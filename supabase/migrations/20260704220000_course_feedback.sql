-- Backfilled from the live database; see 20260704190000 for why this file is a reconstruction
-- rather than the original recovered SQL.
--
-- One feedback row per completed course assignment: a 1-5 rating plus an optional comment.

create table public.course_feedback (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  course_id           uuid not null references public.courses(id) on delete cascade,
  course_assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  rating              smallint not null check (rating between 1 and 5),
  comment             text,
  created_at          timestamptz not null default now(),
  constraint course_feedback_course_assignment_id_key unique (course_assignment_id)
);
create index course_feedback_course_idx on public.course_feedback(course_id);

alter table public.course_feedback enable row level security;

-- One submission per completed assignment, and only by the employee who owns it.
create policy course_feedback_insert on public.course_feedback for insert to authenticated with check (
  owns_employee(employee_id)
  and organization_id = (select current_org_id())
  and exists (
    select 1 from public.course_assignments ca
    where ca.id = course_feedback.course_assignment_id
      and ca.employee_id = course_feedback.employee_id
      and ca.course_id = course_feedback.course_id
      and ca.organization_id = course_feedback.organization_id
      and ca.status = 'completed'
  )
);

create policy course_feedback_select on public.course_feedback for select to authenticated using (
  (select is_platform_admin())
  or owns_employee(employee_id)
  or (organization_id = (select current_org_id())
      and (select "current_role"()) in ('org_admin', 'facility_manager', 'trainer', 'auditor'))
);
