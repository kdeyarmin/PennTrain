import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type ShiftAssignment = Tables<"shift_assignments">;
export type ShiftAssignmentInsert = TablesInsert<"shift_assignments">;
export type ShiftAssignmentUpdate = TablesUpdate<"shift_assignments">;

// Calendar-grid view: one row per shift with the employee/unit/shift names already joined in,
// so the schedule creator and the employee "my schedule" view don't issue one lookup per cell.
export interface ShiftAssignmentWithDetails extends ShiftAssignment {
  employees: { first_name: string; last_name: string } | null;
  facility_units: { name: string } | null;
  shift_definitions: { name: string; color: string | null } | null;
}

const WITH_DETAILS_SELECT = "*, employees(first_name, last_name), facility_units(name), shift_definitions(name, color)";

export interface ListShiftAssignmentsFilters {
  scheduleId?: string;
  employeeId?: string;
  facilityId?: string;
  fromDate?: string;
  toDate?: string;
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every shift RLS permits. Passing `enabled: false` in
// that case (rather than `employeeId: undefined`) is the only way to get "no results yet" instead
// of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListShiftAssignments(filters: ListShiftAssignmentsFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["shift_assignments", filters],
    queryFn: async () => {
      let query = supabase
        .from("shift_assignments")
        .select(WITH_DETAILS_SELECT)
        .order("shift_date")
        .order("start_time");
      if (filters.scheduleId) query = query.eq("schedule_id", filters.scheduleId);
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.fromDate) query = query.gte("shift_date", filters.fromDate);
      if (filters.toDate) query = query.lte("shift_date", filters.toDate);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ShiftAssignmentWithDetails[];
    },
    enabled: options.enabled,
  });
}

export function useCreateShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftAssignmentInsert) => {
      if (!payload.schedule_id || !payload.employee_id || !payload.shift_date || !payload.shift_definition_id) {
        throw new Error("Schedule, employee, date, and shift definition are required");
      }
      const { data, error } = await supabase.rpc("assign_employee_to_shift", {
        p_schedule_id: payload.schedule_id,
        p_employee_id: payload.employee_id,
        p_shift_date: payload.shift_date,
        p_shift_definition_id: payload.shift_definition_id,
        p_unit_id: payload.unit_id ?? undefined,
        p_notes: payload.notes ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-service-workload"] });
    },
  });
}

export function useUpdateShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ShiftAssignmentUpdate & { id: string }) => {
      const { data, error } = await supabase.from("shift_assignments").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-service-workload"] });
    },
  });
}

export function useDeleteShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-service-workload"] });
    },
  });
}
