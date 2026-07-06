import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CourseAiGeneration = Tables<"course_ai_generations">;

// Joined shape returned by useListCourseAiGenerations below -- course title and
// requester name are read alongside the audit row so the platform-wide log page
// doesn't have to do N+1 lookups per row. Mirrors the QuizQuestionWithExplanation
// convention in useQuizzes.ts: extend the base Tables<> row with the extra joined
// fields and `as` the query result, since the generated Supabase types don't model
// ad-hoc joins.
export type CourseAiGenerationWithRelations = CourseAiGeneration & {
  courses: { title: string } | null;
  requester: { first_name: string; last_name: string } | null;
};

export interface ListCourseAiGenerationsFilters {
  status?: string;
  limit?: number;
}

// NOTE: this is a *different* hook from useListCourseAiGenerations in
// useAiCourseGeneration.ts -- that one is scoped to a single course (for the
// per-course review-gate UI on CourseDetail.tsx) and selects "*" with no joins.
// This one is unscoped/platform-wide (for the AiGenerationLog admin page) and
// joins in course title + requester name for display. Same table, different
// query shape -- imported from different paths, so there's no naming collision,
// but don't confuse the two when wiring up a new caller.
//
// RLS restricts course_ai_generations SELECT to platform_admin (see
// supabase/migrations/20260705210000_create_course_ai_generations_table.sql), so
// this naturally returns every organization's AI-generation calls for that caller
// -- no client-side org scoping needed.
export function useListCourseAiGenerations(filters: ListCourseAiGenerationsFilters = {}) {
  return useQuery({
    queryKey: ["course_ai_generations", filters],
    queryFn: async () => {
      // course_ai_generations has two FKs into profiles (requested_by, reviewed_by),
      // so the join must disambiguate with the explicit foreign-key-hint syntax
      // (profiles!course_ai_generations_requested_by_fkey) -- a bare profiles(...)
      // would be ambiguous between the two FK paths and PostgREST would reject it.
      let query = supabase
        .from("course_ai_generations")
        .select("*, courses(title), requester:profiles!course_ai_generations_requested_by_fkey(first_name,last_name)")
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 200);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as CourseAiGenerationWithRelations[];
    },
  });
}
