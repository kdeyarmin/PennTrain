import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { createGenerateCourseVideoHandler } from "./handler.ts";

const ATTEMPT = "aab00000-0000-4000-8000-000000000001";
const LEASE = "aab00000-0000-4000-8000-000000000002";
const BLOCK = "aab00000-0000-4000-8000-000000000003";
const REQUEST = "aab00000-0000-4000-8000-000000000004";
const PAYLOAD = { type: "avatar", avatar_id: "kevin", voice_id: "cloned", script: "Exact stored narration", title: "Course" };
const ENV: Record<string, string> = { SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", HEYGEN_API_KEY: "vendor" };
const request = (overrides = {}) => new Request("https://function.test", { method: "POST", headers: { Authorization: "Bearer user-jwt" },
  body: JSON.stringify({ course_block_id: BLOCK, request_id: REQUEST, avatar_id: "kevin", voice_id: "cloned", script: "Exact stored narration", title: "Course", ...overrides }) });

function harness(options: { claim?: Record<string, unknown>; claimError?: { code: string; message: string }; providerStatus?: number;
  providerBody?: unknown; throwProvider?: boolean; saveError?: boolean; saveThrows?: boolean; savedState?: string } = {}) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const calls: { key: string; name: string; args: Record<string, unknown> }[] = [];
  const handler = createGenerateCourseVideoHandler({
    getEnv: name => ENV[name],
    createClient: ((_: string, key: string, config?: unknown) => {
      if (key === "anon") assertEquals(config, { global: { headers: { Authorization: "Bearer user-jwt" } } });
      else { assertEquals(key, "service"); assertEquals(config, undefined); }
      return { auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ key, name, args });
          if (name === "claim_course_video_generation") return { data: options.claim ?? { attempt_id: ATTEMPT, lease_id: LEASE,
            payload: PAYLOAD, state: "submitting", should_submit: true }, error: options.claimError ?? null };
          assertEquals(name, "finish_course_video_submission");
          if (options.saveThrows) throw new Error("connection lost");
          return { data: { state: options.savedState ?? "processing" }, error: options.saveError ? { message: "database unavailable" } : null };
        } };
    }) as never,
    fetchImpl: ((url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (options.throwProvider) return Promise.reject(new TypeError("connection interrupted"));
      return Promise.resolve(new Response(JSON.stringify(options.providerBody ?? { data: { video_id: "video_123" } }), { status: options.providerStatus ?? 200 }));
    }) as typeof fetch,
  });
  return { handler, requests, calls };
}

Deno.test("billed HeyGen submission uses only the leased stored payload and canonical idempotency key", async () => {
  const h = harness();
  const result = await h.handler(request({ script: "Different client text" }));
  assertEquals(result.status, 200);
  assertEquals(h.calls[0].key, "anon");
  assertEquals(h.requests.length, 1);
  assertEquals(h.requests[0].init?.body, JSON.stringify(PAYLOAD));
  assertEquals(new Headers(h.requests[0].init?.headers).get("Idempotency-Key"), ATTEMPT);
  assertEquals(h.calls[1].key, "service");
  assertEquals(h.calls[1].args.p_attempt_id, ATTEMPT);
  assertEquals(h.calls[1].args.p_lease_id, LEASE);
  assertEquals(h.calls[1].args.p_outcome, "accepted");
});
for (const [state, status] of [["submitting",409],["unknown",409],["reconciliation_required",409],["failed",409],["stale",409],["processing",200],["completed",200]] as const) {
  Deno.test(`HeyGen claim in ${state} never submits a second billed request`, async () => {
    const h = harness({ claim: { attempt_id: ATTEMPT, state, should_submit: false, video_id: "existing" } });
    const response = await h.handler(request());
    assertEquals(response.status, status);
    assertEquals(h.requests.length, 0);
    assertEquals(h.calls.length, 1);
  });
}
for (const [code, status] of [["42501",403],["55000",409],["22023",400],["P0002",404],["08006",503]] as const) {
  Deno.test(`HeyGen claim refusal ${code} precedes any provider call`, async () => {
    const h = harness({ claimError: { code, message: "claim refused" } });
    assertEquals((await h.handler(request())).status, status);
    assertEquals(h.requests.length, 0);
  });
}
for (const providerStatus of [200,409,429,500,502,503]) {
  Deno.test(`uncertain HeyGen ${providerStatus} response retains the same paid attempt`, async () => {
    const h = harness({ providerStatus, providerBody: { error: { message: "unconfirmed" } } });
    assertEquals((await h.handler(request())).status, 502);
    assertEquals(h.calls[1].args.p_outcome, "unknown");
    assertEquals(h.calls[1].args.p_attempt_id, ATTEMPT);
  });
}
Deno.test("lost provider response leaves an unknown attempt, never a terminal retry with a new key", async () => {
  const h = harness({ throwProvider: true });
  assertEquals((await h.handler(request())).status, 502);
  assertEquals(h.calls[1].args.p_outcome, "unknown");
});
Deno.test("definitive provider validation rejection allows only a deliberate new request", async () => {
  const h = harness({ providerStatus: 422, providerBody: { error: {} } });
  assertEquals((await h.handler(request())).status, 502);
  assertEquals(h.calls[1].args.p_outcome, "failed");
});
for (const saveThrows of [false, true]) {
  Deno.test(`accepted render with unavailable confirmation keeps original attempt (${saveThrows})`, async () => {
    const h = harness({ saveError: !saveThrows, saveThrows });
    const response = await h.handler(request());
    assertEquals(response.status, 503);
    assertStringIncludes((await response.json()).error, "reuse the same attempt");
    assertEquals(h.requests.length, 1);
    assertEquals(h.calls[1].args.p_outcome, "accepted");
  });
}
Deno.test("stale authoring refuses attachment after accepted render", async () => {
  const h = harness({ savedState: "stale" });
  assertEquals((await h.handler(request())).status, 409);
});
Deno.test("invalid request ID is rejected before reserving a paid attempt", async () => {
  const h = harness();
  assertEquals((await h.handler(request({ request_id: "not-a-uuid" }))).status, 400);
  assertEquals(h.calls.length, 0);
  assertEquals(h.requests.length, 0);
});
