import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createPushSubscriptionsHandler } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  WEB_PUSH_VAPID_PUBLIC_KEY: "public", WEB_PUSH_VAPID_PRIVATE_KEY: "private",
};
const endpoint = "https://fcm.googleapis.com/fcm/send/subscription-token";
// Deterministic test-only P-256 generator point and 16-byte auth secret.
const keys = {
  p256dh: "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
  // Public synthetic bytes 0..15, encoded at runtime; never a provider credential.
  auth: btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
};

function fixture(assurance: unknown = true, error: { code: string } | null = null, env = ENV) {
  const effects: string[] = [];
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: async (name: string) => {
      assertEquals(name, "current_sms_mfa_satisfied");
      return { data: assurance, error };
    },
    from: () => {
      const query = { select: () => query, eq: () => query,
        single: async () => ({ data: { id: "user-1", organization_id: "org-1", is_active: true }, error: null }) };
      return query;
    },
  };
  const admin = { from: (table: string) => ({
    upsert: async (row: Record<string, unknown>) => {
      effects.push(`${table}:upsert`);
      assertEquals(row.profile_id, "user-1");
      return { error: null };
    },
    update: () => {
      effects.push(`${table}:update`);
      const query = { eq: () => query, then: (resolve: (value: unknown) => void) => resolve({ error: null }) };
      return query;
    },
  }) };
  const handler = createPushSubscriptionsHandler({
    createClient: ((_: string, key: string, options: unknown) => {
      if (key === "anon") {
        assertEquals(options, { global: { headers: { Authorization: "Bearer user-jwt" } } });
        return caller;
      }
      return admin;
    }) as never,
    getEnv: (name) => env[name],
  });
  return { handler, effects };
}

Deno.test("push availability and registration require both VAPID keys while removal stays usable", async () => {
  const { handler, effects } = fixture(true, null, { ...ENV, WEB_PUSH_VAPID_PRIVATE_KEY: " " });
  assertEquals((await handler(new Request("https://function.test", { headers: { Authorization: "Bearer user-jwt" } }))).status, 503);
  assertEquals((await handler(request("POST"))).status, 503);
  assertEquals(effects, []);
  assertEquals((await handler(request("DELETE"))).status, 200);
});

Deno.test("push registration rejects malformed, oversized and expired input without saving", async () => {
  const subscription = { endpoint, keys };
  for (const [body, expected] of [
    ["null", 400], ["[]", 400], ["not JSON", 400], [JSON.stringify({ padding: "x".repeat(17000) }), 413],
    [JSON.stringify({ subscription: { ...subscription, endpoint: "https://127.0.0.1/private-path-of-at-least-40-characters" } }), 400],
    ...[1e100, -1, Date.now() - 1000, "not-a-date"].map((expirationTime) => [JSON.stringify({ subscription: { ...subscription, expirationTime } }), 400]),
  ] as Array<[string, number]>) {
    const { handler, effects } = fixture();
    const response = await handler(new Request("https://function.test", {
      method: "POST", headers: { Authorization: "Bearer user-jwt" }, body,
    }));
    assertEquals(response.status, expected);
    assertEquals(effects, []);
  }
});

function request(method: string) {
  return new Request("https://function.test", { method, headers: { Authorization: "Bearer user-jwt" },
    body: JSON.stringify({ endpoint, subscription: { endpoint, keys } }) });
}

Deno.test("push registration never saves invalid key encoding, length or P-256 points", async () => {
  const invalidPoint = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  for (const invalidKeys of [
    {}, { ...keys, p256dh: "x".repeat(50) }, { ...keys, auth: "abcdefgh" },
    { ...keys, p256dh: invalidPoint }, { ...keys, p256dh: keys.p256dh.slice(0, -1) + "V" },
    { ...keys, p256dh: keys.p256dh.replace("-", "+") }, { ...keys, auth: keys.auth + "=" },
    { ...keys, auth: keys.auth.slice(0, -1) + "x" }, { ...keys, auth: keys.auth + "AAAA" },
    { ...keys, auth: " ".repeat(22) }, { ...keys, p256dh: keys.p256dh + "==" },
    { ...keys, p256dh: keys.p256dh + "A" }, { ...keys, p256dh: null },
  ]) {
    const { handler, effects } = fixture();
    const response = await handler(new Request("https://function.test", {
      method: "POST", headers: { Authorization: "Bearer user-jwt" },
      body: JSON.stringify({ subscription: { endpoint, keys: invalidKeys } }),
    }));
    assertEquals(response.status, 400);
    assertEquals(effects, []);
  }
});

Deno.test("push registration accepts correctly padded browser keys", async () => {
  const { handler, effects } = fixture();
  const response = await handler(new Request("https://function.test", {
    method: "POST", headers: { Authorization: "Bearer user-jwt" },
    body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh + "=", auth: keys.auth + "==" } } }),
  }));
  assertEquals(response.status, 201);
  assertEquals(effects, ["push_subscriptions:upsert"]);
});

for (const method of ["POST", "DELETE"]) {
  for (const error of [null, { code: "42501" }]) {
    Deno.test(`push subscription ${method} refuses password-only SMS session (${error?.code ?? "false"})`, async () => {
      const { handler, effects } = fixture(false, error);
      const response = await handler(request(method));
      assertEquals(response.status, 403);
      assertEquals((await response.json()).code, "mfa_required");
      assertEquals(effects, []);
    });
  }
  Deno.test(`push subscription ${method} retains verified caller operation`, async () => {
    const { handler, effects } = fixture();
    const response = await handler(request(method));
    assertEquals(response.status, method === "POST" ? 201 : 200);
    assertEquals(effects, [`push_subscriptions:${method === "POST" ? "upsert" : "update"}`]);
  });
}
