import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createPushSubscriptionsHandler } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
};
const endpoint = "https://push.example.test/attacker-controlled-subscription";

function fixture(assurance: unknown = true, error: { code: string } | null = null) {
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
    getEnv: (name) => ENV[name],
  });
  return { handler, effects };
}

function request(method: string) {
  return new Request("https://function.test", { method, headers: { Authorization: "Bearer user-jwt" },
    body: JSON.stringify({ endpoint, subscription: { endpoint, keys: { p256dh: "x".repeat(50), auth: "abcdefgh" } } }) });
}

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
