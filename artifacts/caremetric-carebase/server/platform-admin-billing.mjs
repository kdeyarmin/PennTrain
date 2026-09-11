import { phase2StripeGet, STRIPE_API_VERSION } from "../../../supabase/functions/_shared/phase2Billing.ts";
import { AdminError, boundedFetch } from "./platform-admin-auth.mjs";
import { date, listResult, subscriptionSummary, SUBSCRIPTION_COLUMNS, text, uuid, BILLING_STATES } from "./platform-admin-data.mjs";

export const BILLING_READ_OPERATIONS = Object.freeze(["billing.invoices.list", "billing.invoices.get", "billing.subscriptions.verify"]);
// Cast bigint before JSON serialization: JavaScript numbers cannot preserve every PostgreSQL bigint.
export const INVOICE_COLUMNS = "id,organization_id,subscription_id,stripe_subscription_id,stripe_invoice_id,provider_status,currency,amount_due::text,amount_paid::text,amount_remaining::text,issued_at,due_at,paid_at,updated_at,organization:organizations!billing_invoices_organization_id_fkey(id,name),subscription:billing_subscriptions!billing_invoices_subscription_id_organization_id_fkey(id,organization_id,billing_account_id,stripe_subscription_id)";
const VERIFY_SUBSCRIPTION_COLUMNS = SUBSCRIPTION_COLUMNS.replace("stripe_customer_id)", "stripe_customer_id,billing_state,state_source,comped_until,grace_ends_at,updated_at)");
const AMOUNTS = new Set(["amount_due", "amount_paid", "amount_remaining"]);
const INVOICE_COMPARISON = ["status", "currency", "amountDueMinor", "amountPaidMinor", "amountRemainingMinor"];

function providerId(value, prefix, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length > 255 || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)) throw new AdminError(502, "upstream");
  return value;
}

function amount(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) throw new AdminError(502, "upstream");
  return value;
}

function currency(value) {
  if (typeof value !== "string" || !/^[a-z]{3}$/.test(value)) throw new AdminError(502, "upstream");
  return value;
}

export function invoiceSummary(row) {
  if (!row || !row.organization || row.organization.id !== row.organization_id
    || (row.subscription_id === null ? row.subscription !== null : !row.subscription || row.subscription.id !== row.subscription_id
      || row.subscription.organization_id !== row.organization_id
      || (row.stripe_subscription_id !== null && row.subscription.stripe_subscription_id !== row.stripe_subscription_id))) throw new AdminError(502, "upstream");
  return {
    id: uuid(row.id), organizationId: uuid(row.organization_id), organizationName: text(row.organization.name, 500),
    subscriptionId: row.subscription_id === null ? null : uuid(row.subscription_id),
    providerInvoiceId: providerId(row.stripe_invoice_id, "in"), providerSubscriptionId: providerId(row.stripe_subscription_id, "sub", true),
    status: text(row.provider_status, 80, false), currency: currency(row.currency),
    amountDueMinor: amount(row.amount_due), amountPaidMinor: amount(row.amount_paid), amountRemainingMinor: amount(row.amount_remaining),
    issuedAt: date(row.issued_at), dueAt: date(row.due_at), paidAt: date(row.paid_at), updatedAt: date(row.updated_at),
  };
}

function epoch(value, nullable = true) {
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799) throw new AdminError(502, "upstream");
  return new Date(value * 1000).toISOString();
}

function status(value) {
  if (typeof value !== "string" || !/^[a-z_]{1,80}$/.test(value)) throw new AdminError(502, "upstream");
  return value;
}

function providerSubscription(row) {
  if (row?.object !== "subscription" || typeof row.livemode !== "boolean" || typeof row.cancel_at_period_end !== "boolean") throw new AdminError(502, "upstream");
  return { id: providerId(row.id, "sub"), customerId: providerId(row.customer, "cus"), status: status(row.status),
    cancelAtPeriodEnd: row.cancel_at_period_end, canceledAt: epoch(row.canceled_at), livemode: row.livemode };
}

function providerInvoice(row) {
  if (row?.object !== "invoice" || typeof row.livemode !== "boolean") throw new AdminError(502, "upstream");
  // The existing pinned API uses parent.subscription_details, not pre-Basil top-level subscription.
  let subscriptionId = null;
  if (row.parent !== null) {
    if (row.parent?.type !== "subscription_details") throw new AdminError(502, "upstream");
    subscriptionId = providerId(row.parent.subscription_details?.subscription, "sub");
  }
  return { id: providerId(row.id, "in"), customerId: providerId(row.customer, "cus"), subscriptionId,
    status: status(row.status), currency: currency(row.currency), amountDueMinor: amount(row.amount_due),
    amountPaidMinor: amount(row.amount_paid), amountRemainingMinor: amount(row.amount_remaining),
    createdAt: epoch(row.created, false), dueAt: epoch(row.due_date), paidAt: epoch(row.status_transitions?.paid_at), livemode: row.livemode };
}

function comparison(recorded, provider, fields) {
  if (provider.availability !== "available") return { status: "not_checked", fields: [] };
  const differences = fields.filter(field => recorded[field] !== provider.data[field === "providerStatus" ? "status" : field]);
  return { status: differences.length ? "differences" : "matches", fields: differences };
}

async function single(query, id) {
  const result = await query.maybeSingle();
  if (result.error) throw new AdminError(503, "upstream");
  if (!result.data) throw new AdminError(404, "notfound");
  if (id && result.data.id !== id) throw new AdminError(502, "upstream");
  return result.data;
}

/** Fixed GETs only; no provider search, checkout, writes, event application or entitlement changes. */
async function checkProvider({ config, request, fetcher, now }, association, kind) {
  const result = (availability, data = null) => ({ source: "stripe", apiVersion: STRIPE_API_VERSION, availability, checkedAt: now().toISOString(), data });
  if (!config.stripeKey) return result("unconfigured");
  try {
    const { id, customerId, subscriptionId } = await association();
    if (!customerId || (kind === "subscriptions" && !subscriptionId)) return result("identity_mismatch");
    const expectedCustomer = providerId(customerId, "cus");
    const expectedId = providerId(id, kind === "invoices" ? "in" : "sub");
    const expectedSubscription = providerId(subscriptionId, "sub", kind === "invoices");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const providerFetch = async (input, init) => {
      const response = await boundedFetch(fetcher, signal, input, init);
      // Node 24's JSON source context preserves the provider's exact numeric lexeme.
      // Do not stringify a number after it has already lost precision.
      response.json = async () => JSON.parse(await response.text(), (key, value, context) =>
        AMOUNTS.has(key) && typeof value === "number" ? context.source : value);
      return response;
    };
    const response = await phase2StripeGet(`/v1/${kind}/${expectedId}`, config.stripeKey, providerFetch);
    if (!response.ok) return result(response.status === 404 ? "notfound" : "unavailable");
    const data = kind === "invoices" ? providerInvoice(response.data) : providerSubscription(response.data);
    if (data.id !== expectedId || data.customerId !== expectedCustomer
      || (kind === "invoices" && data.subscriptionId !== expectedSubscription)) return result("identity_mismatch");
    return result("available", data);
  } catch {
    // Native/provider response bodies, account identifiers and credentials never enter errors or logs.
    return result("unavailable");
  }
}

export async function readBilling(options) {
  const { native, operation } = options;
  if (operation.operation === "billing.invoices.list") {
    const page = await listResult(native.from("billing_invoices").select(INVOICE_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false }).order("id", { ascending: true }), operation, "stripe_invoice_id", invoiceSummary);
    return { source: "application_database", ...page };
  }
  if (operation.operation === "billing.invoices.get") {
    const row = await single(native.from("billing_invoices").select(INVOICE_COLUMNS).eq("id", operation.id), operation.id);
    const recorded = invoiceSummary(row);
    const provider = await checkProvider(options, async () => {
      const account = await single(native.from("billing_accounts").select("id,organization_id,stripe_customer_id").eq("organization_id", row.organization_id));
      if (account.organization_id !== row.organization_id) return {};
      let subscription = row.subscription;
      if (!subscription && row.stripe_subscription_id !== null) {
        // Late invoice linking is allowed only when the native subscription already belongs to this organization/account.
        subscription = await single(native.from("billing_subscriptions").select("id,organization_id,billing_account_id,stripe_subscription_id")
          .eq("stripe_subscription_id", row.stripe_subscription_id).eq("organization_id", row.organization_id));
      }
      if (subscription && (subscription.organization_id !== row.organization_id || subscription.billing_account_id !== account.id
        || (row.stripe_subscription_id !== null && subscription.stripe_subscription_id !== row.stripe_subscription_id))) return {};
      return { id: row.stripe_invoice_id, customerId: account.stripe_customer_id, subscriptionId: subscription?.stripe_subscription_id ?? null };
    }, "invoices");
    return { recorded, provider, comparison: comparison(recorded, provider, INVOICE_COMPARISON) };
  }
  if (operation.operation === "billing.subscriptions.verify") {
    const row = await single(native.from("billing_subscriptions").select(VERIFY_SUBSCRIPTION_COLUMNS).eq("id", operation.id).eq("is_provider_placeholder", false), operation.id);
    const recorded = subscriptionSummary(row), account = row.account;
    if (!BILLING_STATES.includes(account.billing_state) || !["legacy", "stripe", "manual_comp", "manual_suspension"].includes(account.state_source)) throw new AdminError(502, "upstream");
    const applicationAccess = { billingState: account.billing_state, stateSource: account.state_source,
      compedUntil: date(account.comped_until), graceEndsAt: date(account.grace_ends_at), updatedAt: date(account.updated_at) };
    const provider = await checkProvider(options, async () => ({ id: row.stripe_subscription_id,
      customerId: account.stripe_customer_id, subscriptionId: row.stripe_subscription_id }), "subscriptions");
    return { recorded, applicationAccess, provider, comparison: comparison(recorded, provider, ["providerStatus"]) };
  }
  throw new AdminError(400, "invalid_request");
}
