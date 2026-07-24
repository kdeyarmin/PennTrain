// Trial-state presentation for the billing surface (PT-052).
//
// The database enforces the trial cutoff at entitlement-resolution time
// (20260724180000_enforce_trial_expiry_entitlements.sql): a billing account
// still sitting in 'trial' whose organizations.trial_ends_at has passed, with
// no live subscription, resolves to 'past_due' at read time. This module
// mirrors that rule so the billing UI can tell administrators where they are
// in the trial before the cutoff silently removes module access.

/** Subscription states the entitlement resolver treats as a live subscription. */
export const LIVE_SUBSCRIPTION_STATES = ["trial", "active", "grace"] as const;

export function isLiveSubscriptionState(state: string | null | undefined): boolean {
  return !!state && (LIVE_SUBSCRIPTION_STATES as readonly string[]).includes(state);
}

export type TrialPresentation =
  | { kind: "trialing"; endsAt: Date; daysLeft: number }
  | { kind: "ended"; endsAt: Date }
  | { kind: "none" };

/**
 * Whole days until the trial cutoff, rounded up so a trial ending later today
 * still reads "1 day left" rather than "0 days left". Never negative.
 */
export function trialDaysLeft(trialEndsAt: Date, now: Date = new Date()): number {
  const msLeft = trialEndsAt.getTime() - now.getTime();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / 86_400_000);
}

export interface TrialPresentationInput {
  /** organizations.trial_ends_at (ISO string) -- null for legacy orgs with no stamped window. */
  trialEndsAt: string | null | undefined;
  /** billing_accounts.billing_state; null/undefined when the account row has not loaded or does not exist. */
  billingState: string | null | undefined;
  /** True when a billing_subscriptions row is in a live state (trial/active/grace). */
  hasLiveSubscription: boolean;
  now?: Date;
}

/**
 * Resolve what -- if anything -- the billing surface should say about the
 * in-app signup trial.
 *
 * - `trialing`: the account is still on the signup trial and the window is
 *   open ("Trial ends <date> (N days left)").
 * - `ended`: the window has passed and nothing else grants access; the
 *   entitlement resolver reads this account as past_due ("Trial ended --
 *   choose a plan to continue").
 * - `none`: no stamped window, a live subscription exists (Stripe is the
 *   source of truth), or the account is in a state the trial branch never
 *   touches (active/grace/comped/suspended/canceled).
 */
export function resolveTrialPresentation(input: TrialPresentationInput): TrialPresentation {
  const { trialEndsAt, billingState, hasLiveSubscription } = input;
  const now = input.now ?? new Date();

  if (!trialEndsAt) return { kind: "none" };
  const endsAt = new Date(trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return { kind: "none" };

  // A live subscription (including a Stripe trialing subscription) overrides
  // the in-app window entirely -- same guard as get_effective_entitlements.
  if (hasLiveSubscription) return { kind: "none" };

  // A missing/unloaded billing account defaults to 'trial', matching the
  // resolver's coalesce(v_billing_state, 'trial').
  const state = billingState ?? "trial";

  if (state === "trial") {
    if (endsAt.getTime() > now.getTime()) {
      return { kind: "trialing", endsAt, daysLeft: trialDaysLeft(endsAt, now) };
    }
    return { kind: "ended", endsAt };
  }

  // The read-time downgrade surfaces as past_due in places that consult the
  // resolver (organizations.subscription_status after a webhook, effective
  // entitlements). With no live subscription and a lapsed window, that
  // past_due is the lapsed trial.
  if (state === "past_due" && endsAt.getTime() <= now.getTime()) {
    return { kind: "ended", endsAt };
  }

  return { kind: "none" };
}
