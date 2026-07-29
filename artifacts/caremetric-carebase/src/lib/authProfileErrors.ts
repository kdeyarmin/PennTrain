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
