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

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useTrainingRecords.ts
export function useListTrainingRecords(filters: ListTrainingRecordsFilters = {}) {
=======
// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every record RLS permits. Passing `enabled: false` in
// that case (rather than `employeeId: undefined`) is the only way to get "no results yet" instead
// of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListTrainingRecords(filters: ListTrainingRecordsFilters = {}, options: { enabled?: boolean } = {}) {
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useTrainingRecords.ts
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useTrainingRecords.ts
=======
    enabled: options.enabled,
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useTrainingRecords.ts
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

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useTrainingRecords.ts
export function useDeleteTrainingRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_training_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_records"] }),
  });
}

export function useRecalculateCompliance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("recalculate_all_compliance");
=======
// recalculate_all_compliance() is cron-only now (no client grant at all -- see
// 20260705141141_annual_hours_recalc_engine_and_hardening.sql); org_admin/facility_manager
// get this org-scoped, authorization-checked RPC instead for an on-demand refresh so a newly
// recorded training or completed course doesn't look stale until the next 6am cron run.
export function useRecalculateOrgCompliance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await supabase.rpc("recalculate_org_compliance", { p_organization_id: organizationId });
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useTrainingRecords.ts
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_records"] });
      queryClient.invalidateQueries({ queryKey: ["practicums"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useTrainingRecords.ts
=======
      queryClient.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useTrainingRecords.ts
    },
  });
}
