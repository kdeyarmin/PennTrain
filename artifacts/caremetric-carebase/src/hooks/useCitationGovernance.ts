import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

/**
 * Citation verification governance (program plan Phase 10b, request item 24b).
 *
 * THE GAP THESE CLOSE. `20260726200000` shipped `record_citation_verification`,
 * `record_citation_superseded` and `get_citation_governance_status`, all platform-admin only, and
 * **nothing has ever called any of them.** The display half is wired -- `citationDisplay` is used by
 * `InspectionReadiness.tsx`, so an operator correctly sees "(2600.65 — approximate)". The write half
 * had no surface at all, so no citation could ever move out of `unverified` or `approximate`.
 *
 * The program plan's position is that seeding real content needs a compliance SME with the
 * regulation in front of them, and that stands. This is the narrower point: without these, even an
 * SME has no way in.
 */

export type CitationTopic = Tables<"dhs_citation_topics">;

export interface CitationGovernanceStatus {
  total: number;
  byStatus: Record<string, number>;
  staleVerified: number;
  displayableUnverified: number;
  reverificationIntervalDays: number;
  needsAttention: {
    id: string;
    status: string;
    category: string | null;
    citationRef: string | null;
    verifiedOn: string | null;
    supersededByRef: string | null;
  }[];
}

export function useCitationTopics() {
  return useQuery({
    queryKey: ["dhs-citation-topics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dhs_citation_topics")
        .select("*")
        .order("chapter")
        .order("sort_order");
      if (error) throw error;
      return data as CitationTopic[];
    },
  });
}

export function useCitationGovernanceStatus() {
  return useQuery({
    queryKey: ["citation-governance-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_citation_governance_status" as never);
      if (error) throw error;
      return data as unknown as CitationGovernanceStatus;
    },
  });
}

function useCitationInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["dhs-citation-topics"] });
    queryClient.invalidateQueries({ queryKey: ["citation-governance-status"] });
    // The readiness table renders the qualifier from these same rows; leaving it stale would show
    // "approximate" next to a citation somebody has just verified.
    queryClient.invalidateQueries({ queryKey: ["inspection-readiness"] });
  };
}

export function useRecordCitationVerification() {
  const invalidate = useCitationInvalidation();
  return useMutation({
    mutationFn: async (input: {
      topicId: string;
      citationRef: string;
      sourceUrl: string;
      effectiveDate?: string;
      verifiedOn?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_citation_verification" as never, {
        p_topic_id: input.topicId,
        p_citation_ref: input.citationRef,
        p_source_url: input.sourceUrl,
        p_effective_date: input.effectiveDate || null,
        // Null lets the server stamp its own date rather than trusting a client clock.
        p_verified_on: input.verifiedOn || null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}

export function useRecordCitationSuperseded() {
  const invalidate = useCitationInvalidation();
  return useMutation({
    mutationFn: async (input: { topicId: string; supersededByRef: string; sourceUrl?: string }) => {
      const { data, error } = await supabase.rpc("record_citation_superseded" as never, {
        p_topic_id: input.topicId,
        p_superseded_by_ref: input.supersededByRef,
        p_source_url: input.sourceUrl || null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: invalidate,
  });
}
