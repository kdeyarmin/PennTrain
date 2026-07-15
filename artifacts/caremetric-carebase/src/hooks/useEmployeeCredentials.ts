import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type EmployeeCredential = Tables<"employee_credentials">;
export type EmployeeCredentialInsert = TablesInsert<"employee_credentials">;
export type EmployeeCredentialUpdate = TablesUpdate<"employee_credentials">;

export interface ListEmployeeCredentialsFilters {
  employeeId?: string;
  facilityId?: string;
  credentialType?: string;
  status?: string;
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every credential RLS permits. Passing `enabled: false`
// in that case (rather than `employeeId: undefined`) is the only way to get "no results yet"
// instead of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListEmployeeCredentials(filters: ListEmployeeCredentialsFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["employee_credentials", filters],
    queryFn: async () => {
      let query = supabase.from("employee_credentials").select("*").order("expiration_date");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.credentialType) query = query.eq("credential_type", filters.credentialType);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
  });
}

export function useCreateEmployeeCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeCredentialInsert) => {
      const { data, error } = await supabase.from("employee_credentials").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_credentials"] }),
  });
}

export function useUpdateEmployeeCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: EmployeeCredentialUpdate & { id: string }) => {
      const { data, error } = await supabase.from("employee_credentials").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_credentials"] }),
  });
}

export function useDeleteEmployeeCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_credentials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee_credentials"] }),
  });
}
