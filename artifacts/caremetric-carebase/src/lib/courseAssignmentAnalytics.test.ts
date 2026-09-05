import { describe, expect, it } from "vitest";
import {
  describeBulkAssignment, summarizeBulkAssignment, summarizeCourseAssignmentAnalytics,
} from "./courseAssignmentAnalytics";

describe("summarizeCourseAssignmentAnalytics", () => {
  it("summarizes completion and due-date risk", () => {
    const summary = summarizeCourseAssignmentAnalytics([
      { id: "complete", status: "completed", due_date: "2026-07-01", completed_at: "2026-06-30T12:00:00Z" },
      { id: "old-overdue", status: "assigned", due_date: "2026-06-01", completed_at: null },
      { id: "soon", status: "in_progress", due_date: "2026-07-15", completed_at: null },
      { id: "new-overdue", status: "overdue", due_date: "2026-07-01", completed_at: null },
    ], "2026-07-10");

    expect(summary).toMatchObject({ total: 4, completed: 1, overdue: 2, inProgress: 1, dueWithin7Days: 1, completionRate: 25 });
    expect(summary.oldestOverdueAssignmentId).toBe("old-overdue");
  });
});

/**
 * BACKLOG.md I12. Assigning the annual course to everyone a second time is a normal thing to do,
 * and 20260905060000 turned "they already have it" from a duplicate row into a refused insert. The
 * risk in that change is entirely in how the click is REPORTED: counted as assigned it overstates
 * the work and hides that nothing happened; counted as failed it puts a red error next to the
 * people who really did fail.
 */
describe("summarizeBulkAssignment", () => {
  it("separates newly assigned, already assigned, and failed", () => {
    const outcome = summarizeBulkAssignment([
      { status: "fulfilled", alreadyAssigned: false },
      { status: "fulfilled", alreadyAssigned: true },
      { status: "fulfilled", alreadyAssigned: true },
      { status: "rejected" },
    ]);
    expect(outcome).toEqual({ assigned: 1, alreadyAssigned: 2, failed: 1, total: 4 });
  });

  it("reports the whole list as already assigned when nothing was created", () => {
    const outcome = summarizeBulkAssignment([
      { status: "fulfilled", alreadyAssigned: true },
      { status: "fulfilled", alreadyAssigned: true },
    ]);
    expect(outcome).toEqual({ assigned: 0, alreadyAssigned: 2, failed: 0, total: 2 });
    expect(describeBulkAssignment(outcome)).toBe(
      "0 of 2 employees assigned successfully. 2 already had it open.",
    );
  });

  // The pre-I12 shape, which must keep reading exactly as it did: no "already had it" clause at all.
  it("says nothing about already-assigned when there are none", () => {
    const outcome = summarizeBulkAssignment([{ status: "fulfilled", alreadyAssigned: false }]);
    expect(describeBulkAssignment(outcome)).toBe("1 of 1 employee assigned successfully.");
  });

  it("still names the failures", () => {
    const outcome = summarizeBulkAssignment([
      { status: "fulfilled", alreadyAssigned: true },
      { status: "rejected" },
      { status: "rejected" },
    ]);
    expect(describeBulkAssignment(outcome)).toBe(
      "0 of 3 employees assigned successfully. 1 already had it open. 2 failed.",
    );
  });
});
