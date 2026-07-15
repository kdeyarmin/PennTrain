-- Track multi-course AI training-plan generations as their own audit event instead of
-- overloading the single-course create_course kind.
alter table public.course_ai_generations
  drop constraint if exists course_ai_generations_kind_check;

alter table public.course_ai_generations
  add constraint course_ai_generations_kind_check
  check (kind in ('create_course', 'create_training_plan', 'regenerate_block'));
