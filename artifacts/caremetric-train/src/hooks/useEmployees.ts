import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Employee = Tables<"employees">;
export type EmployeeInsert = TablesInsert<"employees">;
export type EmployeeUpdate = TablesUpdate<"employees">;

export interface ListEmployeesFilters {
  facilityId?: string;
  status?: string;
  organizationId?: string;
}

export function useListEmployees(filters: ListEmployeesFilters = {}) {
  return useQuery({
    queryKey: ["employees", filters],
    queryFn: async () => {
      let query = supabase.from("employees").select("*").order("last_name");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetEmployee(id: string | undefined) {
  return useQuery({
    queryKey: ["employees", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useGetEmployeeByProfileId(profileId: string | undefined) {
  return useQuery({
    queryKey: ["employees", "by-profile", profileId],
    queryFn: async () => {
      // maybeSingle(), not single(): now that every role (not just employee) can reach pages that
      // use this hook, "no employees row yet" (org_admin/auditor/platform_admin pre-self-enroll)
      // is a normal, expected result, not an error condition -- single() would instead throw on
      // zero rows, and react-query's default retry: 3 would retry that "error" with backoff for
      // several seconds before finally giving up and settling `data` to undefined anyway.
      const { data, error } = await supabase.from("employees").select("*").eq("profile_id", profileId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeInsert) => {
      const { data, error } = await supabase.from("employees").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: EmployeeUpdate & { id: string }) => {
      const { data, error } = await supabase.from("employees").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
}
