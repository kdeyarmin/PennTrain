/**
 * When a bounded impersonation context may still be acted on (BACKLOG.md I8).
 *
 * `bind` and `end` used to share one guard, which refused both once `expires_at` had passed. That
 * made the 30-minute window a trap rather than a bound: an administrator who was still signed in
 * AS the target when it elapsed found "Exit impersonation" answering 403 -- and exiting is exactly
 * what revokes the impersonated session and restores their own. They were left inside the target's
 * account, in the target's organization, with no way out short of a full sign-out.
 *
 * Ending late is the safe direction and the only one that reduces exposure. Binding late is not:
 * attaching a fresh Auth session to a dead context is how a bounded window becomes an unbounded
 * one, so that stays refused.
 *
 * Split out and named so the asymmetry is a stated rule with a test, rather than a condition
 * someone can re-merge into the guard above it while tidying.
 */
export type ImpersonationAction = "bind" | "end";

export interface ImpersonationContextState {
  /** ISO timestamp from impersonation_sessions.expires_at. */
  expiresAt: string;
  /** ISO timestamp from impersonation_sessions.ended_at, or null while it is live. */
  endedAt: string | null;
}

export function impersonationActionAllowed(
  action: ImpersonationAction,
  context: ImpersonationContextState,
  now: number = Date.now(),
): boolean {
  // An already-ended context is finished for both actions; there is nothing left to bind to and
  // nothing left to revoke.
  if (context.endedAt) return false;
  if (action === "end") return true;
  const expiresAt = Date.parse(context.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
