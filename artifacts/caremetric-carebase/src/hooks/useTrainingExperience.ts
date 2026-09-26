import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export interface TrainingWelcomeData {
  facility_id: string; organization_id: string; facility_name: string; organization_name: string; logo_path: string | null;
  welcome: { welcome_message?: string; contact_name?: string; contact_email?: string };
  setup: { staff: number; portal_ready: number; plans: number; assigned: number } | null;
}
export interface PracticeTemplate { id: string; title: string; instructions: string; items: string[]; archived: boolean }
export interface PracticeObservation {
  id: string; employee_id: string; title_snapshot: string; employee_name_snapshot: string; evaluator_name_snapshot: string;
  items_snapshot: { label: string; result: string }[]; observed_on: string; notes: string; result: string;
  created_at: string; voided_at: string | null; void_reason: string | null;
}
export interface OutsideTraining {
  id: string; employee_id: string; employee_name: string; title: string; completed_on: string; minutes: number; provider: string;
  status: string; review_note: string | null; evidence_document_id: string; created_at: string;
}
export interface TrainingRecords { templates: PracticeTemplate[]; observations: PracticeObservation[]; external: OutsideTraining[] }

export async function trainingExperience(action: string, facilityId?: string, employeeId?: string, data: Json = {}) {
  const response = await supabase.rpc("training_experience", { p_action: action, p_facility_id: facilityId, p_employee_id: employeeId, p_data: data });
  if (response.error) throw response.error;
  return response.data;
}
export function useTrainingWelcome(facilityId?: string, enabled = true) {
  return useQuery({ queryKey: ["training-experience", "welcome", facilityId], enabled,
    queryFn: async () => await trainingExperience("welcome", facilityId) as unknown as TrainingWelcomeData });
}
export function useTrainingRecords(facilityId: string, employeeId?: string) {
  return useQuery({ queryKey: ["training-experience", "records", facilityId, employeeId], enabled: !!facilityId,
    queryFn: async () => {
      const result: TrainingRecords = { templates: [], observations: [], external: [] };
      for (let offset = 0; ; offset += 500) {
        const page = await trainingExperience("records", facilityId, employeeId, { offset }) as unknown as TrainingRecords;
        if (!page || ![page.templates, page.observations, page.external].every(Array.isArray)) throw new Error("Training records could not be loaded completely.");
        if (!offset) result.templates = page.templates;
        result.observations.push(...page.observations); result.external.push(...page.external);
        if (page.observations.length < 500 && page.external.length < 500) return result;
      }
    } });
}
export function useSaveTrainingExperience() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: { action: string; facilityId: string; employeeId?: string; data: Json }) =>
    trainingExperience(input.action, input.facilityId, input.employeeId, input.data),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["training-experience"] });
      void client.invalidateQueries({ queryKey: ["training-workspace"] });
    } });
}
