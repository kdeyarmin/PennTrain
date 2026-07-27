import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CareConflictDisposition = Tables<"resident_care_conflict_dispositions">;

export function useResidentConflictDispositions(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-conflict-dispositions", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_care_conflict_dispositions")
        .select("*")
        .eq("resident_id", residentId!)
        .order("resolved_at", { ascending: false });
      if (error) throw error;
      return data as CareConflictDisposition[];
    },
  });
}

export function useRecordCareConflictDisposition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      conflictKey: string;
      conflictKind: string;
      disposition: string;
      note: string;
    }) => {
      const { data, error } = await supabase.rpc("record_care_conflict_disposition" as never, {
        p_resident_id: input.residentId,
        p_conflict_key: input.conflictKey,
        p_conflict_kind: input.conflictKind,
        p_disposition: input.disposition,
        p_note: input.note,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["resident-conflict-dispositions", variables.residentId] });
    },
  });
}
