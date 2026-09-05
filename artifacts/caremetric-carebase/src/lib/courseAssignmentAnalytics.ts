import { facilityDaysUntil } from "./dateUtils";

export interface CourseAssignmentAnalyticsRecord {
  id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
}

export interface CourseAssignmentAnalyticsSummary {
  total: number;
  completed: number;
  overdue: number;
  inProgress: number;
  assigned: number;
  dueWithin7Days: number;
  completionRate: number;
  oldestOverdueAssignmentId: string | null;
}

function daysUntil(date: string, today: string): number {
  const anchor = new Date(`${today}T16:00:00Z`);
  return facilityDaysUntil(date, anchor) ?? 0;
}

export function summarizeCourseAssignmentAnalytics(assignments: CourseAssignmentAnalyticsRecord[], today: string): CourseAssignmentAnalyticsSummary {
  const completed = assignments.filter((assignment) => assignment.status === "completed" || !!assignment.completed_at).length;
  const overdueAssignments = assignments.filter((assignment) => assignment.status === "overdue" || (!!assignment.due_date && daysUntil(assignment.due_date, today) < 0 && !assignment.completed_at));
  const dueWithin7Days = assignments.filter((assignment) => {
    if (!assignment.due_date || assignment.completed_at) return false;
    const days = daysUntil(assignment.due_date, today);
    return days >= 0 && days <= 7;
  }).length;
  const oldestOverdueAssignmentId = [...overdueAssignments]
    .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"))[0]?.id ?? null;

  return {
    total: assignments.length,
    completed,
    overdue: overdueAssignments.length,
    inProgress: assignments.filter((assignment) => assignment.status === "in_progress").length,
    assigned: assignments.filter((assignment) => assignment.status === "assigned").length,
    dueWithin7Days,
    completionRate: assignments.length ? Math.round((completed / assignments.length) * 100) : 0,
    oldestOverdueAssignmentId,
  };
}

/**
 * What a bulk "Assign Training" actually did (BACKLOG.md I12).
 *
 * Re-assigning the annual course to everyone is a normal thing to do -- an administrator does it
 * each year, and again after adding one late hire -- so most of the selected list will already
 * have it. Before 20260905060000 those became second identical rows; now they cannot be created at
 * all, which means the same click produces three outcomes, not two, and folding them into two gets
 * one of them wrong in a way nobody would notice from the toast:
 *
 *   * counting an already-assigned employee as newly assigned overstates the work done, and hides
 *     that the second click did nothing;
 *   * counting one as a failure puts a red error beside the people who really did fail.
 *
 * Extracted and named so the arithmetic is testable rather than inline in the page's toast, which
 * is where it was when it only had two cases to get right.
 */
export interface BulkAssignmentOutcome {
  /** Rows that did not exist before this click. */
  assigned: number;
  /** Employees who already had this course open; nothing was created for them. */
  alreadyAssigned: number;
  /** Rejected for some other reason -- no published version, RLS, a lost connection. */
  failed: number;
  total: number;
}

export function summarizeBulkAssignment(
  results: Array<{ status: "fulfilled" | "rejected"; alreadyAssigned?: boolean }>,
): BulkAssignmentOutcome {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const alreadyAssigned = fulfilled.filter((r) => r.alreadyAssigned === true).length;
  return {
    assigned: fulfilled.length - alreadyAssigned,
    alreadyAssigned,
    failed: results.length - fulfilled.length,
    total: results.length,
  };
}

/** The sentence the toast shows, so "N already had it open" cannot go missing from one branch. */
export function describeBulkAssignment(outcome: BulkAssignmentOutcome): string {
  return `${outcome.assigned} of ${outcome.total} employee${outcome.total === 1 ? "" : "s"} assigned successfully.`
    + (outcome.alreadyAssigned > 0 ? ` ${outcome.alreadyAssigned} already had it open.` : "")
    + (outcome.failed > 0 ? ` ${outcome.failed} failed.` : "");
}
