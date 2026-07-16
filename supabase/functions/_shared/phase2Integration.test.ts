import {
  decodePhase2Cursor,
  encodePhase2Cursor,
  parsePhase2ApiCredential,
  phase2CredentialIsUsable,
  phase2PinnedWebhookRequest,
  phase2RetryableWebhookStatus,
  phase2RoundRobinByTenant,
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

Deno.test("pinned webhook transport connects to the validated IP with the TLS hostname", async () => {
  const calls: unknown[] = [];
  let read = false;
  const connector = async (address: string, tlsHostname: string, port: number) => {
    calls.push({ address, tlsHostname, port });
    return {
      write: async (bytes: Uint8Array) => bytes.length,
      read: async (buffer: Uint8Array) => {
        if (read) return null;
        read = true;
        const response = new TextEncoder().encode(
          "HTTP/1.1 302 Found\r\nLocation: https://127.0.0.1/private\r\nContent-Length: 0\r\n\r\n",
        );
        buffer.set(response);
        return response.length;
      },
      close: () => {},
    };
  };
  const response = await phase2PinnedWebhookRequest(
    "https://hooks.example.test/events?source=test",
    { body: "{}" },
    ["8.8.8.8"],
    connector,
  );
  assertEquals(calls, [{ address: "8.8.8.8", tlsHostname: "hooks.example.test", port: 443 }]);
  assertEquals(response.status, 302);
  assertEquals(response.ok, false);
});

Deno.test("pinned webhook timeout is an absolute request deadline", async () => {
  const chunks = [
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n",
    "Connection: close\r\n\r\n",
    "ok",
  ];
  let index = 0;
  const pendingReadDelays: Promise<void>[] = [];
  const connector = async () => ({
    write: async (bytes: Uint8Array) => bytes.length,
    read: async (buffer: Uint8Array) => {
      const delay = new Promise<void>((resolve) => setTimeout(resolve, 45));
      pendingReadDelays.push(delay);
      await delay;
      if (index >= chunks.length) return null;
      const bytes = new TextEncoder().encode(chunks[index++]);
      buffer.set(bytes);
      return bytes.length;
    },
    close: () => {},
  });
  const started = Date.now();
  let timedOut = false;
  try {
    await phase2PinnedWebhookRequest(
      "https://hooks.example.test/events",
      { body: "{}", timeoutMs: 100 },
      ["8.8.8.8"],
      connector,
    );
  } catch (error) {
    timedOut = error instanceof DOMException && error.name === "TimeoutError";
  }
  await Promise.allSettled(pendingReadDelays);
  assertEquals(timedOut, true);
  if (Date.now() - started > 500) throw new Error("Absolute timeout exceeded its bounded allowance");
});

Deno.test("claimed deliveries are interleaved across tenants", () => {
  const rows = [
    { organization_id: "a", id: 1 },
    { organization_id: "a", id: 2 },
    { organization_id: "a", id: 3 },
    { organization_id: "b", id: 4 },
    { organization_id: "b", id: 5 },
  ];
  assertEquals(phase2RoundRobinByTenant(rows).map((row) => row.id), [1, 4, 2, 5, 3]);
});
