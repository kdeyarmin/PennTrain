import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { createSmsMfaHandler } from "./handler.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const CHALLENGE = "33333333-3333-4333-8333-333333333333";
const ATTEMPT = "44444444-4444-4444-8444-444444444444";
const PHONE = "+12025550123";
const SID = "VE" + "a".repeat(32);
const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  TWILIO_ACCOUNT_SID: "AC" + "b".repeat(32), TWILIO_AUTH_TOKEN: "test-only-token", TWILIO_VERIFY_SERVICE_SID: "VA" + "c".repeat(32),
};
function token(claims: Record<string, unknown> = {}) {
  return `header.${btoa(JSON.stringify({ sub: USER, session_id: SESSION, aal: "aal1", ...claims }))}.signature`;
}
function request(body: unknown, bearer = token()) {
  return new Request("https://app.test/sms-mfa", { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
}
function provider(status = "pending", overrides: Record<string, unknown> = {}) {
  return { sid: SID, account_sid: ENV.TWILIO_ACCOUNT_SID, service_sid: ENV.TWILIO_VERIFY_SERVICE_SID,
    to: PHONE, channel: "sms", status, ...overrides };
}
type Options = {
  authError?: boolean; missingConfig?: boolean; providerStatus?: number; reply?: Record<string, unknown>;
  failRpc?: string; errorCode?: string; completed?: boolean; throwingProvider?: boolean;
};
function setup(options: Options = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown>; key: string }> = [];
  const requests: Array<{ url: string; fields: Record<string, string>; redirect?: string }> = [];
  const handler = createSmsMfaHandler({
    getEnv: (name) => options.missingConfig && name === "TWILIO_VERIFY_SERVICE_SID" ? undefined : ENV[name],
    createClient: (_url, key) => ({
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: options.authError ? new Error("invalid") : null }) },
      rpc: async (name, args) => {
        calls.push({ name, args, key });
        if (name === options.failRpc) return { data: null, error: { code: options.errorCode ?? "42501", message: "PRIVATE SQL AND PHONE" } };
        let data: unknown = null;
        if (name === "get_my_mfa_status") data = { verified: false, smsFactors: [] };
        if (name === "prepare_sms_mfa_challenge") data = { challengeId: CHALLENGE, phone: PHONE, expiresAt: "2026-09-09T01:10:00Z" };
        if (name === "reserve_sms_mfa_check") data = { verificationSid: SID, phone: PHONE, attemptId: ATTEMPT, expiresAt: "2026-09-09T01:10:00Z" };
        if (name === "complete_sms_mfa_check") data = { verified: args?.p_approved === true && options.completed !== false };
        return { data, error: null };
      },
    }),
    fetcher: async (url, init) => {
      requests.push({ url: String(url), fields: Object.fromEntries(new URLSearchParams(String(init?.body))), redirect: init?.redirect });
      if (options.throwingProvider) throw new Error("SECRET provider body");
      return new Response(JSON.stringify(options.reply ?? provider()), { status: options.providerStatus ?? 200 });
    },
  });
  return { handler, calls, requests };
}

Deno.test("sms MFA authenticates before parsing identity or sending any SMS", async () => {
  const s = setup({ authError: true });
  assertEquals((await s.handler(request({ action: "send", phone: PHONE }))).status, 401);
  assertEquals(s.calls, []); assertEquals(s.requests, []);
  assertEquals((await s.handler(new Request("https://app.test", { method: "GET" }))).status, 405);
  assertEquals((await s.handler(new Request("https://app.test", { method: "POST" }))).status, 401);
});

for (const claims of [{ sub: "other-user" }, { session_id: "invalid" }, { session_id: null }]) {
  Deno.test(`sms MFA refuses mismatched verified identity ${JSON.stringify(claims)}`, async () => {
    const s = setup();
    assertEquals((await s.handler(request({ action: "send", phone: PHONE }, token(claims)))).status, 401);
    assertEquals(s.requests, []); assertEquals(s.calls, []);
  });
}

for (const body of [null, [], { action: "unknown" }, { action: "send", phone: 123 }, { action: "send", phone: "+012345678" },
  { action: "verify", challengeId: CHALLENGE, code: 123456 }, { action: "verify", challengeId: "other", code: "123456" }]) {
  Deno.test(`sms MFA refuses invalid input ${JSON.stringify(body)}`, async () => {
    const s = setup(); assertEquals((await s.handler(request(body))).status, 400); assertEquals(s.requests, []);
  });
}

Deno.test("sms MFA rejects oversized input before database mutation", async () => {
  const s = setup(); assertEquals((await s.handler(request({ action: "send", phone: "a".repeat(2049) }))).status, 413);
  assertEquals(s.calls, []);
});

Deno.test("sms MFA status remains readable without provider configuration", async () => {
  const s = setup({ missingConfig: true });
  const response = await s.handler(request({ action: "status" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { verified: false, smsFactors: [], smsAvailable: false });
  assertEquals(s.calls[0].key, "anon");
  assertEquals((await s.handler(request({ action: "send", phone: PHONE }))).status, 503);
  assertEquals(s.requests, []);
});

Deno.test("sms MFA binds send to verified caller and backend destination", async () => {
  const s = setup();
  const response = await s.handler(request({ action: "send", profileId: "victim", sessionId: "victim", nativeAal2: true }));
  assertEquals(response.status, 200);
  const result = await response.json(); assertEquals(result.challengeId, CHALLENGE); assertEquals(result.maskedPhone, "••• ••• 0123");
  assertEquals(s.calls[0].args, { p_profile_id: USER, p_session_id: SESSION, p_phone: null, p_native_aal2: false });
  assertEquals(s.calls[1].args, { p_profile_id: USER, p_session_id: SESSION, p_challenge_id: CHALLENGE, p_verification_sid: SID });
  assertEquals(s.requests[0].url, `https://verify.twilio.com/v2/Services/${ENV.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
  assertEquals(s.requests[0].fields, { To: PHONE, Channel: "sms" });
  assertEquals(s.requests[0].redirect, "error"); assertEquals(JSON.stringify(result).includes(PHONE), false);
});

for (const failRpc of ["prepare_sms_mfa_challenge", "reserve_sms_mfa_check"]) {
  Deno.test(`sms MFA database gate ${failRpc} precedes provider use`, async () => {
    const s = setup({ failRpc });
    const response = await s.handler(request({ action: failRpc.startsWith("prepare") ? "send" : "verify", challengeId: CHALLENGE, code: "123456" }));
    assertEquals(response.status, 403); assertEquals(s.requests, []);
    assertEquals((await response.text()).includes("PRIVATE"), false);
  });
}

Deno.test("sms MFA checks exact saved provider SID, then records approved proof", async () => {
  const s = setup({ reply: provider("approved") });
  const response = await s.handler(request({ action: "verify", challengeId: CHALLENGE, code: "123456", phone: "+19999999999" }));
  assertEquals(response.status, 200); assertEquals(await response.json(), { verified: true });
  assertEquals(s.requests[0].fields, { VerificationSid: SID, Code: "123456" });
  assertEquals(s.calls[1].args, { p_profile_id: USER, p_session_id: SESSION, p_challenge_id: CHALLENGE, p_attempt_id: ATTEMPT, p_approved: true });
});

for (const overrides of [{ sid: "VE" + "d".repeat(32) }, { to: "+12025550999" }, { channel: "call" },
  { account_sid: "AC" + "d".repeat(32) }, { service_sid: "VA" + "d".repeat(32) }]) {
  Deno.test(`sms MFA cannot accept approval for a different provider binding ${Object.keys(overrides)}`, async () => {
    const s = setup({ reply: provider("approved", overrides) });
    assertEquals((await s.handler(request({ action: "verify", challengeId: CHALLENGE, code: "123456" }))).status, 503);
    assertEquals(s.calls.filter(c => c.name === "complete_sms_mfa_check").every(c => c.args?.p_approved === false), true);
  });
}

Deno.test("sms MFA never treats valid:true or pending as approved", async () => {
  const s = setup({ reply: provider("pending", { valid: true }) });
  assertEquals((await s.handler(request({ action: "verify", challengeId: CHALLENGE, code: "123456" }))).status, 400);
  assertEquals(s.calls[1].args?.p_approved, false);
});

Deno.test("sms MFA provider approval does not override failed atomic consumption", async () => {
  const s = setup({ reply: provider("approved"), completed: false });
  assertEquals((await s.handler(request({ action: "verify", challengeId: CHALLENGE, code: "123456" }))).status, 400);
});

Deno.test("sms MFA timeout fails closed and releases check lease without code in response", async () => {
  const s = setup({ throwingProvider: true });
  const response = await s.handler(request({ action: "verify", challengeId: CHALLENGE, code: "123456" }));
  assertEquals(response.status, 503); assertEquals(s.calls[1].args?.p_approved, false);
  assertEquals((await response.text()).includes("SECRET"), false);
});

Deno.test("sms MFA does not expose provider errors and honors provider throttling", async () => {
  const s = setup({ providerStatus: 429, reply: { message: "private phone and code" } });
  const response = await s.handler(request({ action: "send" }));
  assertEquals(response.status, 429); assertStringIncludes(await response.text(), "wait");
  assertEquals(s.calls.some(c => c.name === "activate_sms_mfa_challenge"), false);
});

Deno.test("sms MFA refuses duplicate provider SID binding without returning a usable challenge", async () => {
  const s = setup({ failRpc: "activate_sms_mfa_challenge", errorCode: "23505" });
  const response = await s.handler(request({ action: "send" }));
  assertEquals(response.status, 429); assertEquals((await response.text()).includes(CHALLENGE), false);
});
