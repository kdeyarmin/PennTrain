import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Organization = Tables<"organizations">;
export type OrganizationInsert = TablesInsert<"organizations">;
export type OrganizationUpdate = TablesUpdate<"organizations">;

export function useListOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useGetOrganization(id: string | undefined) {
  return useQuery({
    queryKey: ["organizations", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useGetOrganizationStats(id: string | undefined) {
  return useQuery({
    queryKey: ["organizations", id, "stats"],
    queryFn: async () => {
      const [facilities, employees] = await Promise.all([
        supabase.from("facilities").select("id", { count: "exact", head: true }).eq("organization_id", id!),
        supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", id!),
      ]);
      if (facilities.error) throw facilities.error;
      if (employees.error) throw employees.error;
      return {
        facilityCount: facilities.count ?? 0,
        employeeCount: employees.count ?? 0,
      };
    },
    enabled: !!id,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrganizationInsert) => {
      const { data, error } = await supabase.from("organizations").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: OrganizationUpdate & { id: string }) => {
      const { data, error } = await supabase.from("organizations").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations"] }),
  });
}
