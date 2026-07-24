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

  const { data: claimRows, error: claimError } = await admin.rpc("claim_fhir_writeback_batch", {
    p_limit: limit,
  });
  if (claimError) return json({ error: "claim_failed", correlationId }, 500);

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
      try {
        if (!row.target_url) throw new TypeError("Write-back source has no FHIR base URL");
        const destination = await validatePhase2WebhookDestination(row.target_url);
        if (!destination.valid) {
          throw new TypeError(`Unsafe write-back destination: ${destination.reason ?? "rejected"}`);
        }
        const outbound = await phase2PinnedWebhookRequest(
          fhirCreateUrl(row.target_url, row.resource_type),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/fhir+json",
              "Accept": "application/fhir+json",
              "User-Agent": "CareMetric-CareBase-FHIR-Writeback/1.0",
              "X-Correlation-Id": correlationId,
            },
            body: JSON.stringify(row.fhir_payload),
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
        }
      } catch (error) {
        errorMessage = sanitizePhase2IntegrationError(error);
      }

      const { error: completionError } = await admin.rpc("complete_fhir_writeback", {
        p_id: row.id,
        p_success: success,
        p_external_resource_id: externalId,
        p_error: errorMessage,
      });
      if (completionError) {
        persistenceErrors++;
        return;
      }
      if (success) sent++;
      else failed++;
    }));
  }

  const result = { claimed: claimed.length, sent, failed, persistenceErrors, correlationId };
  return json(result, persistenceErrors > 0 ? 500 : 200);
});
