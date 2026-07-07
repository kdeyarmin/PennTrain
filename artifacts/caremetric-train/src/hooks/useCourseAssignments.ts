import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type CourseAssignment = Tables<"course_assignments">;
export type CourseAssignmentInsert = TablesInsert<"course_assignments">;
export type CourseAssignmentUpdate = TablesUpdate<"course_assignments">;

export type CourseProgress = Tables<"course_progress">;
export type CourseProgressInsert = TablesInsert<"course_progress">;
export type CourseProgressUpdate = TablesUpdate<"course_progress">;

export interface ListCourseAssignmentsFilters {
  employeeId?: string;
  courseId?: string;
  status?: string;
  facilityId?: string;
  trainingPlanId?: string;
}

// `enabled` matters for callers that intend to scope by employeeId but don't have one yet (e.g.
// MyCourses.tsx before an account's employees row exists) -- every filter field here is applied
// only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes to "no filter at
// all," silently returning every assignment RLS permits. Passing `enabled: false` in that case
// (rather than `employeeId: undefined`) is the only way to get "no results yet" instead of "every
// org-wide (or platform-wide, for platform_admin) assignment," since RLS alone doesn't stand in
// for a missing employee_id filter.
export function useListCourseAssignments(filters: ListCourseAssignmentsFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["course_assignments", filters],
    queryFn: async () => {
      let query = supabase.from("course_assignments").select("*").order("assigned_at");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.courseId) query = query.eq("course_id", filters.courseId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.trainingPlanId) query = query.eq("training_plan_id", filters.trainingPlanId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: options.enabled,
  });
}

export function useGetCourseAssignment(id: string | undefined) {
  return useQuery({
    queryKey: ["course_assignments", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_assignments").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseAssignmentInsert) => {
      const { data, error } = await supabase.from("course_assignments").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
  });
}

// Wires the assigned -> in_progress transition (previously dead -- protect_course_assignment_fields()
// reverts any plain client .update() of status, so this has to go through the same
// set_config('app.privileged_write', 'on', true) RPC pattern complete_course_assignment already uses.
export function useStartCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.rpc("start_course_assignment", { p_assignment_id: assignmentId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
  });
}

// Any role can self-enroll in a published course -- the RPC (security definer) finds or
// lazily provisions the caller's own employees row, then creates (or reuses) their
// course_assignments row. Returns the assignment id so the caller can navigate straight in.
export function useSelfEnrollCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await supabase.rpc("self_enroll_course", { p_course_id: courseId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_assignments"] }),
  });
}

export function useCompleteCourseAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { data, error } = await supabase.rpc("complete_course_assignment", { p_assignment_id: assignmentId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["course_progress"] });
    },
  });
}

export function useGetCourseProgress(assignmentId: string | undefined) {
  return useQuery({
    queryKey: ["course_progress", assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_progress")
        .select("*")
        .eq("assignment_id", assignmentId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!assignmentId,
  });
}

export function useUpsertCourseProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseProgressInsert) => {
      const { data, error } = await supabase
        .from("course_progress")
        .upsert(payload, { onConflict: "assignment_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_progress", data.assignment_id] });
    },
  });
}
