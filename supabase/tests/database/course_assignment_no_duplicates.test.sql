-- pgTAP coverage for 20260905060000: one open assignment per employee per course.
--
-- Every path that assigns training is a per-employee INSERT with no check for one already open --
-- "Assign Training", applying a training plan, the two schedule pages, and incident retraining. So
-- re-assigning the annual course to everyone, which is what an administrator does each year and
-- again after adding one late hire, gave every learner who already had it a second identical row:
-- twice in My Training, two obligations in the rollup where the regulation has one, and completing
-- either left the other to go overdue.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(8);

insert into public.organizations(id, name, slug) values
  ('6f000000-0000-4000-8000-000000000001', 'Assign Org', 'assign-dupe-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('6f000000-0000-4000-8000-000000000011', '6f000000-0000-4000-8000-000000000001', 'Assign Facility', 'PCH');

insert into public.employees(
  id, organization_id, facility_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000011',
  'AD-1', 'Dana', 'Learner', 'assign-learner@test.local', public.pa_today()-200, 'Direct Care', 'active'
);

insert into public.courses(id, organization_id, title) values
  ('6f000000-0000-4000-8000-000000000501', '6f000000-0000-4000-8000-000000000001', 'Annual dementia care'),
  ('6f000000-0000-4000-8000-000000000502', '6f000000-0000-4000-8000-000000000001', 'A different course');
insert into public.course_versions(id, course_id, organization_id, version_number, title) values
  ('6f000000-0000-4000-8000-000000000601', '6f000000-0000-4000-8000-000000000501',
   '6f000000-0000-4000-8000-000000000001', 1, 'Annual dementia care v1'),
  ('6f000000-0000-4000-8000-000000000602', '6f000000-0000-4000-8000-000000000502',
   '6f000000-0000-4000-8000-000000000001', 1, 'A different course v1');
-- A version needs at least one content block before it will publish, and a course can only be
-- assigned once it is published pointing at a published version.
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body)
select v.id, '6f000000-0000-4000-8000-000000000001', 'text', 0, 'Lesson', '{"content":"Lesson text"}'::jsonb
from public.course_versions v
where v.id in ('6f000000-0000-4000-8000-000000000601', '6f000000-0000-4000-8000-000000000602');

select set_config('app.privileged_write', 'on', true);

update public.course_versions set status = 'published', published_at = now()
where id in ('6f000000-0000-4000-8000-000000000601', '6f000000-0000-4000-8000-000000000602');
update public.courses c
set current_version_id = cv.id, status = 'published'
from public.course_versions cv
where cv.course_id = c.id
  and c.id in ('6f000000-0000-4000-8000-000000000501', '6f000000-0000-4000-8000-000000000502');

insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id, status, due_date
) values (
  '6f000000-0000-4000-8000-000000000701', '6f000000-0000-4000-8000-000000000001',
  '6f000000-0000-4000-8000-000000000011', '6f000000-0000-4000-8000-000000000201',
  '6f000000-0000-4000-8000-000000000501', '6f000000-0000-4000-8000-000000000601',
  'assigned', public.pa_today()+30
);

-- ---------------------------------------------------------------------------------------
-- The defect, in one statement: assigning the same course again.
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.course_assignments(
       organization_id, facility_id, employee_id, course_id, course_version_id, status
     ) values (
       '6f000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000011',
       '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000501',
       '6f000000-0000-4000-8000-000000000601', 'assigned') $$,
  '23505',
  'duplicate key value violates unique constraint "course_assignments_one_open_per_course_idx"',
  'the same course cannot be assigned twice while the first one is still open'
);

select is(
  (select count(*)::int from public.course_assignments
   where employee_id = '6f000000-0000-4000-8000-000000000201'
     and course_id = '6f000000-0000-4000-8000-000000000501'),
  1,
  'the learner still has exactly one row for it'
);

-- A different course is a different obligation and is unaffected.
select lives_ok(
  $$ insert into public.course_assignments(
       organization_id, facility_id, employee_id, course_id, course_version_id, status
     ) values (
       '6f000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000011',
       '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000502',
       '6f000000-0000-4000-8000-000000000602', 'assigned') $$,
  'a different course is a different obligation'
);

-- ---------------------------------------------------------------------------------------
-- The rule the index has to leave alone: annual retraining.
-- ---------------------------------------------------------------------------------------
update public.course_assignments
set status = 'completed', completed_at = now(), completion_recorded_at = now()
where id = '6f000000-0000-4000-8000-000000000701';

select lives_ok(
  $$ insert into public.course_assignments(
       organization_id, facility_id, employee_id, course_id, course_version_id, status
     ) values (
       '6f000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000011',
       '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000501',
       '6f000000-0000-4000-8000-000000000601', 'assigned') $$,
  'the same course CAN be assigned again once the last one is completed -- this is what annual retraining is'
);

select is(
  (select count(*)::int from public.course_assignments
   where employee_id = '6f000000-0000-4000-8000-000000000201'
     and course_id = '6f000000-0000-4000-8000-000000000501'),
  2,
  'so the history keeps both: last year completed, this year open'
);

-- A cancelled assignment is outside the index too: withdrawing one and assigning it again works.
update public.course_assignments
set status = 'canceled', canceled_at = now(), cancellation_reason = 'Assigned to the wrong person'
where employee_id = '6f000000-0000-4000-8000-000000000201'
  and course_id = '6f000000-0000-4000-8000-000000000501'
  and status = 'assigned';

select lives_ok(
  $$ insert into public.course_assignments(
       organization_id, facility_id, employee_id, course_id, course_version_id, status
     ) values (
       '6f000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000011',
       '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000501',
       '6f000000-0000-4000-8000-000000000601', 'assigned') $$,
  'and again after a cancellation'
);

-- ---------------------------------------------------------------------------------------
-- Every open status counts, not just the one it was created in.
-- ---------------------------------------------------------------------------------------
update public.course_assignments
set status = 'in_progress'
where employee_id = '6f000000-0000-4000-8000-000000000201'
  and course_id = '6f000000-0000-4000-8000-000000000501'
  and status = 'assigned';

select throws_ok(
  $$ insert into public.course_assignments(
       organization_id, facility_id, employee_id, course_id, course_version_id, status
     ) values (
       '6f000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000011',
       '6f000000-0000-4000-8000-000000000201', '6f000000-0000-4000-8000-000000000501',
       '6f000000-0000-4000-8000-000000000601', 'assigned') $$,
  '23505',
  'duplicate key value violates unique constraint "course_assignments_one_open_per_course_idx"',
  'a course the learner has already started cannot be assigned on top of'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'course_assignments_one_open_per_course_idx'
      and indexdef like '%paused%'
  ),
  'paused is inside the index too -- a paused assignment is still owed'
);

select set_config('app.privileged_write', 'off', true);

select * from finish();
rollback;
