import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Re-exported so a screen already importing this hook does not need a second import for the
// course's name; the values themselves live in a module with no Supabase dependency.
export {
  DIABETES_COURSE_CATALOG_CODE,
  DIABETES_COURSE_CITATION,
  DIABETES_COURSE_SHORT_TITLE,
} from "@/lib/diabetesCourse";

export interface DiabetesTrainingHistoryRow {
  course_assignment_id: string;
  course_title: string;
  course_code: string | null;
  course_version: string;
  training_provider: string;
  provider_credential: string | null;
  completed_at: string | null;
  final_exam_score: number | null;
  exam_attempts: number;
  certificate_id: string | null;
  certificate_number: string | null;
  certificate_slug: string | null;
  renewal_due_at: string | null;
  attested_at: string | null;
  is_current: boolean;
}

/**
 * Every annual completion this employee has recorded for the diabetes course, newest first.
 *
 * The compliance report shows one row per employee (their most recent assignment) because that is
 * the question an inspector opens with; this is the drill-down that answers "and the years before
 * that". Each row stays bound to the exact course version it was taken against, so a historical
 * record never inherits newer content.
 */
export function useEmployeeDiabetesTrainingHistory(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["diabetes_training_history", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_employee_diabetes_training_history", {
        p_employee_id: employeeId!,
      });
      if (error) throw error;
      return (data ?? []) as DiabetesTrainingHistoryRow[];
    },
    enabled: !!employeeId,
  });
}
