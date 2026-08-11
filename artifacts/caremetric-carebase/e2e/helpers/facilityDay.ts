/**
 * The facility-local calendar date (Pennsylvania facilities, America/New_York).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is already *tomorrow*
 * between 8 PM and midnight Eastern (7 PM–midnight in winter). Seeds that stamp a
 * date-only column or a day-window generator with the UTC date create rows the app's
 * facility-day views correctly exclude, so the suite passes all day and fails only in
 * evening CI runs. en-CA formats as YYYY-MM-DD.
 */
export function facilityToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
