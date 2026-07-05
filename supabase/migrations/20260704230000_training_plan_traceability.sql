-- Backfilled from the live database; see 20260704190000 for why this file is a reconstruction
-- rather than the original recovered SQL.
--
-- Traces a course assignment back to the training plan (and specific plan item) that generated
-- it, when it was created that way, so a facility can answer "why was this employee assigned
-- this course" instead of only seeing a standalone assignment record. Both are nullable and
-- ON DELETE SET NULL: an assignment should survive its originating plan being edited or removed.

alter table public.course_assignments
  add column training_plan_id uuid references public.training_plans(id) on delete set null,
  add column training_plan_item_id uuid references public.training_plan_items(id) on delete set null;

create index course_assignments_training_plan_idx
  on public.course_assignments(training_plan_id) where training_plan_id is not null;
