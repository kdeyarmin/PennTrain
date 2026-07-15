import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  buildDisabledPushSubscriptionPatch,
  buildPushSubscriptionRow,
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
