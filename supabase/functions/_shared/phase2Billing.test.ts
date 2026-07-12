import {
  buildPhase2StripeForm,
  phase2BillingHmac,
  phase2BillingStateForStripeStatus,
  phase2ProviderEventIsNewer,
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

Deno.test("billing status and provider ordering are deterministic", () => {
  assertEquals(phase2BillingStateForStripeStatus("past_due", 1000, 1001), "grace");
  assertEquals(phase2BillingStateForStripeStatus("past_due", 1000, 1000 + 8 * 86400), "past_due");
  assertEquals(phase2ProviderEventIsNewer("2026-07-11T12:00:00Z", "evt_b", "2026-07-11T12:00:00Z", "evt_a"), true);
  assertEquals(phase2ProviderEventIsNewer("2026-07-10T12:00:00Z", "evt_z", "2026-07-11T12:00:00Z", "evt_a"), false);
});

Deno.test("billing redirects stay on configured origins", () => {
  assertEquals(validatePhase2BillingReturnUrl("https://app.example.test/billing", null, ["https://app.example.test"]), true);
  assertEquals(validatePhase2BillingReturnUrl("https://evil.example/collect", "https://app.example.test", []), false);
});
