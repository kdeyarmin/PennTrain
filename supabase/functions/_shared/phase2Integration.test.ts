import {
  decodePhase2Cursor,
  encodePhase2Cursor,
  parsePhase2ApiCredential,
  PHASE2_INTEGRATION_SCHEMA_VERSION,
  phase2CommandContract,
  phase2CommandSchemaVersionError,
  phase2CommandScopeCandidates,
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

Deno.test("command contracts are per-command with a generic baseline fallback", () => {
  assertEquals(phase2CommandContract("medication.snapshot.import"), {
    schemaVersion: "2026-07-14",
    requiredScope: "medications:write",
  });
  assertEquals(phase2CommandContract("workforce.lifecycle.sync"), {
    schemaVersion: PHASE2_INTEGRATION_SCHEMA_VERSION,
    requiredScope: "commands:write",
  });
});

Deno.test("each command accepts exactly its registered schema version", () => {
  assertEquals(phase2CommandSchemaVersionError("medication.snapshot.import", "2026-07-14"), null);
  assertEquals(phase2CommandSchemaVersionError("workforce.lifecycle.sync", "2026-07-11"), null);
  assertEquals(
    phase2CommandSchemaVersionError("medication.snapshot.import", "2026-07-11"),
    "Command 'medication.snapshot.import' requires schemaVersion '2026-07-14'",
  );
  assertEquals(
    phase2CommandSchemaVersionError("workforce.lifecycle.sync", "2026-07-14"),
    "Command 'workforce.lifecycle.sync' requires schemaVersion '2026-07-11'",
  );
  assertEquals(
    phase2CommandSchemaVersionError("medication.snapshot.import", undefined),
    "Command 'medication.snapshot.import' requires schemaVersion '2026-07-14'",
  );
});

Deno.test("command scope candidates put least privilege first with commands:write as superset", () => {
  assertEquals(phase2CommandScopeCandidates("medication.snapshot.import"), [
    "medications:write",
    "commands:write",
  ]);
  assertEquals(phase2CommandScopeCandidates("workforce.lifecycle.sync"), ["commands:write"]);
  assertEquals(phase2CommandScopeCandidates(""), ["commands:write"]);
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
