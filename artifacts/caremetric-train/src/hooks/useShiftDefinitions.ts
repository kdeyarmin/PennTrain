import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type ShiftDefinition = Tables<"shift_definitions">;
export type ShiftDefinitionInsert = TablesInsert<"shift_definitions">;
export type ShiftDefinitionUpdate = TablesUpdate<"shift_definitions">;

export interface ListShiftDefinitionsFilters {
  facilityId?: string;
}

export function useListShiftDefinitions(filters: ListShiftDefinitionsFilters = {}) {
  return useQuery({
    queryKey: ["shift_definitions", filters],
    queryFn: async () => {
      let query = supabase.from("shift_definitions").select("*").order("sort_order").order("start_time");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: filters.facilityId === undefined || !!filters.facilityId,
  });
}

export function useCreateShiftDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftDefinitionInsert) => {
      const { data, error } = await supabase.from("shift_definitions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_definitions"] }),
  });
}

export function useUpdateShiftDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ShiftDefinitionUpdate & { id: string }) => {
      const { data, error } = await supabase.from("shift_definitions").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_definitions"] }),
  });
}

export function useDeleteShiftDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_definitions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift_definitions"] }),
  });
}
