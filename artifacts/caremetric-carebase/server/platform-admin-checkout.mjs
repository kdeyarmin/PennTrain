import { AdminError, boundedFetch, UUID } from "./platform-admin-auth.mjs";
import { planBillingSession } from "../../../supabase/functions/_shared/billingSessionPlan.ts";
import { checkoutRpc, executeCheckoutClaim, projectCheckoutResult, projectCheckoutPreview, projectCheckoutRecovery } from "../../../supabase/functions/_shared/checkoutReservations.ts";
import { phase2StripeGet, phase2StripePost } from "../../../supabase/functions/_shared/phase2Billing.ts";

const ACTION = "billing.checkout.create", RECOVER = "billing.checkout.recover", DIGEST = /^[0-9a-f]{64}$/;
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
const invalid = () => {throw new AdminError(400, "invalid_request");};
const upstream = () => {throw new AdminError(502, "upstream");};

export function parseCheckoutCommand(value) {
  if (keys(value, ["operation", "action", "requestId", "targetId", "reason"]) && value.operation === "recover" && value.action === RECOVER
    && typeof value.requestId === "string" && UUID.test(value.requestId) && typeof value.targetId === "string" && UUID.test(value.targetId)
    && typeof value.reason === "string" && value.reason.trim().length >= 10 && value.reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value.reason))
    return {...value, requestId: value.requestId.toLowerCase(), targetId: value.targetId.toLowerCase(), reason: value.reason.trim()};
  if (keys(value, ["operation", "action", "commandId", "expectedDigest"]) && ["apply", "check"].includes(value.operation)
    && (value.action === ACTION || value.action === RECOVER && value.operation === "check") && typeof value.commandId === "string" && UUID.test(value.commandId)
    && typeof value.expectedDigest === "string" && DIGEST.test(value.expectedDigest)) return {...value, commandId: value.commandId.toLowerCase()};
  if (!keys(value, ["operation", "action", "requestId", "targetId", "reason", "parameters"]) || value.operation !== "preview" || value.action !== ACTION
    || typeof value.requestId !== "string" || !UUID.test(value.requestId) || typeof value.targetId !== "string" || !UUID.test(value.targetId)
    || !keys(value.parameters, ["packageId", "billingInterval"]) || typeof value.parameters.packageId !== "string" || !UUID.test(value.parameters.packageId)
    || !["month", "year"].includes(value.parameters.billingInterval) || typeof value.reason !== "string" || value.reason.trim().length < 10
    || value.reason.length > 500 || /[\u0000-\u001f\u007f]/.test(value.reason)) invalid();
  return {...value, requestId: value.requestId.toLowerCase(), targetId: value.targetId.toLowerCase(), reason: value.reason.trim(),
    parameters: {...value.parameters, packageId: value.parameters.packageId.toLowerCase()}};
}

export function projectCheckoutCommand(value, command, now) {
  if (command.operation === "recover") {
    const result = projectCheckoutRecovery(value, command.targetId, now);
    if (result.preview && result.preview.reason !== command.reason) upstream();
    return result;
  }
  if (command.operation !== "preview") {
    const result = projectCheckoutResult(value);
    if (result.commandId !== command.commandId || result.action !== command.action) upstream();
    return result;
  }
  const result = projectCheckoutPreview(value, command.targetId, command.action, now);
  if (result.reason !== command.reason || result.summary.packageId !== command.parameters.packageId
    || result.summary.billingInterval !== command.parameters.billingInterval) upstream();
  return result;
}

export async function runCheckoutCommand({command, native, common, config, getEnv, request, fetcher, now,
  stripePost = phase2StripePost, stripeGet = phase2StripeGet}) {
  if (!config.checkoutCommandsEnabled || !config.stripeKey) throw new AdminError(503, "unconfigured");
  if (command.operation === "preview") {
    let app;
    try {app = new URL(getEnv("PUBLIC_APP_URL") ?? "https://cmcarebase.com");} catch {throw new AdminError(503, "unconfigured");}
    const plan = await planBillingSession({admin: native, profile: {role: "platform_admin"}, organizationId: command.targetId,
      body: {action: "checkout", ...command.parameters, successUrl: new URL("/admin/enterprise?billing=success", app).href,
        cancelUrl: new URL("/admin/enterprise?billing=cancelled", app).href}, getEnv, nowIso: () => now().toISOString()});
    return checkoutRpc(await native.rpc("platform_admin_preview_checkout", {...common, p_request_id: command.requestId,
      p_target: command.targetId, p_reason: command.reason, p_provider_parameters: plan.values, p_source_snapshot: plan.sourceSnapshot}));
  }
  let recovery;
  if (command.operation === "recover") {
    recovery = checkoutRpc(await native.rpc("platform_admin_recover_checkout", {...common, p_request_id: command.requestId,
      p_target: command.targetId, p_reason: command.reason}));
    if (!keys(recovery, ["preview", "canStartNewCheckout"]) || typeof recovery.canStartNewCheckout !== "boolean") upstream();
    if (recovery.preview === null) return {targetId: command.targetId, ...recovery, result: null};
    recovery.preview = projectCheckoutPreview(recovery.preview, command.targetId, RECOVER, now());
  }
  const identity = {...common, p_command_id: recovery?.preview.commandId ?? command.commandId,
    p_expected_digest: recovery?.preview.previewDigest ?? command.expectedDigest};
  const claim = checkoutRpc(await native.rpc("platform_admin_claim_checkout", {...identity, p_check_only: command.operation !== "apply"}));
  const providerFetch = (input, init) => boundedFetch(fetcher, request.signal, input, init);
  const result = await executeCheckoutClaim(claim, {admin: native, secretKey: config.stripeKey,
    stripePost: (path, key, values, idempotency) => stripePost(path, key, values, idempotency, providerFetch),
    stripeGet: (path, key) => stripeGet(path, key, providerFetch)});
  const observed = projectCheckoutResult(checkoutRpc(await native.rpc("platform_admin_read_checkout_result", {...identity, p_replayed: result.replayed})));
  return recovery ? {targetId: command.targetId, preview: recovery.preview, result: observed, canStartNewCheckout: observed.canStartNewCheckout} : observed;
}
