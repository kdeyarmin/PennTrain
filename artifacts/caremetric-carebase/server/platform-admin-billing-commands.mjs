import { AdminError, authorizePlatformAdmin, boundedFetch, UUID } from "./platform-admin-auth.mjs";
import { BillingSessionPlanError, planBillingSession } from "../../../supabase/functions/_shared/billingSessionPlan.ts";
import { phase2StripePost, resolvePhase2BillingReturnOrigins, validatePhase2BillingReturnUrl } from "../../../supabase/functions/_shared/phase2Billing.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const PORTAL_ACTION = "billing.portal.create";
// Stripe documents both the path token and the newer single secret parameter.
// Match raw canonical URLs so ports, encoding, extra parameters and fragments
// cannot broaden either accepted capability format.
const PORTAL_URL = /^https:\/\/billing\.stripe\.com\/p\/session(?:\/[A-Za-z0-9_-]{1,2048}|\?secret=[A-Za-z0-9_-]{1,2048})$/;
const keysAre = (v, keys) => v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const invalid = () => { throw new AdminError(400, "invalid_request"); };
const upstream = () => { throw new AdminError(502, "upstream"); };

export function parseBillingCommand(value) {
  if (keysAre(value, ["operation", "commandId", "expectedDigest"]) && value.operation === "apply"
    && typeof value.commandId === "string" && UUID.test(value.commandId)
    && typeof value.expectedDigest === "string" && DIGEST.test(value.expectedDigest)) {
    return { ...value, commandId: value.commandId.toLowerCase() };
  }
  if (!keysAre(value, ["operation", "requestId", "action", "targetId", "parameters", "reason"])
    || value.operation !== "preview" || value.action !== PORTAL_ACTION
    || typeof value.requestId !== "string" || !UUID.test(value.requestId)
    || typeof value.targetId !== "string" || !UUID.test(value.targetId) || !keysAre(value.parameters, [])
    || typeof value.reason !== "string" || value.reason.trim().length < 10 || value.reason.length > 500
    || /[\u0000-\u001f\u007f]/.test(value.reason)) invalid();
  return { ...value, requestId: value.requestId.toLowerCase(), targetId: value.targetId.toLowerCase(), reason: value.reason.trim() };
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) upstream();
  return new Date(value).toISOString();
}

function portalSession(value) {
  if (!keysAre(value, ["kind", "id", "url", "expiresAt", "livemode"]) || value.kind !== "portal"
    || typeof value.id !== "string" || !/^bps_[A-Za-z0-9]+$/.test(value.id)
    || typeof value.url !== "string" || value.url.length > 4096 || value.expiresAt !== null
    || typeof value.livemode !== "boolean") upstream();
  if (!PORTAL_URL.test(value.url)) upstream();
  return { ...value };
}

export function projectBillingCommandResult(value, command, now) {
  const common = ["commandId", "action", "targetId"];
  const preview = command.operation === "preview";
  if (!keysAre(value, [...common, ...(preview ? ["reason", "expiresAt", "previewDigest", "summary"]
    : ["outcome", "replayed", "completedAt", "retryAfterSeconds", "session"])])
    || typeof value.commandId !== "string" || !UUID.test(value.commandId) || value.action !== PORTAL_ACTION
    || typeof value.targetId !== "string" || !UUID.test(value.targetId)) upstream();
  if (preview) {
    if (value.targetId !== command.targetId || value.reason !== command.reason
      || typeof value.previewDigest !== "string" || !DIGEST.test(value.previewDigest)) upstream();
    const expiresAt = date(value.expiresAt);
    if (Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) > now.getTime() + 301_000) upstream();
    const s = value.summary;
    if (!keysAre(s, ["kind", "organizationName", "providerCustomerId", "providerConfigurationId", "returnPath"])
      || s.kind !== "portal" || typeof s.organizationName !== "string" || s.organizationName.length > 500
      || !/^cus_[A-Za-z0-9]+$/.test(s.providerCustomerId) || !/^bpc_[A-Za-z0-9]+$/.test(s.providerConfigurationId)
      || s.returnPath !== "/admin/enterprise") upstream();
    return { ...value, expiresAt, summary: { ...s } };
  }
  if (value.commandId !== command.commandId || !["created", "pending", "failed"].includes(value.outcome)
    || typeof value.replayed !== "boolean") upstream();
  if (value.outcome === "pending") {
    if (value.completedAt !== null || value.session !== null || value.retryAfterSeconds !== 30) upstream();
    return { ...value };
  }
  if (value.retryAfterSeconds !== null || (value.outcome === "failed" && value.session !== null)) upstream();
  return { ...value, completedAt: date(value.completedAt), session: value.outcome === "created" ? portalSession(value.session) : null };
}

function rpcError(result) {
  if (!result?.error) return result?.data;
  const code = result.error.code;
  if (code === "42501") throw new AdminError(403, "forbidden");
  if (code === "P0002") throw new AdminError(404, "notfound");
  if (code === "40001") throw new AdminError(409, "conflict");
  if (["22023", "22007", "22P02"].includes(code)) throw new AdminError(400, "invalid_request");
  throw new AdminError(503, "upstream");
}

function configuration(getEnv) {
  const id = getEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID")?.trim();
  const app = getEnv("PUBLIC_APP_URL") ?? "https://cmcarebase.com";
  let url;
  try { url = new URL("/admin/enterprise", app).href; } catch { throw new AdminError(503, "unconfigured"); }
  const origins = resolvePhase2BillingReturnOrigins(getEnv("BILLING_RETURN_URL_ORIGINS") ?? "", [
    getEnv("PUBLIC_APP_URL"), ...(getEnv("SIGNUP_REDIRECT_ORIGINS") ?? "").split(","),
  ]);
  if (!/^bpc_[A-Za-z0-9]+$/.test(id ?? "") || !validatePhase2BillingReturnUrl(url, origins)) throw new AdminError(503, "unconfigured");
  return { id, url };
}

export function createPlatformAdminBillingCommandHandler({ config, createClient, fetcher = fetch,
  stripePost = phase2StripePost, getEnv = name => process.env[name], now = () => new Date() }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  return async request => {
    try {
      if (!config.enabled || !config.commandsEnabled || !config.billingCommandsEnabled || !config.stripeKey) throw new AdminError(503, "unconfigured");
      if (request.method !== "POST") throw new AdminError(405, "method_not_allowed");
      if (request.headers.has("origin")) throw new AdminError(403, "forbidden");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new AdminError(415, "unsupported_content_type");
      let command;
      try { const raw = await request.text(); if (Buffer.byteLength(raw) > 4096) invalid(); command = parseBillingCommand(JSON.parse(raw)); }
      catch { invalid(); }
      const { native, nativeId, actor, authenticationMethod } = await authorizePlatformAdmin(request, {
        config, command: true, operation: command, parseOperation: parseBillingCommand, createClient, fetcher, now,
      });
      const common = { p_actor: nativeId, p_hub_user: actor.user_id, p_hub_session: actor.session_id,
        p_session_started_at: actor.session_started_at, p_assurance_expires_at: actor.assurance_expires_at,
        p_authentication_method: authenticationMethod };
      const current = configuration(getEnv);
      let data;
      if (command.operation === "preview") {
        const plan = await planBillingSession({ admin: native, profile: { role: "platform_admin" }, organizationId: command.targetId,
          body: { action: "portal", returnUrl: current.url }, getEnv, nowIso: () => now().toISOString() });
        data = rpcError(await native.rpc("platform_admin_preview_billing_portal", { ...common, p_request_id: command.requestId,
          p_target: command.targetId, p_reason: command.reason, p_provider_parameters: plan.values }));
      } else {
        const identity = { ...common, p_command_id: command.commandId, p_expected_digest: command.expectedDigest };
        const claim = rpcError(await native.rpc("platform_admin_claim_billing_portal", { ...identity,
          p_configuration: current.id, p_return_url: current.url }));
        if (keysAre(claim, ["kind", "data"]) && claim.kind === "result") data = claim.data;
        else {
          if (!keysAre(claim, ["kind", "commandId", "targetId", "leaseId", "idempotencyKey", "values", "replayed"])
            || claim.kind !== "execute" || claim.commandId !== command.commandId || !UUID.test(claim.targetId)
            || !UUID.test(claim.leaseId) || claim.idempotencyKey !== `carebase:portal:${command.commandId}`
            || typeof claim.replayed !== "boolean" || !keysAre(claim.values, ["customer", "configuration", "return_url"])
            || !/^cus_[A-Za-z0-9]+$/.test(claim.values.customer) || claim.values.configuration !== current.id
            || claim.values.return_url !== current.url) upstream();
          let outcome = "indeterminate", session = null;
          try {
            const result = await stripePost("/v1/billing_portal/sessions", config.stripeKey, claim.values, claim.idempotencyKey,
              (input, init) => boundedFetch(fetcher, request.signal, input, init));
            if (result.ok) {
              if (result.data.customer !== claim.values.customer || result.data.configuration !== claim.values.configuration) upstream();
              session = portalSession({ kind: "portal", id: result.data.id, url: result.data.url, expiresAt: null, livemode: result.data.livemode });
              outcome = "succeeded";
            } else if ([400, 401, 403, 404, 422].includes(result.status)) outcome = "failed";
          } catch { /* Network failures and malformed success responses leave the result uncertain. */ }
          rpcError(await native.rpc("platform_admin_finish_billing_portal", { p_command_id: command.commandId,
            p_lease_id: claim.leaseId, p_outcome: outcome, p_session: session }));
          data = rpcError(await native.rpc("platform_admin_read_billing_portal_result", { ...identity, p_replayed: claim.replayed }));
        }
      }
      const generatedAt = now();
      return json({ contractVersion: 1, product: "carebase", operation: command.operation,
        generatedAt: generatedAt.toISOString(), data: projectBillingCommandResult(data, command, generatedAt) });
    } catch (error) {
      // No raw provider errors, private portal URLs, identities, bodies or keys in logs.
      if (error instanceof BillingSessionPlanError) return json({ error: { code: error.status === 409 ? "conflict" : "unconfigured" } }, error.status === 409 ? 409 : 503);
      return json({ error: { code: error instanceof AdminError ? error.code : "upstream" } }, error instanceof AdminError ? error.status : 503);
    }
  };
}
