import { AdminError, authorizePlatformAdmin, UUID } from "./platform-admin-auth.mjs";

const ACTIONS = new Set(["users.setActive", "organizations.setSuspension", "billing.setAccessOverride"]);
const DIGEST = /^[0-9a-f]{64}$/;
const keysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = () => { throw new AdminError(400, "invalid_request"); };

function parseCommand(body) {
  if (keysAre(body, ["operation", "commandId", "expectedDigest"]) && body.operation === "apply"
    && typeof body.commandId === "string" && UUID.test(body.commandId)
    && typeof body.expectedDigest === "string" && DIGEST.test(body.expectedDigest)) {
    return { ...body, commandId: body.commandId.toLowerCase() };
  }
  if (!keysAre(body, ["operation", "requestId", "action", "targetId", "parameters", "reason"]) || body.operation !== "preview"
    || !ACTIONS.has(body.action) || typeof body.requestId !== "string" || !UUID.test(body.requestId)
    || typeof body.targetId !== "string" || !UUID.test(body.targetId)
    || typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.length > 500
    || /[\u0000-\u001f\u007f]/.test(body.reason)) fail();
  const p = body.parameters;
  if (body.action === "users.setActive") {
    if (!keysAre(p, ["active"]) || typeof p.active !== "boolean") fail();
  } else if (body.action === "organizations.setSuspension") {
    if (!keysAre(p, ["suspended"]) || typeof p.suspended !== "boolean") fail();
  } else {
    if (!keysAre(p, ["state", "expiresAt"]) || !["comped", "provider"].includes(p.state)) fail();
    if (p.expiresAt !== null && (typeof p.expiresAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(p.expiresAt)
      || !Number.isFinite(Date.parse(p.expiresAt)))) fail();
    if (p.state === "provider" && p.expiresAt !== null) fail();
  }
  return { ...body, requestId: body.requestId.toLowerCase(), targetId: body.targetId.toLowerCase(), reason: body.reason.trim() };
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new AdminError(502, "upstream");
  return new Date(value).toISOString();
}

function projectResult(value, command) {
  const preview = command.operation === "preview";
  const expectedKeys = preview ? ["commandId", "action", "targetId", "reason", "expiresAt", "previewDigest", "changes"]
    : ["commandId", "action", "targetId", "appliedAt", "replayed", "changes"];
  if (!keysAre(value, expectedKeys) || typeof value.commandId !== "string" || !UUID.test(value.commandId)
    || !ACTIONS.has(value.action) || typeof value.targetId !== "string" || !UUID.test(value.targetId)
    || !Array.isArray(value.changes)) throw new AdminError(502, "upstream");
  if (preview ? value.action !== command.action || value.targetId !== command.targetId || value.reason !== command.reason
    : value.commandId !== command.commandId) throw new AdminError(502, "upstream");
  const fields = value.action === "users.setActive" ? ["active"] : ["status", "billingState", "stateSource", "compedUntil"];
  const seen = new Set();
  const changes = value.changes.map((change) => {
    if (!keysAre(change, ["field", "before", "after"]) || !fields.includes(change.field) || seen.has(change.field)) throw new AdminError(502, "upstream");
    seen.add(change.field);
    const project = (v) => {
      if (change.field === "compedUntil") return v === null ? null : timestamp(v);
      if (typeof v !== "string" || v.length > 80 || (change.field === "active" && !["true", "false"].includes(v))) throw new AdminError(502, "upstream");
      return v;
    };
    return { field: change.field, before: project(change.before), after: project(change.after) };
  });
  if (seen.size !== fields.length) throw new AdminError(502, "upstream");
  const common = { commandId: value.commandId, action: value.action, targetId: value.targetId };
  if (preview) {
    if (typeof value.previewDigest !== "string" || !DIGEST.test(value.previewDigest)) throw new AdminError(502, "upstream");
    return { ...common, reason: value.reason, expiresAt: timestamp(value.expiresAt), previewDigest: value.previewDigest, changes };
  }
  if (typeof value.replayed !== "boolean") throw new AdminError(502, "upstream");
  return { ...common, appliedAt: timestamp(value.appliedAt), replayed: value.replayed, changes };
}

export function createPlatformAdminCommandHandler({ config, createClient, fetcher = fetch, now = () => new Date() }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  return async (request) => {
    try {
      if (!config.enabled || !config.commandsEnabled) throw new AdminError(503, "unconfigured");
      if (request.method !== "POST") throw new AdminError(405, "method_not_allowed");
      if (request.headers.has("origin")) throw new AdminError(403, "forbidden");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new AdminError(415, "unsupported_content_type");
      let body;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 4096) fail(); body = JSON.parse(raw); }
      catch { fail(); }
      const command = parseCommand(body);
      const { native, nativeId, actor, authenticationMethod } = await authorizePlatformAdmin(request, {
        config, command: true, operation: command, parseOperation: parseCommand, createClient, fetcher, now,
      });
      const common = { p_actor: nativeId, p_hub_user: actor.user_id, p_hub_session: actor.session_id,
        p_session_started_at: actor.session_started_at, p_assurance_expires_at: actor.assurance_expires_at,
        p_authentication_method: authenticationMethod };
      const result = command.operation === "preview"
        ? await native.rpc("platform_admin_preview_command", { ...common, p_request_id: command.requestId, p_action: command.action,
          p_target: command.targetId, p_parameters: command.parameters, p_reason: command.reason })
        : await native.rpc("platform_admin_apply_command", { ...common, p_command_id: command.commandId, p_expected_digest: command.expectedDigest });
      if (result.error) {
        if (result.error.code === "42501") throw new AdminError(403, "forbidden");
        if (result.error.code === "P0002") throw new AdminError(404, "notfound");
        if (result.error.code === "40001") throw new AdminError(409, "conflict");
        if (["22023", "22007", "22P02"].includes(result.error.code)) throw new AdminError(400, "invalid_request");
        throw new AdminError(503, "upstream");
      }
      const data = projectResult(result.data, command);
      return json({ contractVersion: 1, product: "carebase", operation: command.operation, generatedAt: now().toISOString(), data });
    } catch (error) {
      // No identity, reason, provider response or request body is logged or echoed in errors.
      return json({ error: { code: error instanceof AdminError ? error.code : "upstream" } }, error instanceof AdminError ? error.status : 503);
    }
  };
}
