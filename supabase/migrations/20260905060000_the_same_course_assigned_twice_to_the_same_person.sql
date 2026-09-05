-- The same course, assigned twice to the same person, with nothing to stop it.
--
-- THE FINDING. Every path that assigns training is a plain per-employee INSERT into
-- `course_assignments` with no check for one that is already open:
--
--   * "Assign Training" on Course Assignments fans out over the selected employees;
--   * applying a training plan fans out over the plan's course items, per employee;
--   * ScheduleDetail and ScheduleSetup use the same bulk-assignment pattern.
--
-- Nothing in the table prevents the result. Re-assigning the annual course to everyone -- which is
-- what an administrator does every year, and what they do again after adding one late hire to the
-- list -- gives every learner who already had it a second identical row. My Training then shows the
-- same course twice, each with its own due date; the compliance rollup counts two obligations where
-- the regulation has one; and completing either leaves the other open and, in time, overdue. Two
-- training plans that both require a course do the same thing on a single click.
--
-- THE GUARANTEE. A partial unique index: one OPEN assignment per (employee, course). Open means
-- `assigned`, `in_progress`, `overdue` or `paused` -- `completed` and `canceled` are deliberately
-- outside it, because annual retraining is exactly "assign it again once the last one is done",
-- and that has to keep working.
--
-- This is in the table rather than in each caller because there are four callers today and the one
-- that gets added next would not know to check. `useCreateCourseAssignment` now reads the existing
-- open row back instead of failing when it hits this, so an administrator re-assigning to a mixed
-- list gets "already had it" rather than an error.
--
-- EXISTING DUPLICATES. Any that already exist have to go before the index can be created, so this
-- keeps one row per (employee, course) and cancels the rest with a stated reason. The one kept is
-- the one with the most progress -- in_progress, then overdue, then assigned, then paused, and the
-- earliest assignment on a tie -- so no learner loses work they have already done, and the due date
-- that survives is the earliest one anybody was told about.
--
-- Rollback: drop the index. The cancelled duplicates are not restored, and should not be.

do $$
declare
  v_deduped integer := 0;
begin
  -- protect_course_assignment_fields reverts a plain status update; this is the same escape hatch
  -- the assignment RPCs set for their own writes.
  perform set_config('app.privileged_write', 'on', true);

  with ranked as (
    select
      id,
      row_number() over (
        partition by employee_id, course_id
        order by
          case status
            when 'in_progress' then 1
            when 'overdue' then 2
            when 'assigned' then 3
            when 'paused' then 4
          end,
          assigned_at,
          id
      ) as rank
    from public.course_assignments
    where status in ('assigned', 'in_progress', 'overdue', 'paused')
  ), cancelled as (
    update public.course_assignments a
    set status = 'canceled',
        canceled_at = now(),
        cancellation_reason = 'Duplicate open assignment for the same course; consolidated onto the earliest open assignment.'
    from ranked r
    where a.id = r.id and r.rank > 1
    returning a.id
  )
  select count(*) into v_deduped from cancelled;

  perform set_config('app.privileged_write', 'off', true);

  raise notice 'Cancelled % duplicate open course assignment(s).', v_deduped;
end;
$$;

create unique index if not exists course_assignments_one_open_per_course_idx
  on public.course_assignments (employee_id, course_id)
  where status in ('assigned', 'in_progress', 'overdue', 'paused');

comment on index public.course_assignments_one_open_per_course_idx is
  'One open assignment per employee per course. completed/canceled are excluded so annual retraining can be assigned again once the last one is done.';
