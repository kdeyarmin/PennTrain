begin;
select plan(11);

select has_function('public', 'get_resident_clinical_chart', array['uuid', 'text'], 'consolidated chart summary RPC exists');
select ok(
  exists(select 1 from public.integration_api_scope_definitions where scope_key = 'clinical.writeback' and is_active = true),
  'FHIR write-back scope is defined and enabled'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('d1000000-0000-4000-8000-000000000001', 'Chart Org A', 'chart-org-a', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 'Chart Facility A1', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'd-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'd-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'd-trainer@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d1000000-0000-4000-8000-000000000101', 'd1000000-0000-4000-8000-000000000001', 'd-admin@test.local', 'Dana', 'Admin', 'org_admin', true),
  ('d1000000-0000-4000-8000-000000000102', 'd1000000-0000-4000-8000-000000000001', 'd-emp@test.local', 'Dee', 'Aide', 'employee', true),
  ('d1000000-0000-4000-8000-000000000105', 'd1000000-0000-4000-8000-000000000001', 'd-trainer@test.local', 'Deb', 'Trainer', 'trainer', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status) values
  ('d1000000-0000-4000-8000-000000000112', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000102', 'Dee', 'Aide', 'd-emp@test.local', 'Direct Care Staff', current_date, 'active');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('d1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'Devon', 'Resident', current_date - 30, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- Staff document a vital and a note --------------------------------------------------
select pg_temp.act_as('d1000000-0000-4000-8000-000000000102');
select lives_ok($$select public.record_clinical_observation(
  'd1000000-0000-4000-8000-000000000301', 'heart_rate', now(), 72, null, null, '/min')$$,
  'employee records a vital observation');
select lives_ok($$select public.save_clinical_progress_note(
  'd1000000-0000-4000-8000-000000000301', 'nursing', 'Resident stable.', now())$$,
  'employee drafts a progress note');

-- Consolidated chart summary + access logging ----------------------------------------
select pg_temp.act_as('d1000000-0000-4000-8000-000000000101');
select is(
  (public.get_resident_clinical_chart('d1000000-0000-4000-8000-000000000301', 'Care review')->'resident'->>'id'),
  'd1000000-0000-4000-8000-000000000301',
  'chart summary returns the resident identity'
);
select ok(
  jsonb_array_length(public.get_resident_clinical_chart('d1000000-0000-4000-8000-000000000301')->'latestVitals') >= 1,
  'chart summary includes the latest vital observation'
);

-- Unified timeline includes clinical events ------------------------------------------
select ok(
  exists(select 1 from public.get_resident_timeline('d1000000-0000-4000-8000-000000000301') where event_type = 'vital'),
  'the resident timeline includes native vital events'
);
select ok(
  exists(select 1 from public.get_resident_timeline('d1000000-0000-4000-8000-000000000301') where event_type = 'progress_note'),
  'the resident timeline includes progress-note events'
);

-- Access control ---------------------------------------------------------------------
select pg_temp.act_as('d1000000-0000-4000-8000-000000000105');
select throws_ok(
  $$select public.get_resident_clinical_chart('d1000000-0000-4000-8000-000000000301')$$,
  '42501', null, 'a trainer cannot read the consolidated clinical chart'
);

reset role;
select ok(
  (select count(*) from app_private.clinical_access_log
   where resident_id = 'd1000000-0000-4000-8000-000000000301' and access_kind = 'view_chart') >= 1,
  'consolidated chart reads are written to the HIPAA access log'
);
select is(
  (select minimum_necessary_reason from app_private.clinical_access_log
   where resident_id = 'd1000000-0000-4000-8000-000000000301' and minimum_necessary_reason is not null limit 1),
  'Care review', 'the minimum-necessary reason is captured'
);

select * from finish();
rollback;
