/**
 * What the complete-organization-export card may claim about a job
 * (RELEASE_READINESS_PLAN 4.3, imports D5 and D6).
 *
 * Pure predicates, kept out of the hook module so they can be unit tested without constructing a
 * Supabase client.
 */

/**
 * Whether a requested export still owes the tenant an archive.
 *
 * `claim_organization_export_jobs` claims `status in ('pending','failed') and attempt_count <
 * max_attempts`, so a failed job with attempts left is not finished -- it is waiting out
 * `finish_organization_export_job`'s backoff and will run again. `request_organization_export` used
 * to refuse only `pending`/`processing`, which let an admin queue a second full-tenant archive
 * while the first was still going to run; the RPC now covers the retry window and this is the
 * matching client-side guard, so the button is disabled rather than throwing.
 */
export function organizationExportIsInFlight(job: {
  status: string;
  attempt_count: number;
  max_attempts: number;
}): boolean {
  if (job.status === "pending" || job.status === "processing") return true;
  return job.status === "failed" && job.attempt_count < job.max_attempts;
}

/**
 * Whether a succeeded archive is past its seven-day life.
 *
 * `finish_organization_export_job` stamps `expires_at = now() + interval '7 days'` and
 * `purge_expired_organization_exports` deletes the stored object after it. The row keeps
 * `status = 'succeeded'` either way, so status alone cannot decide whether a Download button has
 * anything behind it -- and it was the only thing being asked, so the button was offered for
 * archives that no longer existed and the click ended in a storage error.
 */
export function organizationExportArchiveHasExpired(
  job: { status: string; expires_at: string | null },
  now: Date = new Date(),
): boolean {
  if (job.status !== "succeeded" || !job.expires_at) return false;
  const expiresAt = new Date(job.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}
