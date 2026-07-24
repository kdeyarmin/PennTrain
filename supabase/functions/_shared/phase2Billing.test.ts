import {
  buildPhase2StripeForm,
  phase2BillingHmac,
  phase2CheckoutTrialDays,
  phase2MeasuredBillingQuantity,
  phase2BillingStateForStripeStatus,
  phase2ProviderEventIsNewer,
  resolvePhase2BillingQuantity,
  validatePhase2BillingReturnUrl,
  verifyPhase2StripeSignature,
} from "./phase2Billing.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("Stripe signatures accept one fresh v1 value and reject tamper/replay", async () => {
  const body = '{"id":"evt_1"}';
  const timestamp = 1_800_000_000;
  const signature = await phase2BillingHmac("whsec_test", `${timestamp}.${body}`);
  assertEquals(
    await verifyPhase2StripeSignature(body, `t=${timestamp},v1=${signature}`, "whsec_test", timestamp),
    { valid: true, timestamp },
  );
  assertEquals(
    (await verifyPhase2StripeSignature(`${body}x`, `t=${timestamp},v1=${signature}`, "whsec_test", timestamp)).reason,
    "signature",
  );
  assertEquals(
    (await verifyPhase2StripeSignature(body, `t=${timestamp},v1=${signature}`, "whsec_test", timestamp + 301)).reason,
    "replay_window",
  );
});

Deno.test("Checkout form uses recurring Price quantities and subscription mode", () => {
  const form = buildPhase2StripeForm({
    mode: "subscription",
    line_items: [{ price: "price_contract", quantity: 12 }],
    metadata: { organization_id: "org" },
  });
  assertEquals(form.get("mode"), "subscription");
  assertEquals(form.get("line_items[0][price]"), "price_contract");
  assertEquals(form.get("line_items[0][quantity]"), "12");
  assertEquals(form.has("payment_intent"), false);
  assertEquals(form.has("plan"), false);
});

Deno.test("recurring quantity synchronization avoids surprise mid-cycle proration", () => {
  const form = buildPhase2StripeForm({ quantity: 31, proration_behavior: "none" });
  assertEquals(form.get("quantity"), "31");
  assertEquals(form.get("proration_behavior"), "none");
});

Deno.test("billing quantities follow the configured commercial metric", () => {
  assertEquals(resolvePhase2BillingQuantity("flat", 99, 1, 1), 1);
  assertEquals(resolvePhase2BillingQuantity("active_learner", 26, 1, null), 26);
  assertEquals(resolvePhase2BillingQuantity("active_resident", undefined, 5, 100), 5);
  assertEquals(resolvePhase2BillingQuantity("active_user", 4.5, 1, null), null);
  assertEquals(resolvePhase2BillingQuantity("facility", 101, 1, 100), null);
});

Deno.test("billing quantities are measured from the canonical organization snapshot", () => {
  const usage = { active_learners: 31, active_users: 12, active_residents: 27, facilities: 2 };
  assertEquals(phase2MeasuredBillingQuantity("active_learner", usage), 31);
  assertEquals(phase2MeasuredBillingQuantity("active_resident", usage), 27);
  assertEquals(phase2MeasuredBillingQuantity("active_user", usage), 12);
  assertEquals(phase2MeasuredBillingQuantity("facility", usage), 2);
  assertEquals(phase2MeasuredBillingQuantity("flat", usage), 1);
  assertEquals(phase2MeasuredBillingQuantity("unknown", usage), null);
});

Deno.test("billing status and provider ordering are deterministic", () => {
  assertEquals(phase2BillingStateForStripeStatus("past_due", 1000, 1001), "grace");
  assertEquals(phase2BillingStateForStripeStatus("past_due", 1000, 1000 + 8 * 86400), "past_due");
  assertEquals(phase2ProviderEventIsNewer("2026-07-11T12:00:00Z", "evt_b", "2026-07-11T12:00:00Z", "evt_a"), true);
  assertEquals(phase2ProviderEventIsNewer("2026-07-10T12:00:00Z", "evt_z", "2026-07-11T12:00:00Z", "evt_a"), false);
});

Deno.test("billing redirects stay on configured origins only", () => {
  assertEquals(validatePhase2BillingReturnUrl("https://app.example.test/billing", ["https://app.example.test"]), true);
  assertEquals(validatePhase2BillingReturnUrl("https://evil.example/collect", []), false);
  // The caller's Origin header must never extend the allowlist (N-6a).
  assertEquals(validatePhase2BillingReturnUrl("https://evil.example/collect", ["https://app.example.test"]), false);
  // localhost works only when explicitly configured.
  assertEquals(validatePhase2BillingReturnUrl("http://localhost:5173/billing", ["http://localhost:5173"]), true);
  assertEquals(validatePhase2BillingReturnUrl("http://localhost:5173/billing", ["https://app.example.test"]), false);
  // A malformed configured entry does not disable the valid ones.
  assertEquals(validatePhase2BillingReturnUrl("https://app.example.test/billing", ["not a url", "https://app.example.test"]), true);
});

Deno.test("checkout forwards only the remaining in-app trial days", () => {
  const now = Date.parse("2026-07-24T12:00:00Z");
  const days = (count: number) => new Date(now + count * 86_400_000).toISOString();
  // Mid-trial: remaining days, capped by the package configuration.
  assertEquals(phase2CheckoutTrialDays(days(10), 30, now), 10);
  assertEquals(phase2CheckoutTrialDays(days(45), 30, now), 30);
  // A partially elapsed final day still grants one day (min 1).
  assertEquals(phase2CheckoutTrialDays(new Date(now + 3_600_000).toISOString(), 30, now), 1);
  // Consumed, never stamped, or unparsable trial windows grant nothing.
  assertEquals(phase2CheckoutTrialDays(days(-1), 30, now), 0);
  assertEquals(phase2CheckoutTrialDays(null, 30, now), 0);
  assertEquals(phase2CheckoutTrialDays("not-a-date", 30, now), 0);
  // A package without a trial never grants one.
  assertEquals(phase2CheckoutTrialDays(days(10), 0, now), 0);
});
