import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type InspectionEvent = Tables<"inspection_events">;
export type InspectionEventInsert = TablesInsert<"inspection_events">;

export function useListInspectionEvents(inspectionItemId: string | undefined) {
  return useQuery({
    queryKey: ["inspection_events", inspectionItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspection_events").select("*").eq("inspection_item_id", inspectionItemId!).order("performed_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!inspectionItemId,
  });
}

// Unfiltered (RLS-scoped) lookup of every event's parent inspection_item_id -- used to resolve
// a corrective_actions.inspection_event_id into a "View Inspection Item" deep-link without a
// per-alert fetch.
export function useListAllInspectionEvents() {
  return useQuery({
    queryKey: ["inspection_events", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inspection_events").select("id, inspection_item_id");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateInspectionEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InspectionEventInsert) => {
      const { data, error } = await supabase.from("inspection_events").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inspection_events", data.inspection_item_id] });
      queryClient.invalidateQueries({ queryKey: ["inspection_items"] });
    },
  });
}
