import { addFacilityCalendarDays, facilityDateOf, facilityToday } from "./dateUtils";

export interface ComplaintDeadlineInput {
  date_received: string;
  method_received: string;
  acknowledgement_date: string | null;
  written_response_date: string | null;
}

/** 2600.44(e)-(f) / 2800.44(e)-(f): clocks start with the written submission. */
export function complaintDeadlines(complaint: ComplaintDeadlineInput, today = facilityToday()) {
  if (!["email", "letter", "portal"].includes(complaint.method_received)) return null;
  const submitted = facilityDateOf(complaint.date_received);
  if (!submitted) return null;
  let statusDue = submitted;
  let remaining = 2;
  while (remaining > 0) {
    statusDue = addFacilityCalendarDays(statusDue, 1);
    const [year, month, day] = statusDue.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  const decisionDue = addFacilityCalendarDays(submitted, 7);
  return {
    statusDue,
    decisionDue,
    statusOverdue: !complaint.acknowledgement_date && today > statusDue,
    decisionOverdue: !complaint.written_response_date && today > decisionDue,
    statusLate: Boolean(complaint.acknowledgement_date && facilityDateOf(complaint.acknowledgement_date)! > statusDue),
    decisionLate: Boolean(complaint.written_response_date && facilityDateOf(complaint.written_response_date)! > decisionDue),
  };
}
