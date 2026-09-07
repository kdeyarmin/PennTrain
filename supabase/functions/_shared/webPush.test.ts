import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  buildDisabledPushSubscriptionPatch,
  buildPushSubscriptionRow,
  webPushTargetPath,
} from "./webPush.ts";

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
});
