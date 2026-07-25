import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ResidentAssessmentReview = Tables<"resident_assessment_reviews">;

function invalidate(queryClient: ReturnType<typeof useQueryClient>, residentId?: string) {
  queryClient.invalidateQueries({ queryKey: ["resident-assessment-reviews", residentId] });
  // A finalized review is a timeline event and can change what Needs Attention reports.
  queryClient.invalidateQueries({ queryKey: ["resident-timeline", residentId] });
}

export function useResidentAssessmentReviews(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-assessment-reviews", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_assessment_reviews")
        .select("*")
        .eq("resident_id", residentId!)
        .order("review_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ResidentAssessmentReview[];
    },
  });
}

export function useSaveResidentAssessmentReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      templateKey: string;
      templateVersion: number;
      answers: Json;
      reviewId?: string;
      hospitalEpisodeId?: string;
      reviewDate?: string;
    }) => {
      const { data, error } = await supabase.rpc("save_resident_assessment_review" as never, {
        p_resident_id: input.residentId,
        p_template_key: input.templateKey,
        p_template_version: input.templateVersion,
        p_answers: input.answers,
        p_review_id: input.reviewId ?? null,
        p_hospital_episode_id: input.hospitalEpisodeId ?? null,
        p_review_date: input.reviewDate ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_result, variables) => invalidate(queryClient, variables.residentId),
  });
}

export function useFinalizeResidentAssessmentReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      reviewId: string;
      assessorName: string;
      residentId: string;
      supersedesReviewId?: string;
    }) => {
      const { data, error } = await supabase.rpc("finalize_resident_assessment_review" as never, {
        p_review_id: input.reviewId,
        p_assessor_name: input.assessorName,
        p_supersedes_review_id: input.supersedesReviewId ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: (_result, variables) => invalidate(queryClient, variables.residentId),
  });
}

export function useRecordAssessmentReviewClinicalReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reviewId: string; residentId: string }) => {
      const { data, error } = await supabase.rpc("record_assessment_review_clinical_review" as never, {
        p_review_id: input.reviewId,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: (_result, variables) => invalidate(queryClient, variables.residentId),
  });
}
