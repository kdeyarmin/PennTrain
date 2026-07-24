import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  decodePhase2Cursor,
  encodePhase2Cursor,
  parsePhase2ApiCredential,
  PHASE2_INTEGRATION_SCHEMA_VERSION,
  phase2CommandContract,
  phase2CommandSchemaVersionError,
  phase2CommandScopeCandidates,
  phase2IntegrationHeaders,
  phase2IntegrationSha256,
} from "../_shared/phase2Integration.ts";

const MAX_BODY_BYTES = 256 * 1024;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, idempotency-key, x-correlation-id, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  const isCommands = url.pathname.endsWith("/v1/commands") && req.method === "POST";
  const isEvents = url.pathname.endsWith("/v1/events") && req.method === "GET";
  const isEntitlements = url.pathname.endsWith("/v1/entitlements") && req.method === "GET";
  if (!isCommands && !isEvents && !isEntitlements) {
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

  // The required scope on the commands route depends on the named command
  // (PT-003: e.g. medication.snapshot.import accepts the least-privilege
  // medications:write scope), so the bounded envelope is read before
  // authenticating. Read routes keep their fixed scope.
  let commandBody: Record<string, unknown> | null = null;
  let commandType = "";
  let rawBody = "";
  if (isCommands) {
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return response({ error: { code: "payload_too_large" }, meta: { correlationId } }, 413, correlationId);
    }
    rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return response({ error: { code: "payload_too_large" }, meta: { correlationId } }, 413, correlationId);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return response({ error: { code: "invalid_json" }, meta: { correlationId } }, 400, correlationId);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return response({ error: { code: "invalid_command_envelope" }, meta: { correlationId } }, 400, correlationId);
    }
    commandBody = parsed as Record<string, unknown>;
    commandType = typeof commandBody.commandType === "string" ? commandBody.commandType : "";
  }
  const scopeCandidates = isCommands
    ? phase2CommandScopeCandidates(commandType)
    : [isEvents ? "events:read" : "entitlements:read"];
  const secretSha256 = await phase2IntegrationSha256(plaintextKey);
  let credential: Record<string, unknown> | null = null;
  for (const requiredScope of scopeCandidates) {
    const { data: authRows, error: authError } = await admin.rpc(
      "authenticate_integration_api_credential",
      {
        p_secret_sha256: secretSha256,
        p_required_scope: requiredScope,
        p_correlation_id: correlationId,
      },
    );
    if (authError) break;
    const row = Array.isArray(authRows) ? authRows[0] : authRows;
    if (row) {
      credential = row as Record<string, unknown>;
      break;
    }
  }
  if (!credential) {
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

  if (isCommands) {
    const body = commandBody as Record<string, unknown>;
    const idempotencyKey = req.headers.get("idempotency-key") ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200 ||
      !/^[a-z][a-z0-9_.:-]{1,149}$/.test(commandType) ||
      typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload) ||
      (body.organizationId !== undefined && body.organizationId !== credential.organization_id)) {
      return response({ error: { code: "invalid_command_envelope" }, meta: { correlationId } }, 400, correlationId, rate);
    }
    // Per-command contract: registered commands must be submitted at their
    // registered version; everything else keeps the global baseline.
    const contract = phase2CommandContract(commandType);
    const versionError = phase2CommandSchemaVersionError(commandType, body.schemaVersion);
    if (versionError) {
      return response({
        error: {
          code: "schema_version_mismatch",
          message: versionError,
          expectedSchemaVersion: contract.schemaVersion,
        },
        meta: { correlationId },
      }, 400, correlationId, rate);
    }
    const { data: commandRows, error: commandError } = await admin.rpc("accept_integration_command", {
      p_credential_id: credential.credential_id,
      p_idempotency_key: idempotencyKey,
      p_request_sha256: await phase2IntegrationSha256(rawBody),
      p_command_type: commandType,
      p_schema_version: contract.schemaVersion,
      p_payload: body.payload,
      p_correlation_id: correlationId,
    });
    if (commandError) {
      const conflict = commandError.code === "23505";
      return response({
        error: { code: conflict ? "idempotency_conflict" : "command_rejected" },
        meta: { schemaVersion: contract.schemaVersion, correlationId },
      }, conflict ? 409 : 422, correlationId, rate);
    }
    const command = Array.isArray(commandRows) ? commandRows[0] : commandRows;
    return response({
      data: {
        commandId: command.command_id,
        status: command.command_status,
        duplicate: command.was_duplicate,
      },
      meta: { schemaVersion: contract.schemaVersion, correlationId: command.correlation_id },
    }, command.was_duplicate ? 200 : 202, correlationId, rate);
  }

  if (isEvents) {
    let afterSequence: number;
    try {
      afterSequence = decodePhase2Cursor(url.searchParams.get("cursor"));
    } catch {
      return response({ error: { code: "invalid_cursor" }, meta: { correlationId } }, 400, correlationId, rate);
    }
    const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
    const { data: rows, error } = await admin.rpc("list_integration_events", {
      p_credential_id: credential.credential_id,
      p_after_sequence: afterSequence,
      p_limit: limit,
    });
    if (error) return response({ error: { code: "event_read_failed" }, meta: { correlationId } }, 500, correlationId, rate);
    const events = (rows ?? []).map((row: Record<string, unknown>) => ({
      sequence: row.sequence_number,
      eventId: row.event_id,
      eventType: row.event_type,
      schemaVersion: row.event_schema_version,
      occurredAt: row.occurred_at,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      data: row.payload,
    }));
    const lastSequence = events.length ? Number(events[events.length - 1].sequence) : afterSequence;
    return response({
      data: events,
      page: {
        nextCursor: events.length ? encodePhase2Cursor(lastSequence) : null,
        hasMore: events.length === limit,
      },
      meta: { schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION, correlationId },
    }, 200, correlationId, rate);
  }

  const { data: entitlements, error: entitlementError } = await admin.rpc("get_effective_entitlements", {
    p_organization_id: credential.organization_id,
    p_as_of: new Date().toISOString(),
  });
  if (entitlementError) {
    return response({ error: { code: "entitlement_read_failed" }, meta: { correlationId } }, 500, correlationId, rate);
  }
  return response({
    data: entitlements,
    meta: { schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION, correlationId },
  }, 200, correlationId, rate);
});
