/**
 * The written fire drill record 55 Pa. Code 2600.132(c) / 2800.132(c) require: date, time, the
 * amount of time it took for evacuation, the exit route used, the number of residents in the building,
 * the number evacuated, the number of staff participating, problems encountered, and whether the fire
 * alarm or smoke detector was operative.
 *
 * `inspection_events` leaves every one of these columns nullable (they are shared with non-drill
 * inspections), so this check is the only thing standing between a surveyor and an incomplete record.
 */
export interface FireDrillRecordDraft {
  drillTime: string;
  durationMinutes: string;
  durationSeconds: string;
  exitRouteUsed: string;
  residentsPresent: string;
  residentsEvacuated: string;
  staffParticipating: string;
  problemsEncountered: string;
}

export type FireDrillRecordErrors = Partial<Record<
  "drillTime" | "evacuationDuration" | "exitRouteUsed" | "residentsPresent"
  | "residentsEvacuated" | "staffParticipating" | "problemsEncountered",
  string
>>;

const WHOLE_NUMBER = /^\d+$/;

/** Total evacuation time in seconds, or null when neither part is filled in or either is malformed. */
export function evacuationSeconds(minutes: string, seconds: string): number | null {
  const m = minutes.trim();
  const s = seconds.trim();
  if (!m && !s) return null;
  if ((m && !WHOLE_NUMBER.test(m)) || (s && !WHOLE_NUMBER.test(s))) return null;
  const secondsPart = Number(s || 0);
  if (secondsPart > 59) return null;
  return Number(m || 0) * 60 + secondsPart;
}

export function fireDrillRecordErrors(draft: FireDrillRecordDraft, allowIncompleteEvacuation = false): FireDrillRecordErrors {
  const blank = (value: string) => !value.trim();
  const errors: FireDrillRecordErrors = {};
  if (!draft.drillTime) errors.drillTime = "Required";

  const minutes = draft.durationMinutes.trim();
  const seconds = draft.durationSeconds.trim();
  if (!minutes && !seconds && !allowIncompleteEvacuation) {
    errors.evacuationDuration = "Required";
  } else if (minutes || seconds) {
    const total = evacuationSeconds(minutes, seconds);
    if (total === null) errors.evacuationDuration = "Enter whole minutes and seconds (0–59)";
    else if (total === 0) errors.evacuationDuration = "Enter how long the evacuation took";
  }

  if (blank(draft.exitRouteUsed)) errors.exitRouteUsed = "Required";
  if (blank(draft.residentsPresent)) errors.residentsPresent = "Required";
  if (blank(draft.residentsEvacuated)) errors.residentsEvacuated = "Required";
  if (blank(draft.staffParticipating)) errors.staffParticipating = "Required";
  for (const key of ["residentsPresent", "residentsEvacuated", "staffParticipating"] as const) {
    if (!blank(draft[key]) && !WHOLE_NUMBER.test(draft[key].trim())) errors[key] = "Enter a nonnegative whole number";
  }
  if (!errors.residentsPresent && !errors.residentsEvacuated && Number(draft.residentsEvacuated) > Number(draft.residentsPresent)) {
    errors.residentsEvacuated = "Cannot exceed residents present";
  }
  if (blank(draft.problemsEncountered)) errors.problemsEncountered = "Required";
  return errors;
}
