import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type EmployeeOnboardingItem = Tables<"employee_onboarding_items">;
export type EmployeeOnboardingItemUpdate = TablesUpdate<"employee_onboarding_items">;
export type EmployeeCheckinLog = Tables<"employee_checkin_logs">;
export type EmployeeCheckinLogInsert = TablesInsert<"employee_checkin_logs">;

export function useListEmployeeOnboardingItems(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["employee_onboarding_items", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_onboarding_items").select("*").eq("employee_id", employeeId!).order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
    enabled: !!employeeId,
  });
}

export function useUpdateEmployeeOnboardingItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: EmployeeOnboardingItemUpdate & { id: string }) => {
      const { data, error } = await supabase.from("employee_onboarding_items").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    // cleared_for_unsupervised_duty is recomputed server-side (recompute_cleared_for_unsupervised_duty
    // trigger) -- invalidate the employee record too so the gate badge picks up the new value.
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["employee_onboarding_items", data.employee_id] });
      queryClient.invalidateQueries({ queryKey: ["employees", data.employee_id] });
    },
  });
}

export function useListEmployeeCheckinLogs(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["employee_checkin_logs", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_checkin_logs").select("*").eq("employee_id", employeeId!).order("check_in_day");
      if (error) throw error;
      return data;
    },
    enabled: !!employeeId,
  });
}

export function useLogEmployeeCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeCheckinLogInsert) => {
      const { data, error } = await supabase.from("employee_checkin_logs").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["employee_checkin_logs", data.employee_id] }),
  });
}
