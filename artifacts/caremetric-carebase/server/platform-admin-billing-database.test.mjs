import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { readBilling } from "./platform-admin-billing.mjs";

test("native PostgREST preserves int64 invoice amounts, named foreign keys and nullable legacy rows", {
  skip: process.env.CAREMETRIC_LOCAL_BILLING_READ_TESTS !== "true",
}, async () => {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Billing fixtures require disposable loopback Supabase");
  const native = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const org = randomUUID(), sub = randomUUID(), invoice = randomUUID(), standalone = randomUUID();
  const suffix = org.replaceAll("-", "");
  // Fixed local Supabase container from this repository's config.toml; no remote database connection.
  const sql = input => execFileSync("docker", ["exec", "-i", "supabase_db_xsqobvvreaovwibxwyvv", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  sql(`begin;
    insert into public.organizations(id,name,slug,subscription_status) values ('${org}','Billing read fixture','billing-read-${suffix}','active');
    update public.billing_accounts set stripe_customer_id='cus_${suffix}',billing_state='active',provider_state='active',state_source='stripe' where organization_id='${org}';
    insert into public.billing_subscriptions(id,organization_id,billing_account_id,stripe_subscription_id,provider_status,billing_state,provider_event_created_at,provider_event_id)
      select '${sub}','${org}',id,'sub_${suffix}','active','active',now(),'evt_${suffix}' from public.billing_accounts where organization_id='${org}';
    insert into public.billing_invoices(id,organization_id,subscription_id,stripe_subscription_id,stripe_invoice_id,provider_status,currency,amount_due,amount_paid,amount_remaining,provider_event_created_at,provider_event_id)
      values ('${invoice}','${org}','${sub}','sub_${suffix}','in_${suffix}','open','jpy',9223372036854775807,0,9223372036854775807,now(),'evt_${suffix}'),
      ('${standalone}','${org}',null,null,'in_legacy${suffix}','paid','ugx',10000,10000,0,now(),'evt_legacy${suffix}');
    commit;`);
  try {
    const options = { native, config: { stripeKey: null }, request: new Request(url), now: () => new Date(),
      fetcher: () => { throw new Error("Provider network is forbidden in database fixtures"); } };
    const page = await readBilling({ ...options, operation: { operation: "billing.invoices.list", limit: 25, offset: 0, search: `in_${suffix}` } });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].amountDueMinor, "9223372036854775807");
    assert.equal(page.items[0].organizationId, org);
    assert.equal(page.items[0].subscriptionId, sub);
    assert.equal(page.items[0].issuedAt, null);
    const detail = await readBilling({ ...options, operation: { operation: "billing.invoices.get", id: invoice } });
    assert.equal(detail.recorded.amountRemainingMinor, "9223372036854775807");
    assert.equal(detail.provider.availability, "unconfigured");
    const legacy = await readBilling({ ...options, operation: { operation: "billing.invoices.get", id: standalone } });
    assert.equal(legacy.recorded.subscriptionId, null);
    assert.equal(legacy.recorded.providerSubscriptionId, null);
    assert.equal(legacy.recorded.currency, "ugx");
    const verified = await readBilling({ ...options, operation: { operation: "billing.subscriptions.verify", id: sub } });
    assert.equal(verified.recorded.id, sub);
    assert.equal(verified.recorded.providerCustomerId, `cus_${suffix}`);
    assert.equal(verified.recorded.planName, null);
    assert.equal(verified.applicationAccess.stateSource, "stripe");
    assert.deepEqual(verified.comparison, { status: "not_checked", fields: [] });
  } finally {
    sql(`begin; delete from public.billing_invoices where organization_id='${org}'; delete from public.billing_subscriptions where organization_id='${org}'; delete from public.organizations where id='${org}'; commit;`);
  }
});
