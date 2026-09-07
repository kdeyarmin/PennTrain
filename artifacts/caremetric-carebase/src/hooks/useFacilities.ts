import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Facility = Tables<"facilities">;
export type FacilityInsert = TablesInsert<"facilities">;
export type FacilityUpdate = TablesUpdate<"facilities">;

export interface ListFacilitiesFilters {
  organizationId?: string;
}

export function useListFacilities(filters: ListFacilitiesFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ["facilities", filters],
    queryFn: async () => {
      let query = supabase.from("facilities").select("*").order("name");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

export function useGetFacility(id: string | undefined) {
  return useQuery({
    queryKey: ["facilities", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("facilities").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: FacilityInsert) => {
      const { data, error } = await supabase.from("facilities").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities"] }),
  });
}

export function useUpdateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: FacilityUpdate & { id: string }) => {
      const { data, error } = await supabase.from("facilities").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities"] }),
  });
}

// There is deliberately no useDeleteFacility.
//
// `delete from facilities` is refused by employment_episodes.facility_id, which references
// facilities `on delete restrict` -- and an episode exists for every facility that has ever
// employed anybody. The two Delete Facility buttons that called this always answered with a
// foreign-key error, under a dialog promising to remove "all associated data".
//
// Retiring a facility is `is_active = false` through useUpdateFacility, which both facility edit
// dialogs already offer as Status -> Inactive.
