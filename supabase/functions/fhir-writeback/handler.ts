import { type FhirOutboundCredential, authorizeFhirOutboundRow, fhirOutboundCredentialMatches, parseFhirOutboundCredentials } from "../_shared/fhirOutboundAuth.ts";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import {
  phase2PinnedWebhookRequest,
  sanitizePhase2IntegrationError,
  validatePhase2WebhookDestination,
} from "../_shared/phase2Integration.ts";

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-correlation-id, x-request-id",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface ClaimedWriteback {
  id: string;
  organization_id: string;
  facility_id: string;
  source_id: string;
  resident_id: string;
  fhir_patient_id: string;
  resource_type: string;
  origin_kind: string;
  origin_id: string;
  fhir_payload: Record<string, unknown>;
  target_url: string | null;
  attempts: number;
}

// FHIR "create" is a POST to {base}/{ResourceType}. Join without duplicating slashes.
function fhirCreateUrl(baseUrl: string, resourceType: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${resourceType}`;
}

// The created resource id is returned in the response body for a FHIR create; the pinned
// transport does not surface response headers, so fall back to the body's logical id.
function extractResourceId(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length <= 200 ? parsed.id : null;
  } catch {
    return null;
  }
}

export function createFhirWritebackHandler({
  createClient,
  getEnv = (name: string) => Deno.env.get(name),
  authorizeRequest = requireCronRequest,
  resolveDestination = validatePhase2WebhookDestination,
  send = phase2PinnedWebhookRequest,
}: {
  // Real clients are generic; dependency injection lets tests exercise the actual request path.
  createClient: (url: string, key: string) => any;
  getEnv?: (name: string) => string | undefined;
  authorizeRequest?: typeof requireCronRequest;
  resolveDestination?: typeof validatePhase2WebhookDestination;
  send?: typeof phase2PinnedWebhookRequest;
}) {
 return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authError = authorizeRequest(req, CORS_HEADERS);
  if (authError) return authError;

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "service_not_configured" }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: { limit?: number; batchSize?: number } = {};
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // An empty/absent body is a normal scheduled invocation.
    body = {};
  }
  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const limit = Math.min(Math.max(Math.trunc(body.limit ?? body.batchSize ?? 20), 1), 100);

  // The run ledger is what the watchdog and /admin/system-jobs read -- pg_cron delivery
  // success is deliberately ignored for edge_cron definitions (the 20260814010000 lesson),
  // so a drain that never records runs reads as permanently stale while its cron requests
  // succeed, and operator "run now" rows stay stuck at queued.
  const { data: jobClaim, error: jobClaimError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: "fhir-writeback-drain",
    p_correlation_id: correlationId,
    p_trigger_type: "scheduled",
    p_provider_request_id: req.headers.get("x-request-id"),
  });
  if (jobClaimError) return json({ error: "job_claim_failed", correlationId }, 500);
  const claim = Array.isArray(jobClaim) ? jobClaim[0] : jobClaim;
  const systemJobRunId = claim?.run_id as string | undefined;
  if (!systemJobRunId) return json({ error: "job_claim_failed", correlationId }, 500);
  if (!claim?.should_execute) {
    return json({ success: true, replayed: true, correlationId, runId: systemJobRunId });
  }

  const finishRun = async (
    status: "succeeded" | "partial" | "failed",
    attempted: number,
    succeeded: number,
    failedCount: number,
    result: Record<string, unknown>,
    errorMessage: string | null,
  ) => {
    const { error } = await admin.rpc("finish_system_job", {
      p_run_id: systemJobRunId,
      p_status: status,
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failedCount,
      p_result: result,
      p_error_code: errorMessage ? "writeback_drain_failed" : null,
      p_error_message: errorMessage,
    });
    if (error) console.error("fhir-writeback: finish_system_job failed", error.message);
  };

  let credentials;
  try { credentials = parseFhirOutboundCredentials(getEnv("FHIR_OUTBOUND_AUTH_JSON")); }
  catch {
    await finishRun("failed", 0, 0, 0, { correlationId }, "outbound FHIR configuration is invalid");
    return json({ error: "outbound_auth_configuration_invalid", correlationId }, 503);
  }
  const configuredCredentials = new Map<string, FhirOutboundCredential>();
  if (credentials.size > 0) {
    const { data: sources, error: sourcesError } = await admin.from("fhir_integration_sources")
      .select("id,organization_id,fhir_base_url,writeback_contract_reference,writeback_conditional_create_confirmed,facility:facilities!inner(clinical_enabled)")
      .in("id", [...credentials.keys()]).eq("writeback_enabled", true).eq("status", "active").eq("facility.clinical_enabled", true);
    if (sourcesError) {
      await finishRun("failed", 0, 0, 0, { correlationId }, "outbound source authorization lookup failed");
      return json({ error: "source_authorization_unavailable", correlationId }, 503);
    }
    for (const source of sources ?? []) {
      const credential = credentials.get(source.id);
      if (credential && fhirOutboundCredentialMatches(credential, source)) configuredCredentials.set(source.id, credential);
    }
  }
  if (configuredCredentials.size === 0) {
    // Checked BEFORE the claim so nothing is marked in_flight and no attempts counter moves: the
    // rows stay exactly as queued for whenever delivery becomes possible. Reported as a real run
    // outcome rather than a silent success, but only noisy when there is actually something
    // waiting -- a scheduled tick with an empty queue is not an incident.
    const { count, error: pendingError } = await admin
      .from("fhir_writeback_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (pendingError) {
      await finishRun("failed", 0, 0, 0, { correlationId }, "pending write-back count failed");
      return json({ error: "pending_count_failed", correlationId }, 500);
    }
    const pending = count ?? 0;
    const message =
      "FHIR write-back has no outbound credential for the connected source, so no PHI was sent. " +
      "The queued rows are untouched.";
    await finishRun(
      pending > 0 ? "failed" : "succeeded",
      0,
      0,
      0,
      { correlationId, pending, skipped: "outbound_auth_not_configured" },
      pending > 0 ? message : null,
    );
    return json(
      { success: pending === 0, skipped: "outbound_auth_not_configured", pending, message, correlationId },
      pending > 0 ? 503 : 200,
    );
  }

  const { count: blockedCount, error: blockedError } = await admin.from("fhir_writeback_queue")
    .select("id", { count: "exact", head: true }).eq("status", "pending")
    .not("source_id", "in", `(${[...configuredCredentials.keys()].join(",")})`);
  if (blockedError) {
    await finishRun("failed", 0, 0, 0, { correlationId }, "unconfigured write-back count failed");
    return json({ error: "pending_count_failed", correlationId }, 500);
  }
  const unconfiguredPending = blockedCount ?? 0;
  const { data: claimRows, error: claimError } = await admin.rpc("claim_fhir_writeback_batch", {
    p_limit: limit,
    p_source_ids: [...configuredCredentials.keys()],
  });
  if (claimError) {
    await finishRun("failed", 0, 0, 0, { correlationId }, "claim_fhir_writeback_batch failed");
    return json({ error: "claim_failed", correlationId }, 500);
  }

  const claimed = (claimRows ?? []) as ClaimedWriteback[];
  let sent = 0;
  let failed = 0;
  let persistenceErrors = 0;

  const concurrency = 5;
  for (let offset = 0; offset < claimed.length; offset += concurrency) {
    await Promise.all(claimed.slice(offset, offset + concurrency).map(async (row) => {
      let success = false;
      let externalId: string | null = null;
      let errorMessage: string | null = null;
      // Transient provider trouble (network failure, timeout, throttle, server error) goes
      // back to 'pending' for the next tick instead of parking at terminal 'failed' -- one
      // EHR restart at drain time otherwise stranded the observation forever. Config and
      // contract failures (bad destination, 4xx) stay terminal.
      let retryable = false;
      try {
        if (!row.target_url) throw new TypeError("Write-back source has no FHIR base URL");
        const authorization = authorizeFhirOutboundRow(configuredCredentials, row);
        const destination = await resolveDestination(row.target_url);
        if (!destination.valid) {
          throw new TypeError(`Unsafe write-back destination: ${destination.reason ?? "rejected"}`);
        }
        // Retries are only safe if a re-sent create cannot duplicate the resource: a network
        // error or timeout is ambiguous AFTER the POST bytes left -- the EHR may have created
        // the resource without this worker seeing the response. Stamp a deterministic
        // identifier (the queue row's origin id, unique per source observation) into the
        // payload and send FHIR conditional create (If-None-Exist) keyed on it, so a
        // conforming server treats the retry as a no-op returning the existing resource.
        // Non-conforming servers ignore the header, which degrades to today's risk, not
        // below it.
        const identifierSystem = `https://cmcarebase.com/fhir/identifiers/${row.origin_kind.replace(/_/g, "-")}`;
        const payloadWithIdentity = {
          ...row.fhir_payload,
          identifier: [
            ...(Array.isArray(row.fhir_payload.identifier) ? row.fhir_payload.identifier.filter((value: unknown) =>
              !!value && typeof value === "object" && (value as { system?: unknown }).system !== identifierSystem) : []),
            { system: identifierSystem, value: row.origin_id },
          ],
        };
        const outbound = await send(
          fhirCreateUrl(row.target_url, row.resource_type),
          {
            method: "POST",
            headers: {
              "Authorization": authorization,
              "Content-Type": "application/fhir+json",
              "Accept": "application/fhir+json",
              "User-Agent": "CareMetric-CareBase-FHIR-Writeback/1.0",
              "X-Correlation-Id": correlationId,
              "If-None-Exist": `identifier=${identifierSystem}|${row.origin_id}`,
            },
            body: JSON.stringify(payloadWithIdentity),
            timeoutMs: 15_000,
          },
          destination.addresses,
        );
        success = outbound.ok;
        const responseText = (await outbound.text()).slice(0, 64 * 1024);
        if (success) {
          externalId = extractResourceId(responseText);
        } else {
          errorMessage = `FHIR endpoint returned HTTP ${outbound.status}`;
          retryable = outbound.status === 408 || outbound.status === 429 || outbound.status >= 500;
        }
      } catch (error) {
        errorMessage = sanitizePhase2IntegrationError(error);
        // TypeError marks this run's own configuration guards above; everything else out of
        // the pinned transport is a network-level failure worth retrying.
        retryable = !(error instanceof TypeError);
      }

      // The resource has ALREADY been POSTed by this point, so failing to record the outcome is
      // not a neutral error: the row stays claimable and the next run sends it again, creating a
      // duplicate in the customer's EHR. Retry the bookkeeping before giving up, and if it still
      // fails, log the external id at error level -- that id is the only handle anyone has for
      // reconciling the duplicate, and it exists nowhere else once this function returns.
      let completionError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error } = await admin.rpc("complete_fhir_writeback", {
          p_id: row.id,
          p_success: success,
          p_external_resource_id: externalId,
          p_error: errorMessage,
          p_retryable: retryable,
        });
        completionError = error;
        if (!error) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
      if (completionError) {
        console.error(
          "complete_fhir_writeback failed after retries; this row will be re-sent and may duplicate",
          { rowId: row.id, delivered: success, externalResourceId: externalId, correlationId, error: completionError.message },
        );
        persistenceErrors++;
        return;
      }
      if (success) sent++;
      else failed++;
    }));
  }

  const result = { claimed: claimed.length, sent, failed, persistenceErrors, unconfiguredPending, correlationId };
  await finishRun(
    persistenceErrors > 0 || failed > 0 || unconfiguredPending > 0 ? "partial" : "succeeded",
    claimed.length,
    sent,
    failed + persistenceErrors,
    result,
    persistenceErrors > 0 ? "some write-back outcomes could not be recorded"
      : unconfiguredPending > 0 ? "some pending sources require outbound authorization" : null,
  );
  return json(result, persistenceErrors > 0 ? 500 : 200);
 };
}
