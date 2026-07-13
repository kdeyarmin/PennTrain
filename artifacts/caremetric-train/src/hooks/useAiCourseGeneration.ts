import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type CourseAiGeneration = Tables<"course_ai_generations">;

// supabase-js's functions.invoke() only ever throws a generic
// FunctionsHttpError ("Edge Function returned a non-2xx status code") for
// any non-2xx response -- the actual `{ error: "..." }` body our Edge
// Functions return lives on `error.context`, a raw Response the SDK doesn't
// parse for you. The AI wizard needs a real, specific message to show
// inline (not a generic one), so we make a best-effort attempt to recover
// it here rather than surfacing the SDK's generic message.
async function describeFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Response body wasn't JSON (or already consumed) -- fall through to the generic message below.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export interface GenerateCourseCurriculumPayload {
  generationMode?: "course" | "training_plan";
  organizationId?: string;
  planName?: string;
  courseCount?: number;
  titleHint?: string;
  category?: string;
  trainingTypeId?: string;
  sourceMaterial?: string;
  desiredModuleCount?: number;
  desiredDurationMinutes?: number;
  notes?: string;
}

export interface GenerateCourseCurriculumResult {
  success: true;
  course_id?: string;
  course_version_id?: string;
  training_plan_id?: string;
  courses?: { course_id: string; course_version_id: string; title: string }[];
  generation_id: string;
}

// The raw Edge Function response shape (success and error responses share one
// loosely-typed interface since which fields are present depends on outcome).
interface GenerateCourseCurriculumResponse {
  success?: boolean;
  course_id?: string;
  course_version_id?: string;
  training_plan_id?: string;
  courses?: { course_id: string; course_version_id: string; title: string }[];
  generation_id?: string;
  error?: string;
}

/**
 * Kicks off AI curriculum generation (Anthropic Claude, via the
 * generate-course-curriculum Edge Function): drafts a full course --
 * modules, lesson text/video scripts, and knowledge-check quizzes -- and
 * persists it as a new draft course + course_version in one call.
 */
export function useGenerateCourseCurriculum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GenerateCourseCurriculumPayload) => {
      const { data, error } = await supabase.functions.invoke<GenerateCourseCurriculumResponse>(
        "generate-course-curriculum",
        {
          body: {
            generation_mode: payload.generationMode ?? "course",
            organization_id: payload.organizationId || undefined,
            plan_name: payload.planName || undefined,
            course_count: payload.courseCount,
            title_hint: payload.titleHint || undefined,
            category: payload.category || undefined,
            training_type_id: payload.trainingTypeId || undefined,
            source_material: payload.sourceMaterial || undefined,
            desired_module_count: payload.desiredModuleCount,
            desired_duration_minutes: payload.desiredDurationMinutes,
            notes: payload.notes || undefined,
          },
        },
      );
      if (error) throw new Error(await describeFunctionError(error, "Failed to generate course curriculum"));
      if (!data || data.success === false || !data.generation_id) {
        throw new Error(data?.error ?? "Failed to generate course curriculum");
      }
      if ((payload.generationMode ?? "course") === "training_plan") {
        if (!data.training_plan_id || !data.courses?.length) throw new Error(data.error ?? "Failed to generate training plan");
      } else if (!data.course_id || !data.course_version_id) {
        throw new Error(data.error ?? "Failed to generate course curriculum");
      }
      return data as GenerateCourseCurriculumResult;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

export interface RegenerateCourseBlockPayload {
  courseBlockId: string;
  // Not sent to the Edge Function -- carried through so onSuccess can invalidate
  // exactly the affected block list, matching useCreateCourseBlock/useUpdateCourseBlock's
  // targeted ["course_blocks", courseVersionId] invalidation in useCourses.ts.
  courseVersionId: string;
  feedback: string;
}

export interface RegenerateCourseBlockResult {
  success: true;
  course_block_id: string;
  generation_id: string;
}

interface RegenerateCourseBlockResponse {
  success?: boolean;
  course_block_id?: string;
  generation_id?: string;
  error?: string;
}

/**
 * Regenerates a single content block (text lesson, video script, or full quiz
 * question set) via the regenerate-course-block Edge Function, applying the
 * caller's feedback. Persists directly onto the existing block/quiz rows --
 * no new block or quiz is created.
 */
export function useRegenerateCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseBlockId, feedback }: RegenerateCourseBlockPayload) => {
      const { data, error } = await supabase.functions.invoke<RegenerateCourseBlockResponse>(
        "regenerate-course-block",
        { body: { course_block_id: courseBlockId, feedback } },
      );
      if (error) throw new Error(await describeFunctionError(error, "Failed to regenerate block"));
      if (!data || data.success === false || !data.course_block_id || !data.generation_id) {
        throw new Error(data?.error ?? "Failed to regenerate block");
      }
      return data as RegenerateCourseBlockResult;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["course_blocks", variables.courseVersionId] }),
  });
}

/**
 * Audit trail of AI generation calls (course_ai_generations), RLS-scoped to
 * platform_admin. Pass a courseId to scope to one course's history (e.g. to
 * find the generation record backing a course_version for the review-gate
 * UI); omit it to list every generation across all courses. `enabled`
 * defaults to true but lets callers who only sometimes need this (e.g. the
 * review gate, which only matters for AI-generated versions) skip firing an
 * unscoped "every generation ever" query on every render.
 */
export function useListCourseAiGenerations(courseId?: string, enabled = true) {
  return useQuery({
    queryKey: ["course_ai_generations", courseId ?? "all"],
    queryFn: async () => {
      let query = supabase.from("course_ai_generations").select("*").order("created_at", { ascending: false });
      if (courseId) query = query.eq("course_id", courseId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

export interface MarkAiGenerationReviewedPayload {
  courseVersionId: string;
  // The course_ai_generations row that produced this version (or the block being
  // reviewed within it), if one could be identified client-side. Best-effort --
  // the review gate itself lives entirely on course_versions.ai_reviewed_at, so a
  // missing/unmatched generation row doesn't block marking the version reviewed.
  generationId?: string;
  reviewedBy: string;
}

export interface MarkAiGenerationReviewedResult {
  version: Tables<"course_versions">;
  generationFailed: boolean;
  generationError: Error | null;
}

// Mirrors CourseDetail.tsx's handlePublish: two related updates (the
// course_versions review-gate columns, and the matching course_ai_generations
// audit row) chained via Promise.allSettled so one failing doesn't hide the
// other's outcome. The version update is the one that actually matters (it's
// what the DB trigger checks), so it's the only one that throws; a failed
// generation-row update is reported back for the caller to toast about but
// doesn't prevent the version from being marked reviewed.
export function useMarkAiGenerationReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      courseVersionId, generationId, reviewedBy,
    }: MarkAiGenerationReviewedPayload): Promise<MarkAiGenerationReviewedResult> => {
      const reviewedAt = new Date().toISOString();

      const [versionResult, generationResult] = await Promise.allSettled([
        supabase
          .from("course_versions")
          .update({ ai_reviewed_at: reviewedAt, ai_reviewed_by: reviewedBy })
          .eq("id", courseVersionId)
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          }),
        generationId
          ? supabase
              .from("course_ai_generations")
              .update({ reviewed_at: reviewedAt, reviewed_by: reviewedBy })
              .eq("id", generationId)
              .then(({ error }) => {
                if (error) throw error;
              })
          : Promise.resolve(),
      ]);

      if (versionResult.status === "rejected") throw versionResult.reason;

      return {
        version: versionResult.value,
        generationFailed: generationResult.status === "rejected",
        generationError: generationResult.status === "rejected" ? (generationResult.reason as Error) : null,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", result.version.id] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", result.version.course_id] });
      queryClient.invalidateQueries({ queryKey: ["course_ai_generations"] });
    },
  });
}
