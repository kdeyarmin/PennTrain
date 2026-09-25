import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  buildDisabledPushSubscriptionPatch,
  buildPushSubscriptionRow,
  isAllowedWebPushEndpoint,
  validatedWebPushKeys,
  rejectInvalidStoredPushSubscription,
  webPushTargetPath,
} from "./webPush.ts";

Deno.test("push key validation accepts the P-256 generator and canonical optional padding", async () => {
  const p256dh = "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU";
  // Public synthetic bytes 0..15, encoded at runtime; never a provider credential.
  const auth = btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  assertEquals(await validatedWebPushKeys(p256dh, auth), { p256dh, auth });
  assertEquals(await validatedWebPushKeys(p256dh + "=", auth + "=="), { p256dh, auth });
  assertEquals(await validatedWebPushKeys(p256dh, auth + "="), null);
  assertEquals(await validatedWebPushKeys(p256dh, auth.slice(0, -1) + "x"), null);
  assertEquals(await validatedWebPushKeys("BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", auth), null);
});

Deno.test("push key validation rejects out-of-field coordinates and off-curve points", async () => {
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const auth = encode(Uint8Array.from({ length: 16 }, (_, index) => index));
  const prime = Uint8Array.from("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff".match(/../g)!, (byte) => parseInt(byte, 16));
  for (const coordinateOffset of [1, 33]) {
    const point = new Uint8Array(65);
    point[0] = 4;
    point.set(prime, coordinateOffset);
    assertEquals(await validatedWebPushKeys(encode(point), auth), null);
    point.fill(255, coordinateOffset, coordinateOffset + 32);
    assertEquals(await validatedWebPushKeys(encode(point), auth), null);
  }
  const offCurve = new Uint8Array(65);
  offCurve[0] = 4;
  offCurve[32] = 1;
  offCurve[64] = 1;
  assertEquals(await validatedWebPushKeys(encode(offCurve), auth), null);
});

Deno.test("stored invalid push destinations retire only the matching profile and endpoint", async () => {
  const p256dh = "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU";
  const auth_key = btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index))).replace(/=+$/, "");
  const valid = { id: "subscription-1", endpoint: "https://fcm.googleapis.com/fcm/send/subscription-token", p256dh_key: p256dh, auth_key };
  assertEquals(await rejectInvalidStoredPushSubscription({ from: () => { throw new Error("valid destination must not be retired"); } } as never, valid, "profile-1"), null);

  for (const [subscription, reason] of [
    [{ ...valid, endpoint: "https://127.0.0.1/private-path-at-least-40-characters" }, "invalid_push_endpoint"],
    [{ ...valid, p256dh_key: "invalid" }, "invalid_push_keys"],
  ] as const) {
    for (const scenario of ["updated", "lost_response", "already_disabled", "deleted_or_replaced", "write_failed", "read_failed"]) {
      const queries: Array<{ mode: string; filters: Array<[string, unknown]>; patch?: Record<string, unknown> }> = [];
      const client = { from: (table: string) => {
        assertEquals(table, "push_subscriptions");
        const record: { mode: string; filters: Array<[string, unknown]>; patch?: Record<string, unknown> } = { mode: "read", filters: [] };
        queries.push(record);
        const query = {
          update: (patch: Record<string, unknown>) => { record.mode = "update"; record.patch = patch; return query; },
          eq: (name: string, value: unknown) => { record.filters.push([name, value]); return query; },
          is: (name: string, value: unknown) => { record.filters.push([name, value]); return query; },
          select: () => query,
          maybeSingle: async () => {
            if (record.mode === "update") {
              if (scenario === "lost_response") throw new Error("response lost");
              if (scenario === "updated") return { data: { id: valid.id, disabled_at: "2026-09-15T00:00:00Z" }, error: null };
              return { data: null, error: scenario === "write_failed" || scenario === "read_failed" ? { code: "error" } : null };
            }
            if (scenario === "read_failed") throw new Error("read unavailable");
            return { data: scenario === "deleted_or_replaced" ? null : { id: valid.id, disabled_at: scenario === "write_failed" ? null : "2026-09-15T00:00:00Z" }, error: null };
          },
        };
        return query;
      } };
      const result = await rejectInvalidStoredPushSubscription(client as never, subscription, "profile-1");
      assertEquals(result?.ok, false);
      assertEquals(result?.retryable, false);
      assertEquals(result?.errorCode, reason);
      assertEquals(result?.persistenceError, ["write_failed", "read_failed"].includes(scenario));
      assertEquals(queries[0].patch?.disabled_reason, reason);
      assertEquals(typeof queries[0].patch?.disabled_at, "string");
      for (const record of queries) {
        assertEquals(record.filters.slice(0, 3), [["id", subscription.id], ["profile_id", "profile-1"], ["endpoint", subscription.endpoint]]);
      }
      assertEquals(queries[0].filters[3], ["disabled_at", null]);
    }
  }
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
