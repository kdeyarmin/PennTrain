import { describe, expect, it } from "vitest";
import { buildTrainingClassesIcs } from "./calendarExport";

describe("buildTrainingClassesIcs", () => {
  it("exports filtered training classes as all-day calendar events", () => {
    const ics = buildTrainingClassesIcs([
      {
        id: "class-1",
        className: "Med Admin, Annual; Refresher",
        classDate: "2026-07-10",
        durationHours: 2,
        trainingTypeName: "Medication Administration",
        facilityName: "Main Campus",
        status: "draft",
      },
    ], new Date("2026-07-01T12:00:00Z"));

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:training-class-class-1@caremetric-carebase");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260710");
    expect(ics).toContain("DTEND;VALUE=DATE:20260711");
    expect(ics).toContain("SUMMARY:Med Admin\\, Annual\\; Refresher");
    expect(ics).toContain("LOCATION:Main Campus");
  });
});
