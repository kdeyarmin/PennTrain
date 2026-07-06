-- Course completion feedback: a learner rates a course (1-5) with an optional
-- comment once they've completed it, giving trainers/admins a quality signal
-- the platform otherwise has no way to collect. One row per course_assignment
-- (a learner can rate a given completion once); no update/delete policy is
-- included since there's no edit/moderation UI built on top of this yet --
-- add those together if that need comes up, rather than shipping unused RLS
-- surface ahead of a consumer.

create table public.course_feedback (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  course_id            uuid not null references public.courses(id) on delete cascade,
  course_assignment_id uuid not null unique references public.course_assignments(id) on delete cascade,
  employee_id          uuid not null references public.employees(id) on delete cascade,
  rating               smallint not null constraint course_feedback_rating_check check (rating between 1 and 5),
  comment              text,
  created_at           timestamptz not null default now()
)