import { AdminError, UUID } from "./platform-admin-auth.mjs";

export const BILLING_STATES = ["trial", "active", "grace", "past_due", "canceled", "comped", "suspended"];

export const SUBSCRIPTION_COLUMNS = "id,organization_id,billing_account_id,package_id,billing_state,provider_status,stripe_subscription_id,current_period_end,updated_at,is_provider_placeholder,organization:organizations!billing_subscriptions_organization_id_fkey(id,name),account:billing_accounts!billing_subscriptions_billing_account_id_fkey(id,organization_id,stripe_customer_id),package:packages!billing_subscriptions_package_id_fkey(id,name)";

export function text(value, limit, nullable = true) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new AdminError(502, "upstream");
  return value.slice(0, limit);
}


export function countResult(result) {
  if (result.error || !Number.isSafeInteger(result.count) || result.count < 0) throw new AdminError(503, "upstream");
  return result.count;
}


export function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AdminError(502, "upstream");
  return value;
}


export function date(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new AdminError(502, "upstream");
  return new Date(value).toISOString();
}


export function subscriptionSummary(row) {
  if (!row || row.is_provider_placeholder !== false || !BILLING_STATES.includes(row.billing_state)
    || !row.organization || row.organization.id !== row.organization_id
    || !row.account || row.account.id !== row.billing_account_id || row.account.organization_id !== row.organization_id
    || (row.package_id === null ? row.package !== null : !row.package || row.package.id !== row.package_id)) {
    throw new AdminError(502, "upstream");
  }
  return {
    id: uuid(row.id), organizationId: uuid(row.organization_id), organizationName: text(row.organization.name, 500),
    planCode: null, planName: row.package === null ? null : text(row.package.name, 500),
    status: row.billing_state, providerStatus: text(row.provider_status, 80),
    providerCustomerId: text(row.account.stripe_customer_id, 255), providerSubscriptionId: text(row.stripe_subscription_id, 255),
    currentPeriodEnd: date(row.current_period_end), updatedAt: date(row.updated_at),
  };
}


export async function listResult(query, operation, searchColumn, project) {
  // A single encoded scalar filter treats PostgREST syntax as literal text.
  if (operation.search) query = query.ilike(searchColumn, `%${operation.search.replace(/[\\%_]/g, "\\$&")}%`);
  const result = await query.range(operation.offset, operation.offset + operation.limit - 1);
  const total = countResult(result);
  if (!Array.isArray(result.data) || result.data.length > operation.limit) throw new AdminError(502, "upstream");
  return { items: result.data.map(project), total, limit: operation.limit, offset: operation.offset };
}

