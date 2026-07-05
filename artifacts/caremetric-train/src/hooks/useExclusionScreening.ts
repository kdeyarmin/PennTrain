import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ExclusionScreeningMatch = Tables<"exclusion_screening_matches">;

export interface ListExclusionScreeningMatchesFilters {
  organizationId?: string;
  facilityId?: string;
  status?: ExclusionScreeningMatch["status"];
}

export function useListExclusionScreeningMatches(filters: ListExclusionScreeningMatchesFilters = {}) {
  return useQuery({
    queryKey: ["exclusion_screening_matches", filters],
    queryFn: async () => {
      let query = supabase.from("exclusion_screening_matches").select("*").order("created_at", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useReviewExclusionScreeningMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, status, reviewedBy, reviewedNotes,
    }: { id: string; status: "confirmed_exclusion" | "false_positive"; reviewedBy: string; reviewedNotes?: string }) => {
      const { data, error } = await supabase
        .from("exclusion_screening_matches")
        .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString(), reviewed_notes: reviewedNotes ?? null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exclusion_screening_matches"] }),
  });
}

// Scoped to the caller's own org (rescan_org_exclusion_matches enforces this server-side too) --
// re-runs the trigram match against whatever's currently in exclusion_list_entries, it does not
// re-download the OIG LEIE/SAM.gov data (that only happens via the monthly screen-exclusions
// cron job).
export function useRescanOrgExclusionMatches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await supabase.rpc("rescan_org_exclusion_matches", { p_organization_id: organizationId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exclusion_screening_matches"] }),
  });
}
