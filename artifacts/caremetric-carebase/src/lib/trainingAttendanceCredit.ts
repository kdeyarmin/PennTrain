/**
 * What an in-person session's attendance actually credits, and where the recorded seat time
 * disagrees with it (BACKLOG.md J25).
 *
 * `approve_training_session_completion` used to write `hours = v_class.duration_hours` onto every
 * attended registration's employee_training_records row, ignoring the attendance evidence it had
 * just insisted on: `record_training_attendance` stores `seat_minutes` derived from
 * check_in_at/check_out_at, and approval never read it. A registration recorded with check-in ==
 * check-out -- zero seat minutes -- was credited the class's full scheduled hours, and those hours
 * rolled straight into the annual hour buckets a DHS surveyor reads.
 *
 * Migration 20260906220000 fixed that at the source. Approval now credits each attendee
 * `least(round(max(seat_minutes) / 60, 2), duration_hours)` -- their own recorded time, with the
 * class's scheduled length as the ceiling, never the floor -- and refuses the whole approval if any
 * attended registration carries evidence with no seat time at all.
 *
 * This module mirrors that rule so the "what will this credit" figure shown before approval is the
 * number the server will write. Mirroring it is the point: while these two disagreed, the roster
 * card promised every attendee the scheduled duration and approval quietly wrote less.
 *
 * The arithmetic lives here rather than in the roster card so the previewed figure and the
 * shortfall warning come from one place, and so both can be tested without rendering.
 */

/** Recorded attendance evidence, in the shape the roster card reads it from the database. */
export interface AttendanceEvidenceLike {
  registration_id: string;
  attendance_status: string;
  check_in_at: string | null;
  check_out_at: string | null;
}

export type AttendanceIssue =
  /** check_out_at is at or before check_in_at. Approval refuses the whole session over this. */
  | "zero_length"
  /** Seat time is recorded but materially below the scheduled duration, so the credit is short. */
  | "short"
  /** `attended`/`partial` with no usable check-in/check-out pair at all. */
  | "unrecorded";

/**
 * Minutes between two timestamps, or null when either is missing/unparseable.
 * Negative is preserved rather than clamped -- the caller needs to tell "0 minutes" from
 * "check-out before check-in", and only one of those is a data-entry inversion.
 */
export function seatMinutesBetween(
  checkInAt: string | null | undefined,
  checkOutAt: string | null | undefined,
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const start = Date.parse(checkInAt);
  const end = Date.parse(checkOutAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60_000);
}

/**
 * Fraction of the scheduled duration below which recorded seat time is called short.
 *
 * Not zero: a class that runs a couple of minutes over or under its scheduled window is normal,
 * and flagging that would train people to ignore the warning. 0.9 flags the ten-minute shortfall
 * on a 1-hour class, which is the point at which the credited hour stops being defensible.
 */
export const SHORT_SEAT_TIME_FRACTION = 0.9;

export interface AttendanceCredit {
  registrationId: string;
  /** Null when no usable check-in/check-out pair was recorded. */
  seatMinutes: number | null;
  /** What approval will actually write to employee_training_records for this attendee. */
  creditedHours: number;
  /** Null when the recorded seat time supports the credited hours. */
  issue: AttendanceIssue | null;
}

/**
 * What approval will credit this one registration, and whether the evidence backs it.
 *
 * Only `attended` is examined: `no_show` produces no training record at all, and `partial` moves
 * the registration to `makeup_required`, which approval's `registration_status = 'attended'` loop
 * skips. Both are therefore credited nothing and cannot be short.
 */
export function creditForAttendance(
  evidence: AttendanceEvidenceLike,
  scheduledHours: number,
): AttendanceCredit {
  const seatMinutes = seatMinutesBetween(evidence.check_in_at, evidence.check_out_at);
  if (evidence.attendance_status !== "attended") {
    return { registrationId: evidence.registration_id, seatMinutes, creditedHours: 0, issue: null };
  }
  const scheduledMinutes = scheduledHours * 60;
  let issue: AttendanceIssue | null = null;
  if (seatMinutes === null) issue = "unrecorded";
  else if (seatMinutes <= 0) issue = "zero_length";
  else if (scheduledMinutes > 0 && seatMinutes < scheduledMinutes * SHORT_SEAT_TIME_FRACTION) issue = "short";
  return {
    registrationId: evidence.registration_id,
    seatMinutes,
    // `least(round(max(seat_minutes) / 60, 2), duration_hours)`, in that order -- round first, then
    // cap -- because that is what approve_training_session_completion does (20260906220000). With
    // no usable seat time the server's own coalesce falls back to the scheduled figure, so this
    // does too; the evidence guard refuses that approval before the fallback can ever be written,
    // and showing anything else here would misdescribe a row that is about to be rejected anyway.
    creditedHours: seatMinutes !== null && seatMinutes > 0
      ? Math.min(Math.round((seatMinutes / 60) * 100) / 100, scheduledHours)
      : scheduledHours,
    issue,
  };
}

export interface SessionCreditSummary {
  /** Registrations approval will turn into training records. */
  attendedCount: number;
  /**
   * Hours approval writes to each attendee -- but only when they all get the same figure. Credit
   * comes from each attendee's own seat time now, so a session where one person left early has no
   * single per-attendee number, and this is null rather than a figure that is wrong for somebody.
   */
  hoursPerAttendee: number | null;
  /** The sum of every attendee's credit -- what this approval adds to annual hour buckets. */
  totalCreditedHours: number;
  /** The class's scheduled length: the ceiling on any one attendee's credit, never the floor. */
  scheduledHours: number;
  /** Attended registrations whose recorded seat time is missing, zero, or materially short. */
  flagged: AttendanceCredit[];
}

/**
 * The whole session's credit, given the evidence rows recorded so far.
 *
 * `evidenceByRegistration` is keyed by registration id because the evidence table has no class_id;
 * the caller resolves it from the registrations it already lists.
 */
export function summarizeSessionCredit(
  attendedRegistrationIds: readonly string[],
  evidenceByRegistration: ReadonlyMap<string, AttendanceEvidenceLike>,
  scheduledHours: number,
): SessionCreditSummary {
  const flagged: AttendanceCredit[] = [];
  const perAttendee: number[] = [];
  for (const registrationId of attendedRegistrationIds) {
    const evidence = evidenceByRegistration.get(registrationId)
      // No evidence row at all is still an attended registration approval will refuse; treat it as
      // unrecorded rather than dropping it, so the count and the warning agree.
      ?? { registration_id: registrationId, attendance_status: "attended", check_in_at: null, check_out_at: null };
    const credit = creditForAttendance(evidence, scheduledHours);
    perAttendee.push(credit.creditedHours);
    if (credit.issue) flagged.push(credit);
  }
  const attendedCount = attendedRegistrationIds.length;
  const first = perAttendee[0];
  const uniform = perAttendee.length > 0 && perAttendee.every((hours) => hours === first);
  return {
    attendedCount,
    hoursPerAttendee: uniform ? first : null,
    // Summed, not multiplied. Multiplying one figure by the head count was right only while every
    // attendee was credited the schedule; it now overstates any session somebody left early from.
    totalCreditedHours: Math.round(perAttendee.reduce((sum, hours) => sum + hours, 0) * 100) / 100,
    scheduledHours,
    flagged,
  };
}

/** "1 h 30 m" / "0 m" / "—" for a seat-minute figure. */
export function formatSeatMinutes(seatMinutes: number | null): string {
  if (seatMinutes === null) return "—";
  if (seatMinutes < 0) return `−${formatSeatMinutes(Math.abs(seatMinutes))}`;
  const hours = Math.floor(seatMinutes / 60);
  const minutes = seatMinutes % 60;
  if (hours === 0) return `${minutes} m`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} m`;
}
