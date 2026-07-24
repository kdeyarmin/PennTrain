// Pure decision logic for the billing provider-operation ledger (PT-053).
//
// Constraints this module encodes:
//   * Operation keys must be scoped to a billing period (or UTC day when the
//     subscription has no recorded period) so a recurring target quantity gets
//     a fresh ledger row instead of forever adopting a stale terminal status.
//   * Keys are built from the Stripe subscription item id, not the local row
//     id: the webhook replaces local rows (delete + reinsert), which changes
//     local ids mid-flight and would otherwise fork the ledger.
//   * 'failed' rows retry with exponential backoff derived from (attempts,
//     updated_at); 'pending' rows are reclaimed only after a claim timeout so
//     a crashed worker cannot wedge a target while a live one is not raced.
//   * Prior-success rows must be verified against the live Stripe item before
//     any mutation is skipped: a recorded success for this period/quantity is
//     not proof the provider still agrees.

export type BillingProviderOperationStatus =
  | "pending"
  | "provider_succeeded"
  | "local_succeeded"
  | "failed";

export type BillingOperationConflictResolution =
  | { action: "retry" }
  | { action: "wait"; reason: "backoff" | "in_flight" }
  | { action: "verify_provider" };

// A crashed worker's claim expires after this window; live workers finish (or
// mark failure) well inside it because every Stripe call has a 15s timeout.
const IN_FLIGHT_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_BASE_DELAY_MS = 15 * 60 * 1000;
// Capped (not attempt-limited) backoff: a persistently failing target keeps
// retrying a few times a day and keeps surfacing as failed in System Jobs
// instead of wedging permanently.
const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

export function billingQuantitySyncPeriodBucket(
  currentPeriodStart: string | null,
  nowMs = Date.now(),
): string {
  const parsed = currentPeriodStart ? Date.parse(currentPeriodStart) : NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function billingQuantitySyncOperationKey(
  stripeSubscriptionItemId: string,
  targetQuantity: number,
  periodBucket: string,
): string {
  return ["billing-quantity-sync", stripeSubscriptionItemId, targetQuantity, periodBucket].join(":");
}

// Stripe idempotency keys cache the full original response, so a retry that
// must actually mutate needs a fresh key per claimed attempt; the ledger row
// remains the cross-attempt duplicate guard.
export function billingQuantitySyncIdempotencyKey(
  operationKey: string,
  attempt: number,
): string {
  return attempt <= 1 ? operationKey : `${operationKey}:attempt-${attempt}`;
}

export function billingOperationRetryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 10);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

export function resolveBillingOperationConflict(
  existing: {
    status: BillingProviderOperationStatus;
    attempts: number;
    updated_at: string | null;
  },
  nowMs = Date.now(),
): BillingOperationConflictResolution {
  const updatedAtMs = existing.updated_at ? Date.parse(existing.updated_at) : NaN;
  // An unparsable timestamp is treated as infinitely old: retrying is the
  // converging choice and the ledger CAS prevents double-claims.
  const ageMs = Number.isFinite(updatedAtMs) ? nowMs - updatedAtMs : Number.POSITIVE_INFINITY;
  if (existing.status === "failed") {
    return ageMs >= billingOperationRetryDelayMs(existing.attempts)
      ? { action: "retry" }
      : { action: "wait", reason: "backoff" };
  }
  if (existing.status === "pending") {
    return ageMs >= IN_FLIGHT_CLAIM_TIMEOUT_MS
      ? { action: "retry" }
      : { action: "wait", reason: "in_flight" };
  }
  return { action: "verify_provider" };
}
