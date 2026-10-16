/** Same 1–120 minute values the database sums for a comprehensive version. */
const DESIGNED_BLOCK_MINUTES = /^([1-9]|[1-9][0-9]|1[01][0-9]|120)$/;

/** Sum of designed block minutes. Invalid or missing values are skipped, matching the database. */
export function designedEngagementMinutes(blocks: readonly { body?: unknown }[] | null | undefined): number {
  let total = 0;
  for (const block of blocks ?? []) {
    const body = block.body;
    if (!body || typeof body !== "object") continue;
    const raw = (body as { estimated_minutes?: unknown }).estimated_minutes;
    const text = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : typeof raw === "string" ? raw : "";
    if (DESIGNED_BLOCK_MINUTES.test(text)) total += Number(text);
  }
  return total;
}

/**
 * Seconds until Mark complete can succeed.
 * Ordinary courses use the 10 percent floor in complete_course_assignment (at least one minute).
 * Comprehensive courses also have to stay open for the full designed block time; the button
 * used to follow only the shorter floor, then the save failed.
 */
export function courseCompletionWaitSeconds(
  startedAt: string | null | undefined,
  durationMinutes: number | null | undefined,
  now: number,
  options?: { contentStandard?: string | null; designedMinutes?: number | null },
): number | null {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return null;
  const comprehensive = options?.contentStandard === "comprehensive";
  const designed = options?.designedMinutes ?? 0;
  const minimumSeconds = comprehensive && designed > 0
    ? Math.max(60, Math.round(designed * 60))
    : Math.max(60, Math.round((durationMinutes ?? 0) * 6));
  return Math.max(0, Math.ceil((started + minimumSeconds * 1000 - now) / 1000));
}
