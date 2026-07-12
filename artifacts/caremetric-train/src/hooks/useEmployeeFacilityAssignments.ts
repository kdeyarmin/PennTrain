import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type EmployeeFacilityAssignment = Tables<"employee_facility_assignments">;
export type EmployeeFacilityAssignmentInsert = TablesInsert<"employee_facility_assignments">;

export interface EmployeeFacilityAssignmentWithEmployee extends EmployeeFacilityAssignment {
  employees: { id: string; first_name: string; last_name: string; job_title: string; status: string } | null;
}

export interface ListEmployeeFacilityAssignmentsFilters {
  employeeId?: string;
  facilityId?: string;
}

// Includes the joined employee record (name/title/status) since every caller of this hook is
// building a facility roster picker -- avoids a second round-trip per consumer.
export function useListEmployeeFacilityAssignments(filters: ListEmployeeFacilityAssignmentsFilters = {}) {
  return useQuery({
    queryKey: ["employee_facility_assignments", filters],
    queryFn: async () => {
      let query = supabase
        .from("employee_facility_assignments")
        .select("*, employees(id, first_name, last_name, job_title, status)")
        // Alphabetized by the joined employee's last name, matching useListEmployees elsewhere --
        // "employees(last_name)" (rather than .order("last_name", { referencedTable: "employees" }))
        // is required to make a to-one embed reorder the *parent* rows instead of a no-op.
        .order("employees(last_name)");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EmployeeFacilityAssignmentWithEmployee[];
    },
  });
}

export function useAddEmployeeFacilityAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeFacilityAssignmentInsert) => {
      const { data, error } = await supabase.from("employee_facility_assignments").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_facility_assignments"] }),
  });
}

export function useRemoveEmployeeFacilityAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_facility_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_facility_assignments"] }),
  });
}
