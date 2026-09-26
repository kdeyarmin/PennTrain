import type { TrainingEnrollmentFilters } from "./trainingEnrollmentReport";

export type SavedTrainingFilters = Omit<TrainingEnrollmentFilters, "organizationId" | "facilityId">;
/** A saved report can carry filters, never tenant authority from a URL or form. */
export function saveableTrainingFilters(filters: TrainingEnrollmentFilters): SavedTrainingFilters {
  return Object.fromEntries(Object.entries({ employeeId: filters.employeeId, planId: filters.planId,
    purpose: filters.purpose, department: filters.department, trainingYear: filters.trainingYear,
    deadline: filters.deadline, courseSearch: filters.courseSearch, status: filters.status,
    dateBasis: filters.dateBasis, dateFrom: filters.dateFrom, dateThrough: filters.dateThrough,
  }).filter(([, value]) => value !== undefined)) as SavedTrainingFilters;
}
export function applySavedTrainingFilters(saved: SavedTrainingFilters, organizationId: string, facilityId: string): TrainingEnrollmentFilters {
  return { ...saved, courseSearch: saved.courseSearch ?? "", status: saved.status ?? "all", dateBasis: saved.dateBasis ?? "assigned",
    dateFrom: saved.dateFrom ?? "", dateThrough: saved.dateThrough ?? "", organizationId, facilityId };
}
export const TRAINING_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function trainingScheduleDayIsValid(frequency: string, day: number) {
  return Number.isInteger(day) && day >= 1 && day <= (frequency === "weekly" ? 7 : frequency === "monthly" ? 28 : 0);
}
