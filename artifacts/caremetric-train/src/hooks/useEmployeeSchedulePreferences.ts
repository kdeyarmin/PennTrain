import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

// One row = one recurring "typical shift" pattern for an employee (e.g. Mon/Wed/Fri, Day shift,
// Wing A). Several rows can cover a mixed weekly pattern. This is the data the schedule
// auto-fill (generate_schedule_assignments) prioritizes so managers don't arrange every cell by hand.
export type EmployeeSchedulePreference = Tables<"employee_schedule_preferences">;
export type EmployeeSchedulePreferenceInsert = TablesInsert<"employee_schedule_preferences">;
export type EmployeeSchedulePreferenceUpdate = TablesUpdate<"employee_schedule_preferences">;

export interface ListEmployeeSchedulePreferencesFilters {
  employeeId?: string;
  facilityId?: string;
}

export function useListEmployeeSchedulePreferences(filters: ListEmployeeSchedulePreferencesFilters = {}) {
  return useQuery({
    queryKey: ["employee_schedule_preferences", filters],
    queryFn: async () => {
      let query = supabase.from("employee_schedule_preferences").select("*").order("priority", { ascending: false });
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEmployeeSchedulePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeSchedulePreferenceInsert) => {
      const { data, error } = await supabase.from("employee_schedule_preferences").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_schedule_preferences"] }),
  });
}

export function useUpdateEmployeeSchedulePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: EmployeeSchedulePreferenceUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("employee_schedule_preferences")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_schedule_preferences"] }),
  });
}

export function useDeleteEmployeeSchedulePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_schedule_preferences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_schedule_preferences"] }),
  });
}
