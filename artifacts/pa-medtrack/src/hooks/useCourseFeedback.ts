import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type CourseFeedback = Tables<"course_feedback">;
export type CourseFeedbackInsert = TablesInsert<"course_feedback">;

export interface ListCourseFeedbackFilters {
  courseId?: string;
}

// Unfiltered (no courseId) returns every course_feedback row RLS lets the
// caller see -- for an org_admin/trainer/facility_manager/auditor that's every
// row in their org, which is cheap enough at this app's scale to aggregate
// client-side per course (see summarizeCourseFeedback) rather than needing a
// dedicated aggregate RPC/view.
export function useListCourseFeedback(filters: ListCourseFeedbackFilters = {}) {
  return useQuery({
    queryKey: ["course_feedback", filters],
    queryFn: async () => {
      let query = supabase.from("course_feedback").select("*");
      if (filters.courseId) query = query.eq("course_id", filters.courseId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetCourseFeedbackForAssignment(courseAssignmentId: string | undefined) {
  return useQuery({
    queryKey: ["course_feedback", "by-assignment", courseAssignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_feedback")
        .select("*")
        .eq("course_assignment_id", courseAssignmentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!courseAssignmentId,
  });
}

export function useCreateCourseFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseFeedbackInsert) => {
      const { data, error } = await supabase.from("course_feedback").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_feedback"] });
      queryClient.invalidateQueries({ queryKey: ["course_feedback", "by-assignment", data.course_assignment_id] });
    },
  });
}

export function summarizeCourseFeedback(rows: CourseFeedback[] | undefined) {
  const list = rows ?? [];
  if (list.length === 0) return { average: null as number | null, count: 0 };
  const average = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
  return { average: Math.round(average * 10) / 10, count: list.length };
}
