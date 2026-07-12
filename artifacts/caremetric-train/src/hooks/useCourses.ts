import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Course = Tables<"courses">;
export type CourseInsert = TablesInsert<"courses">;
export type CourseUpdate = TablesUpdate<"courses">;
export type CourseVersion = Tables<"course_versions">;
export type CourseVersionInsert = TablesInsert<"course_versions">;
export type CourseBlock = Tables<"course_blocks">;
export type CourseBlockInsert = TablesInsert<"course_blocks">;
export type CourseBlockUpdate = TablesUpdate<"course_blocks">;

export interface ListCoursesFilters {
  organizationId?: string;
  status?: string;
  // Restricts the list to system-catalog courses (organization_id IS NULL).
  // platform_admin's RLS grant bypasses the org filter entirely, so without this
  // its unfiltered list interleaves every organization's courses -- this is the
  // opt-in "System Catalog" view for that role (see Courses.tsx).
  systemOnly?: boolean;
}

// Mirrors self_enroll_course()'s own organization-scope check. courses_select RLS lets
// platform_admin see every organization's courses (its RLS grant bypasses the org filter
// entirely -- see ListCoursesFilters.systemOnly above), but self_enroll_course rejects enrolling
// in a course whose organization_id doesn't match the caller's own employee record (a
// platform_admin's is always the dedicated internal org, never a real tenant's). Without this,
// a platform_admin's "Available Courses"/"Take This Course" would offer every tenant's courses,
// each guaranteed to fail with a destructive error toast the moment they're clicked.
export function canEnrollInCourse(course: Pick<Course, "organization_id">, employeeOrganizationId: string | undefined): boolean {
  return course.organization_id === null || course.organization_id === employeeOrganizationId;
}

// Courses can be org-owned or system-catalog (organization_id null); RLS already
// scopes which rows a given user can see (their org's courses + the system
// catalog), so we only apply an organization_id filter when the caller explicitly
// asks for one -- we never filter out null-org rows client-side by default.
export function useListCourses(filters: ListCoursesFilters = {}) {
  return useQuery({
    queryKey: ["courses", filters],
    queryFn: async () => {
      let query = supabase.from("courses").select("*").order("title");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.systemOnly) query = query.is("organization_id", null);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetCourse(id: string | undefined) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseInsert) => {
      const { data, error } = await supabase.from("courses").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

export function useUpdateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CourseUpdate & { id: string }) => {
      const { data, error } = await supabase.from("courses").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

// Course versions are scoped under the "courses" query-key namespace (rather than
// their own top-level "course_versions" key) so that a broad invalidateQueries({
// queryKey: ["courses"] }) -- e.g. after useUpdateCourse changes current_version_id
// -- also sweeps every version list/detail query via TanStack's default prefix match.

export function useListCourseVersions(courseId: string | undefined) {
  return useQuery({
    queryKey: ["courses", "versions", courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_versions")
        .select("*")
        .eq("course_id", courseId!)
        .order("version_number");
      if (error) throw error;
      return data;
    },
    enabled: !!courseId,
  });
}

export function useGetCourseVersion(id: string | undefined) {
  return useQuery({
    queryKey: ["courses", "versions", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_versions").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseVersionInsert) => {
      const { data, error } = await supabase.from("course_versions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Refresh this course's version list...
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
      // ...and the courses list/detail too: creating a version doesn't itself change
      // courses.current_version_id (that's a separate useUpdateCourse call the calling
      // page makes to publish it), but callers may still be showing derived state.
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });
}

export interface CloneCourseVersionPayload {
  sourceVersionId: string;
  courseId: string;
  organizationId: string | null;
  versionNumber: number;
  title: string;
}

// Deep-copies a source version's blocks -> (for quiz blocks) quiz -> questions -> answers +
// explanations into a brand-new draft version, client IDs generated up front so every table can
// be bulk-inserted in one request instead of round-tripping server-assigned IDs block by block.
// Not wrapped in a single DB transaction (this is a sequence of client requests, not an RPC) --
// if a later step fails, the catch below deletes the version row it already created so a botched
// clone doesn't leave a half-populated draft behind; the caller sees one clean error either way.
// Cascading tables (course_blocks/quizzes/quiz_questions/quiz_answers) key off
// course_version_id/course_block_id/quiz_id/question_id FKs, so deleting the version is enough
// to let the FK's own ON DELETE behavior (or a retried clone attempt) clean up the rest.
export function useCloneCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CloneCourseVersionPayload) => {
      const { data: sourceVersion, error: sourceError } = await supabase
        .from("course_versions")
        .select("ai_generated, description")
        .eq("id", payload.sourceVersionId)
        .single();
      if (sourceError) throw sourceError;

      const { data: newVersion, error: versionError } = await supabase
        .from("course_versions")
        .insert({
          course_id: payload.courseId,
          organization_id: payload.organizationId,
          version_number: payload.versionNumber,
          title: payload.title,
          description: sourceVersion.description,
          // A version cloned from AI-generated content is itself still AI-authored content --
          // it needs the same mandatory self-review acknowledgment before it can publish, even
          // though the source version was already reviewed once.
          ai_generated: sourceVersion.ai_generated,
        })
        .select()
        .single();
      if (versionError) throw versionError;

      try {
        const { data: sourceBlocks, error: blocksError } = await supabase
          .from("course_blocks")
          .select("*")
          .eq("course_version_id", payload.sourceVersionId)
          .order("sort_order");
        if (blocksError) throw blocksError;
        if (!sourceBlocks || sourceBlocks.length === 0) return newVersion;

        const blockIdMap = new Map(sourceBlocks.map((b) => [b.id, crypto.randomUUID()]));
        const newBlocks: CourseBlockInsert[] = sourceBlocks.map((b) => ({
          id: blockIdMap.get(b.id),
          course_version_id: newVersion.id,
          organization_id: b.organization_id,
          block_type: b.block_type,
          title: b.title,
          body: b.body,
          video_url: b.video_url,
          document_id: b.document_id,
          sort_order: b.sort_order,
        }));
        const { error: insertBlocksError } = await supabase.from("course_blocks").insert(newBlocks);
        if (insertBlocksError) throw insertBlocksError;

        const quizBlockIds = sourceBlocks.filter((b) => b.block_type === "quiz").map((b) => b.id);
        if (quizBlockIds.length === 0) return newVersion;

        const { data: sourceQuizzes, error: quizzesError } = await supabase
          .from("quizzes").select("*").in("course_block_id", quizBlockIds);
        if (quizzesError) throw quizzesError;
        if (!sourceQuizzes || sourceQuizzes.length === 0) return newVersion;

        const quizIdMap = new Map(sourceQuizzes.map((q) => [q.id, crypto.randomUUID()]));
        const newQuizzes: TablesInsert<"quizzes">[] = sourceQuizzes.map((q) => ({
          id: quizIdMap.get(q.id),
          course_block_id: blockIdMap.get(q.course_block_id)!,
          organization_id: q.organization_id,
          title: q.title,
          passing_score_percent: q.passing_score_percent,
          max_attempts: q.max_attempts,
        }));
        const { error: insertQuizzesError } = await supabase.from("quizzes").insert(newQuizzes);
        if (insertQuizzesError) throw insertQuizzesError;

        const { data: sourceQuestions, error: questionsError } = await supabase
          .from("quiz_questions").select("*").in("quiz_id", [...quizIdMap.keys()]);
        if (questionsError) throw questionsError;
        if (!sourceQuestions || sourceQuestions.length === 0) return newVersion;

        const questionIdMap = new Map(sourceQuestions.map((q) => [q.id, crypto.randomUUID()]));
        const newQuestions: TablesInsert<"quiz_questions">[] = sourceQuestions.map((q) => ({
          id: questionIdMap.get(q.id),
          quiz_id: quizIdMap.get(q.quiz_id)!,
          organization_id: q.organization_id,
          question_text: q.question_text,
          question_type: q.question_type,
          points: q.points,
          sort_order: q.sort_order,
        }));
        const { error: insertQuestionsError } = await supabase.from("quiz_questions").insert(newQuestions);
        if (insertQuestionsError) throw insertQuestionsError;

        const sourceQuestionIds = [...questionIdMap.keys()];
        const [answersRes, explanationsRes] = await Promise.all([
          supabase.from("quiz_answers").select("*").in("question_id", sourceQuestionIds),
          supabase.from("quiz_question_explanations").select("*").in("question_id", sourceQuestionIds),
        ]);
        if (answersRes.error) throw answersRes.error;
        if (explanationsRes.error) throw explanationsRes.error;

        if (answersRes.data.length > 0) {
          const newAnswers: TablesInsert<"quiz_answers">[] = answersRes.data.map((a) => ({
            question_id: questionIdMap.get(a.question_id)!,
            organization_id: a.organization_id,
            answer_text: a.answer_text,
            is_correct: a.is_correct,
            sort_order: a.sort_order,
          }));
          const { error: insertAnswersError } = await supabase.from("quiz_answers").insert(newAnswers);
          if (insertAnswersError) throw insertAnswersError;
        }

        if (explanationsRes.data.length > 0) {
          const newExplanations: TablesInsert<"quiz_question_explanations">[] = explanationsRes.data.map((e) => ({
            question_id: questionIdMap.get(e.question_id)!,
            organization_id: e.organization_id,
            explanation: e.explanation,
          }));
          const { error: insertExplanationsError } = await supabase.from("quiz_question_explanations").insert(newExplanations);
          if (insertExplanationsError) throw insertExplanationsError;
        }

        return newVersion;
      } catch (err) {
        const { error: cleanupError } = await supabase.from("course_versions").delete().eq("id", newVersion.id);
        if (cleanupError) throw new Error(`Clone failed and cleanup failed: ${cleanupError.message}`, { cause: err });
        throw err;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.id] });
    },
  });
}

// Published versions are DB-locked immutable: a trigger rejects updates once
// version.status === 'published', surfacing as a Postgres error via `error` above.
// Callers should generally only offer an edit UI while version.status === 'draft',
// but we don't try to pre-guess/suppress the DB error here beyond that.
export function useUpdateCourseVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: TablesUpdate<"course_versions"> & { id: string }) => {
      const { data, error } = await supabase.from("course_versions").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.id] });
      queryClient.invalidateQueries({ queryKey: ["courses", "versions", data.course_id] });
    },
  });
}

export function useListCourseBlocks(courseVersionId: string | undefined) {
  return useQuery({
    queryKey: ["course_blocks", courseVersionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_blocks")
        .select("*")
        .eq("course_version_id", courseVersionId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!courseVersionId,
  });
}

export function useGetCourseBlock(id: string | undefined) {
  return useQuery({
    queryKey: ["course_blocks", "single", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("course_blocks").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CourseBlockInsert) => {
      const { data, error } = await supabase.from("course_blocks").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.course_version_id] }),
  });
}

export function useUpdateCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CourseBlockUpdate & { id: string }) => {
      const { data, error } = await supabase.from("course_blocks").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.course_version_id] }),
  });
}

export function useDeleteCourseBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, courseVersionId }: { id: string; courseVersionId: string }) => {
      const { error } = await supabase.from("course_blocks").delete().eq("id", id);
      if (error) throw error;
      return { courseVersionId };
    },
    onSuccess: (data) =>
      queryClient.invalidateQueries({ queryKey: ["course_blocks", data.courseVersionId] }),
  });
}
