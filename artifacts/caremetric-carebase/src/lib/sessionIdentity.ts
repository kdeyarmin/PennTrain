/**
 * Did the signed-in identity actually change under a session that stayed signed in?
 *
 * BACKLOG.md open question 6. `auth.tsx` already calls `queryClient.clear()` on every transition
 * that ends a session -- SIGNED_IN, a definitively-missing profile, a deactivated profile, the
 * AuthProfileError sign-out, and `useSignOut`. The one transition with no clear was the one where
 * the session survives: an admin changes someone's role, organization, or facility mid-shift. Any
 * cached query whose key does not itself carry the identity then keeps serving the previous
 * context's rows until its own staleTime lapses. The worst case is a signed storage URL, which is
 * bearer-authorized for its whole TTL and keeps resolving no matter what RLS would now say.
 *
 * WHY THIS IS NOT shouldWipeOfflineServiceDraftData. That predicate looks close enough to reuse and
 * is the wrong tool: it returns true whenever `current.role !== "employee"`, because the offline
 * draft store is employee-only and a non-employee holding drafts is itself the thing to wipe.
 * Wiping an empty store for a manager costs nothing. Clearing a manager's entire react-query cache
 * every time that predicate is evaluated would be a different matter entirely -- every manager would
 * lose their whole cache on any identity re-evaluation, forever. The two questions are genuinely
 * different: "may this identity hold offline drafts" versus "is this a different identity than the
 * one the cache was populated for".
 *
 * DEACTIVATION IS DELIBERATELY ABSENT. A profile that goes inactive is handled by its own effect in
 * auth.tsx, which signs the session out and clears. Testing `active` here as well would re-fire on
 * every subsequent evaluation of an identity that is still inactive, since the comparison ref
 * carries no activity flag -- a clear-refetch-clear cycle rather than a single transition.
 */
export interface SessionIdentity {
  profileId: string;
  organizationId: string;
  role: string;
}

export function signedInIdentityChanged(
  previous: SessionIdentity | null,
  current: SessionIdentity | null,
): boolean {
  // Nothing established yet. The transition that establishes an identity is SIGNED_IN, which
  // already clears; treating first resolution as a change would only clear an empty cache.
  if (!previous) return false;
  // An identity was established and is now gone. Reached only once the profile query has actually
  // settled -- auth.tsx skips this comparison entirely while a live session's profile is still
  // resolving, which is the state that would otherwise read as a spurious identity loss. Returning
  // true here is the deliberately safe direction: a false negative serves another context's rows,
  // a false positive costs one refetch.
  if (!current) return true;
  return previous.profileId !== current.profileId
    || previous.organizationId !== current.organizationId
    || previous.role !== current.role;
}
