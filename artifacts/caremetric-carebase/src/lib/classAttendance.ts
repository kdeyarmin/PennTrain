export interface AttendanceReconciliationAttendee {
  attended: boolean | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  training_record_id: string | null;
}

export interface AttendanceReconciliationSummary {
  rosterCount: number;
  markedPresent: number;
  markedAbsent: number;
  checkedIn: number;
  checkedOut: number;
  checkedInNotMarkedPresent: number;
  presentWithoutCheckin: number;
  checkedInWithoutCheckout: number;
  recordsPending: number;
}

export function summarizeClassAttendance(attendees: AttendanceReconciliationAttendee[]): AttendanceReconciliationSummary {
  return attendees.reduce<AttendanceReconciliationSummary>(
    (summary, attendee) => {
      const attended = attendee.attended === true;
      const checkedIn = !!attendee.checked_in_at;
      const checkedOut = !!attendee.checked_out_at;

      summary.rosterCount += 1;
      if (attended) summary.markedPresent += 1;
      else summary.markedAbsent += 1;
      if (checkedIn) summary.checkedIn += 1;
      if (checkedOut) summary.checkedOut += 1;
      if (checkedIn && !attended) summary.checkedInNotMarkedPresent += 1;
      if (attended && !checkedIn) summary.presentWithoutCheckin += 1;
      if (checkedIn && !checkedOut) summary.checkedInWithoutCheckout += 1;
      if (attended && !attendee.training_record_id) summary.recordsPending += 1;
      return summary;
    },
    {
      rosterCount: 0,
      markedPresent: 0,
      markedAbsent: 0,
      checkedIn: 0,
      checkedOut: 0,
      checkedInNotMarkedPresent: 0,
      presentWithoutCheckin: 0,
      checkedInWithoutCheckout: 0,
      recordsPending: 0,
    },
  );
}
