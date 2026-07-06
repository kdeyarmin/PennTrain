-- Applying a training plan to an employee fans out into individual
-- course_assignments rows (one per course-type plan item, see
-- useApplyTrainingPlanToEmployee), but nothing tracked that link back --
-- there was no way to see "which employees are on Plan X" or "how far along
-- is employee Y against Plan X" after the fact. Adds the missing FK columns.

alter table public.course_assignments
  add column training_plan_id uuid references public.training_plans(id) on delete set null,
  add column training_plan_item_id uuid references public.training_plan_items(id) on delete set null