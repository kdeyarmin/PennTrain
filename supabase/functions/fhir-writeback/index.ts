// FHIR clinical write-back drain (outbound).
//
// Drains public.fhir_writeback_queue: for each claimed row it POSTs the pre-serialized FHIR
// resource to the connected source's FHIR base URL and records the outcome. Write-back is opt-in
// per source (fhir_integration_sources.writeback_enabled) and gated in the database by the
// clinical.integration.writeback permission before a row is ever queued -- this worker only moves
// rows that queue_clinical_observation_writeback already authorized. Outbound requests use the
// same SSRF-guarded, DNS-pinned, TLS-checked transport as the signed-webhook dispatcher.
//
// Cron-only: authenticated with the shared cron secret (no user JWT). Enable delivery by
// scheduling this function; with no write-back-enabled sources the claim returns nothing and the
// call is a cheap no-op.

import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authError = requireCronRequest(req, CORS_HEADERS);
  if (authError) return authError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "service_not_configured" }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: { limit?: number; batchSize?: number } = {};
  try {
    body = await req.json();
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

  const { data: claimRows, error: claimError } = await admin.rpc("claim_fhir_writeback_batch", {
    p_limit: limit,
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
        const destination = await validatePhase2WebhookDestination(row.target_url);
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
          identifier: Array.isArray(row.fhir_payload.identifier)
            ? row.fhir_payload.identifier
            : [{ system: identifierSystem, value: row.origin_id }],
        };
        const outbound = await phase2PinnedWebhookRequest(
          fhirCreateUrl(row.target_url, row.resource_type),
          {
            method: "POST",
            headers: {
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

  const result = { claimed: claimed.length, sent, failed, persistenceErrors, correlationId };
  await finishRun(
    persistenceErrors > 0 ? "partial" : "succeeded",
    claimed.length,
    sent,
    failed + persistenceErrors,
    result,
    persistenceErrors > 0 ? "some write-back outcomes could not be recorded" : null,
  );
  return json(result, persistenceErrors > 0 ? 500 : 200);
});
