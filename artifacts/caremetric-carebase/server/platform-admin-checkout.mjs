import { AdminError, boundedFetch, UUID } from "./platform-admin-auth.mjs";
import { planBillingSession } from "../../../supabase/functions/_shared/billingSessionPlan.ts";
import { checkoutRpc, checkoutTimestamp, executeCheckoutClaim, projectCheckoutResult } from "../../../supabase/functions/_shared/checkoutReservations.ts";
import { phase2StripeGet, phase2StripePost } from "../../../supabase/functions/_shared/phase2Billing.ts";

const ACTION = "billing.checkout.create", DIGEST = /^[0-9a-f]{64}$/;
const METRICS = ["flat", "active_learner", "active_user", "active_resident", "facility"];
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
const invalid = () => {throw new AdminError(400, "invalid_request");};
const upstream = () => {throw new AdminError(502, "upstream");};

export function parseCheckoutCommand(value) {
  if (keys(value, ["operation", "action", "commandId", "expectedDigest"]) && ["apply", "check"].includes(value.operation)
    && value.action === ACTION && typeof value.commandId === "string" && UUID.test(value.commandId)
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
  if (command.operation !== "preview") {
    const result = projectCheckoutResult(value);
    if (result.commandId !== command.commandId) upstream();
    return result;
  }
  if (!keys(value, ["commandId", "action", "targetId", "reason", "expiresAt", "previewDigest", "summary"])
    || typeof value.commandId !== "string" || !UUID.test(value.commandId) || value.action !== ACTION || value.targetId !== command.targetId
    || value.reason !== command.reason || typeof value.previewDigest !== "string" || !DIGEST.test(value.previewDigest)
    || !checkoutTimestamp(value.expiresAt)
    || Date.parse(value.expiresAt) <= now.getTime() || Date.parse(value.expiresAt) > now.getTime() + 301000) upstream();
  const s = value.summary;
  if (!keys(s, ["kind", "organizationName", "packageId", "billingInterval", "intervalCount", "currency", "billingMetric", "quantity", "providerPriceId", "providerCustomerId", "trialDays"])
    || s.kind !== "checkout" || typeof s.organizationName !== "string" || s.organizationName.length > 500
    || s.packageId !== command.parameters.packageId || s.billingInterval !== command.parameters.billingInterval || !METRICS.includes(s.billingMetric)
    || !Number.isInteger(s.intervalCount) || s.intervalCount < 1 || s.intervalCount > 36 || !/^[a-z]{3}$/.test(s.currency)
    || !Number.isSafeInteger(s.quantity) || s.quantity < 1 || !Number.isSafeInteger(s.trialDays) || s.trialDays < 0 || s.trialDays > 90
    || typeof s.providerPriceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(s.providerPriceId)
    || !(s.providerCustomerId === null || typeof s.providerCustomerId === "string" && /^cus_[A-Za-z0-9]+$/.test(s.providerCustomerId))) upstream();
  return {...value, expiresAt: new Date(value.expiresAt).toISOString()};
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
  const identity = {...common, p_command_id: command.commandId, p_expected_digest: command.expectedDigest};
  const claim = checkoutRpc(await native.rpc("platform_admin_claim_checkout", {...identity, p_check_only: command.operation === "check"}));
  const providerFetch = (input, init) => boundedFetch(fetcher, request.signal, input, init);
  const result = await executeCheckoutClaim(claim, {admin: native, secretKey: config.stripeKey,
    stripePost: (path, key, values, idempotency) => stripePost(path, key, values, idempotency, providerFetch),
    stripeGet: (path, key) => stripeGet(path, key, providerFetch)});
  return checkoutRpc(await native.rpc("platform_admin_read_checkout_result", {...identity, p_replayed: result.replayed}));
}
