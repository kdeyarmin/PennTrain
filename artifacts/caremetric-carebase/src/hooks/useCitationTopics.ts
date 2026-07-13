import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CitationTopic = Tables<"dhs_citation_topics">;

export function useListCitationTopics() {
  return useQuery({
    queryKey: ["dhs_citation_topics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dhs_citation_topics").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}

export interface ReadinessTopicBreakdown {
  citation_topic_id: string;
  chapter: string;
  citation_ref: string | null;
  category: string;
  title: string;
  frequency_weight: number;
  compliant_count: number;
  total_count: number;
}

// Backed by get_facility_readiness_breakdown() (see
// supabase/migrations/20260705171322_dhs_citation_topics_and_readiness_core.sql) -- a
// security-invoker SQL function, so it returns exactly the rows the calling user's own RLS
// grants would already allow via a direct .select(), just pre-aggregated by citation topic.
export function useFacilityReadinessBreakdown(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["facility_readiness_breakdown", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_facility_readiness_breakdown", { p_facility_id: facilityId! });
      if (error) throw error;
      return data as ReadinessTopicBreakdown[];
    },
    enabled: !!facilityId,
  });
}
