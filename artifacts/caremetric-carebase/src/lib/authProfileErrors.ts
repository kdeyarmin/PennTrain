/**
 * Classify profile-load failures so a transient network blip (or offline start)
 * does not tear down a still-valid Auth session.
 *
 * PostgREST returns PGRST116 when `.single()` finds no row -- that is a definitive
 * "this account has no readable profile" signal and should end the session.
 * Everything else (Failed to fetch, timeouts, 5xx) is retryable; keep the session
 * and let AuthProfileError offer Try again so offline learning can still open.
 */
export function isDefinitiveProfileAbsence(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "PGRST116";
}

/**
 * Whether the full-page "Couldn't load your account profile" screen should replace the app.
 *
 * The rule is `no profile to run on`, not `the last request failed`, and the difference is the
 * defect this predicate exists to prevent. react-query reports `isError` for a failed REFETCH
 * while still holding the previous data, and the profile query is invalidated on every auth event
 * except sign-in/out -- including the roughly hourly TOKEN_REFRESHED. Keying the screen on
 * `isError` alone therefore unmounted the whole tree on any wifi blip, mid-form, and "Try again"
 * brought the user back to an empty one.
 *
 * A definitive absence (PGRST116) is not softened by this: `auth.tsx` signs that case out through
 * its own effect, which never consults the cached profile.
 */
export function shouldShowProfileError(state: {
  hasSession: boolean;
  isError: boolean;
  hasProfile: boolean;
}): boolean {
  return state.hasSession && state.isError && !state.hasProfile;
}
