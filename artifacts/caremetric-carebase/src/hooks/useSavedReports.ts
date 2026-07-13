import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type SavedReportDefinition = Tables<"saved_report_definitions"> & {
  current_version: Pick<Tables<"saved_report_versions">, "filters" | "time_zone" | "version_number"> | null;
};

// Saved report views live on the Phase 5 saved-reports schema: the definition is the
// named container, each save publishes a checksummed version, and RLS scopes reads to
// the caller's organization. Writes go through the save/delete RPCs only.

export function useListSavedReportViews() {
  return useQuery({
    queryKey: ["saved_report_views"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_report_definitions")
        .select("*, current_version:saved_report_versions!saved_report_current_version_fk(filters, time_zone, version_number)")
        .order("name");
      if (error) throw error;
      return data as unknown as SavedReportDefinition[];
    },
  });
}

export interface SaveReportViewPayload {
  name: string;
  reportType: string;
  filters: Record<string, string>;
}

export function useSaveReportView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, reportType, filters }: SaveReportViewPayload) => {
      const { data, error } = await supabase.rpc("save_report_definition", {
        p_name: name,
        p_report_type: reportType,
        p_filters: filters as unknown as Json,
        p_columns: [] as unknown as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved_report_views"] }),
  });
}

export function useDeleteReportView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (definitionId: string) => {
      const { error } = await supabase.rpc("delete_saved_report_definition", {
        p_definition_id: definitionId,
      });
      if (error) throw error;
      return true;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved_report_views"] }),
  });
}
