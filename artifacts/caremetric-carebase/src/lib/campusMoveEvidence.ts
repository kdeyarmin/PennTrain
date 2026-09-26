import { addFacilityCalendarYears } from "@/lib/dateUtils";
import type { ResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
export const CAMPUS_SOURCE_TYPES: Record<string, string[]> = {
  medical_evaluation: ["medical_evaluation", "annual_medical_evaluation", "change_medical_evaluation"],
  initial_assessment_15day: ["initial_assessment_15day", "annual_reassessment", "significant_change_reassessment"],
  support_plan_30day: ["support_plan_30day"],
  support_plan_quarterly_review: ["support_plan_quarterly_review"],
};
/** Carry what was current on the move day, including a legitimately overdue cycle. */
export function latestCampusSourceItems(items: ResidentComplianceItem[], kind: string, moveDate: string | null) {
  if (!moveDate) return [];
  const eligible = items.filter(item => CAMPUS_SOURCE_TYPES[kind]?.includes(item.item_type) && item.status === "compliant" && item.completed_date && item.completed_date <= moveDate
    && (kind !== "medical_evaluation" || item.completed_date >= addFacilityCalendarYears(moveDate, -1)));
  const latest = eligible.reduce((date, item) => item.completed_date! > date ? item.completed_date! : date, "");
  return eligible.filter(item => item.completed_date === latest).sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}
