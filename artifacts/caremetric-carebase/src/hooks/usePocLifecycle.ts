import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Row shape for plan_of_correction_versions until database.types is regenerated. */
export interface PlanOfCorrectionVersion {
  id: string;
  organization_id: string;
  facility_id: string;
  violation_id: string;
  version_number: number;
  submitted_at: string;
  submitted_by_profile_id: string | null;
  snapshot: Record<string, unknown>;
  pdf_storage_bucket: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  amendment_reason: string | null;
  created_at: string;
}

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
      const { data, error } = await supabase.rpc("submit_plan_of_correction", {
        p_violation_id: violationId,
        p_amendment_reason: amendmentReason ?? null,
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
