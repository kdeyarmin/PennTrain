import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CourseLearnerAttestation = Tables<"course_learner_attestations">;

/**
 * Signatures already recorded against one training assignment.
 *
 * course_learner_attestations has no client write policy on purpose: the statement a learner signs
 * is copied from the published course block by record_course_attestation(), never sent up from the
 * browser, so a signature can never be recorded against text the learner did not actually see.
 */
export function useListCourseAttestations(assignmentId: string | undefined) {
  return useQuery({
    queryKey: ["course_learner_attestations", assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_learner_attestations")
        .select("*")
        .eq("course_assignment_id", assignmentId!)
        .order("attested_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!assignmentId,
  });
}

export function useRecordCourseAttestation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, blockId }: { assignmentId: string; blockId: string }) => {
      const { data, error } = await supabase.rpc("record_course_attestation", {
        p_assignment_id: assignmentId,
        p_block_id: blockId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["course_learner_attestations", variables.assignmentId] });
    },
  });
}

/** The statement and version an attestation block asks the learner to sign. */
export interface AttestationBlockContent {
  intro: string;
  statement: string;
  version: string;
}

export function parseAttestationBlock(body: unknown): AttestationBlockContent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const parsed = body as Record<string, unknown>;
  const statement = typeof parsed.attestation_text === "string" ? parsed.attestation_text.trim() : "";
  const version = typeof parsed.attestation_version === "string" ? parsed.attestation_version.trim() : "";
  if (!statement || !version) return null;
  return {
    intro: typeof parsed.content === "string" ? parsed.content : "",
    statement,
    version,
  };
}
