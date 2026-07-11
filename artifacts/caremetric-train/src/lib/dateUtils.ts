const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Return a Date as the user's local calendar day, without converting through UTC. */
export function toLocalIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
