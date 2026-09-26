/** Mirrors the pacing floor in complete_course_assignment; the server remains authoritative. */
export function courseCompletionWaitSeconds(startedAt: string | null | undefined, durationMinutes: number | null | undefined, now: number): number | null {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return null;
  const minimumSeconds = Math.max(60, Math.round((durationMinutes ?? 0) * 6));
  return Math.max(0, Math.ceil((started + minimumSeconds * 1000 - now) / 1000));
}
