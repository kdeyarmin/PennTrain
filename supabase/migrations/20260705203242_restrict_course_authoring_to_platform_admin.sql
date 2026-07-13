-- Restrict course authoring (create/edit/delete) to platform_admin only.
--
-- Product decision: org_admin/trainer retain the ability to browse the training content catalog and
-- enroll/assign employees into existing courses (course_assignments / course_progress are
-- untouched by this migration), but lose the ability to author courses themselves. Course
-- authoring becomes exclusive to platform_admin, who will get an AI-assisted authoring
-- workflow in a follow-up migration.
--
-- This migration ONLY rewrites the INSERT/UPDATE/DELETE policies on the 7 course-authoring
-- tables below, dropping the "org_admin/trainer" OR-branch so the write check becomes
-- `(select public.is_platform_admin())` alone. SELECT policies on these tables are left
-- byte-for-byte unchanged (org members still need read access to browse courses for
-- enrollment purposes; quiz_answers/quiz_question_explanations SELECT stays
-- org_admin/trainer/auditor-only as before). course_assignments/course_progress policies are
-- a separate, unrelated policy set and are not touched here.

-- ========== courses ==========

drop policy courses_insert on public.courses;
create policy courses_insert on public.courses for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy courses_update on public.courses;
create policy courses_update on public.courses for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy courses_delete on public.courses;
create policy courses_delete on public.courses for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== course_versions ==========

drop policy course_versions_insert on public.course_versions;
create policy course_versions_insert on public.course_versions for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy course_versions_update on public.course_versions;
create policy course_versions_update on public.course_versions for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy course_versions_delete on public.course_versions;
create policy course_versions_delete on public.course_versions for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== course_blocks ==========

drop policy course_blocks_insert on public.course_blocks;
create policy course_blocks_insert on public.course_blocks for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy course_blocks_update on public.course_blocks;
create policy course_blocks_update on public.course_blocks for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy course_blocks_delete on public.course_blocks;
create policy course_blocks_delete on public.course_blocks for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== quizzes ==========

drop policy quizzes_insert on public.quizzes;
create policy quizzes_insert on public.quizzes for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy quizzes_update on public.quizzes;
create policy quizzes_update on public.quizzes for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy quizzes_delete on public.quizzes;
create policy quizzes_delete on public.quizzes for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== quiz_questions ==========

drop policy quiz_questions_insert on public.quiz_questions;
create policy quiz_questions_insert on public.quiz_questions for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy quiz_questions_update on public.quiz_questions;
create policy quiz_questions_update on public.quiz_questions for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy quiz_questions_delete on public.quiz_questions;
create policy quiz_questions_delete on public.quiz_questions for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== quiz_answers ==========
-- (SELECT policy unchanged: org_admin/trainer/auditor may still read answers.)

drop policy quiz_answers_insert on public.quiz_answers;
create policy quiz_answers_insert on public.quiz_answers for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy quiz_answers_update on public.quiz_answers;
create policy quiz_answers_update on public.quiz_answers for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

drop policy quiz_answers_delete on public.quiz_answers;
create policy quiz_answers_delete on public.quiz_answers for delete to authenticated using (
  (select public.is_platform_admin())
);

-- ========== quiz_question_explanations ==========
-- (SELECT policy unchanged: org_admin/trainer/auditor may still read explanations.)

drop policy quiz_question_explanations_insert on public.quiz_question_explanations;
create policy quiz_question_explanations_insert on public.quiz_question_explanations for insert to authenticated with check (
  (select is_platform_admin())
);

drop policy quiz_question_explanations_update on public.quiz_question_explanations;
create policy quiz_question_explanations_update on public.quiz_question_explanations for update to authenticated
using (
  (select is_platform_admin())
)
with check (
  (select is_platform_admin())
);

drop policy quiz_question_explanations_delete on public.quiz_question_explanations;
create policy quiz_question_explanations_delete on public.quiz_question_explanations for delete to authenticated using (
  (select is_platform_admin())
);
