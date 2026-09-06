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
  reason: "user_unsubscribed" | "provider_subscription_expired",
  now = new Date().toISOString(),
) {
  return { disabled_at: now, disabled_reason: reason };
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
  if (typeof link === "string" && link.startsWith("/") && !link.startsWith("//")) return link;
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
