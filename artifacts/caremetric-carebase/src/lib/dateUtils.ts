const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Return a Date as the user's local calendar day, without converting through UTC. */
export function toLocalIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const FACILITY_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
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
 * 20260727010000 the server no longer tolerates the disagreement. `record_support_plan_-
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

/** Convert a Date or ISO timestamp to a local `YYYY-MM-DDTHH:mm` string for datetime-local inputs. */
export function toDateTimeLocal(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
 * Short urgency phrase meant to follow an absolute due date, e.g. "Due Jul 15, 2026 · in 3
 * days" / "· today" / "· 2 days overdue". Returns null when there is no usable date.
 */
export function formatDueDistance(value: string | null | undefined, today = new Date()): string | null {
  const days = daysUntil(value, today);
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
