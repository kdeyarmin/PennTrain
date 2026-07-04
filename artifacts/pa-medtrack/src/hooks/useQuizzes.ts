import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// IMPORTANT -- is_correct exposure boundary
//
// `quiz_answers` (and the `QuizAnswer` type below) carries `is_correct`, i.e.
// the answer key. `useListQuizAnswers` reads that table directly and MUST
// only ever be used from authoring/editing UI (the quiz builder), where the
// author is allowed to see and edit the key.
//
// The quiz-TAKING flow (anything a learner sees while answering a quiz) must
// use `useQuizAnswerChoices` instead, which calls the `get_quiz_answer_choices`
// RPC. That RPC deliberately omits `is_correct` -- it is the only sanctioned
// way for a learner to read answer options without seeing the key. Never
// substitute `useListQuizAnswers` for `useQuizAnswerChoices` in a
// quiz-taking page.
// ---------------------------------------------------------------------------

export type Quiz = Tables<"quizzes">;
export type QuizInsert = TablesInsert<"quizzes">;
export type QuizUpdate = TablesUpdate<"quizzes">;

export type QuizQuestion = Tables<"quiz_questions">;
export type QuizQuestionInsert = TablesInsert<"quiz_questions">;
export type QuizQuestionUpdate = TablesUpdate<"quiz_questions">;

/** Author-side shape -- includes is_correct. See boundary note at the top of this file. */
export type QuizAnswer = Tables<"quiz_answers">;
export type QuizAnswerInsert = TablesInsert<"quiz_answers">;
export type QuizAnswerUpdate = TablesUpdate<"quiz_answers">;

export type QuizAttempt = Tables<"quiz_attempts">;
type QuizAttemptInsert = TablesInsert<"quiz_attempts">;

export type QuizAttemptAnswer = Tables<"quiz_attempt_answers">;
export type QuizAttemptAnswerInsert = TablesInsert<"quiz_attempt_answers">;

// ---------------------------------------------------------------------------
// quizzes
// ---------------------------------------------------------------------------

// quizzes.course_block_id is unique, so this is a single-row lookup.
export function useGetQuizByBlockId(courseBlockId: string | undefined) {
  return useQuery({
    queryKey: ["quizzes", "by-block", courseBlockId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*")
        .eq("course_block_id", courseBlockId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!courseBlockId,
  });
}

export function useGetQuiz(id: string | undefined) {
  return useQuery({
    queryKey: ["quizzes", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("quizzes").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: QuizInsert) => {
      const { data, error } = await supabase.from("quizzes").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["quizzes", "by-block", data.course_block_id] });
    },
  });
}

// ---------------------------------------------------------------------------
// quiz_questions
// ---------------------------------------------------------------------------

export function useListQuizQuestions(quizId: string | undefined) {
  return useQuery({
    queryKey: ["quiz_questions", quizId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("quiz_id", quizId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!quizId,
  });
}

// quiz_questions/quiz_answers are locked by a Postgres trigger once the owning
// course_version is published -- mutating a locked quiz raises a Postgres
// exception that surfaces here as-is via onError, unmodified.
export function useCreateQuizQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: QuizQuestionInsert) => {
      const { data, error } = await supabase.from("quiz_questions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["quiz_questions", data.quiz_id] }),
  });
}

export function useUpdateQuizQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: QuizQuestionUpdate & { id: string }) => {
      const { data, error } = await supabase.from("quiz_questions").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["quiz_questions", data.quiz_id] }),
  });
}

export function useDeleteQuizQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    // quizId is passed in (rather than inferred) so the delete -- which returns
    // no row -- can still invalidate the specific ["quiz_questions", quizId] key
    // that useListQuizQuestions reads.
    mutationFn: async ({ id }: { id: string; quizId: string }) => {
      const { error } = await supabase.from("quiz_questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["quiz_questions", variables.quizId] }),
  });
}

// ---------------------------------------------------------------------------
// quiz_answers -- AUTHOR-SIDE ONLY (includes is_correct)
//
// Only call these from the quiz-authoring/editing UI. The quiz-taking flow
// must use useQuizAnswerChoices below instead.
// ---------------------------------------------------------------------------

export function useListQuizAnswers(questionId: string | undefined) {
  return useQuery({
    queryKey: ["quiz_answers", questionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_answers")
        .select("*")
        .eq("question_id", questionId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!questionId,
  });
}

export function useCreateQuizAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: QuizAnswerInsert) => {
      const { data, error } = await supabase.from("quiz_answers").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["quiz_answers", data.question_id] }),
  });
}

export function useUpdateQuizAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: QuizAnswerUpdate & { id: string }) => {
      const { data, error } = await supabase.from("quiz_answers").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["quiz_answers", data.question_id] }),
  });
}

export function useDeleteQuizAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    // questionId is passed in for the same reason as useDeleteQuizQuestion above.
    mutationFn: async ({ id }: { id: string; questionId: string }) => {
      const { error } = await supabase.from("quiz_answers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["quiz_answers", variables.questionId] }),
  });
}

// ---------------------------------------------------------------------------
// LEARNER-SIDE answer choices (no is_correct) -- use this from any
// quiz-TAKING page instead of useListQuizAnswers.
// ---------------------------------------------------------------------------

export function useQuizAnswerChoices(quizId: string | undefined) {
  return useQuery({
    queryKey: ["quiz_answer_choices", quizId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_quiz_answer_choices", { p_quiz_id: quizId! });
      if (error) throw error;
      return data;
    },
    enabled: !!quizId,
  });
}

// ---------------------------------------------------------------------------
// quiz_attempts / quiz_attempt_answers
// ---------------------------------------------------------------------------

export interface StartQuizAttemptPayload {
  assignment_id: string;
  quiz_id: string;
  /**
   * Optional explicit attempt number. If omitted, this hook computes it as
   * (current max attempt_number for this assignment_id + quiz_id pair) + 1,
   * so callers don't need to track attempt history themselves.
   */
  attempt_number?: number;
}

export function useStartQuizAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignment_id, quiz_id, attempt_number }: StartQuizAttemptPayload) => {
      let nextAttemptNumber = attempt_number;
      if (nextAttemptNumber === undefined) {
        const { data: previous, error: lookupError } = await supabase
          .from("quiz_attempts")
          .select("attempt_number")
          .eq("assignment_id", assignment_id)
          .eq("quiz_id", quiz_id)
          .order("attempt_number", { ascending: false })
          .limit(1);
        if (lookupError) throw lookupError;
        nextAttemptNumber = (previous?.[0]?.attempt_number ?? 0) + 1;
      }
      // organization_id, facility_id, and employee_id are stamped server-side by
      // a trigger that derives them from the assignment row -- the generated
      // Insert type marks those columns required, but the client must not send
      // them, hence the cast below.
      const { data, error } = await supabase
        .from("quiz_attempts")
        .insert({ assignment_id, quiz_id, attempt_number: nextAttemptNumber } as QuizAttemptInsert)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quiz_attempts"] }),
  });
}

export function useSubmitQuizAttemptAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { attempt_id: string; question_id: string; selected_answer_ids: string[] }) => {
      const { data, error } = await supabase
        .from("quiz_attempt_answers")
        .upsert(payload, { onConflict: "attempt_id,question_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["quiz_attempt_answers", data.attempt_id] }),
  });
}

// Supports the invalidation target for grading below (and any review UI that
// needs to display per-question results, including the is_correct the
// grading RPC writes back onto each row).
export function useListQuizAttemptAnswers(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["quiz_attempt_answers", attemptId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quiz_attempt_answers").select("*").eq("attempt_id", attemptId!);
      if (error) throw error;
      return data;
    },
    enabled: !!attemptId,
  });
}

export function useGradeQuizAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { error } = await supabase.rpc("grade_quiz_attempt", { p_attempt_id: attemptId });
      if (error) throw error;
    },
    onSuccess: (_data, attemptId) => {
      // The RPC writes score_percent/passed onto quiz_attempts and is_correct
      // onto quiz_attempt_answers, so both need invalidating.
      queryClient.invalidateQueries({ queryKey: ["quiz_attempts"] });
      queryClient.invalidateQueries({ queryKey: ["quiz_attempt_answers", attemptId] });
    },
  });
}

export interface ListQuizAttemptsFilters {
  assignmentId?: string;
  employeeId?: string;
}

export function useListQuizAttempts(filters: ListQuizAttemptsFilters = {}) {
  return useQuery({
    queryKey: ["quiz_attempts", filters],
    queryFn: async () => {
      let query = supabase.from("quiz_attempts").select("*").order("started_at", { ascending: false });
      if (filters.assignmentId) query = query.eq("assignment_id", filters.assignmentId);
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetQuizAttempt(id: string | undefined) {
  return useQuery({
    queryKey: ["quiz_attempts", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("quiz_attempts").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}
