import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type CourseProviderProfile = Tables<"course_provider_profiles">;
export type CourseProviderProfileInsert = TablesInsert<"course_provider_profiles">;

/**
 * Training-provider and clinical-review metadata for one course.
 *
 * Readable by anyone who can already see the course -- the provider's name and credential are
 * printed on the learner's own certificate. Writable by platform_admin only, which is the role that
 * authors courses at all. None of it gates publication, assignment, or completion: a stale
 * next_review_due surfaces a reminder to administrators, it does not withdraw the course.
 */
export function useGetCourseProviderProfile(courseId: string | undefined) {
  return useQuery({
    queryKey: ["course_provider_profiles", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_provider_profiles")
        .select("*")
        .eq("course_id", courseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!courseId,
  });
}

export function useUpsertCourseProviderProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseProviderProfileInsert) => {
      const { data, error } = await supabase
        .from("course_provider_profiles")
        .upsert(payload, { onConflict: "course_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["course_provider_profiles", data.course_id] });
    },
  });
}

/** Blank strings from an empty form field are stored as NULL, not as "". */
export function nullableField(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
