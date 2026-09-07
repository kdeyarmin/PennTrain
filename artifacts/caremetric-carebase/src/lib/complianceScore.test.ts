import { describe, expect, it } from "vitest";
import {
  complianceBand,
  complianceBandTextClass,
  compliancePercentage,
  summarizeCurrentTrainingCompliance,
  TRACKED_COMPLIANCE_STATUSES,
} from "./complianceScore";

/**
 * A facility that renewed everything on time. Each employee has last cycle's record, still graded
 * 'expired' because the nightly recalculation keeps grading every historical row by its own
 * completion date, and this cycle's compliant renewal beside it.
 */
const RENEWED_EVERYTHING = [
  { employee_id: "e1", training_type_id: "t1", due_date: "2025-07-01", completion_date: "2024-07-01", status: "expired" },
  { employee_id: "e1", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
  { employee_id: "e1", training_type_id: "t2", due_date: "2025-03-01", completion_date: "2024-03-01", status: "expired" },
  { employee_id: "e1", training_type_id: "t2", due_date: "2026-03-01", completion_date: "2025-03-01", status: "compliant" },
  { employee_id: "e2", training_type_id: "t1", due_date: "2025-07-01", completion_date: "2024-07-01", status: "expired" },
  { employee_id: "e2", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
];

/**
 * The same two employees and the same three obligations, equally compliant today, but at a newer
 * facility that has not been open long enough for anyone to renew anything. No history, so nothing
 * superseded.
 */
const NEVER_HAD_TO_RENEW = [
  { employee_id: "e1", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
  { employee_id: "e1", training_type_id: "t2", due_date: "2026-03-01", completion_date: "2025-03-01", status: "compliant" },
  { employee_id: "e2", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
];

function rawRowScore(records: Array<{ status: string }>): number {
  const tracked = records.filter((record) =>
    (TRACKED_COMPLIANCE_STATUSES as readonly string[]).includes(record.status)
  );
  const compliant = tracked.filter((record) => record.status === "compliant").length;
  return tracked.length > 0 ? Math.round((compliant / tracked.length) * 100) : 100;
}

describe("summarizeCurrentTrainingCompliance", () => {
  it("scores a fully renewed facility at 100, which counting raw rows does not", () => {
    // The defect, stated as a number: every requirement has a current compliant record, so the
    // facility is fully compliant -- but the superseded rows drag it to 50%.
    expect(rawRowScore(RENEWED_EVERYTHING)).toBe(50);
    expect(summarizeCurrentTrainingCompliance(RENEWED_EVERYTHING).compliancePercentage).toBe(100);
  });

  it("scores two equally compliant facilities the same, whatever their renewal history", () => {
    // The consequence that makes it worse than a rounding error: counting raw rows PENALISES the
    // facility that has been renewing on schedule for years against one that has never had to,
    // even though every obligation at both is currently met.
    expect(rawRowScore(NEVER_HAD_TO_RENEW)).toBe(100);
    expect(rawRowScore(RENEWED_EVERYTHING)).toBeLessThan(rawRowScore(NEVER_HAD_TO_RENEW));
    expect(summarizeCurrentTrainingCompliance(RENEWED_EVERYTHING).compliancePercentage)
      .toBe(summarizeCurrentTrainingCompliance(NEVER_HAD_TO_RENEW).compliancePercentage);
  });

  it("counts one current obligation per employee and training type", () => {
    const counts = summarizeCurrentTrainingCompliance(RENEWED_EVERYTHING);
    expect(counts.total).toBe(3);
    expect(counts.compliant).toBe(3);
    expect(counts.expired).toBe(0);
  });

  it("keeps a genuinely outstanding requirement outstanding", () => {
    const counts = summarizeCurrentTrainingCompliance([
      ...RENEWED_EVERYTHING,
      { employee_id: "e3", training_type_id: "t1", due_date: "2025-01-01", completion_date: "2024-01-01", status: "expired" },
      { employee_id: "e3", training_type_id: "t2", due_date: "2026-12-01", completion_date: null, status: "due_soon" },
      { employee_id: "e4", training_type_id: "t1", due_date: null, completion_date: null, status: "missing" },
    ]);
    expect(counts.total).toBe(6);
    expect(counts.expired).toBe(1);
    expect(counts.dueSoon).toBe(1);
    expect(counts.missing).toBe(1);
    expect(counts.compliancePercentage).toBe(50);
  });

  it("leaves not_applicable and pending_review out of the denominator", () => {
    const counts = summarizeCurrentTrainingCompliance([
      { employee_id: "e1", training_type_id: "t1", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
      { employee_id: "e1", training_type_id: "t3", due_date: null, completion_date: null, status: "not_applicable" },
      { employee_id: "e1", training_type_id: "t4", due_date: null, completion_date: null, status: "pending_review" },
    ]);
    expect(counts.total).toBe(1);
    expect(counts.compliancePercentage).toBe(100);
  });

  it("answers 100 for an empty tracked set, as both RPCs do", () => {
    expect(summarizeCurrentTrainingCompliance([]).compliancePercentage).toBe(100);
    expect(compliancePercentage(0, 0)).toBe(100);
  });
});

describe("complianceBand", () => {
  it("puts the boundaries where the dashboard's inline ladders had them", () => {
    expect(complianceBand(100).label).toBe("Excellent");
    expect(complianceBand(90).label).toBe("Excellent");
    expect(complianceBand(89).label).toBe("Needs Improvement");
    expect(complianceBand(75).label).toBe("Needs Improvement");
    expect(complianceBand(74).label).toBe("At Risk");
    expect(complianceBand(0).label).toBe("At Risk");
  });

  it("has an unknown band so a missing score is never drawn as zero", () => {
    expect(complianceBand(null)).toEqual({ tone: "unknown", label: "—" });
    expect(complianceBandTextClass(null)).toBe("text-muted-foreground");
    expect(complianceBandTextClass(95)).toBe("text-emerald-600");
  });
});
