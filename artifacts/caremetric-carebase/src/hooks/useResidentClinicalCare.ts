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

/**
 * Care plans, goals, assessments and progress notes for one resident, through the logged RPC.
 *
 * This used to be four direct PostgREST selects. They were correctly RLS-scoped, but
 * app_private.clinical_access_log records who read a resident's record, and a table read writes
 * nothing to it -- so opening this tab, one of the busiest doors into a chart, left no trace at all.
 * get_resident_clinical_care runs the same reads server-side and writes one access row per clinical
 * domain it returns (care_plans, assessments, progress_notes) before returning them.
 *
 * `reason` is the HIPAA minimum-necessary annotation on those rows, and it is in the query key for
 * the same reason it is in useResidentClinicalChartSummary's: the log entry exists only when the
 * query actually runs, so two surfaces sharing one cache entry would leave the second one's access
 * recorded under the first one's reason -- or not recorded at all.
 */
export function useResidentClinicalCare(residentId?: string, reason?: string) {
  return useQuery({
    queryKey: [CARE_KEY, residentId, reason ?? null],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentClinicalCare> => {
      const { data, error } = await supabase.rpc("get_resident_clinical_care", {
        p_resident_id: residentId!,
        ...(reason ? { p_minimum_necessary_reason: reason } : {}),
      });
      if (error) throw error;
      return data as unknown as ResidentClinicalCare;
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

/**
 * Marking a note entered in error (BACKLOG.md G15.14).
 *
 * Sign and amend were both wired; this third one was not, so a note charted against the wrong
 * resident -- the mistake this exists for -- simply stood. It is not a delete: the server writes
 * the prior body into `clinical_progress_note_versions` and sets the note to `entered_in_error`,
 * which is how a clinical record is corrected without losing what it used to say.
 */
export function useRetractClinicalProgressNote() {
  return useCareMutation(async (input: { residentId: string; noteId: string; reason: string }) => {
    const { error } = await supabase.rpc("retract_clinical_progress_note" as never, {
      p_note_id: input.noteId, p_reason: input.reason,
    } as never);
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

/**
 * Create a goal, or revise one that exists.
 *
 * `goalId` is what makes the second half possible: `save_care_plan_goal` branches on `p_goal_id`,
 * inserting when it is absent and updating when it is present, and nothing ever passed it. So a
 * goal's status was rendered on the plan -- proposed, active, achieved, on hold, cancelled -- and
 * could never leave the value it was created with. A care plan whose goals cannot be marked
 * achieved is one that only ever grows.
 */
export function useSaveCarePlanGoal() {
  return useCareMutation(async (input: {
    residentId: string; carePlanId: string; description: string; targetMeasure?: string | null;
    status?: string; goalId?: string;
  }) => {
    const { error } = await supabase.rpc("save_care_plan_goal", {
      p_care_plan_id: input.carePlanId, p_description: input.description,
      ...(input.targetMeasure ? { p_target_measure: input.targetMeasure } : {}),
      ...(input.status ? { p_status: input.status } : {}),
      ...(input.goalId ? { p_goal_id: input.goalId } : {}),
    });
    if (error) throw error;
  }, (input) => input.residentId);
}
