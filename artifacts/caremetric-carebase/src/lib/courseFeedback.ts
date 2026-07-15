import type { Tables } from "@/lib/database.types";

export type CourseFeedback = Tables<"course_feedback">;

export function summarizeCourseFeedback(rows: CourseFeedback[] | undefined) {
  const list = rows ?? [];
  if (list.length === 0) return { average: null as number | null, count: 0 };
  const average = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
  return { average: Math.round(average * 10) / 10, count: list.length };
}
