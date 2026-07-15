begin;
select plan(18);

select has_table('public', 'resident_service_requirements', 'service requirements use a dedicated high-volume model');
select has_table('public', 'resident_service_task_instances', 'scheduled service task instances exist');
select has_table('public', 'service_task_alerts', 'service exceptions have a dedicated alert queue');
select has_function(
  'public',
  'record_resident_service_task',
  array['uuid', 'text', 'text', 'boolean', 'uuid'],
  'staff outcomes use a scoped command'
);
select ok(
  not has_table_privilege('authenticated', 'public.resident_service_task_instances', 'UPDATE'),
  'browser roles cannot silently rewrite service history'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('56000000-0000-4000-8000-000000000001', 'Service Org', 'service-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('56000000-0000-4000-8000-000000000011', '56000000-0000-4000-8000-000000000001', 'Service Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '56000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'service-manager@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '56000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'service-worker@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values
  ('56000000-0000-4000-8000-000000000101', '56000000-0000-4000-8000-000000000001',
   'service-manager@test.local', 'Service', 'Manager', 'org_admin', true),
  ('56000000-0000-4000-8000-000000000102', '56000000-0000-4000-8000-000000000001',
   'service-worker@test.local', 'Service', 'Worker', 'employee', true)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values (
  '56000000-0000-4000-8000-000000000111', '56000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000011', '56000000-0000-4000-8000-000000000102',
  'Service', 'Worker', 'service-worker@test.local', 'Direct Care Staff', current_date, 'active'
);
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date
) values (
  '56000000-0000-4000-8000-000000000201', '56000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000011', 'Jamie', 'Resident', current_date
);

insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason,
  version_number, status, content
) values (
  '56000000-0000-4000-8000-000000000301', '56000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000011', '56000000-0000-4000-8000-000000000201',
  'RASP', 'initial', 1, 'draft',
  jsonb_build_object(
    'assessmentInfo', jsonb_build_object('lastSupportPlanDate', current_date::text),
    'section1', jsonb_build_object(
      'items', jsonb_build_object(
        'bathing', jsonb_build_object(
          'planNotApplicable', false,
          'serviceNeedDescription', 'Needs cueing and standby support',
          'planDescription', 'Provide bathing assistance and document exceptions.',
          'planFrequency', 'daily',
          'planResponsibleParty', 'DCS'
        ),
        'dressing', jsonb_build_object(
          'planNotApplicable', true,
          'planDescription', 'Do not create this requirement',
          'planFrequency', 'daily',
          'planResponsibleParty', 'DCS'
        )
      )
    )
  )
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

select pg_temp.act_as('56000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.finalize_resident_assessment_form('56000000-0000-4000-8000-000000000301')$$,
  'finalizing a support plan automatically materializes services'
);
select is(
  (select count(*)::integer from public.resident_service_requirements
   where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'),
  1,
  'only applicable support-plan obligations become requirements'
);
select is(
  (select count(*)::integer from public.resident_service_task_instances
   where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
     and status = 'scheduled'),
  15,
  'daily requirement generates a rolling fifteen-day task horizon'
);
select is(
  (select source_plan_version from public.resident_service_task_instances
   where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
   limit 1),
  1,
  'task instances retain source support-plan version'
);

select pg_temp.act_as('56000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::integer from public.get_resident_service_task_queue(
    current_date, current_date + interval '15 days', null, null
  )),
  15,
  'direct-care employee sees unassigned facility service tasks'
);
select lives_ok(
  $$select public.record_resident_service_task(
    (select id from public.resident_service_task_instances
     where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
       and status = 'scheduled' order by scheduled_start limit 1),
    'resident_refused', 'Resident declined after two offers.', true, null
  )$$,
  'staff can document a resident refusal with supervisor notification'
);
select lives_ok(
  $$select public.record_resident_service_task(
    (select id from public.resident_service_task_instances
     where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
       and status = 'scheduled' order by scheduled_start limit 1),
    'resident_refused', 'Resident declined the scheduled service.', false, null
  )$$,
  'second refusal remains tied to its scheduled instance'
);
select lives_ok(
  $$select public.record_resident_service_task(
    (select id from public.resident_service_task_instances
     where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
       and status = 'scheduled' order by scheduled_start limit 1),
    'resident_refused', 'Resident declined again; manager notified.', true, null
  )$$,
  'third refusal crosses the configurable threshold'
);

select pg_temp.act_as('56000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::integer from public.service_task_alerts
   where resident_id = '56000000-0000-4000-8000-000000000201'
     and alert_type = 'support_plan_review'),
  1,
  'repeated refusals route to support-plan review'
);

reset role;
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason,
  version_number, cloned_from_id, status, content
) values (
  '56000000-0000-4000-8000-000000000302', '56000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000011', '56000000-0000-4000-8000-000000000201',
  'RASP', 'significant_change', 2, '56000000-0000-4000-8000-000000000301', 'draft',
  jsonb_build_object(
    'assessmentInfo', jsonb_build_object('lastSupportPlanDate', (current_date + 1)::text),
    'section1', jsonb_build_object(
      'items', jsonb_build_object(
        'bathing', jsonb_build_object(
          'planNotApplicable', false,
          'serviceNeedDescription', 'Now requires hands-on support',
          'planDescription', 'Provide two-person bathing assistance.',
          'planFrequency', 'daily',
          'planResponsibleParty', 'DCS'
        )
      )
    )
  )
);
select pg_temp.act_as('56000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.finalize_resident_assessment_form('56000000-0000-4000-8000-000000000302')$$,
  'finalizing a revised plan creates a new service generation'
);
select is(
  (select status from public.resident_service_requirements
   where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'),
  'superseded',
  'prior-version requirement is superseded'
);
select ok(
  exists (
    select 1 from public.resident_service_task_instances
    where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
      and status = 'resident_refused'
  ),
  'historical service outcomes are never rewritten'
);
select ok(
  not exists (
    select 1 from public.resident_service_task_instances
    where source_assessment_form_id = '56000000-0000-4000-8000-000000000301'
      and status = 'scheduled'
      and scheduled_start::date >= current_date + 1
  ),
  'future prior-version tasks are superseded at the new effective date'
);

select * from finish();
rollback;
