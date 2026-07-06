-- Quiz question authoring had hooks (useCreateQuizQuestion/useCreateQuizAnswer etc.)
-- but no UI ever built on top of them, and no way for a learner to review *why* an
-- answer was right or wrong after a graded attempt. This migration adds:
--
-- 1. quiz_questions.explanation -- optional author-written feedback text.
-- 2. get_quiz_review(p_attempt_id) -- a SECURITY DEFINER RPC that returns, for one
--    already-graded (submitted_at is not null) attempt the caller is allowed to see,
--    each answer choice's is_correct plus its question's explanation. This mirrors
--    get_quiz_answer_choices' pattern of shielding quiz_answers.is_correct behind a
--    function rather than base-table RLS, except gated on submitted_at so it can
--    never be used to peek at the key before/during an attempt.
--
-- Authorization mirrors grade_quiz_attempt: the owning employee, or an org_admin/
-- facility_manager/trainer in the attempt's organization, or a platform_admin.

alter table public.quiz_questions add column explanation text