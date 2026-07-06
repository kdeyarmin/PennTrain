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

export function useListShiftAssignments(filters: ListShiftAssignmentsFilters = {}) {
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
  });
}

export function useCreateShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftAssignmentInsert) => {
      const { data, error } = await supabase.from("shift_assignments").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_assignments"] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_assignments"] }),
  });
}

export function useDeleteShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_assignments"] }),
  });
}
