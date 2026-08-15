import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { EmployeeLifecycleTransition } from "@/lib/employeeLifecycleCases";

export type EmployeeLifecycleCase = Tables<"employee_lifecycle_cases">;

export interface LifecycleCaseFilters {
  status?: string;
  transition?: string;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

export function useEmployeeLifecycleCases(filters: LifecycleCaseFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["employee-lifecycle-cases", filters],
    queryFn: async () => {
      let query = supabase
        .from("employee_lifecycle_cases")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        // Unique tie-break: cases opened by one bulk transition share a `created_at`, and a page
        // boundary inside that run would otherwise let Postgres order the two requests
        // differently -- showing the same case on two pages and hiding another entirely.
        .order("id", { ascending: true })
        .range(from, to);
      if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
      if (filters.transition && filters.transition !== "all") {
        query = query.eq("transition", filters.transition);
      }
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data as EmployeeLifecycleCase[], total: count ?? 0 };
    },
  });
}

export function useCreateEmployeeLifecycleCase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employeeId: string;
      transition: EmployeeLifecycleTransition;
      effectiveOn: string;
      reason: string;
      targetFacilityId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_employee_lifecycle_case", {
        p_employee_id: input.employeeId,
        p_transition: input.transition,
        p_effective_on: input.effectiveOn,
        p_target_facility_id: input.targetFacilityId ?? undefined,
        p_reason: input.reason,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-lifecycle-cases"] }),
  });
}

export function useRefreshEmployeeLifecycleCase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (caseId: string) => {
      const { data, error } = await supabase.rpc("refresh_employee_lifecycle_case", {
        p_case_id: caseId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-lifecycle-cases"] }),
  });
}

export function useApplyEmployeeLifecycleCase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (caseId: string) => {
      const { data, error } = await supabase.rpc("apply_employee_lifecycle_case", {
        p_case_id: caseId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["employee-lifecycle-cases"] });
      client.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useCancelEmployeeLifecycleCase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, reason }: { caseId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("cancel_employee_lifecycle_case", {
        p_case_id: caseId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-lifecycle-cases"] }),
  });
}
