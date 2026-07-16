begin;
select plan(7);

-- Daily start-reminder for never-started course assignments approaching their due date:
-- covers status='assigned' only (the continuation job owns in-progress work), skips
-- assignments without due dates or with far-off due dates, dedups one nudge per
-- assignment, and its provider delivery stays behind the expanded-delivery flag.

select ok(
  exists (select 1 from cron.job where jobname = 'course-assignment-due-reminders-daily'),
  'the due-reminder job is scheduled'
);
select ok(
  exists (
    select 1 from app_private.system_job_definitions
    where job_key = 'course-assignment-due-reminders'
  ),
  'the due-reminder job is registered in the operational control plane'
);

insert into public.organizations(id,name,slug,subscription_status) values
  ('14000000-0000-4000-8000-000000000001','Due Reminder Org','due-reminder-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000001','Due Reminder Facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values ('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000021','authenticated','authenticated','due-reminder-worker@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('14000000-0000-4000-8000-000000000021','14000000-0000-4000-8000-000000000001','due-reminder-worker@test.local','Due','Worker','employee',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status) values
  ('14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000021','Due','Worker','Aide','active');

-- Assignments require a published course whose current version is also published.
-- Version publication requires at least one non-empty content block, so each version
-- gets a text block before the version and its catalog course are published.
insert into public.courses(id,organization_id,title) values
  ('14000000-0000-4000-8000-000000000041','14000000-0000-4000-8000-000000000001','Due Soon Course'),
  ('14000000-0000-4000-8000-000000000042','14000000-0000-4000-8000-000000000001','Far Future Course'),
  ('14000000-0000-4000-8000-000000000043','14000000-0000-4000-8000-000000000001','Started Course'),
  ('14000000-0000-4000-8000-000000000044','14000000-0000-4000-8000-000000000001','No Deadline Course');
insert into public.course_versions(id,course_id,organization_id,version_number,title) values
  ('14000000-0000-4000-8000-000000000051','14000000-0000-4000-8000-000000000041','14000000-0000-4000-8000-000000000001',1,'Due Soon Course'),
  ('14000000-0000-4000-8000-000000000052','14000000-0000-4000-8000-000000000042','14000000-0000-4000-8000-000000000001',1,'Far Future Course'),
  ('14000000-0000-4000-8000-000000000053','14000000-0000-4000-8000-000000000043','14000000-0000-4000-8000-000000000001',1,'Started Course'),
  ('14000000-0000-4000-8000-000000000054','14000000-0000-4000-8000-000000000044','14000000-0000-4000-8000-000000000001',1,'No Deadline Course');
insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body)
select v.id,'14000000-0000-4000-8000-000000000001','text',0,'Lesson','{"content":"Lesson text"}'::jsonb
from public.course_versions v
where v.id::text like '14000000-0000-4000-8000-0000000000%';
select set_config('app.privileged_write','on',true);
update public.course_versions
set status='published', published_at=now()
where id::text like '14000000-0000-4000-8000-0000000000%';
update public.courses c
set current_version_id = cv.id, status = 'published'
from public.course_versions cv
where cv.course_id = c.id
  and c.id::text like '14000000-0000-4000-8000-0000000000%';
select set_config('app.privileged_write','off',true);
-- Assignment status is a protected compliance field (client-set values are reverted);
-- seed the in_progress fixture under the trusted-path bypass.
select set_config('app.privileged_write','on',true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,due_date,status) values
  ('14000000-0000-4000-8000-000000000061','14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-000000000041','14000000-0000-4000-8000-000000000051',current_date + 3,'assigned'),
  ('14000000-0000-4000-8000-000000000062','14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-000000000042','14000000-0000-4000-8000-000000000052',current_date + 30,'assigned'),
  ('14000000-0000-4000-8000-000000000063','14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-000000000043','14000000-0000-4000-8000-000000000053',current_date + 3,'in_progress'),
  ('14000000-0000-4000-8000-000000000064','14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-000000000044','14000000-0000-4000-8000-000000000054',null,'assigned');
insert into public.course_progress(assignment_id,percent_complete,started_at,updated_at) values
  ('14000000-0000-4000-8000-000000000063',20,now(),now());
select set_config('app.privileged_write','off',true);

select lives_ok(
  $$ select public.queue_course_assignment_due_reminders() $$,
  'the due-reminder queue function runs'
);
select results_eq(
  $$ select count(*)::int from public.notifications
     where notification_type = 'course_assignment_due_soon' $$,
  array[1],
  'only the unstarted assignment due within the window gets a reminder'
);
select results_eq(
  $$ select link from public.notifications
     where notification_type = 'course_assignment_due_soon' $$,
  array['/me/courses/14000000-0000-4000-8000-000000000061'::text],
  'the reminder links to the due-soon assignment'
);
select public.queue_course_assignment_due_reminders();
select results_eq(
  $$ select count(*)::int from public.notifications
     where notification_type = 'course_assignment_due_soon' $$,
  array[1],
  'reruns do not re-nag the same assignment'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.notification_type = 'course_assignment_due_soon' $$,
  array[0],
  'provider delivery for the reminder stays behind the expanded-delivery flag'
);

select * from finish();
rollback;
