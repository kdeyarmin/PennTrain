import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type ResidentInformalSupport = Tables<"resident_informal_supports">;
export type ResidentInformalSupportInsert = TablesInsert<"resident_informal_supports">;
export type ResidentInformalSupportUpdate = TablesUpdate<"resident_informal_supports">;

export function useListResidentInformalSupports(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_informal_supports", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_informal_supports").select("*").eq("resident_id", residentId!).order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!residentId,
  });
}

export function useUpsertResidentInformalSupport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string } & ResidentInformalSupportInsert) => {
      const { id, ...rest } = payload;
      if (id) {
        const { data, error } = await supabase.from("resident_informal_supports").update(rest as ResidentInformalSupportUpdate).eq("id", id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from("resident_informal_supports").insert(rest).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["resident_informal_supports", data.resident_id] }),
  });
}

export function useDeleteResidentInformalSupport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (support: ResidentInformalSupport) => {
      const { error } = await supabase.from("resident_informal_supports").delete().eq("id", support.id);
      if (error) throw error;
      return support;
    },
    onSuccess: (support) => queryClient.invalidateQueries({ queryKey: ["resident_informal_supports", support.resident_id] }),
  });
}
