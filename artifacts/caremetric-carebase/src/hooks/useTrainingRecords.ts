import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type TrainingRecord = Tables<"employee_training_records">;
export type TrainingRecordInsert = TablesInsert<"employee_training_records">;
export type TrainingRecordUpdate = TablesUpdate<"employee_training_records">;

export interface ListTrainingRecordsFilters {
  employeeId?: string;
  /** Prefer this over a full roster load when the page already has a known employee set. */
  employeeIds?: string[];
  facilityId?: string;
  status?: string;
  approvalStatus?: string;
  /** Restrict to specific training types (e.g. MED-INIT / MED-RENEW / DIABETES-EDU on MedAdminRoster). */
  trainingTypeIds?: string[];
  /** Only rows whose external_certificate_document_id is non-null (PendingApprovals linked-id set). */
  hasExternalCertificateDocument?: boolean;
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every record RLS permits. Passing `enabled: false` in
// that case (rather than `employeeId: undefined`) is the only way to get "no results yet" instead
// of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListTrainingRecords(filters: ListTrainingRecordsFilters = {}, options: { enabled?: boolean } = {}) {
  // Stabilize array keys so reordering the same set of ids does not produce a new queryKey.
  const sortedEmployeeIds = filters.employeeIds ? [...filters.employeeIds].filter(Boolean).sort() : undefined;
  const sortedTrainingTypeIds = filters.trainingTypeIds ? [...filters.trainingTypeIds].filter(Boolean).sort() : undefined;
  const stableFilters = {
    ...filters,
    employeeIds: sortedEmployeeIds,
    trainingTypeIds: sortedTrainingTypeIds,
  };

  return useQuery({
    queryKey: ["training_records", stableFilters],
    queryFn: async () => {
      // Empty array scopes mean "nothing matches" -- short-circuit instead of sending an empty
      // .in() (PostgREST treats .in("col", []) as a syntax error / empty result depending on version).
      if (sortedEmployeeIds && sortedEmployeeIds.length === 0) return [] as TrainingRecord[];
      if (sortedTrainingTypeIds && sortedTrainingTypeIds.length === 0) return [] as TrainingRecord[];

      // PostgREST caps a single response. Page until exhausted so readiness / roster views do not
      // silently under-count outstanding training once a facility grows past max-rows.
      //
      // `due_date` alone is not a total order -- a renewal cycle gives every employee on the same
      // training type the same due date, and records with no completion carry a NULL one. Postgres
      // may resolve each page's request differently inside a run of equal keys, so without the `id`
      // tie-break rows repeat on one page and are dropped from another: the same silent
      // under-count this loop exists to prevent.
      const pageSize = 1000;
      const rows: TrainingRecord[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase.from("employee_training_records").select("*").order("due_date").order("id", { ascending: true }).range(from, from + pageSize - 1);
        if (sortedEmployeeIds && sortedEmployeeIds.length > 0) {
          query = query.in("employee_id", sortedEmployeeIds);
        } else if (filters.employeeId) {
          query = query.eq("employee_id", filters.employeeId);
        }
        if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.approvalStatus) query = query.eq("approval_status", filters.approvalStatus);
        if (sortedTrainingTypeIds && sortedTrainingTypeIds.length > 0) {
          query = query.in("training_type_id", sortedTrainingTypeIds);
        }
        if (filters.hasExternalCertificateDocument) {
          // PendingApprovals builds a Set of already-linked document ids from this column.
          // Restricting to non-null keeps that Set correct without downloading every training row.
          query = query.not("external_certificate_document_id", "is", null);
        }
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    },
    enabled: options.enabled,
  });
}

export function useCreateTrainingRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingRecordInsert) => {
      const { data, error } = await supabase.rpc("save_training_record", {
        p_payload: payload as Json,
      });
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
      const { data, error } = await supabase.rpc("save_training_record", {
        p_record_id: id,
        p_payload: payload as Json,
      });
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
