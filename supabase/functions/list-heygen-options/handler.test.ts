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
    assertEquals(requests.length, expected === 200 ? 4 : 0);
  });
}

function optionsHandler(fetchImpl: typeof fetch) {
  const profile = { select: () => profile, eq: () => profile,
    single: async () => ({ data: { role: "platform_admin", is_active: true }, error: null }) };
  return createListHeygenOptionsHandler({
    createClient: (() => ({
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
      rpc: async () => ({ data: true, error: null }), from: () => profile,
    })) as never,
    getEnv: (name) => ENV[name], fetchImpl,
  });
}

const optionsRequest = () => new Request("https://function.test", { headers: { Authorization: "Bearer user-jwt" } });

Deno.test("private HeyGen twins and their cloned voices survive public catalog pagination", async () => {
  const requested: URL[] = [];
  const signals = new Set<AbortSignal | null | undefined>();
  const handler = optionsHandler(((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requested.push(url);
    signals.add(init?.signal);
    const isAvatar = url.pathname.includes("looks");
    const isPrivate = (url.searchParams.get("ownership") ?? url.searchParams.get("type")) === "private";
    let body: Record<string, unknown>;
    if (isPrivate && !url.searchParams.has("token")) {
      body = { data: isAvatar ? [{ id: "training-look", status: "processing" }] : [], has_more: true, next_token: "opaque+/=& token" };
    } else if (isPrivate) {
      assertEquals(url.searchParams.get("token"), "opaque+/=& token");
      body = { data: isAvatar
        ? [{ id: "private-twin", name: "Kevin", avatar_type: "digital_twin", status: "completed", default_voice_id: "cloned-voice" }]
        : [{ voice_id: "cloned-voice", name: "Kevin", language: "English" }], has_more: false };
    } else {
      body = { data: isAvatar
        ? [{ id: "stock-look", name: "Custom stock avatar", avatar_type: "studio_avatar", status: "completed" }]
        : [{ voice_id: "stock-voice", name: "Public voice", language: "English" }], has_more: true, next_token: "public-next" };
    }
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as typeof fetch);
  const response = await handler(optionsRequest());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.avatars.map((a: { id: string }) => a.id), ["private-twin", "stock-look"]);
  assertEquals(body.avatars[0].is_ai_twin, true);
  assertEquals(body.avatars[0].default_voice_id, "cloned-voice");
  assertEquals(body.avatars[1].is_ai_twin, false);
  assertEquals(body.voices.map((v: { voice_id: string }) => v.voice_id), ["cloned-voice", "stock-voice"]);
  assertEquals(requested.length, 6);
  assertEquals(signals.size, 1);
});

for (const [label, fetchImpl, expected] of [
  ["invalid JSON", () => Promise.resolve(new Response("not json")), 502],
  ["non-array payload", () => Promise.resolve(new Response(JSON.stringify({ data: {} }))), 502],
  ["invalid array item", () => Promise.resolve(new Response(JSON.stringify({ data: [null] }))), 502],
  ["provider refusal", () => Promise.resolve(new Response(JSON.stringify({ error: { message: "provider details" } }), { status: 401 })), 502],
  ["network failure", () => Promise.reject(new TypeError("fetch failed")), 502],
  ["timeout", () => Promise.reject(new DOMException("request timed out", "TimeoutError")), 504],
  ["repeated pagination cursor", () => Promise.resolve(new Response(JSON.stringify({ data: [], has_more: true, next_token: "same" }))), 502],
] as const) {
  Deno.test(`HeyGen options return structured errors for ${label}`, async () => {
    const response = await optionsHandler(fetchImpl as typeof fetch)(optionsRequest());
    assertEquals(response.status, expected);
    assertEquals(typeof (await response.json()).error, "string");
    assertEquals(response.headers.get("Content-Type"), "application/json");
  });
}
