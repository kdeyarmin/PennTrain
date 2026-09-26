import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PlanCoverage {
  employee_id: string; student: string; needs_reapply: boolean; applied_at: string;
  required: number; completed: number; unresolved: number;
  items: { course_id: string; title: string; required: boolean; assignment_id: string | null;
    status: string; due_date: string | null; conflict_assignment_id: string | null; conflict_due_date: string | null }[];
}
export function useTrainingPlanProgress(planId: string, enabled = true) {
  return useQuery({ queryKey: ["training_plans", "progress", planId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_plan_progress", { p_plan_id: planId });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Plan progress is unavailable. Refresh before reporting completion.");
      return data as unknown as PlanCoverage[];
    }, staleTime: 0,
  });
}
export function useResolveTrainingPlanAssignment() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (input: { planId: string; employeeId: string; assignmentId: string }) => {
    const { error } = await supabase.rpc("resolve_training_plan_assignment", {
      p_plan_id: input.planId, p_employee_id: input.employeeId, p_assignment_id: input.assignmentId,
    });
    if (error) throw error;
  }, onSuccess: async () => { await Promise.all([
    client.invalidateQueries({ queryKey: ["training_plans"] }), client.invalidateQueries({ queryKey: ["course_assignments"] }),
  ]); } });
}
export interface TrainingRosterRow {
  exemption_reason: string | null; exemption_year: number | null;
  employee_id: string; student: string; first_name: string; last_name: string;
  email: string | null; department: string | null; profile_id: string | null; invitation_id: string | null;
  last_sent_at: string | null; last_error: string | null; account_status: string;
  required_total: number; required_completed: number; optional_total: number; overdue: number; due_soon: number;
  next_due: string | null; plan_attention: boolean; state: string;
}
export interface TrainingRosterPage {
  setup: { profile_complete: boolean; has_policy: boolean; staff_count: number; plan_count: number; assigned_staff: number };
  exempt: number; total: number; active_staff: number; no_assignments: number; overdue: number; due_soon: number;
  complete: number; plan_attention: number; needs_invite: number; needs_activation: number; rows: TrainingRosterRow[];
}
export function useTrainingRosterProgress(facilityId: string, filters: { search: string; state: string; year?: number; offset: number }) {
  return useQuery({ queryKey: ["course_assignments", "training-roster", facilityId, filters], enabled: !!facilityId && (filters.year === undefined || (Number.isInteger(filters.year) && filters.year >= 1990 && filters.year <= 2200)), staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_roster_progress", { p_facility_id: facilityId,
        p_search: filters.search, p_state: filters.state, p_training_year: filters.year, p_offset: filters.offset, p_limit: 50 });
      if (error) throw error;
      const page = data as unknown as TrainingRosterPage;
      if (!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.total)) throw new Error("Staff progress is unavailable.");
      return page;
    },
  });
}

export function useSetAssignmentRequirement() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async ({ id, required }: { id: string; required: boolean }) => {
    const { data, error } = await supabase.from("course_assignments").update({ is_required: required }).eq("id", id).select("id").single();
    if (error) throw error;
    return data;
  }, onSuccess: async () => { await Promise.all([
    client.invalidateQueries({ queryKey: ["course_assignments"] }), client.invalidateQueries({ queryKey: ["training-enrollment-report"] }),
  ]); } });
}
