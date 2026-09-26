import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { trainingPlanErrorMessage } from "@/lib/trainingPlanEditing";

export type StarterKit = { id: string; name: string; description: string; revision: number; is_published: boolean;
  items: { course_id: string; is_required: boolean }[] };
export type StarterSelection = { id: string; facility_id: string; kit_id: string; copied_plan_id: string | null; copied_revision: number | null };
export type AssignmentRule = { training_plan_id: string; job_title: string | null; department: string | null; is_enabled: boolean;
  revision: number; automatic_enabled: boolean; approved_snapshot: string | null };
export type RulePreview = { fingerprint: string; automatic_fingerprint: string; due_date: string; training_year: number; can_apply: boolean;
  courses: { course_id: string; title: string; is_required: boolean; available: boolean }[];
  employees: { id: string; first_name: string; last_name: string; job_title: string; department: string | null; already_enrolled: boolean;
    existing_assignments: { id: string; course_id: string; status: string; due_date: string | null; plan_id: string | null }[] }[] };
export function useTrainingStarterKits(enabled = true) {
  return useQuery({ queryKey: ["training-starter-kits"], enabled, queryFn: async () => {
    const { data, error } = await supabase.from("training_starter_kits").select("*").order("name");
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as StarterKit[];
  } });
}
export function useTrainingStarterSelections(facilityId?: string) {
  return useQuery({ queryKey: ["training-starter-selections", facilityId], enabled: !!facilityId, queryFn: async () => {
    const { data, error } = await supabase.from("training_starter_kit_selections").select("*").eq("facility_id", facilityId!).order("selected_at", { ascending: false });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as StarterSelection[];
  } });
}
export function useSaveTrainingStarterKit() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (kit: { id?: string; revision?: number; name: string; description: string; items: StarterKit["items"]; is_published: boolean }) => {
    const { data, error } = await supabase.rpc("save_training_starter_kit", { p_id: kit.id, p_revision: kit.revision,
      p_name: kit.name, p_description: kit.description, p_items: kit.items, p_is_published: kit.is_published });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as StarterKit;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-starter-kits"] }) });
}
export function useSelectTrainingStarterKit() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ facilityId, kitId }: { facilityId: string; kitId: string }) => {
    const { data, error } = await supabase.rpc("select_training_starter_kit", { p_facility_id: facilityId, p_kit_id: kitId });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as string;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-starter-selections"] }) });
}
export function useCopyTrainingStarterKit() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ selectionId, revision, name, year, deadline }: { selectionId: string; revision: number; name: string; year: number; deadline: string }) => {
    const { data, error } = await supabase.rpc("copy_training_starter_kit", { p_selection_id: selectionId, p_revision: revision,
      p_name: name, p_training_year: year, p_due_date: deadline });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as string;
  }, onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["training_plans"] }), client.invalidateQueries({ queryKey: ["training-starter-selections"] })]) });
}
export function useTrainingAssignmentRule(planId: string) {
  return useQuery({ queryKey: ["training-assignment-rules", planId], queryFn: async () => {
    const { data, error } = await supabase.from("training_plan_assignment_rules").select("*").eq("training_plan_id", planId).maybeSingle();
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as AssignmentRule | null;
  } });
}
export function useSaveTrainingAssignmentRule() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ planId, jobTitle, department, enabled, revision }: { planId: string; jobTitle: string; department: string; enabled: boolean; revision?: number }) => {
    const { error } = await supabase.rpc("save_training_assignment_rule", { p_plan_id: planId, p_job_title: jobTitle.trim(),
      p_department: department.trim(), p_is_enabled: enabled, p_revision: revision });
    if (error) throw new Error(trainingPlanErrorMessage(error));
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-assignment-rules"] }) });
}
export function usePreviewTrainingAssignmentRule() {
  return useMutation({ mutationFn: async (planId: string) => {
    const { data, error } = await supabase.rpc("preview_training_assignment_rule", { p_plan_id: planId });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as RulePreview;
  } });
}
export function useApplyTrainingAssignmentRule() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ planId, fingerprint, employeeIds }: { planId: string; fingerprint: string; employeeIds: string[] }) => {
    const { data, error } = await supabase.rpc("apply_training_assignment_rule", { p_plan_id: planId, p_fingerprint: fingerprint, p_employee_ids: employeeIds });
    if (error) throw new Error(trainingPlanErrorMessage(error));
    return data as unknown as { employee_id: string; result: { assigned: number; already_enrolled?: boolean; conflicts?: { title: string; due_date: string | null }[] } }[];
  }, onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["training_plans"] }), client.invalidateQueries({ queryKey: ["course_assignments"] }),
    client.invalidateQueries({ queryKey: ["training-enrollment-report"] }), client.invalidateQueries({ queryKey: ["training-assignment-rules"] })]) });
}
export function useApproveTrainingAssignmentAutomation() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ planId, fingerprint, enabled }: { planId: string; fingerprint: string; enabled: boolean }) => {
    const { error } = await supabase.rpc("approve_training_assignment_automation", { p_plan_id: planId, p_fingerprint: fingerprint, p_enabled: enabled });
    if (error) throw new Error(trainingPlanErrorMessage(error));
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-assignment-rules"] }) });
}
