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
);

create index course_feedback_course_idx on public.course_feedback(course_id);

alter table public.course_feedback enable row level security;

create policy course_feedback_select on public.course_feedback for select to authenticated using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin', 'facility_manager', 'trainer', 'auditor'))
);

-- A learner can only rate their own, already-completed assignment for the
-- course they claim -- mirrors the course_assignments_insert-adjacent checks
-- used elsewhere rather than trusting client-supplied course_id/employee_id.
create policy course_feedback_insert on public.course_feedback for insert to authenticated with check (
  public.owns_employee(employee_id)
  and organization_id = (select public.current_org_id())
  and exists (
    select 1 from public.course_assignments ca
    where ca.id = course_feedback.course_assignment_id
      and ca.employee_id = course_feedback.employee_id
      and ca.course_id = course_feedback.course_id
      and ca.status = 'completed'
  )
);
