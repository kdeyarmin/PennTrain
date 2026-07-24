import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  parsePhase2ApiCredential,
  PHASE2_INTEGRATION_SCHEMA_VERSION,
  phase2IntegrationHeaders,
  phase2IntegrationSha256,
} from "../_shared/phase2Integration.ts";
import { mapFhirBundle } from "../_shared/fhirMapping.ts";

// FHIR R4 ingestion endpoint. Accepts a FHIR Bundle (or single resource), maps the supported
// medication resources into normalized records, and submits them through the existing versioned
// command inbox (fhir.bundle.import). Read-only boundary: CareBase never writes back to the
// source. Mirrors integration-api's credential auth, rate limiting, and command envelope.

const MAX_BODY_BYTES = 512 * 1024;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, idempotency-key, x-correlation-id, x-request-id, x-fhir-source-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(
  body: unknown,
  status: number,
  correlationId: string,
  rate?: { limit: number; remaining: number; resetAt: string },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...phase2IntegrationHeaders(correlationId, rate) },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/v1/fhir/bundle") || req.method !== "POST") {
    return response({ error: { code: "route_not_found" }, meta: { correlationId } }, 404, correlationId);
  }

  const plaintextKey = parsePhase2ApiCredential(req.headers.get("authorization"));
  if (!plaintextKey) {
    return response({ error: { code: "unauthorized" }, meta: { correlationId } }, 401, correlationId);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: { code: "service_not_configured" }, meta: { correlationId } }, 503, correlationId);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: authRows, error: authError } = await admin.rpc("authenticate_integration_api_credential", {
    p_secret_sha256: await phase2IntegrationSha256(plaintextKey),
    p_required_scope: "commands:write",
    p_correlation_id: correlationId,
  });
  const credential = Array.isArray(authRows) ? authRows[0] : authRows;
  if (authError || !credential) {
    return response({ error: { code: "unauthorized" }, meta: { correlationId } }, 401, correlationId);
  }
  const { data: rateRows, error: rateError } = await admin.rpc("consume_integration_rate_limit", {
    p_credential_id: credential.credential_id,
    p_cost: 1,
  });
  const rateRow = Array.isArray(rateRows) ? rateRows[0] : rateRows;
  if (rateError || !rateRow) {
    return response({ error: { code: "rate_limit_unavailable" }, meta: { correlationId } }, 503, correlationId);
  }
  const rate = {
    limit: credential.rate_limit_per_minute as number,
    remaining: rateRow.remaining as number,
    resetAt: rateRow.reset_at as string,
  };
  if (!rateRow.allowed) {
    return response({ error: { code: "rate_limit_exceeded" }, meta: { correlationId } }, 429, correlationId, rate);
  }

  const sourceId = req.headers.get("x-fhir-source-id") ?? url.searchParams.get("source_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) {
    return response({ error: { code: "missing_source_id" }, meta: { correlationId } }, 400, correlationId, rate);
  }
  const idempotencyKey = req.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return response({ error: { code: "invalid_idempotency_key" }, meta: { correlationId } }, 400, correlationId, rate);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return response({ error: { code: "payload_too_large" }, meta: { correlationId } }, 413, correlationId, rate);
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return response({ error: { code: "payload_too_large" }, meta: { correlationId } }, 413, correlationId, rate);
  }
  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return response({ error: { code: "invalid_json" }, meta: { correlationId } }, 400, correlationId, rate);
  }
  if (typeof bundle.resourceType !== "string") {
    return response({ error: { code: "invalid_fhir_resource" }, meta: { correlationId } }, 400, correlationId, rate);
  }

  const mapped = mapFhirBundle(bundle, new Date().toISOString());
  const supportedCount = mapped.medicationRequests.length + mapped.medicationAdministrations.length +
    mapped.allergies.length + mapped.conditions.length + mapped.serviceRequests.length +
    mapped.documentReferences.length;
  if (supportedCount === 0) {
    return response({
      error: { code: "no_supported_resources" },
      meta: { correlationId, unsupported: mapped.unsupported },
    }, 422, correlationId, rate);
  }

  const payload = {
    sourceId,
    medicationRequests: mapped.medicationRequests,
    medicationAdministrations: mapped.medicationAdministrations,
    allergies: mapped.allergies,
    conditions: mapped.conditions,
    serviceRequests: mapped.serviceRequests,
    documentReferences: mapped.documentReferences,
  };
  const { data: commandRows, error: commandError } = await admin.rpc("accept_integration_command", {
    p_credential_id: credential.credential_id,
    p_idempotency_key: idempotencyKey,
    // Bind the request fingerprint to the target source too: one credential can serve multiple
    // FHIR sources, so the same Bundle body replayed for a different x-fhir-source-id must not
    // collide with the first source's command (sourceId comes from the header, not rawBody).
    p_request_sha256: await phase2IntegrationSha256(`${sourceId}\n${rawBody}`),
    p_command_type: "fhir.bundle.import",
    p_schema_version: PHASE2_INTEGRATION_SCHEMA_VERSION,
    p_payload: payload,
    p_correlation_id: correlationId,
  });
  if (commandError) {
    const conflict = commandError.code === "23505";
    return response({
      error: { code: conflict ? "idempotency_conflict" : "command_rejected" },
      meta: { schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION, correlationId },
    }, conflict ? 409 : 422, correlationId, rate);
  }
  const command = Array.isArray(commandRows) ? commandRows[0] : commandRows;
  return response({
    data: {
      commandId: command.command_id,
      status: command.command_status,
      duplicate: command.was_duplicate,
      mapped: {
        medicationRequests: mapped.medicationRequests.length,
        medicationAdministrations: mapped.medicationAdministrations.length,
        allergies: mapped.allergies.length,
        conditions: mapped.conditions.length,
        serviceRequests: mapped.serviceRequests.length,
        documentReferences: mapped.documentReferences.length,
        unsupported: mapped.unsupported.length,
      },
    },
    meta: { schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION, correlationId: command.correlation_id },
  }, command.was_duplicate ? 200 : 202, correlationId, rate);
});
