import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  buildDisabledPushSubscriptionPatch,
  buildPushSubscriptionRow,
  isAllowedWebPushEndpoint,
  validatedWebPushKeys,
  webPushTargetPath,
} from "./webPush.ts";

Deno.test("push key validation accepts the P-256 generator and canonical optional padding", async () => {
  const p256dh = "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU";
  const auth = "AAECAwQFBgcICQoLDA0ODw";
  assertEquals(await validatedWebPushKeys(p256dh, auth), { p256dh, auth });
  assertEquals(await validatedWebPushKeys(p256dh + "=", auth + "=="), { p256dh, auth });
  assertEquals(await validatedWebPushKeys(p256dh, auth + "="), null);
  assertEquals(await validatedWebPushKeys(p256dh, auth.slice(0, -1) + "x"), null);
  assertEquals(await validatedWebPushKeys("BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", auth), null);
});

Deno.test("push subscription rows use the schema column and clear disable state", () => {
  const row = buildPushSubscriptionRow({
    organizationId: "org-1",
    profileId: "profile-1",
    endpoint: "https://push.example/subscription",
    endpointHash: "a".repeat(64),
    p256dhKey: "p".repeat(80),
    authKey: "auth-key",
    expirationTime: null,
    userAgentHash: "b".repeat(64),
    now: "2026-07-15T19:00:00.000Z",
  });

  assertEquals(row.user_agent_hash, "b".repeat(64));
  assertFalse("user_agent_sha256" in row);
  assertEquals(row.disabled_at, null);
  assertEquals(row.disabled_reason, null);
});

Deno.test("disable patches satisfy the paired timestamp and reason constraint", () => {
  assertEquals(
    buildDisabledPushSubscriptionPatch(
      "provider_subscription_expired",
      "2026-07-15T20:00:00.000Z",
    ),
    {
      disabled_at: "2026-07-15T20:00:00.000Z",
      disabled_reason: "provider_subscription_expired",
    },
  );
});

Deno.test("webPushTargetPath prefers the notification's own destination", () => {
  assertEquals(webPushTargetPath("/app/work-queue/abc", "employee"), "/app/work-queue/abc");
  assertEquals(webPushTargetPath("/me/courses", "org_admin"), "/me/courses");
});

Deno.test("webPushTargetPath falls back to the recipient role's home, not /me for everyone", () => {
  assertEquals(webPushTargetPath(null, "platform_admin"), "/admin");
  assertEquals(webPushTargetPath(null, "org_admin"), "/app/today");
  assertEquals(webPushTargetPath(null, "facility_manager"), "/app/today");
  assertEquals(webPushTargetPath(null, "auditor"), "/app/today");
  assertEquals(webPushTargetPath(null, "trainer"), "/trainer");
  assertEquals(webPushTargetPath(null, "employee"), "/me");
  assertEquals(webPushTargetPath(null, null), "/");
});

Deno.test("webPushTargetPath refuses a link that is not a same-origin path", () => {
  assertEquals(webPushTargetPath("//evil.example/steal", "employee"), "/me");
  assertEquals(webPushTargetPath("https://evil.example/steal", "org_admin"), "/app/today");
  assertEquals(webPushTargetPath("", "trainer"), "/trainer");
  assertEquals(webPushTargetPath("app/today", "org_admin"), "/app/today");
  assertEquals(webPushTargetPath("/\\evil.example/steal", "employee"), "/me");
  assertEquals(webPushTargetPath("/\n/evil.example/steal", "employee"), "/me");
});

Deno.test("push endpoint policy accepts supported browser services", () => {
  for (const origin of ["https://fcm.googleapis.com", "https://updates.push.services.mozilla.com", "https://web.push.apple.com", "https://subdomain.push.apple.com", "https://wns2-bn1p.notify.windows.com"]) {
    assertEquals(isAllowedWebPushEndpoint(`${origin}/subscription/opaque-token`), true);
  }
});

Deno.test("push endpoint policy blocks SSRF, deceptive hosts and URL parser ambiguities", () => {
  for (const endpoint of [
    "https://127.0.0.1/private-path-of-at-least-40-characters",
    "https://169.254.169.254/metadata/identity/oauth2/token",
    "https://[::1]/private-path-of-at-least-40-characters",
    "https://internal-service/private-path-of-at-least-40-characters",
    "https://fcm.googleapis.com.evil.example/opaque-token",
    "https://evilpush.apple.com/opaque-token-at-least-40-characters",
    "https://push.apple.com.evil.example/opaque-token",
    "https://evilnotify.windows.com/opaque-token-at-least-40-characters",
    "https://evil.example/fcm.googleapis.com/opaque-token",
    "https://fcm.googleapis.com@evil.example/opaque-token",
    "https://user:password@fcm.googleapis.com/opaque-token",
    "https://fcm.googleapis.com:444/opaque-token",
    "https://fcm.googleapis.com/opaque-token#fragment",
    "https://fcm.googleapis.com\\@evil.example/opaque-token",
    "https://fcm.google\napis.com/opaque-token",
    "http://fcm.googleapis.com/opaque-token-at-least-40-characters",
  ]) assertEquals(isAllowedWebPushEndpoint(endpoint), false, endpoint);
});
