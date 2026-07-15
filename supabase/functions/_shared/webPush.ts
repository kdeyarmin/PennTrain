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
