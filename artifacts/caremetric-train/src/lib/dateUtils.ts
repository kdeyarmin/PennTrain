const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Return a Date as the user's local calendar day, without converting through UTC. */
export function toLocalIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-calendar-day difference from `today` to the given Postgres date/timestamp, in the
 * user's local time zone (0 = today, positive = future, negative = past, null = no/bad date).
 * Bare dates are read as local calendar days so "due today" flips at local midnight.
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
