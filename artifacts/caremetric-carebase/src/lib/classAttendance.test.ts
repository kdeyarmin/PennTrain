import { describe, expect, it } from "vitest";
import { summarizeClassAttendance } from "./classAttendance";

describe("summarizeClassAttendance", () => {
  it("reconciles roster, check-in, attendance, checkout, and record status", () => {
    expect(summarizeClassAttendance([
      { attended: true, checked_in_at: "2026-07-10T10:00:00Z", checked_out_at: "2026-07-10T11:00:00Z", training_record_id: "record-1" },
      { attended: false, checked_in_at: "2026-07-10T10:02:00Z", checked_out_at: null, training_record_id: null },
      { attended: true, checked_in_at: null, checked_out_at: null, training_record_id: null },
    ])).toEqual({
      rosterCount: 3,
      markedPresent: 2,
      markedAbsent: 1,
      checkedIn: 2,
      checkedOut: 1,
      checkedInNotMarkedPresent: 1,
      presentWithoutCheckin: 1,
      checkedInWithoutCheckout: 1,
      recordsPending: 1,
    });
  });
});
