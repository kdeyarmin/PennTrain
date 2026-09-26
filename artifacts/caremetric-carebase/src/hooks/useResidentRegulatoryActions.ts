import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type ResidentRegulatoryAction = Tables<"resident_regulatory_actions">;

export function useResidentRegulatoryActions(facilityId: string, residentId?: string) {
  return useQuery({
    queryKey: ["resident_regulatory_actions", facilityId, residentId ?? "facility"],
    queryFn: async () => {
      const rows: ResidentRegulatoryAction[] = [];
      for (let from = 0; ; from += 1000) {
        let query = supabase.from("resident_regulatory_actions").select("*").eq("facility_id", facilityId).order("due_at").order("id").range(from, from + 999);
        if (residentId) query = query.eq("resident_id", residentId);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    },
    enabled: !!facilityId,
  });
}

export function useSaveResidentRegulatoryAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { rows: TablesInsert<"resident_regulatory_actions">[] } | { id: string; changes: TablesUpdate<"resident_regulatory_actions"> }) => {
      const query = "rows" in payload
        ? supabase.from("resident_regulatory_actions").insert(payload.rows)
        : supabase.from("resident_regulatory_actions").update(payload.changes).eq("id", payload.id);
      const { data, error } = await query.select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["resident_regulatory_actions"] }),
  });
}
