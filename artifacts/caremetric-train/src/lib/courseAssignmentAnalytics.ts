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
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const dateTime = Date.parse(`${date}T00:00:00Z`);
  return Math.ceil((dateTime - todayTime) / 86_400_000);
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
