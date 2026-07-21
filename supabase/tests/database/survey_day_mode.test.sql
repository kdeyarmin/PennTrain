begin;
select plan(18);

-- Survey Day Mode: activation lifecycle, feature-flag + role gating, RLS scope, snapshot
-- immutability, append-only events, disposition, roster envelope, and close/re-activate.

insert into public.organizations(id,name,slug,subscription_status) values
  ('5d000000-0000-4000-8000-000000000001','Survey Org A','survey-org-a','active'),
  ('5d000000-0000-4000-8000-000000000002','Survey Org B','survey-org-b','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('5d000000-0000-4000-8000-000000000011','5d000000-0000-4000-8000-000000000001','Survey Facility A1','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('5d000000-0000-4000-8000-000000000021'::uuid,'sd-platform@test.local'),
  ('5d000000-0000-4000-8000-000000000022'::uuid,'sd-admin-a@test.local'),
  ('5d000000-0000-4000-8000-000000000023'::uuid,'sd-manager-a@test.local'),
  ('5d000000-0000-4000-8000-000000000024'::uuid,'sd-auditor-a@test.local'),
  ('5d000000-0000-4000-8000-000000000025'::uuid,'sd-admin-b@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('5d000000-0000-4000-8000-000000000021',null,'sd-platform@test.local','Sd','Platform','platform_admin',true),
  ('5d000000-0000-4000-8000-000000000022','5d000000-0000-4000-8000-000000000001','sd-admin-a@test.local','Sd','Admin A','org_admin',true),
  ('5d000000-0000-4000-8000-000000000023','5d000000-0000-4000-8000-000000000001','sd-manager-a@test.local','Sd','Manager A','facility_manager',true),
  ('5d000000-0000-4000-8000-000000000024','5d000000-0000-4000-8000-000000000001','sd-auditor-a@test.local','Sd','Auditor A','auditor',true),
  ('5d000000-0000-4000-8000-000000000025','5d000000-0000-4000-8000-000000000002','sd-admin-b@test.local','Sd','Admin B','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values
  ('5d000000-0000-4000-8000-000000000023','5d000000-0000-4000-8000-000000000011');

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;
create temp table sd(key text primary key, id uuid) on commit drop;
grant all on sd to authenticated, anon, service_role;

-- Anon cannot reach the survey-day surface at all.
select ok(not has_function_privilege('anon','public.activate_survey_day(uuid)','EXECUTE'),
  'anon cannot execute activate_survey_day');
select ok(not has_function_privilege('anon','public.get_survey_day_staff_roster(uuid,text,integer,integer)','EXECUTE'),
  'anon cannot execute get_survey_day_staff_roster');

-- Role and feature-flag gating on the command surface.
select pg_temp.act_as('5d000000-0000-4000-8000-000000000024');
select throws_ok($$ select public.activate_survey_day('5d000000-0000-4000-8000-000000000011') $$,
  '42501', null, 'auditor cannot activate survey day');

select pg_temp.act_as('5d000000-0000-4000-8000-000000000023');
select throws_ok($$ select public.activate_survey_day('5d000000-0000-4000-8000-000000000011') $$,
  '42501', null, 'manager cannot activate while the feature flag is disabled');

-- Platform admin bypasses the org feature flag (support path) and drives the lifecycle.
select pg_temp.act_as('5d000000-0000-4000-8000-000000000021');
insert into sd(key,id) select 'session', (public.activate_survey_day('5d000000-0000-4000-8000-000000000011')).id;
select is((select status from public.survey_day_sessions where id=(select id from sd where key='session')),
  'active', 'activation creates an active session');
select cmp_ok((select count(*)::int from public.survey_day_checklist_items where session_id=(select id from sd where key='session')),
  '>', 0, 'activation snapshots the entrance-conference checklist');
select is((select count(*)::int from public.survey_day_events where session_id=(select id from sd where key='session') and event_type='activated'),
  1, 'activation records exactly one activated event');
select is((public.activate_survey_day('5d000000-0000-4000-8000-000000000011')).id, (select id from sd where key='session'),
  'activation is idempotent and resumes the existing session');

-- Cross-tenant command denial, and a positive workspace read (platform admin bypasses the module gate).
select pg_temp.act_as('5d000000-0000-4000-8000-000000000025');
select throws_ok($$ select public.activate_survey_day('5d000000-0000-4000-8000-000000000011') $$,
  '42501', null, 'a different organization cannot activate the facility');
select pg_temp.act_as('5d000000-0000-4000-8000-000000000021');
select is(jsonb_typeof(public.get_survey_day_workspace((select id from sd where key='session')) -> 'checklist'),
  'array', 'workspace query returns the checklist snapshot');

-- Disposition (platform admin acting as support).
select pg_temp.act_as('5d000000-0000-4000-8000-000000000021');
insert into sd(key,id) select 'item', id from public.survey_day_checklist_items
  where session_id=(select id from sd where key='session') order by sort_order, prompt limit 1;
select is((public.set_survey_day_checklist_disposition((select id from sd where key='session'),(select id from sd where key='item'),'provided','Shown to surveyor')).disposition,
  'provided', 'manager disposition is recorded on the checklist item');

-- Immutability + append-only enforcement (service role bypasses RLS; triggers still fire).
select pg_temp.act_as('5d000000-0000-4000-8000-000000000021','service_role');
select throws_ok($$ update public.survey_day_checklist_items set prompt='drift' where session_id in (select id from sd where key='session') $$,
  '55000', null, 'checklist snapshot prompt cannot drift after activation');
select throws_ok($$ update public.survey_day_events set metadata='{}'::jsonb where session_id in (select id from sd where key='session') $$,
  '55000', null, 'survey day events cannot be updated');
select throws_ok($$ delete from public.survey_day_events where session_id in (select id from sd where key='session') $$,
  '55000', null, 'survey day events cannot be deleted');

-- Roster envelope (rows/count/summary), even with no active employees on file.
select pg_temp.act_as('5d000000-0000-4000-8000-000000000021');
select ok((public.get_survey_day_staff_roster((select id from sd where key='session'),null,1,25) ->> 'count') is not null,
  'staff roster returns an exact count');
select is(jsonb_typeof(public.get_survey_day_staff_roster((select id from sd where key='session'),null,1,25) -> 'rows'),
  'array', 'staff roster returns a rows array');

-- Closure, then a later activation creates a brand new session.
select is((public.close_survey_day((select id from sd where key='session'),'Survey concluded')).status,
  'closed', 'close_survey_day marks the session closed');
select ok((public.activate_survey_day('5d000000-0000-4000-8000-000000000011')).id <> (select id from sd where key='session'),
  'activating after closure creates a new session');

select * from finish();
rollback;
