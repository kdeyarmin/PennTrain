import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  chapterLabel,
  computeComplianceScore,
  effectiveStatus,
  isDueSoon,
  isMissingEvidence,
  isOverdue,
  recurrenceLabel,
  statusBadgeClassName,
  statusLabel,
  summarizeInstances,
  type InstanceLike,
} from "./complianceCommandCenter";

const TODAY = new Date(2026, 6, 24); // 2026-07-24 (local)

function inst(partial: Partial<InstanceLike> & { status: string; due_date: string }): InstanceLike {
  return { evidence_count: 0, requires_evidence: false, warning_days: 14, ...partial };
}

describe("labels", () => {
  it("maps categories, statuses, and chapters to human labels", () => {
    expect(categoryLabel("fire_emergency_preparedness")).toBe("Fire & emergency preparedness");
    expect(categoryLabel("unknown_cat")).toBe("unknown_cat");
    expect(categoryLabel(null)).toBe("—");
    expect(statusLabel("awaiting_review")).toBe("Awaiting review");
    expect(statusLabel("exception_approved")).toBe("Exception approved");
    expect(chapterLabel("2800")).toContain("2800");
    expect(chapterLabel(null)).toBe("—");
  });

  it("formats recurrence including custom intervals", () => {
    expect(recurrenceLabel("annual")).toBe("Annual");
    expect(recurrenceLabel("quarterly")).toBe("Quarterly");
    expect(recurrenceLabel("custom", 45)).toBe("Every 45 days");
    expect(recurrenceLabel("custom", null)).toBe("Custom interval");
  });

  it("uses semantic tokens for badges", () => {
    expect(statusBadgeClassName("complete")).toContain("bg-success");
    expect(statusBadgeClassName("overdue")).toContain("bg-destructive");
    expect(statusBadgeClassName("in_progress")).toContain("bg-warning");
    expect(statusBadgeClassName("not_started")).toContain("bg-muted");
  });
});

describe("effectiveStatus", () => {
  it("derives overdue from a past due date without waiting for the nightly job", () => {
    expect(effectiveStatus(inst({ status: "not_started", due_date: "2026-07-01" }), TODAY)).toBe("overdue");
    expect(effectiveStatus(inst({ status: "in_progress", due_date: "2026-07-01" }), TODAY)).toBe("overdue");
  });

  it("does not override terminal statuses, but a past-due review reads as overdue", () => {
    expect(effectiveStatus(inst({ status: "complete", due_date: "2026-07-01" }), TODAY)).toBe("complete");
    expect(effectiveStatus(inst({ status: "not_applicable", due_date: "2026-07-01" }), TODAY)).toBe("not_applicable");
    // Awaiting review before its due date stays awaiting_review...
    expect(effectiveStatus(inst({ status: "awaiting_review", due_date: "2026-08-10" }), TODAY)).toBe("awaiting_review");
    // ...but once past due it is overdue (the approval is late and must stay actionable, not "good").
    expect(effectiveStatus(inst({ status: "awaiting_review", due_date: "2026-07-01" }), TODAY)).toBe("overdue");
  });

  it("keeps a future not_started as not_started", () => {
    expect(effectiveStatus(inst({ status: "not_started", due_date: "2026-12-01" }), TODAY)).toBe("not_started");
  });
});

describe("predicates", () => {
  it("flags overdue, due-soon, and not-yet-due correctly", () => {
    expect(isOverdue(inst({ status: "not_started", due_date: "2026-07-01" }), TODAY)).toBe(true);
    expect(isDueSoon(inst({ status: "in_progress", due_date: "2026-07-30", warning_days: 14 }), TODAY)).toBe(true);
    expect(isDueSoon(inst({ status: "not_started", due_date: "2026-12-01", warning_days: 14 }), TODAY)).toBe(false);
    // Past due is overdue, not "due soon".
    expect(isDueSoon(inst({ status: "not_started", due_date: "2026-07-01" }), TODAY)).toBe(false);
  });

  it("detects missing evidence only for actionable, evidence-required occurrences", () => {
    expect(isMissingEvidence(inst({ status: "in_progress", due_date: "2026-08-01", requires_evidence: true }), TODAY)).toBe(true);
    expect(isMissingEvidence(inst({ status: "in_progress", due_date: "2026-08-01", requires_evidence: true, evidence_count: 2 }), TODAY)).toBe(false);
    expect(isMissingEvidence(inst({ status: "complete", due_date: "2026-08-01", requires_evidence: true }), TODAY)).toBe(false);
    expect(isMissingEvidence(inst({ status: "in_progress", due_date: "2026-08-01", requires_evidence: false }), TODAY)).toBe(false);
  });
});

describe("computeComplianceScore", () => {
  it("scores resolved+awaiting over resolved+awaiting+overdue", () => {
    const score = computeComplianceScore(
      [
        inst({ status: "complete", due_date: "2026-07-01" }),
        inst({ status: "complete", due_date: "2026-07-02" }),
        inst({ status: "not_started", due_date: "2026-06-01" }), // -> overdue
      ],
      TODAY,
    );
    expect(score).toBe(67);
  });

  it("returns 100 when nothing is overdue and something is resolved", () => {
    expect(computeComplianceScore([inst({ status: "complete", due_date: "2026-07-01" }), inst({ status: "not_applicable", due_date: "2026-07-01" })], TODAY)).toBe(100);
  });

  it("counts a not-yet-due awaiting_review as good, but a past-due one as overdue", () => {
    expect(computeComplianceScore([inst({ status: "awaiting_review", due_date: "2026-08-01" })], TODAY)).toBe(100);
    expect(computeComplianceScore([inst({ status: "awaiting_review", due_date: "2026-07-01" })], TODAY)).toBe(0);
  });

  it("returns null when there is nothing scoreable yet", () => {
    expect(computeComplianceScore([inst({ status: "not_started", due_date: "2026-12-01" })], TODAY)).toBeNull();
    expect(computeComplianceScore([], TODAY)).toBeNull();
  });
});

describe("summarizeInstances", () => {
  it("rolls up counts using effective status", () => {
    const summary = summarizeInstances(
      [
        inst({ status: "complete", due_date: "2026-07-01" }),
        inst({ status: "not_started", due_date: "2026-06-01" }), // overdue
        inst({ status: "in_progress", due_date: "2026-07-30", requires_evidence: true }), // due soon + missing evidence
        inst({ status: "awaiting_review", due_date: "2026-08-10" }), // not yet due -> stays awaiting_review
        inst({ status: "not_applicable", due_date: "2026-07-01" }),
        inst({ status: "not_started", due_date: "2026-12-01" }), // future, neutral
      ],
      TODAY,
    );
    expect(summary.total).toBe(6);
    expect(summary.overdue).toBe(1);
    expect(summary.awaitingReview).toBe(1);
    expect(summary.dueSoon).toBe(1);
    expect(summary.missingEvidence).toBe(1);
    expect(summary.resolved).toBe(2);
    expect(summary.byStatus.complete).toBe(1);
    expect(summary.byStatus.not_started).toBe(1);
    // 3 good (complete, not_applicable, awaiting_review) / (3 good + 1 overdue) = 75
    expect(summary.score).toBe(75);
  });
});
