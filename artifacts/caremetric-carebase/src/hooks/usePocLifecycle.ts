import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type PlanOfCorrectionVersion = Tables<"plan_of_correction_versions">;

export function useListPocVersions(violationId: string | undefined) {
  return useQuery({
    queryKey: ["plan_of_correction_versions", violationId],
    queryFn: async (): Promise<PlanOfCorrectionVersion[]> => {
      const { data, error } = await supabase.rpc("list_plan_of_correction_versions", {
        p_violation_id: violationId!,
      });
      if (error) throw error;
      return (data ?? []) as PlanOfCorrectionVersion[];
    },
    enabled: !!violationId,
  });
}

function invalidateViolation(queryClient: ReturnType<typeof useQueryClient>, violationId: string) {
  queryClient.invalidateQueries({ queryKey: ["dhs_violations"] });
  queryClient.invalidateQueries({ queryKey: ["dhs_violations", violationId] });
  queryClient.invalidateQueries({ queryKey: ["plan_of_correction_versions", violationId] });
  queryClient.invalidateQueries({ queryKey: ["corrective_actions"] });
}

export function useSubmitPlanOfCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      violationId,
      amendmentReason,
    }: {
      violationId: string;
      amendmentReason?: string;
    }): Promise<PlanOfCorrectionVersion> => {
      // Omitted rather than passed as null: the RPC's own `default null` is what marks a
      // first submission, and the generated Args type only accepts a string.
      const { data, error } = await supabase.rpc("submit_plan_of_correction", {
        p_violation_id: violationId,
        ...(amendmentReason ? { p_amendment_reason: amendmentReason } : {}),
      });
      if (error) throw error;
      return data as PlanOfCorrectionVersion;
    },
    onSuccess: (_data, vars) => invalidateViolation(queryClient, vars.violationId),
  });
}

export function useMarkPlanOfCorrectionCorrected() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (violationId: string) => {
      const { data, error } = await supabase.rpc("mark_plan_of_correction_corrected", {
        p_violation_id: violationId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, violationId) => invalidateViolation(queryClient, violationId),
  });
}

export function useVerifyPlanOfCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ violationId, notes }: { violationId: string; notes: string }) => {
      const { data, error } = await supabase.rpc("verify_plan_of_correction", {
        p_violation_id: violationId,
        p_notes: notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => invalidateViolation(queryClient, vars.violationId),
  });
}
