import { AdminError, authorizePlatformAdmin, readPlatformAdminConfig, UUID } from "./platform-admin-auth.mjs";
import { createProviderRouter } from "./provider-router.mjs";

const SHA = /^[0-9a-f]{64}$/;
const definitions = {
  resolve_identity: ["organizationId", "employeeId"],
  provision: ["mappingId", "organizationId", "employeeId", "hubTenantId", "hubUserId", "courseId", "versionId", "sourceRevision"],
  revoke: ["mappingId"], list: ["limit"], acknowledge: ["eventId", "sourceDigest"], retract: ["assignmentId", "expectedSequence"],
};
function parse(value) {
  const fields = value && typeof value === "object" && !Array.isArray(value) && definitions[value.operation];
  if (!fields || Object.keys(value).length !== fields.length + 1 || !fields.every(key => Object.hasOwn(value, key))) throw new AdminError(400, "invalid_request");
  for (const key of fields) {
    const v = value[key];
    if (key === "limit" || key === "expectedSequence") {
      if (!Number.isSafeInteger(v) || v < 1 || v > (key === "limit" ? 10 : 2147483647)) throw new AdminError(400, "invalid_request");
    } else if (typeof v !== "string" || !(key === "sourceRevision" || key === "sourceDigest" ? SHA : UUID).test(v)) throw new AdminError(400, "invalid_request");
  }
  return value;
}
function project(value, op) {
  const uuid = v => { if (typeof v !== "string" || !UUID.test(v)) throw new AdminError(502, "upstream"); return v; };
  if (op.operation === "resolve_identity") {
    if (!value || value.organizationId?.toLowerCase() !== op.organizationId.toLowerCase() || value.employeeId?.toLowerCase() !== op.employeeId.toLowerCase()) throw new AdminError(502, "upstream");
    return { organizationId: uuid(value.organizationId), employeeId: uuid(value.employeeId), profileId: uuid(value.profileId) };
  }
  if (op.operation === "provision") {
    if (!value || value.mappingId?.toLowerCase() !== op.mappingId.toLowerCase() || value.sourceRevision !== op.sourceRevision || value.active !== true) throw new AdminError(502, "upstream");
    return { mappingId: uuid(value.mappingId), sourceRevision: value.sourceRevision, active: true };
  }
  if (op.operation === "list") {
    if (!Array.isArray(value) || value.length > op.limit) throw new AdminError(502, "upstream");
    const batch=[]; let bytes=2;
    for (const row of value) {
      if (!row || typeof row.payload !== "string" || Buffer.byteLength(row.payload) > 100000 || !SHA.test(row.sourceDigest)
        || !["pending", "quarantined", "delivered"].includes(row.state)
        || !(row.reason === null || ["mapping_disabled", "policy_drift", "missing_renewal_evidence", "binding_identity_drift", "receipt_retracted", "receipt_limits"].includes(row.reason))) throw new AdminError(502, "upstream");
      const projected={ eventId: uuid(row.eventId), payload: row.state === "quarantined" ? "" : row.payload, sourceDigest: row.sourceDigest, state: row.state, reason: row.reason };
      bytes+=Buffer.byteLength(JSON.stringify(projected))+1;
      if(bytes>900000) break; // Remaining events stay unacknowledged for the next pull.
      batch.push(projected);
    }
    return batch;
  }
  if (op.operation === "retract") uuid(value);
  return { success: true };
}
export function createLearningAdminHandler({ config, enabled = false, createClient, fetcher = fetch, now = () => new Date() }) {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  return async request => {
    try {
      if (!enabled || !config.enabled || !config.commandsEnabled) throw new AdminError(503, "unconfigured");
      let op;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 4096) throw new Error(); op = parse(JSON.parse(raw)); }
      catch { throw new AdminError(400, "invalid_request"); }
      const { native, nativeId, authenticationMethod } = await authorizePlatformAdmin(request, { config, command: true, learning: true,
        operation: op, parseOperation: parse, createClient, fetcher, now });
      const actor = { p_actor_id: nativeId, p_authentication_method: authenticationMethod };
      const calls = {
        resolve_identity: ["resolve_learning_receipt_identity", { p_organization_id: op.organizationId, p_employee_id: op.employeeId }],
        provision: ["provision_learning_receipt_mapping", { p_mapping_id: op.mappingId, p_organization_id: op.organizationId, p_employee_id: op.employeeId,
          p_hub_tenant_id: op.hubTenantId, p_hub_user_id: op.hubUserId, p_course_id: op.courseId, p_version_id: op.versionId, p_source_revision: op.sourceRevision }],
        revoke: ["revoke_learning_receipt_mapping", { p_mapping_id: op.mappingId }],
        list: ["list_learning_receipt_outbox", { p_limit: op.limit }],
        acknowledge: ["acknowledge_learning_receipt", { p_event_id: op.eventId, p_source_digest: op.sourceDigest }],
        retract: ["retract_learning_receipt", { p_assignment_id: op.assignmentId, p_expected_sequence: op.expectedSequence }],
      };
      const [rpc, args] = calls[op.operation];
      const result = await native.rpc(rpc, { ...args, ...actor });
      if (result.error) {
        const code = result.error.code;
        throw new AdminError(code === "42501" ? 403 : code === "40001" ? 409 : code === "22023" ? 400 : 503,
          code === "42501" ? "forbidden" : code === "40001" ? "conflict" : code === "22023" ? "invalid_request" : "upstream");
      }
      return json(project(result.data, op));
    } catch (error) { return json({ error: { code: error instanceof AdminError ? error.code : "upstream" } }, error instanceof AdminError ? error.status : 503); }
  };
}
export function createLearningAdminRouter(options = {}) {
  const getEnv = options.getEnv ?? (name => process.env[name]);
  const config = options.config ?? readPlatformAdminConfig(getEnv);
  const enabled = getEnv("CAREMETRIC_LEARNING_RECEIPTS_ENABLED") === "true";
  return createProviderRouter({ handlers: new Map([["receipt", createLearningAdminHandler({ ...options, config, enabled })]]),
    enabled: config.enabled && config.commandsEnabled && enabled, prefix: "/api/learning-admin/", unavailableCode: "unconfigured",
    routes: new Map([["receipt", { bytes: 4096, browser: false }]]), forwardedHeaders: ["authorization", "origin", "content-type"],
    handlerTimeoutMs: 12000, maxConcurrent: 4, maxPendingBodies: 8 });
}
