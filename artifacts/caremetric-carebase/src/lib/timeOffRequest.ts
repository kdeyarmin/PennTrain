export interface TimeOffRequestValidationResult {
  startsAtIso: string;
  endsAtIso: string;
}

export function getTimeOffRequestWindowError(startsAt: string, endsAt: string): string | null {
  if (!startsAt || !endsAt) return null;

  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Enter a valid start and end date/time for the time-off request.";
  }

  if (end <= start) {
    return "The time-off end must be after the start.";
  }

  return null;
}

export function normalizeTimeOffRequestWindow(startsAt: string, endsAt: string): TimeOffRequestValidationResult {
  const error = getTimeOffRequestWindowError(startsAt, endsAt);
  if (error) throw new Error(error);

  return {
    startsAtIso: new Date(startsAt).toISOString(),
    endsAtIso: new Date(endsAt).toISOString(),
  };
}
