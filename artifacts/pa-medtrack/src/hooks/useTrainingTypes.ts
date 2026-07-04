import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type TrainingType = Tables<"training_types">;
export type TrainingTypeInsert = TablesInsert<"training_types">;
export type TrainingTypeUpdate = TablesUpdate<"training_types">;

export function useListTrainingTypes(filters: { isActive?: boolean } = {}) {
  return useQuery({
    queryKey: ["training_types", filters],
    queryFn: async () => {
      let query = supabase.from("training_types").select("*").order("sort_order").order("name");
      if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTrainingType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TrainingTypeInsert) => {
      const { data, error } = await supabase.from("training_types").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_types"] }),
  });
}

export function useUpdateTrainingType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TrainingTypeUpdate & { id: string }) => {
      const { data, error } = await supabase.from("training_types").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_types"] }),
  });
}
