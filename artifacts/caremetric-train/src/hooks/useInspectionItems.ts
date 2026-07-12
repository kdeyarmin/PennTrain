import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type InspectionItem = Tables<"inspection_items">;
export type InspectionItemInsert = TablesInsert<"inspection_items">;
export type InspectionItemUpdate = TablesUpdate<"inspection_items">;

export interface ListInspectionItemsFilters {
  facilityId?: string;
  itemKind?: string;
  status?: string;
  isActive?: boolean;
}

export function useListInspectionItems(filters: ListInspectionItemsFilters = {}) {
  return useQuery({
    queryKey: ["inspection_items", filters],
    queryFn: async () => {
      let query = supabase.from("inspection_items").select("*").order("next_due_date");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.itemKind) query = query.eq("item_kind", filters.itemKind);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.isActive !== undefined) query = query.eq("is_active", filters.isActive);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetInspectionItem(id: string | undefined) {
  return useQuery({
    queryKey: ["inspection_items", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inspection_items").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateInspectionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InspectionItemInsert) => {
      const { data, error } = await supabase.from("inspection_items").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inspection_items"] }),
  });
}

export function useUpdateInspectionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: InspectionItemUpdate & { id: string }) => {
      const { data, error } = await supabase.from("inspection_items").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inspection_items"] });
      queryClient.invalidateQueries({ queryKey: ["inspection_items", data.id] });
    },
  });
}

export function useDeleteInspectionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inspection_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inspection_items"] }),
  });
}
