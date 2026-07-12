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

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useOrganizations.ts
=======
// Detects a suspended organization from the *inside*: current_org_id() (and therefore every RLS
// policy shaped organization_id = current_org_id()) returns null for a suspended org's members,
// so their own organizations row becomes unreadable -- that absence IS the suspension signal.
// platform_admin never needs this (is_platform_admin() bypasses org scoping entirely), so callers
// should only enable this for non-platform_admin roles.
export function useMyOrganizationAccessible(organizationId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["organizations", "self-check", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id").eq("id", organizationId!).maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: enabled && !!organizationId,
  });
}

>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useOrganizations.ts
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
