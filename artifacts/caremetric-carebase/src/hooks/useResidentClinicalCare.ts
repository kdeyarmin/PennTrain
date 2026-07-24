import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ClinicalCarePlan = Tables<"clinical_care_plans">;
export type ClinicalCarePlanGoal = Tables<"clinical_care_plan_goals">;
export type ClinicalAssessment = Tables<"clinical_assessments">;
export type ClinicalProgressNote = Tables<"clinical_progress_notes">;

export type AssessmentType = "braden" | "morse_fall" | "pain" | "mmse" | "nutrition" | "adl" | "mood" | "custom";
export type ProgressNoteType = "nursing" | "soap" | "shift" | "care_conference" | "general";

export interface ResidentClinicalCare {
  carePlans: ClinicalCarePlan[];
  goals: ClinicalCarePlanGoal[];
  assessments: ClinicalAssessment[];
  notes: ClinicalProgressNote[];
}

const CARE_KEY = "resident-clinical-care";

export function useResidentClinicalCare(residentId?: string) {
  return useQuery({
    queryKey: [CARE_KEY, residentId],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentClinicalCare> => {
      const [carePlans, assessments, notes] = await Promise.all([
        supabase.from("clinical_care_plans").select("*").eq("resident_id", residentId!).order("created_at", { ascending: false }),
        supabase.from("clinical_assessments").select("*").eq("resident_id", residentId!).order("assessed_at", { ascending: false }).limit(100),
        supabase.from("clinical_progress_notes").select("*").eq("resident_id", residentId!).order("authored_at", { ascending: false }).limit(100),
      ]);
      const planIds = (carePlans.data ?? []).map((plan) => plan.id);
      const goals = planIds.length
        ? await supabase.from("clinical_care_plan_goals").select("*").in("care_plan_id", planIds)
        : { data: [], error: null };
      const failed = [carePlans, assessments, notes, goals].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        carePlans: carePlans.data ?? [],
        goals: goals.data ?? [],
        assessments: assessments.data ?? [],
        notes: notes.data ?? [],
      };
    },
    staleTime: 30_000,
  });
}

function useCareMutation<TInput>(runner: (input: TInput) => Promise<void>, residentIdOf: (input: TInput) => string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runner,
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: [CARE_KEY, residentIdOf(input)] }),
  });
}

export function useSaveClinicalProgressNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string; noteType: ProgressNoteType; body: string; authoredAt: string; noteId?: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("save_clinical_progress_note", {
        p_resident_id: input.residentId,
        p_note_type: input.noteType,
        p_body: input.body,
        p_authored_at: input.authoredAt,
        ...(input.noteId ? { p_note_id: input.noteId } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: [CARE_KEY, input.residentId] }),
  });
}

export function useSignClinicalProgressNote() {
  return useCareMutation(async (input: { residentId: string; noteId: string }) => {
    const { error } = await supabase.rpc("sign_clinical_progress_note", { p_note_id: input.noteId });
    if (error) throw error;
  }, (input) => input.residentId);
}

export function useAmendClinicalProgressNote() {
  return useCareMutation(async (input: { residentId: string; noteId: string; reason: string; newBody: string }) => {
    const { error } = await supabase.rpc("amend_clinical_progress_note", {
      p_note_id: input.noteId, p_reason: input.reason, p_new_body: input.newBody,
    });
    if (error) throw error;
  }, (input) => input.residentId);
}

export function useRecordClinicalAssessment() {
  return useCareMutation(async (input: {
    residentId: string; assessmentType: AssessmentType; assessedAt: string;
    score?: number | null; riskBand?: string | null; customLabel?: string | null;
  }) => {
    const { error } = await supabase.rpc("record_clinical_assessment", {
      p_resident_id: input.residentId,
      p_assessment_type: input.assessmentType,
      p_assessed_at: input.assessedAt,
      ...(input.score != null ? { p_score: input.score } : {}),
      ...(input.riskBand ? { p_risk_band: input.riskBand } : {}),
      ...(input.customLabel ? { p_custom_label: input.customLabel } : {}),
    });
    if (error) throw error;
  }, (input) => input.residentId);
}

export function useFinalizeClinicalAssessment() {
  return useCareMutation(async (input: { residentId: string; assessmentId: string }) => {
    const { error } = await supabase.rpc("finalize_clinical_assessment", { p_assessment_id: input.assessmentId });
    if (error) throw error;
  }, (input) => input.residentId);
}

export function useSaveClinicalCarePlan() {
  return useCareMutation(async (input: {
    residentId: string; title: string; category: string; status: "draft" | "active" | "on_hold" | "completed" | "revoked"; carePlanId?: string;
  }) => {
    const { error } = await supabase.rpc("save_clinical_care_plan", {
      p_resident_id: input.residentId, p_title: input.title, p_category: input.category, p_status: input.status,
      ...(input.carePlanId ? { p_care_plan_id: input.carePlanId } : {}),
    });
    if (error) throw error;
  }, (input) => input.residentId);
}

export function useSaveCarePlanGoal() {
  return useCareMutation(async (input: {
    residentId: string; carePlanId: string; description: string; targetMeasure?: string | null; status?: string;
  }) => {
    const { error } = await supabase.rpc("save_care_plan_goal", {
      p_care_plan_id: input.carePlanId, p_description: input.description,
      ...(input.targetMeasure ? { p_target_measure: input.targetMeasure } : {}),
      ...(input.status ? { p_status: input.status } : {}),
    });
    if (error) throw error;
  }, (input) => input.residentId);
}
