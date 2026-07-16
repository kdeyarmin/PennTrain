begin;
select plan(8);

insert into public.organizations (id, name, slug, subscription_status)
values (
  '73000000-0000-4000-8000-000000000001',
  'Monotonic Course Progress Test Org',
  'monotonic-course-progress-test-org',
  'active'
);

insert into public.facilities (id, organization_id, name, facility_type, state)
values (
  '73000000-0000-4000-8000-000000000011',
  '73000000-0000-4000-8000-000000000001',
  'Monotonic Course Progress PCH',
  'PCH',
  'PA'
);

insert into public.employees (
  id,
  organization_id,
  facility_id,
  first_name,
  last_name,
  job_title,
  status
)
values (
  '73000000-0000-4000-8000-000000000021',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000011',
  'Monotonic',
  'Learner',
  'Direct Care Staff',
  'active'
);

insert into public.courses (id, organization_id, title)
values
  (
    '73000000-0000-4000-8000-000000000041',
    '73000000-0000-4000-8000-000000000001',
    'Monotonic Progress Course'
  ),
  (
    '73000000-0000-4000-8000-000000000042',
    '73000000-0000-4000-8000-000000000001',
    'Foreign Progress Course'
  );

insert into public.course_versions (
  id,
  course_id,
  organization_id,
  version_number,
  title
)
values
  (
    '73000000-0000-4000-8000-000000000051',
    '73000000-0000-4000-8000-000000000041',
    '73000000-0000-4000-8000-000000000001',
    1,
    'Monotonic Progress Course'
  ),
  (
    '73000000-0000-4000-8000-000000000052',
    '73000000-0000-4000-8000-000000000042',
    '73000000-0000-4000-8000-000000000001',
    1,
    'Foreign Progress Course'
  );

insert into public.course_blocks (
  id,
  course_version_id,
  organization_id,
  block_type,
  sort_order,
  title,
  body
)
values
  ('73000000-0000-4000-8000-000000000061', '73000000-0000-4000-8000-000000000051', '73000000-0000-4000-8000-000000000001', 'text', 1, 'First', '{"content":"First lesson"}'::jsonb),
  ('73000000-0000-4000-8000-000000000062', '73000000-0000-4000-8000-000000000051', '73000000-0000-4000-8000-000000000001', 'text', 2, 'Middle', '{"content":"Middle lesson"}'::jsonb),
  ('73000000-0000-4000-8000-000000000063', '73000000-0000-4000-8000-000000000051', '73000000-0000-4000-8000-000000000001', 'text', 3, 'Later', '{"content":"Later lesson"}'::jsonb),
  ('73000000-0000-4000-8000-000000000064', '73000000-0000-4000-8000-000000000051', '73000000-0000-4000-8000-000000000001', 'text', 4, 'Almost Final', '{"content":"Almost final lesson"}'::jsonb),
  ('73000000-0000-4000-8000-000000000065', '73000000-0000-4000-8000-000000000051', '73000000-0000-4000-8000-000000000001', 'text', 5, 'Final', '{"content":"Final lesson"}'::jsonb),
  ('73000000-0000-4000-8000-000000000069', '73000000-0000-4000-8000-000000000052', '73000000-0000-4000-8000-000000000001', 'text', 99, 'Foreign', '{"content":"Foreign lesson"}'::jsonb);

select set_config('app.privileged_write', 'on', true);
update public.course_versions
set status = 'published', published_at = now()
where id = '73000000-0000-4000-8000-000000000051';
update public.courses
set current_version_id = '73000000-0000-4000-8000-000000000051',
    status = 'published'
where id = '73000000-0000-4000-8000-000000000041';
select set_config('app.privileged_write', 'off', true);

insert into public.course_assignments (
  id,
  organization_id,
  facility_id,
  employee_id,
  course_id,
  course_version_id
)
values (
  '73000000-0000-4000-8000-000000000031',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000011',
  '73000000-0000-4000-8000-000000000021',
  '73000000-0000-4000-8000-000000000041',
  '73000000-0000-4000-8000-000000000051'
);

create temporary table monotonic_progress_blocks (
  key text primary key,
  id uuid not null unique
) on commit drop;

insert into monotonic_progress_blocks (key, id)
values
  ('first', '73000000-0000-4000-8000-000000000061'),
  ('middle', '73000000-0000-4000-8000-000000000062'),
  ('later', '73000000-0000-4000-8000-000000000063'),
  ('final', '73000000-0000-4000-8000-000000000065');

select set_config('app.privileged_write', 'off', true);

insert into public.course_progress (
  assignment_id,
  percent_complete,
  last_block_id
)
values (
  '73000000-0000-4000-8000-000000000031',
  10,
  (select id from monotonic_progress_blocks where key = 'first')
);

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (10, 'first'::text) $$,
  'the first checkpoint records its initial percentage and block'
);

update public.course_progress
set percent_complete = 80,
    last_block_id = (select id from monotonic_progress_blocks where key = 'later')
where assignment_id = '73000000-0000-4000-8000-000000000031';

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (80, 'later'::text) $$,
  'a forward checkpoint advances both percentage and last block'
);

update public.course_progress
set percent_complete = 20,
    last_block_id = (select id from monotonic_progress_blocks where key = 'first')
where assignment_id = '73000000-0000-4000-8000-000000000031';

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (80, 'later'::text) $$,
  'revisiting the first step cannot lower authoritative progress'
);

update public.course_progress
set percent_complete = 60,
    last_block_id = (select id from monotonic_progress_blocks where key = 'middle')
where assignment_id = '73000000-0000-4000-8000-000000000031';

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (80, 'later'::text) $$,
  'a delayed middle-step save cannot overwrite a newer checkpoint'
);

update public.course_progress
set percent_complete = 0,
    last_block_id = null
where assignment_id = '73000000-0000-4000-8000-000000000031';

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (80, 'later'::text) $$,
  'clearing the cursor cannot erase previously reached progress'
);

update public.course_progress
set percent_complete = 100,
    last_block_id = (select id from monotonic_progress_blocks where key = 'final')
where assignment_id = '73000000-0000-4000-8000-000000000031';

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (100, 'final'::text) $$,
  'a genuinely newer checkpoint can still reach the final step'
);

select throws_ok(
  $$
    update public.course_progress
    set last_block_id = '73000000-0000-4000-8000-000000000069'
    where assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  '23514',
  'course progress last block must belong to the assignment course version',
  'a checkpoint cannot borrow a block from another course version'
);

select results_eq(
  $$
    select cp.percent_complete, b.key
    from public.course_progress cp
    join monotonic_progress_blocks b on b.id = cp.last_block_id
    where cp.assignment_id = '73000000-0000-4000-8000-000000000031'
  $$,
  $$ values (100, 'final'::text) $$,
  'a rejected foreign block leaves the final checkpoint intact'
);

select * from finish();
rollback;
