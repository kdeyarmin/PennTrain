import type { createClient } from "jsr:@supabase/supabase-js@2.48.1";

export interface PushSubscriptionRowInput {
  organizationId: string;
  profileId: string;
  endpoint: string;
  endpointHash: string;
  p256dhKey: string;
  authKey: string;
  expirationTime: string | null;
  userAgentHash: string;
  now: string;
}

export function buildPushSubscriptionRow(input: PushSubscriptionRowInput) {
  return {
    organization_id: input.organizationId,
    profile_id: input.profileId,
    endpoint: input.endpoint,
    endpoint_hash: input.endpointHash,
    p256dh_key: input.p256dhKey,
    auth_key: input.authKey,
    expiration_time: input.expirationTime,
    user_agent_hash: input.userAgentHash,
    disabled_at: null,
    disabled_reason: null,
    last_used_at: input.now,
  };
}

export function buildDisabledPushSubscriptionPatch(
  reason: "user_unsubscribed" | "provider_subscription_expired" | "invalid_push_endpoint" | "invalid_push_keys",
  now = new Date().toISOString(),
) {
  return { disabled_at: now, disabled_reason: reason };
}

/** Only browser push providers may receive server-side push requests.
 * A user supplied HTTPS URL alone is not an SSRF boundary. Check again at send
 * time because stored subscriptions can predate this validation or use the API.
 * Providers: Firebase/Chromium, Mozilla Autopush, Apple Web Push, Windows WNS.
 * Verified provider guidance (2026-09-15):
 * https://developer.chrome.com/blog/web-push-interop-wins
 * https://mozilla-services.github.io/autopush-rs/
 * https://developer.apple.com/videos/play/wwdc2022/10098/ (all push.apple.com subdomains)
 * https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview
 */
export function isAllowedWebPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 40 || value.length > 4096
    || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    return url.hostname === "fcm.googleapis.com"
      || url.hostname === "updates.push.services.mozilla.com"
      || url.hostname.endsWith(".push.apple.com")
      || url.hostname.endsWith(".notify.windows.com");
  } catch { return false; }
}

function decodePushKey(value: unknown, byteLength: number): Uint8Array<ArrayBuffer> | null {
  const encodedLength = Math.ceil(byteLength * 8 / 6);
  if (typeof value !== "string" || value.length < encodedLength || value.length > encodedLength + 2
    || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const unpadded = value.replace(/=+$/, "");
  const padding = "=".repeat((4 - unpadded.length % 4) % 4);
  if (unpadded.length !== encodedLength || (value !== unpadded && value !== unpadded + padding)) return null;
  try {
    const decoded = atob(unpadded.replaceAll("-", "+").replaceAll("_", "/") + padding);
    if (decoded.length !== byteLength) return null;
    // Reject nonzero trailing pad bits as well as alphabet/padding errors.
    if (btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== unpadded) return null;
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch { return null; }
}

function isP256Point(bytes: Uint8Array<ArrayBuffer>): boolean {
  // RFC 5903 section 3.1: https://www.rfc-editor.org/rfc/rfc5903.html#section-3.1
  // Bounded public-coordinate validation only. Some Deno versions accept off-curve
  // points in importKey, so that import cannot by itself establish point validity.
  const prime = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const coefficientB = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const coordinate = (start: number) => bytes.slice(start, start + 32)
    .reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  if (bytes.length !== 65 || bytes[0] !== 4) return false;
  const x = coordinate(1);
  const y = coordinate(33);
  if (x >= prime || y >= prime) return false;
  const mod = (value: bigint) => ((value % prime) + prime) % prime;
  return mod(y * y) === mod(x * x * x - 3n * x + coefficientB);
}

/** Validate browser key encoding and the actual P-256 point before saving a subscription. */
export async function validatedWebPushKeys(p256dh: unknown, auth: unknown): Promise<{ p256dh: string; auth: string } | null> {
  const publicKey = decodePushKey(p256dh, 65);
  const authSecret = decodePushKey(auth, 16);
  if (!publicKey || !isP256Point(publicKey) || !authSecret) return null;
  try {
    await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch { return null; }
  return { p256dh: (p256dh as string).replace(/=+$/, ""), auth: (auth as string).replace(/=+$/, "") };
}

/** Retire invalid stored destinations before provider I/O, including rows predating validation. */
export async function rejectInvalidStoredPushSubscription(
  adminClient: Pick<ReturnType<typeof createClient<any>>, "from">,
  subscription: { id: string; endpoint: string; p256dh_key: string; auth_key: string },
  profileId: string,
): Promise<{ ok: false; retryable: false; errorCode: string; error: string; persistenceError: boolean } | null> {
  const reason = !isAllowedWebPushEndpoint(subscription.endpoint) ? "invalid_push_endpoint"
    : !await validatedWebPushKeys(subscription.p256dh_key, subscription.auth_key) ? "invalid_push_keys" : null;
  if (!reason) return null;
  let confirmedUnavailable = false;
  try {
    const { data, error } = await adminClient.from("push_subscriptions")
      .update(buildDisabledPushSubscriptionPatch(reason))
      .eq("id", subscription.id).eq("profile_id", profileId).eq("endpoint", subscription.endpoint)
      .is("disabled_at", null).select("id,disabled_at").maybeSingle();
    confirmedUnavailable = !error && data?.id === subscription.id
      && typeof data.disabled_at === "string" && data.disabled_at.length > 0;
  } catch { /* A lost response is resolved by the scoped observation below. */ }
  if (!confirmedUnavailable) {
    try {
      const { data, error } = await adminClient.from("push_subscriptions")
        .select("id,disabled_at").eq("id", subscription.id).eq("profile_id", profileId)
        .eq("endpoint", subscription.endpoint).maybeSingle();
      // Already disabled, deleted or replaced subscriptions are safe no-ops. A
      // replacement with another endpoint/profile must never be disabled here.
      confirmedUnavailable = !error && (data === null || (data?.id === subscription.id
        && typeof data.disabled_at === "string" && data.disabled_at.length > 0));
    } catch { confirmedUnavailable = false; }
  }
  // No provider request occurred. Keep the delivery permanently failed so policy
  // fallback runs, while independently surfacing an unconfirmed retirement write.
  return {
    ok: false, retryable: false, errorCode: reason,
    error: reason === "invalid_push_endpoint" ? "Browser push endpoint is not supported" : "Browser push subscription keys are invalid",
    persistenceError: !confirmedUnavailable,
  };
}

/**
 * Where a web-push notification should land (RELEASE_READINESS_PLAN 4.3, platform L8).
 *
 * Every push payload used to carry `data: { url: "/me" }`. `/me` is the employee self-service
 * shell: an org admin, facility manager, auditor, trainer or platform admin who tapped a push
 * notification was sent to a route their role cannot render, and the notification's own
 * destination -- `notifications.link`, which the in-app bell and the email/SMS `action_url` both
 * use -- was thrown away.
 *
 * The notification's link is the answer whenever it has one. Otherwise the role's own home is,
 * mirroring homePathForRole in artifacts/caremetric-carebase/src/lib/appDomains.ts (the Deno
 * runtime and the Vite app are separate deploy targets, so this is a cross-referenced copy rather
 * than a shared import -- the _shared/facilityTypes.ts convention).
 *
 * Only a same-origin absolute path is ever emitted: a link that is empty, relative, protocol
 * relative (`//evil.example`) or absolute would otherwise become the URL a tap navigates to.
 */
export function webPushTargetPath(
  link: string | null | undefined,
  role: string | null | undefined,
): string {
  if (typeof link === "string" && link.startsWith("/") && !link.startsWith("//")
    && !/[\\\u0000-\u001f\u007f]/.test(link)) return link;
  switch (role) {
    case "platform_admin":
      return "/admin";
    case "trainer":
      return "/trainer";
    case "employee":
      return "/me";
    case "org_admin":
    case "facility_manager":
    case "auditor":
      return "/app/today";
    default:
      // No role read back: the app's own post-sign-in router decides, which is strictly better
      // than guessing one role's shell for everybody.
      return "/";
  }
}
