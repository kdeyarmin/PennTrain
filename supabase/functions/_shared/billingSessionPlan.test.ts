import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { BillingSessionPlanError, planBillingSession } from "./billingSessionPlan.ts";

Deno.test("shared Checkout planner includes nonterminal provider-backed rows in its scoped native guard", async () => {
  for (const status of ["paused", "unpaid", "incomplete", "past_due"]) {
    const requests: URL[] = [];
    const admin = createClient("https://native.test", "synthetic-service", { auth: { persistSession: false }, global: {
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        if (url.pathname.endsWith("/billing_accounts")) return Promise.resolve(Response.json({ id: "account", stripe_customer_id: "cus_fixture" }));
        assertEquals(url.pathname, "/rest/v1/billing_subscriptions");
        assertEquals(url.searchParams.get("organization_id"), "eq.11111111-1111-4111-8111-111111111111");
        assertEquals(url.searchParams.get("or"), "(billing_state.in.(trial,active,grace,past_due),and(stripe_subscription_id.not.is.null,provider_status.not.in.(canceled,incomplete_expired)),and(stripe_subscription_id.not.is.null,provider_status.is.null))");
        // The actual PostgREST request selects only id. Provider status is the
        // synthetic row's reason for inclusion; it is never exposed to callers.
        return Promise.resolve(Response.json({ id: `synthetic-${status}` }));
      },
    } });
    await assertRejects(() => planBillingSession({ admin, profile: { role: "platform_admin" },
      organizationId: "11111111-1111-4111-8111-111111111111",
      body: { action: "checkout", packageId: "22222222-2222-4222-8222-222222222222" },
      getEnv: name => name === "STRIPE_BILLING_WEBHOOK_SECRET" ? "fixture" : undefined,
      nowIso: () => "2026-09-11T19:00:00Z" }), BillingSessionPlanError, "existing_subscription_requires_portal");
    assertEquals(requests.length, 2);
  }
});
