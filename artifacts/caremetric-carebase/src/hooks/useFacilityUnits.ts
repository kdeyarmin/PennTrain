import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type FacilityUnit = Tables<"facility_units">;
export type FacilityUnitInsert = TablesInsert<"facility_units">;
export type FacilityUnitUpdate = TablesUpdate<"facility_units">;

export interface ListFacilityUnitsFilters {
  facilityId?: string;
}

export function useListFacilityUnits(filters: ListFacilityUnitsFilters = {}) {
  return useQuery({
    queryKey: ["facility_units", filters],
    queryFn: async () => {
      let query = supabase.from("facility_units").select("*").order("sort_order").order("name");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: filters.facilityId === undefined || !!filters.facilityId,
  });
}

export function useCreateFacilityUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: FacilityUnitInsert) => {
      const { data, error } = await supabase.from("facility_units").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facility_units"] }),
  });
}

export function useUpdateFacilityUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: FacilityUnitUpdate & { id: string }) => {
      const { data, error } = await supabase.from("facility_units").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facility_units"] }),
  });
}

export function useDeleteFacilityUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("facility_units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facility_units"] }),
  });
}
