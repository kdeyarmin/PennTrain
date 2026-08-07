import { facilityDateTimeLocalToUtcIso } from "./dateUtils";

export interface TimeOffRequestValidationResult {
  startsAtIso: string;
  endsAtIso: string;
}

/** Parse a datetime-local value as Pennsylvania facility wall clock (not the browser zone). */
function facilityLocalInstant(value: string): Date | null {
  try {
    const instant = new Date(facilityDateTimeLocalToUtcIso(value));
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    return null;
  }
}

export function getTimeOffRequestWindowError(startsAt: string, endsAt: string): string | null {
  if (!startsAt || !endsAt) return null;

  const start = facilityLocalInstant(startsAt);
  const end = facilityLocalInstant(endsAt);

  if (!start || !end) {
    return "Enter a valid start and end date/time for the time-off request.";
  }

  if (end <= start) {
    return "The time-off end must be after the start.";
  }

  return null;
}

export function normalizeTimeOffRequestWindow(startsAt: string, endsAt: string): TimeOffRequestValidationResult {
  if (!startsAt || !endsAt) {
    throw new Error("Enter both a start and end date/time for the time-off request.");
  }

  const error = getTimeOffRequestWindowError(startsAt, endsAt);
  if (error) throw new Error(error);

  return {
    startsAtIso: facilityDateTimeLocalToUtcIso(startsAt),
    endsAtIso: facilityDateTimeLocalToUtcIso(endsAt),
  };
}
