import { describe, expect, it } from "vitest";
import { summarizeCourseAssignmentAnalytics } from "./courseAssignmentAnalytics";

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
