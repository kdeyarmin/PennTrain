export interface RecurringCourseLike {
  id: string;
  recurrence_interval_days: number | null;
}

export interface CourseAssignmentLike {
  course_id: string;
  status: string;
  assigned_at: string;
  completed_at: string | null;
  completion_recorded_at?: string | null;
}

const OPEN_ASSIGNMENT_STATUSES = new Set(["assigned", "in_progress", "overdue", "paused"]);
const DAY_MS = 24 * 60 * 60 * 1000;
export const SELF_SERVICE_RENEWAL_WINDOW_DAYS = 30;
const TRAINING_TIME_ZONE = "America/New_York";
const trainingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TRAINING_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function trainingDayStart(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = trainingDateFormatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Date.UTC(year, month - 1, day);
}

export function latestCourseAssignment(
  courseId: string,
  assignments: CourseAssignmentLike[],
): CourseAssignmentLike | undefined {
  return assignments
    .filter(assignment => assignment.course_id === courseId)
    .sort((a, b) => Date.parse(b.assigned_at) - Date.parse(a.assigned_at))[0];
}

/**
 * Mirrors self_enroll_course(): open work is reused, canceled work can be replaced,
 * and protected completion evidence becomes renewable during the final 30 days
 * of its recurrence cycle, measured on the Pennsylvania training day.
 */
export function canSelfEnrollInCourse(
  course: RecurringCourseLike,
  assignments: CourseAssignmentLike[],
  now = new Date(),
): boolean {
  const courseAssignments = assignments.filter(assignment => assignment.course_id === course.id);
  if (courseAssignments.some(assignment => OPEN_ASSIGNMENT_STATUSES.has(assignment.status))) {
    return false;
  }

  // Mirrors the RPC's second lookup: canceled rows do not hide protected
  // completion evidence, and renewal follows the latest recorded completion
  // rather than whichever assignment happened to be created most recently.
  const latestCompletion = courseAssignments
    .filter(assignment => assignment.status === "completed")
    .sort((a, b) => {
      const aEvidence = Date.parse(a.completion_recorded_at ?? a.completed_at ?? "");
      const bEvidence = Date.parse(b.completion_recorded_at ?? b.completed_at ?? "");
      const byEvidence = (Number.isNaN(bEvidence) ? -Infinity : bEvidence)
        - (Number.isNaN(aEvidence) ? -Infinity : aEvidence);
      return byEvidence || Date.parse(b.assigned_at) - Date.parse(a.assigned_at);
    })[0];
  if (!latestCompletion) return true;

  const completionEvidence = latestCompletion.completion_recorded_at ?? latestCompletion.completed_at;
  if (!course.recurrence_interval_days || !completionEvidence) return false;

  const completionDay = trainingDayStart(completionEvidence);
  const today = trainingDayStart(now);
  if (completionDay === null || today === null) return false;

  const eligibilityDays = Math.max(
    course.recurrence_interval_days - SELF_SERVICE_RENEWAL_WINDOW_DAYS,
    1,
  );
  return completionDay + eligibilityDays * DAY_MS <= today;
}
