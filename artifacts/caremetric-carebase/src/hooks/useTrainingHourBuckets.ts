import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { StaffTrainingSummary } from "@/lib/trainingWorkspace";

export function useStaffTrainingSummary(employeeId: string | undefined) {
  return useQuery({ queryKey: ["staff-training-summary", employeeId], enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_staff_training_summary", { p_employee_id: employeeId! });
      if (error) throw error;
      return data as StaffTrainingSummary | null;
    } });
}

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

