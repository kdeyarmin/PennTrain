const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Return a Date as the user's local calendar day, without converting through UTC. */
export function toLocalIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const FACILITY_TIME_ZONE = "America/New_York";

const FACILITY_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: FACILITY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The FACILITY's calendar day as `YYYY-MM-DD` -- the browser-side twin of `public.pa_today()`.
 *
 * Use this, not `toLocalIsoDate()`, for any date that is sent to the server, compared against a
 * Postgres `date` column, or shown as "today" in a compliance context. `toLocalIsoDate()` answers in
 * whatever timezone the browser is set to, which is the right answer for rendering a Date the user
 * gave you and the wrong one for "what day is it at the facility".
 *
 * They agree for a user sitting in Pennsylvania, which is why the difference went unnoticed. They
 * stop agreeing the moment the browser is anywhere else -- a regional administrator on the road, a
 * corporate office in another state, a laptop whose clock is simply set wrong -- and after
 * 20260727010100 the server no longer tolerates the disagreement. `record_support_plan_-
 * participation` rejects a participation date later than the Pennsylvania day, and the resident
 * lifecycle journey caught this immediately: running in a UTC container, the browser offered
 * tomorrow's date as the default, the server refused it, and the plan could not leave the
 * participation stage. `save_resident_assessment_review`, `create_qapi_project` and
 * `preview_employee_lifecycle_transition` guard their date arguments the same way.
 *
 * Pennsylvania is hardcoded for the same reason it is hardcoded in SQL: nothing in the schema models
 * a per-facility timezone, and inventing one here would be a guess dressed up as a feature. If that
 * changes, this function and `public.pa_today()` are the two places that grow a facility argument.
 */
export function facilityToday(now = new Date()): string {
  return FACILITY_DAY_FORMAT.format(now);
}

/**
 * Add (or subtract) whole calendar days to a facility `YYYY-MM-DD` without touching wall-clock
 * timezone. Use for defaults like "due in 15 days" / "metrics from 30 days ago" that must agree
 * with `pa_today()` arithmetic rather than `Date.now() + N * 864e5` in the browser zone.
 */
export function addFacilityCalendarDays(isoDate: string, days: number): string {
  const match = DATE_ONLY_PATTERN.exec(isoDate);
  if (!match) throw new Error(`expected YYYY-MM-DD, got ${isoDate}`);
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Offset of `timeZone` relative to UTC at the given instant, in milliseconds
 * (positive when the zone is ahead of UTC). Used only to invert wall-clock
 * facility times into UTC instants for timestamptz range filters.
 */
function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/**
 * Convert a facility calendar date + wall-clock time (America/New_York) into a UTC Date.
 * Iterates twice so DST transitions land on the correct offset.
 */
export function facilityDateTimeToUtc(isoDate: string, timeHms = "00:00:00"): Date {
  const match = DATE_ONLY_PATTERN.exec(isoDate);
  if (!match) throw new Error(`expected YYYY-MM-DD, got ${isoDate}`);
  const [hour, minute, second] = timeHms.split(":").map(Number);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  for (let i = 0; i < 2; i++) {
    const offset = timeZoneOffsetMs(FACILITY_TIME_ZONE, new Date(utcMs));
    utcMs = Date.UTC(year, month - 1, day, hour, minute, second || 0) - offset;
  }
  return new Date(utcMs);
}

/**
 * Interpret a `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`) as Pennsylvania
 * facility wall clock and return a UTC ISO string. `new Date(value).toISOString()` would use
 * the browser's zone instead.
 */
export function facilityDateTimeLocalToUtcIso(value: string): string {
  const [datePart, rawTime = "00:00"] = value.split("T");
  if (!DATE_ONLY_PATTERN.test(datePart)) {
    throw new Error(`expected YYYY-MM-DDTHH:mm, got ${value}`);
  }
  const timeHms = rawTime.length === 5 ? `${rawTime}:00` : rawTime;
  return facilityDateTimeToUtc(datePart, timeHms).toISOString();
}

/**
 * Half-open `[from, through)` UTC instants covering one Pennsylvania calendar day.
 * Use for timestamptz range filters so "today" means the facility day, not the browser day.
 */
export function facilityDayBounds(isoDate: string): { from: string; through: string } {
  const match = DATE_ONLY_PATTERN.exec(isoDate);
  if (!match) throw new Error(`expected YYYY-MM-DD, got ${isoDate}`);
  const from = facilityDateTimeToUtc(isoDate, "00:00:00");
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  const nextIso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const through = facilityDateTimeToUtc(nextIso, "00:00:00");
  return { from: from.toISOString(), through: through.toISOString() };
}

/**
 * Inclusive facility-day range as half-open UTC bounds: from 00:00 on `fromDate`
 * through 00:00 on the day after `throughDate` (so the full through day is included).
 */
export function facilityDateRangeBounds(fromDate: string, throughDate: string): { from: string; through: string } {
  const start = facilityDayBounds(fromDate);
  const end = facilityDayBounds(throughDate);
  return { from: start.from, through: end.through };
}

/** Convert a Date or ISO timestamp to a local `YYYY-MM-DDTHH:mm` string for datetime-local inputs. */
export function toDateTimeLocal(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Convert a Date or ISO timestamp to a Pennsylvania facility-wall-clock `YYYY-MM-DDTHH:mm`
 * string for `<input type="datetime-local">`. Pair with `facilityDateTimeLocalToUtcIso` on
 * submit — `toDateTimeLocal` answers in the browser zone, which is the wrong default when the
 * field is later interpreted as America/New_York.
 */
export function toFacilityDateTimeLocal(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`invalid datetime: ${String(value)}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Pennsylvania calendar year — the twin of `facilityToday().slice(0, 4)`. */
export function facilityYear(now = new Date()): number {
  return Number(facilityToday(now).slice(0, 4));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-calendar-day difference from `today` to the given Postgres date/timestamp, in the
 * user's local time zone (0 = today, positive = future, negative = past, null = no/bad date).
 * Bare dates are read as local calendar days so "due today" flips at local midnight.
 *
 * Deliberately still LOCAL, not `facilityToday()`. This is the boundary between the two:
 * facilityToday() is for a day that is submitted to the server, compared against a `date` column to
 * decide something, or otherwise has to agree with `public.pa_today()`. daysUntil is for the phrase
 * rendered beside it ("in 3 days", "1 day overdue"), where the user's own midnight is the more
 * natural reading and no server decision hangs on the answer.
 *
 * Moving this one to the facility calendar would be defensible, but it is a change to a documented
 * display contract rather than a bug fix: its own tests encode the local-midnight reading (a
 * timestamp at 23:00 and a `today` at 01:00 the same local day are zero days apart, which stops
 * being true once both are re-read in Eastern). Worth doing on purpose, with the label copy
 * re-checked; not worth smuggling in.
 */
export function daysUntil(value: string | null | undefined, today = new Date()): number | null {
  if (!value) return null;

  const match = DATE_ONLY_PATTERN.exec(value);
  const target = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  if (Number.isNaN(target.getTime())) return null;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(target) - startOfDay(today)) / MS_PER_DAY);
}

/**
 * Whole facility-calendar-day difference from Pennsylvania "today" to a bare Postgres `date`.
 * Prefer this over `daysUntil` when the countdown is a compliance/regulatory window
 * (provisional hire periods, corrective-action due dates) that must agree with `pa_today()`.
 */
export function facilityDaysUntil(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const today = facilityToday(now);
  const todayMatch = DATE_ONLY_PATTERN.exec(today);
  if (!todayMatch) return null;
  const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const todayUtc = Date.UTC(Number(todayMatch[1]), Number(todayMatch[2]) - 1, Number(todayMatch[3]));
  return Math.round((targetUtc - todayUtc) / MS_PER_DAY);
}

/**
 * Short urgency phrase meant to follow an absolute due date, e.g. "Due Jul 15, 2026 · in 3
 * days" / "· today" / "· 2 days overdue". Returns null when there is no usable date.
 *
 * Uses the Pennsylvania facility calendar (`facilityDaysUntil`) so the phrase agrees with
 * `pa_today()` and the numeric due-tone styling beside it. Bare Postgres `date` values only —
 * timestamps fall through to null (callers should pass the calendar date column).
 */
export function formatDueDistance(value: string | null | undefined, now = new Date()): string | null {
  const days = facilityDaysUntil(value, now);
  if (days === null) return null;
  if (days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Format a Postgres date or timestamp without shifting bare calendar dates across time zones. */
export function formatDateForDisplay(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  if (!value) return "—";

  const match = DATE_ONLY_PATTERN.exec(value);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, match ? { ...options, timeZone: "UTC" } : options);
}
