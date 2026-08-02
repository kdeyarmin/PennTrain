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

export interface GenerateFireDrillTrackerPdfResult {
  url: string;
  path: string;
  expiresIn: number;
  drillCount: number;
}

interface GenerateFireDrillTrackerPdfResponse extends GenerateFireDrillTrackerPdfResult {
  success?: boolean;
  error?: string;
}

export interface GenerateFireDrillTrackerPdfPayload {
  facilityId: string;
  /** "YYYY-MM" */
  month: string;
}

// Always regenerates (no client-visible caching) -- the tracker renders whatever is currently in
// inspection_events for the month, matching generate-incident-report-pdf's "living document"
// convention rather than generate-certificate-pdf's cache-once behavior.
export function useGenerateFireDrillTrackerPdf() {
  return useMutation({
    mutationFn: async (payload: GenerateFireDrillTrackerPdfPayload): Promise<GenerateFireDrillTrackerPdfResult> => {
      const { data, error } = await supabase.functions.invoke<GenerateFireDrillTrackerPdfResponse>(
        "generate-fire-drill-tracker-pdf",
        { body: payload },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate the fire drill tracker PDF");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn, drillCount: data.drillCount };
    },
  });
}
