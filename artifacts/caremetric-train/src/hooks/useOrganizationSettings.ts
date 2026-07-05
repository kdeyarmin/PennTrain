import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type OrganizationSettings = Tables<"organization_settings">;
export type OrganizationSettingsUpsert = TablesInsert<"organization_settings">;

export function useGetOrganizationSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization_settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });
}

export function useUpsertOrganizationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrganizationSettingsUpsert) => {
      const { data, error } = await supabase
        .from("organization_settings")
        .upsert(payload, { onConflict: "organization_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["organization_settings", data.organization_id] });
    },
  });
}
