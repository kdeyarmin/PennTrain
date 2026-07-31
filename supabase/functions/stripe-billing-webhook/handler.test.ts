import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createStripeBillingWebhookHandler } from "./handler.ts";

Deno.test("stripe-billing-webhook rejects non-POST and invalid signatures", async () => {
  const handler = createStripeBillingWebhookHandler({
    createClient: () => {
      throw new Error("should not persist");
    },
    getEnv: (name) => name === "STRIPE_BILLING_WEBHOOK_SECRET" ? "whsec_test" : "https://project.test",
    verifySignature: async () => ({ valid: false, timestamp: null, reason: "signature" }),
  });
  assertEquals((await handler(new Request("https://example.test", { method: "GET" }))).status, 405);
  const rejected = await handler(new Request("https://example.test", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=bad" },
    body: JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", created: 1 }),
  }));
  assertEquals(rejected.status, 400);
  assertEquals((await rejected.json()).error, "invalid_signature");
});

Deno.test("stripe-billing-webhook validates event shape before persistence", async () => {
  const handler = createStripeBillingWebhookHandler({
    createClient: () => {
      throw new Error("should not persist invalid events");
    },
    getEnv: () => "set",
    verifySignature: async () => ({ valid: true, timestamp: 1 }),
  });
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=ok" },
    body: JSON.stringify({ id: "not-an-event", type: "x", created: 1 }),
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "invalid_event");
});

Deno.test("stripe-billing-webhook persists a verified event through the RPC", async () => {
  let rpcArgs: Record<string, unknown> = {};
  const handler = createStripeBillingWebhookHandler({
    createClient: () => ({
      rpc: async (_name: string, args: Record<string, unknown>) => {
        rpcArgs = args ?? {};
        return { data: { was_duplicate: false, was_applied: true, was_stale: false }, error: null };
      },
    }),
    getEnv: (name) => {
      if (name === "STRIPE_BILLING_WEBHOOK_SECRET") return "whsec_test";
      if (name === "SUPABASE_URL") return "https://project.test";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service";
      return undefined;
    },
    verifySignature: async () => ({ valid: true, timestamp: 1_720_000_000 }),
    sha256: async () => "a".repeat(64),
  });
  const body = JSON.stringify({
    id: "evt_test_1",
    type: "customer.subscription.updated",
    created: 1_720_000_000,
    data: { object: { id: "sub_1" } },
  });
  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=ok", "x-correlation-id": "corr-1" },
    body,
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    received: true,
    eventId: "evt_test_1",
    duplicate: false,
    applied: true,
    stale: false,
  });
  assertEquals(rpcArgs.p_event_id, "evt_test_1");
  assertEquals(rpcArgs.p_event_type, "customer.subscription.updated");
  assertEquals(rpcArgs.p_correlation_id, "corr-1");
  assertEquals(rpcArgs.p_payload_sha256, "a".repeat(64));
});
