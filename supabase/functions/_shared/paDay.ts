/**
 * The facility's calendar day, for edge functions.
 *
 * Edge functions run in UTC, exactly like the database does, so `new Date().toISOString().slice(0,
 * 10)` is the UTC day and is one day ahead of Pennsylvania every evening after 20:00 ET. Four
 * functions derived a "today" that way and each one fed it somewhere it mattered:
 *
 *   * generate-compliance-binder compared it against attestation due_date to sort overdue from
 *     pending, so an attestation due tomorrow was printed as OVERDUE in the binder an inspector
 *     reads;
 *   * run-mock-inspection stamped it as the run's as_of_date;
 *   * compliance-copilot and voice-tools used it as the default `asOf` for compliance questions,
 *     so an evening question was answered against the wrong day's picture.
 *
 * This is the TypeScript twin of public.pa_today() (supabase/migrations/20260727010100). Keeping the
 * two in step matters: an edge function that computes a day one way and then calls an RPC that
 * computes it the other produces answers that disagree with themselves.
 *
 * Not applied to: the `isoDate` validators and `addDays` helpers in compliance-copilot and
 * voice-tools. Those do arithmetic on bare "YYYY-MM-DD" strings by parsing them at UTC midnight,
 * which is the correct way to add days to a date string without DST dragging it across a boundary.
 * They never ask what day it is now, so they are not affected. Nor to _shared/billingQuantitySync,
 * which bounds a billing period -- the SQL side keeps billing periods in UTC too, and the two must
 * agree with each other rather than with a wall clock.
 */

const PA_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pennsylvania calendar day as "YYYY-MM-DD". `en-CA` is the locale that formats that way. */
export function paToday(now: Date = new Date()): string {
  return PA_DAY_FORMAT.format(now);
}
