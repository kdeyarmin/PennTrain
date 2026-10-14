import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { expect, type Page, type Route } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Text message is CareBase's only second factor, and a browser run has no phone. These helpers
 * stand in for the one thing a test cannot do -- receive the text -- and nothing else:
 *
 * - `emulateSmsDelivery` answers the app's calls to the sms-mfa Edge Function the way that
 *   function does once Twilio Verify has sent (and later approved) a code: the same service-role
 *   database calls in the same order, with TEST_SMS_CODE as the code the user received. The
 *   real UI is driven end to end.
 * - `verifySessionBySms` does the same for a script-held session (an API client in a fixture).
 *
 * Everything the database enforces still runs: the fresh-password rule for enrollment, the
 * per-session challenge, the attempt lease and the session-bound attestation that every
 * privileged read and write then checks. The one adjustment is to the send-rate history of the
 * test account itself (`ageSmsHistory`): suites sign the same account in many times a minute,
 * which the one-code-per-minute limit is there to stop in production.
 */

export const TEST_SMS_CODE = "246810";
const LOCAL_DB_CONTAINER = "supabase_db_xsqobvvreaovwibxwyvv";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to verify a session by text message`);
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A stable, never-dialled number per account, so per-number send limits never couple two accounts. */
export function testMobileFor(profileId: string): string {
  const digits = BigInt(`0x${createHash("sha256").update(profileId).digest("hex").slice(0, 12)}`) % 10_000n;
  return `+1555555${digits.toString().padStart(4, "0")}`;
}

function sessionClaims(accessToken: string): { sub: string; session_id: string } {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("Not a session access token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub) || typeof claims.session_id !== "string" || !UUID.test(claims.session_id)) {
    throw new Error("The access token carries no user or session id");
  }
  return { sub: claims.sub, session_id: claims.session_id };
}

/**
 * Move this test account's finished challenges out of the send-rate windows (one code a minute,
 * five in ten minutes, twenty a day). Only consumed or canceled rows of the one profile move, and
 * only in the disposable local database -- the same docker/psql route the local-stack tests use.
 */
function ageSmsHistory(profileId: string): void {
  if (!UUID.test(profileId)) throw new Error("Invalid profile id");
  const url = new URL(requireEnv("SUPABASE_URL"));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Send history is only adjusted in the local test stack");
  }
  execFileSync("docker", ["exec", "-i", LOCAL_DB_CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-qAt", "-c",
    `update app_private.sms_mfa_challenges
        set created_at = created_at - interval '2 days', expires_at = expires_at - interval '2 days',
            last_sent_at = last_sent_at - interval '2 days'
      where profile_id = '${profileId}' and state in ('consumed', 'canceled');`], { stdio: ["ignore", "ignore", "pipe"] });
}

class DatabaseCallError extends Error {
  constructor(name: string, readonly hint: string | undefined, message: string) { super(`${name}: ${message}`); }
}

async function call(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new DatabaseCallError(name, error.hint ?? undefined, error.message);
  return (data ?? {}) as Record<string, unknown>;
}

type Identity = { p_profile_id: string; p_session_id: string };

/**
 * Twilio returns the same Verification SID when a pending verification is resent, and
 * `activate_sms_mfa_challenge` accepts only that original SID for a reused challenge, so the
 * emulated provider keeps one SID per challenge.
 */
const verificationSids = new Map<string, string>();

/** What the Edge Function's "send" does after its own checks: open the challenge and record the SID. */
async function sendCode(client: SupabaseClient, identity: Identity, phone: string | null) {
  ageSmsHistory(identity.p_profile_id);
  const prepared = await call(client, "prepare_sms_mfa_challenge", { ...identity, p_phone: phone, p_native_aal2: false });
  if (typeof prepared.challengeId !== "string" || typeof prepared.phone !== "string") throw new Error("No challenge was prepared");
  let sid = verificationSids.get(prepared.challengeId);
  if (!sid) verificationSids.set(prepared.challengeId, sid = `VE${randomBytes(16).toString("hex")}`);
  await call(client, "activate_sms_mfa_challenge", { ...identity, p_challenge_id: prepared.challengeId, p_verification_sid: sid });
  return { challengeId: prepared.challengeId, phone: prepared.phone, expiresAt: prepared.expiresAt };
}

/** What the Edge Function's "verify" does around Twilio's answer, with `approved` as that answer. */
async function checkCode(client: SupabaseClient, identity: Identity, challengeId: string, approved: boolean) {
  const reserved = await call(client, "reserve_sms_mfa_check", { ...identity, p_challenge_id: challengeId });
  const completed = await call(client, "complete_sms_mfa_check", {
    ...identity, p_challenge_id: challengeId, p_attempt_id: reserved.attemptId, p_approved: approved,
  });
  return approved && completed.verified === true;
}

/** Verify the Auth session behind `accessToken` by text message, enrolling the account's test number if needed. */
export async function verifySessionBySms(accessToken: string): Promise<void> {
  const { sub, session_id } = sessionClaims(accessToken);
  const identity = { p_profile_id: sub, p_session_id: session_id };
  const client = serviceClient();
  let sent;
  try {
    sent = await sendCode(client, identity, null);
  } catch (error) {
    if (!(error instanceof DatabaseCallError) || error.hint !== "sms_factor_not_enrolled") throw error;
    sent = await sendCode(client, identity, testMobileFor(sub));
  }
  if (!await checkCode(client, identity, sent.challengeId, true)) throw new Error("The text-message check did not verify the session");
}

const RATE_LIMITED = new Set(["sms_send_rate_limited", "sms_check_rate_limited", "sms_provider_challenge_reused", "sms_verification_in_progress"]);

/**
 * Answer this page's sms-mfa requests (Supabase or Railway provider route) as the Edge Function
 * would, with TEST_SMS_CODE as the code that arrives. Install before the page needs a code.
 */
const emulatedPages = new WeakSet<Page>();

export async function emulateSmsDelivery(page: Page): Promise<void> {
  if (emulatedPages.has(page)) return;
  emulatedPages.add(page);
  const client = serviceClient();
  const anonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const handler = async (route: Route) => {
    const request = route.request();
    const origin = request.headers().origin;
    const cors: Record<string, string> = origin ? {
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    } : {};
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const reply = (status: number, body: unknown) => route.fulfill({
      status, headers: { ...cors, "Cache-Control": "no-store" }, contentType: "application/json", body: JSON.stringify(body),
    });
    const authorization = request.headers().authorization ?? "";
    const body = (request.postDataJSON() ?? {}) as { action?: string; phone?: string; challengeId?: string; code?: string };
    try {
      const { sub, session_id } = sessionClaims(authorization.replace(/^Bearer\s+/i, ""));
      const identity = { p_profile_id: sub, p_session_id: session_id };
      if (body.action === "status") {
        const caller = createClient(requireEnv("SUPABASE_URL"), anonKey, {
          global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await caller.rpc("get_my_mfa_status");
        if (error) return reply(503, { error: "Verification is temporarily unavailable." });
        return reply(200, { ...(data as Record<string, unknown>), smsAvailable: true });
      }
      if (body.action === "send") {
        const sent = await sendCode(client, identity, typeof body.phone === "string" ? body.phone : null);
        return reply(200, { challengeId: sent.challengeId, maskedPhone: `••• ••• ${sent.phone.slice(-4)}`, expiresAt: sent.expiresAt });
      }
      if (body.action === "verify" && typeof body.challengeId === "string" && typeof body.code === "string") {
        if (await checkCode(client, identity, body.challengeId, body.code === TEST_SMS_CODE)) return reply(200, { verified: true });
        return reply(400, { error: "That code is invalid or expired. Request a new code and try again.", code: "invalid_code" });
      }
      return reply(400, { error: "Invalid verification request." });
    } catch (error) {
      const hint = error instanceof DatabaseCallError ? error.hint : undefined;
      if (hint && RATE_LIMITED.has(hint)) return reply(429, { error: "Please wait before requesting another code.", code: "sms_rate_limited" });
      if (hint === "sms_challenge_unavailable") return reply(400, { error: "This code is unavailable or expired.", code: "challenge_expired" });
      if (hint) return reply(403, { error: "Verification could not be completed.", code: hint });
      return reply(503, { error: "Verification could not be completed. Please try again later." });
    }
  };
  await page.route("**/functions/v1/sms-mfa", handler);
  await page.route("**/api/providers/sms-mfa", handler);
}

/**
 * The flow a privileged user takes from the MFA wall, through the real account security page:
 * open it from the gate, add the account's mobile number (or text a code to the one on file),
 * enter the code, and continue to the page they were opening. `onAccountSecurity` runs on the
 * account security page before anything is sent.
 */
export async function completeRequiredSmsVerification(
  page: Page,
  onAccountSecurity?: () => Promise<void>,
): Promise<void> {
  await emulateSmsDelivery(page);
  await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
  await page.getByRole("link", { name: "Open account security" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Multi-factor authentication" })).toBeVisible();
  // Text message is the only method on offer: no authenticator app, QR code or setup key.
  await expect(page.getByText(/authenticator|setup key/i)).toHaveCount(0);
  await onAccountSecurity?.();
  const textMe = page.getByRole("button", { name: "Text me a code", exact: true });
  const addMobile = page.getByRole("button", { name: "Add text message (SMS)", exact: true });
  // Wait for the page to settle on one of its two states before choosing.
  await expect(textMe.or(addMobile).first()).toBeVisible();
  if (await textMe.isVisible()) {
    await textMe.click();
  } else {
    await addMobile.click();
    const { sub } = sessionClaims(await pageAccessToken(page));
    await page.getByLabel("Mobile number", { exact: true }).fill(testMobileFor(sub));
    await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  }
  await page.getByLabel("Text message code", { exact: true }).fill(TEST_SMS_CODE);
  await page.getByRole("button", { name: "Verify text message code", exact: true }).click();
  await expect(page.getByText(/This session is already verified/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to the page you were opening" }).click();
}

/** The access token of the session this page is signed in with (supabase-js's default storage). */
export async function pageAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as { access_token?: unknown } | null;
      if (typeof stored?.access_token === "string") return stored.access_token;
    }
    return null;
  });
  if (!token) throw new Error("This page has no signed-in session to verify");
  return token;
}

/** The access and refresh token this page's session is stored with, for a script-held client. */
export async function pageSession(page: Page): Promise<{ access_token: string; refresh_token: string }> {
  const session = await page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as { access_token?: unknown; refresh_token?: unknown } | null;
      if (typeof stored?.access_token === "string" && typeof stored.refresh_token === "string") {
        return { access_token: stored.access_token, refresh_token: stored.refresh_token };
      }
    }
    return null;
  });
  if (!session) throw new Error("This page has no signed-in session");
  return session;
}

/**
 * Verify this page's session for an account that already has a mobile number on file, through the
 * account security page: text a code, enter it, and see the session verified.
 */
export async function verifyEnrolledSessionOnAccountSecurity(page: Page): Promise<void> {
  await emulateSmsDelivery(page);
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Text me a code", exact: true }).click();
  await page.getByLabel("Text message code", { exact: true }).fill(TEST_SMS_CODE);
  await page.getByRole("button", { name: "Verify text message code", exact: true }).click();
  await expect(page.getByText(/session is already verified/i)).toBeVisible();
}
