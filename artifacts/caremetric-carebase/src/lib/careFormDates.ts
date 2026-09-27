import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "./dateUtils";

/** Native date fields can be empty, and Date otherwise normalizes impossible dates. */
export function isCareCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString() === `${value}T00:00:00.000Z`;
}

/** Refuse malformed/rolled-over dates and nonexistent facility times at the DST jump. */
export function careDateTimeInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isCareCalendarDate(value.slice(0, 10))) return null;
  try {
    const instant = facilityDateTimeLocalToUtcIso(value);
    return toFacilityDateTimeLocal(instant) === value ? instant : null;
  } catch {
    return null;
  }
}
