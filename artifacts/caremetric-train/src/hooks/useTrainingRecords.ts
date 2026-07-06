import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type TrainingRecord = Tables<"employee_training_records">;
export type TrainingRecordInsert = TablesInsert<"employee_training_records">;
export type TrainingRecordUpdate = TablesUpdate<"employee_training_records">;

export interface ListTrainingRecordsFilters {
  employeeId?: string;
  facilityId?: string;
  status?: string;
  approvalStatus?: string;
}

export function useListTrainingRecords(filters: ListTrainingRecordsFilters = {}) {
  return useQuery({
    queryKey: ["training_records", filters],
    queryFn: async () => {
      let query = supabase.from("employee_training_records").select("*").order("due_date");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.approvalStatus) query = query.eq("approval_status", filters.approvalStatus);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTrainingRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingRecordInsert) => {
      const { data, error } = await supabase.from("employee_training_records").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_records"] }),
  });
}

export function useUpdateTrainingRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TrainingRecordUpdate & { id: string }) => {
      const { data, error } = await supabase.from("employee_training_records").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_records"] }),
  });
}

// recalculate_all_compliance() is cron-only now (no client grant at all -- see
// 20260705141141_annual_hours_recalc_engine_and_hardening.sql); org_admin/facility_manager
// get this org-scoped, authorization-checked RPC instead for an on-demand refresh so a newly
// recorded training or completed course doesn't look stale until the next 6am cron run.
export function useRecalculateOrgCompliance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await supabase.rpc("recalculate_org_compliance", { p_organization_id: organizationId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      queryClient.invalidateQueries({ queryKey: ["practicums"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
