import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createListHeygenOptionsHandler } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", HEYGEN_API_KEY: "vendor-key",
};

for (const [assurance, error, expected] of [[false, null, 403], [null, { code: "42501" }, 403], [true, null, 200]] as const) {
  Deno.test(`HeyGen account options require SMS floor before vendor request (${expected}, ${assurance})`, async () => {
    const requests: string[] = [];
    const profile = { select: () => profile, eq: () => profile,
      single: async () => ({ data: { role: "platform_admin", is_active: true }, error: null }) };
    const handler = createListHeygenOptionsHandler({
      createClient: ((_: string, key: string, options: unknown) => {
        assertEquals(key, "anon");
        assertEquals(options, { global: { headers: { Authorization: "Bearer user-jwt" } } });
        return {
          auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
          rpc: async (name: string) => {
            assertEquals(name, "current_sms_mfa_satisfied");
            return { data: assurance, error };
          },
          from: () => profile,
        };
      }) as never,
      getEnv: (name) => ENV[name],
      fetchImpl: ((url: string) => {
        requests.push(url);
        return Promise.resolve(new Response(JSON.stringify({ data: [] })));
      }) as typeof fetch,
    });
    const response = await handler(new Request("https://function.test", { headers: { Authorization: "Bearer user-jwt" } }));
    assertEquals(response.status, expected);
    assertEquals(requests.length, expected === 200 ? 2 : 0);
  });
}
