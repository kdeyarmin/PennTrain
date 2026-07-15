import {
  decodePhase2Cursor,
  encodePhase2Cursor,
  parsePhase2ApiCredential,
  phase2CredentialIsUsable,
  phase2RetryableWebhookStatus,
  signPhase2IntegrationWebhook,
  verifyPhase2IntegrationWebhook,
  validatePhase2WebhookDestination,
} from "./phase2Integration.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${expected}, got ${actual}`);
}

Deno.test("outbound signatures bind id, timestamp, and exact body with replay protection", async () => {
  const signature = await signPhase2IntegrationWebhook("whsec_test", "event-1", 1000, '{"ok":true}');
  assertEquals(await verifyPhase2IntegrationWebhook({
    secret: "whsec_test", webhookId: "event-1", timestamp: 1000,
    rawBody: '{"ok":true}', signature: `v1=${signature}`, nowSeconds: 1001,
  }), true);
  assertEquals(await verifyPhase2IntegrationWebhook({
    secret: "whsec_test", webhookId: "event-1", timestamp: 1000,
    rawBody: '{"ok":false}', signature: `v1=${signature}`, nowSeconds: 1001,
  }), false);
  assertEquals(await verifyPhase2IntegrationWebhook({
    secret: "whsec_test", webhookId: "event-1", timestamp: 1000,
    rawBody: '{"ok":true}', signature: `v1=${signature}`, nowSeconds: 1301,
  }), false);
});

Deno.test("credentials are strict, expiring, scoped, and rotation/revocation aware", () => {
  const key = `ccb_live_abcdef012345.${"a".repeat(64)}`;
  const legacyKey = `cmt_live_abcdef012345.${"a".repeat(64)}`;
  assertEquals(parsePhase2ApiCredential(`Bearer ${key}`), key);
  assertEquals(parsePhase2ApiCredential(`Bearer ${legacyKey}`), legacyKey);
  assertEquals(parsePhase2ApiCredential("Bearer service-role-secret"), null);
  assertEquals(phase2CredentialIsUsable({
    status: "active", expiresAt: "2030-01-01T00:00:00Z", scopes: ["events:read"], requiredScope: "events:read",
  }, Date.parse("2029-01-01T00:00:00Z")), true);
  assertEquals(phase2CredentialIsUsable({
    status: "rotated", expiresAt: "2030-01-01T00:00:00Z", scopes: ["events:read"], requiredScope: "events:read",
  }, Date.parse("2029-01-01T00:00:00Z")), false);
  assertEquals(phase2CredentialIsUsable({
    status: "active", expiresAt: "2028-01-01T00:00:00Z", scopes: ["events:read"], requiredScope: "events:read",
  }, Date.parse("2029-01-01T00:00:00Z")), false);
});

Deno.test("cursor pagination is versioned and rejects malformed cursors", () => {
  assertEquals(decodePhase2Cursor(encodePhase2Cursor(42)), 42);
  let failed = false;
  try { decodePhase2Cursor("not-a-cursor"); } catch { failed = true; }
  assertEquals(failed, true);
});

Deno.test("bounded webhook retry classification includes throttling and 5xx", () => {
  assertEquals(phase2RetryableWebhookStatus(429), true);
  assertEquals(phase2RetryableWebhookStatus(503), true);
  assertEquals(phase2RetryableWebhookStatus(400), false);
});

Deno.test("webhook destinations reject SSRF targets and fail closed on DNS", async () => {
  const publicResolver = async (_host: string, type: "A" | "AAAA") =>
    type === "A" ? ["8.8.8.8"] : ["2606:4700:4700::1111"];
  const privateResolver = async (_host: string, type: "A" | "AAAA") =>
    type === "A" ? ["10.0.0.8"] : [];
  assertEquals((await validatePhase2WebhookDestination("https://hooks.example.test/events", publicResolver)).valid, true);
  assertEquals((await validatePhase2WebhookDestination("https://hooks.example.test/events", privateResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://127.0.0.1/events", publicResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://[::1]/events", publicResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://user:pass@example.test/events", publicResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://service.internal/events", publicResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://example.test:8443/events", publicResolver)).valid, false);
  assertEquals((await validatePhase2WebhookDestination("https://unresolved.example/events", async () => {
    throw new Error("NXDOMAIN");
  })).valid, false);
});
