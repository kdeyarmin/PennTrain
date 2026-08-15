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

const PA_OFFSET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "longOffset",
});

/** The America/New_York UTC offset in minutes at a given instant (-300 EST, -240 EDT). */
function paOffsetMinutesAt(instant: Date): number {
  const name = PA_OFFSET_FORMAT.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return -300;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Interpret a zone-less "YYYY-MM-DD" or "YYYY-MM-DD[ T]HH:MM[:SS]" wall-clock value as
 * Pennsylvania local time and return a UTC ISO string. Values that already carry a zone
 * ("Z" or a +/-HH:MM offset) pass through unchanged.
 *
 * Why: Postgres parses a zone-less timestamptz literal in the SESSION zone (UTC here), so an
 * imported incident logged as "2026-08-14" landed at midnight UTC -- 8 PM ET on 2026-08-13 --
 * and the incident rendered on the previous calendar day in every report an inspector reads.
 */
/**
 * True when `value` has the zone-less wall-clock shape but names components that do not
 * exist on the calendar ("2026-02-30"). Validators use this to refuse the row up front:
 * V8's Date.parse is finite for such values (it rolls the day), so a bare
 * Number.isNaN(Date.parse(...)) check passes them, and paZonelessToUtcIso deliberately
 * passes them through unconverted -- which would surface only as a raw Postgres error at
 * apply, the preview/apply mismatch this codebase goes out of its way to rule out.
 */
export function paZonelessDateImpossible(value: string): boolean {
  const trimmed = value.trim();
  const shaped = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/.test(trimmed);
  if (!shaped) return false;
  return paZonelessToUtcIso(trimmed) === trimmed;
}

export function paZonelessToUtcIso(value: string): string {
  const trimmed = value.trim();
  // Fractional seconds are part of the zone-less shape too: the importer's validation
  // (bare Date.parse) accepts "YYYY-MM-DD HH:MM:SS.sss", and a shape this regex does not
  // claim falls through unconverted -- back to the UTC misread this function exists to fix.
  // Digits beyond milliseconds are truncated.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/.exec(trimmed);
  if (!match) return trimmed;
  const [, y, mo, d, h = "00", mi = "00", s = "00", frac = ""] = match;
  const ms = frac ? Number(`${frac}000`.slice(0, 3)) : 0;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  // Date.UTC normalizes impossible components instead of rejecting them ("2026-02-30"
  // becomes March 2 -- and V8's Date.parse is finite for it too, so upstream validation
  // does not catch it either). Round-trip the components: a mismatch means the wall-clock
  // value names a day that does not exist, and it passes through unchanged so Postgres
  // rejects it at apply exactly as it did before this helper existed.
  const roundTrip = new Date(asUtc);
  if (
    roundTrip.getUTCFullYear() !== Number(y) ||
    roundTrip.getUTCMonth() !== Number(mo) - 1 ||
    roundTrip.getUTCDate() !== Number(d) ||
    roundTrip.getUTCHours() !== Number(h) ||
    roundTrip.getUTCMinutes() !== Number(mi) ||
    roundTrip.getUTCSeconds() !== Number(s)
  ) {
    return trimmed;
  }
  // Derive the ET offset from the UTC-interpreted instant, then once more from the corrected
  // instant so a wall-clock time near a DST transition lands on the offset actually in effect.
  const firstGuess = new Date(asUtc - paOffsetMinutesAt(new Date(asUtc)) * 60_000);
  const offsetMinutes = paOffsetMinutesAt(firstGuess);
  return new Date(asUtc - offsetMinutes * 60_000).toISOString();
}
