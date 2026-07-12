import { describe, expect, it } from "vitest";
import { summarizeResidentComplianceAnalytics } from "./residentComplianceAnalytics";

describe("summarizeResidentComplianceAnalytics", () => {
  it("summarizes resident compliance pressure", () => {
    const summary = summarizeResidentComplianceAnalytics([
      { id: "r1", status: "active", admission_date: "2026-07-01", facility_id: "f1" },
      { id: "r2", status: "active", admission_date: "2026-07-09", facility_id: "f1" },
      { id: "r3", status: "discharged", admission_date: "2026-06-01", facility_id: "f1" },
    ], [
      { resident_id: "r1", status: "expired", due_date: "2026-07-01" },
      { resident_id: "r1", status: "missing", due_date: null },
      { resident_id: "r2", status: "due_soon", due_date: "2026-07-20" },
      { resident_id: "outside", status: "expired", due_date: "2026-07-01" },
    ], "2026-07-10");

    expect(summary).toMatchObject({ residents: 3, activeResidents: 2, residentsWithOpenItems: 2, expiredItems: 1, missingItems: 1, dueSoonItems: 1, dueWithin14Days: 1 });
    expect(summary.newestAdmissionResidentId).toBe("r2");
  });
});
