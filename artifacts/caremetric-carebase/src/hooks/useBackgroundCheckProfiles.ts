import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type BackgroundCheckProfile = Tables<"employee_background_check_profiles">;
export type BackgroundCheckProfileInsert = TablesInsert<"employee_background_check_profiles">;

export interface ListBackgroundCheckProfilesFilters {
  organizationId?: string;
  facilityId?: string;
}

export function useListBackgroundCheckProfiles(filters: ListBackgroundCheckProfilesFilters = {}) {
  return useQuery({
    queryKey: ["background_check_profiles", filters],
    queryFn: async () => {
      let query = supabase.from("employee_background_check_profiles").select("*");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

// One profile row per employee -- upsert-on-employee_id so the same dialog handles both "create
// on first use" and "edit an existing profile" without the caller needing to know which case
// it is.
export function useUpsertBackgroundCheckProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BackgroundCheckProfileInsert) => {
      const { data, error } = await supabase
        .from("employee_background_check_profiles")
        .upsert(payload, { onConflict: "employee_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["background_check_profiles"] });
      queryClient.invalidateQueries({ queryKey: ["employee_credentials"] });
    },
  });
}
