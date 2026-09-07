import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type TrainingHourBucket = Tables<"employee_training_hour_buckets">;

export interface ListTrainingHourBucketsFilters {
  employeeId?: string;
  facilityId?: string;
}

export function useListTrainingHourBuckets(filters: ListTrainingHourBucketsFilters = {}) {
  return useQuery({
    queryKey: ["training_hour_buckets", filters],
    queryFn: async () => {
      let query = supabase
        .from("employee_training_hour_buckets")
        .select("*")
        .order("training_year", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export type CourseCompletionCredit = Tables<"course_completion_credits">;

/**
 * Regulatory credit earned by finishing an individual course (BACKLOG.md J28).
 *
 * `recalculate_compliance_core` sums these into the annual hour buckets alongside
 * `employee_training_records`, so any figure recomputed from the records alone under-reports every
 * employee who did their annual hours as courses rather than in a classroom. `credited_at` is what
 * makes an anniversary-year total possible at all: the row's own `training_year` column is keyed on
 * the calendar year, which is the thing being worked around.
 */
export function useListCourseCompletionCredits(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["course_completion_credits", employeeId ?? null],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_completion_credits")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("credited_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
