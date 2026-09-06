import { describe, expect, it } from "vitest";
import {
  creditForAttendance,
  formatSeatMinutes,
  seatMinutesBetween,
  summarizeSessionCredit,
  type AttendanceEvidenceLike,
} from "./trainingAttendanceCredit";

function evidence(overrides: Partial<AttendanceEvidenceLike> = {}): AttendanceEvidenceLike {
  return {
    registration_id: "r1",
    attendance_status: "attended",
    check_in_at: "2026-09-01T13:00:00.000Z",
    check_out_at: "2026-09-01T15:00:00.000Z",
    ...overrides,
  };
}

describe("seatMinutesBetween", () => {
  it("returns whole minutes between the two stamps", () => {
    expect(seatMinutesBetween("2026-09-01T13:00:00Z", "2026-09-01T15:30:00Z")).toBe(150);
  });

  it("returns null when either stamp is missing or unparseable", () => {
    expect(seatMinutesBetween(null, "2026-09-01T15:00:00Z")).toBeNull();
    expect(seatMinutesBetween("2026-09-01T13:00:00Z", null)).toBeNull();
    expect(seatMinutesBetween("not a date", "2026-09-01T15:00:00Z")).toBeNull();
  });

  it("preserves a negative span rather than clamping it", () => {
    // A clamp would make an inverted entry indistinguishable from a genuine zero-length one, and
    // only the inverted one is a typo the recorder can fix.
    expect(seatMinutesBetween("2026-09-01T15:00:00Z", "2026-09-01T13:00:00Z")).toBe(-120);
  });
});

describe("creditForAttendance", () => {
  it("credits the class's full scheduled hours, not the seat time", () => {
    // This is the defect being previewed, not a proposal: approve_training_session_completion
    // writes duration_hours regardless of what the evidence says.
    const credit = creditForAttendance(evidence({ check_out_at: "2026-09-01T13:30:00.000Z" }), 2);
    expect(credit.creditedHours).toBe(2);
    expect(credit.seatMinutes).toBe(30);
  });

  it("flags check-in == check-out as zero length", () => {
    const credit = creditForAttendance(
      evidence({ check_out_at: "2026-09-01T13:00:00.000Z" }),
      2,
    );
    expect(credit.seatMinutes).toBe(0);
    expect(credit.issue).toBe("zero_length");
  });

  it("flags an inverted pair as zero length too", () => {
    const credit = creditForAttendance(
      evidence({ check_in_at: "2026-09-01T15:00:00.000Z", check_out_at: "2026-09-01T13:00:00.000Z" }),
      2,
    );
    expect(credit.issue).toBe("zero_length");
  });

  it("flags seat time below 90% of the scheduled duration", () => {
    // 100 of 120 scheduled minutes is 83%.
    const credit = creditForAttendance(evidence({ check_out_at: "2026-09-01T14:40:00.000Z" }), 2);
    expect(credit.issue).toBe("short");
  });

  it("does not flag a session that ran slightly under its scheduled window", () => {
    // 115 of 120 minutes: a class that wraps five minutes early is not a credit problem.
    const credit = creditForAttendance(evidence({ check_out_at: "2026-09-01T14:55:00.000Z" }), 2);
    expect(credit.issue).toBeNull();
  });

  it("flags an attended registration with no recorded times", () => {
    const credit = creditForAttendance(
      evidence({ check_in_at: null, check_out_at: null }),
      2,
    );
    expect(credit.issue).toBe("unrecorded");
    expect(credit.seatMinutes).toBeNull();
  });

  it("credits nothing, and flags nothing, for no_show and partial", () => {
    // Approval's loop only walks registration_status = 'attended'; record_training_attendance puts
    // `partial` into makeup_required and `no_show` into no_show, so neither reaches a record.
    for (const status of ["no_show", "partial"]) {
      const credit = creditForAttendance(
        evidence({ attendance_status: status, check_out_at: "2026-09-01T13:00:00.000Z" }),
        2,
      );
      expect(credit.creditedHours).toBe(0);
      expect(credit.issue).toBeNull();
    }
  });
});

describe("summarizeSessionCredit", () => {
  it("totals what approval will write and lists only the unsupported rows", () => {
    const rows = new Map<string, AttendanceEvidenceLike>([
      ["r1", evidence({ registration_id: "r1" })],
      ["r2", evidence({ registration_id: "r2", check_out_at: "2026-09-01T13:00:00.000Z" })],
    ]);
    const summary = summarizeSessionCredit(["r1", "r2"], rows, 2);
    expect(summary.attendedCount).toBe(2);
    expect(summary.hoursPerAttendee).toBe(2);
    expect(summary.totalCreditedHours).toBe(4);
    expect(summary.flagged.map((f) => f.registrationId)).toEqual(["r2"]);
  });

  it("treats an attended registration with no evidence row as unrecorded", () => {
    const summary = summarizeSessionCredit(["r9"], new Map(), 1.5);
    expect(summary.flagged).toHaveLength(1);
    expect(summary.flagged[0].issue).toBe("unrecorded");
    expect(summary.totalCreditedHours).toBe(1.5);
  });

  it("rounds a fractional total instead of carrying float noise into the display", () => {
    const rows = new Map<string, AttendanceEvidenceLike>([
      ["r1", evidence({ registration_id: "r1", check_out_at: "2026-09-01T13:15:00.000Z" })],
      ["r2", evidence({ registration_id: "r2", check_out_at: "2026-09-01T13:15:00.000Z" })],
      ["r3", evidence({ registration_id: "r3", check_out_at: "2026-09-01T13:15:00.000Z" })],
    ]);
    expect(summarizeSessionCredit(["r1", "r2", "r3"], rows, 0.25).totalCreditedHours).toBe(0.75);
  });
});

describe("formatSeatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatSeatMinutes(90)).toBe("1 h 30 m");
    expect(formatSeatMinutes(120)).toBe("2 h");
    expect(formatSeatMinutes(45)).toBe("45 m");
    expect(formatSeatMinutes(0)).toBe("0 m");
    expect(formatSeatMinutes(null)).toBe("—");
  });

  it("marks an inverted span rather than showing it as positive time", () => {
    expect(formatSeatMinutes(-30)).toBe("−30 m");
  });
});
