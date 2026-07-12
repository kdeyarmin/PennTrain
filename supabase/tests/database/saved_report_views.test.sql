begin;
select plan(10);

-- Saved report views: caller-authorized create/version/publish over the Phase 5
-- saved-reports schema, org-scoped visibility, and owner/org_admin-only deletion.

insert into public.organizations(id,name,slug,subscription_status) values
  ('19000000-0000-4000-8000-000000000001','Report Views Org K','report-views-org-k','active'),
  ('19000000-0000-4000-8000-000000000002','Report Views Org L','report-views-org-l','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('19000000-0000-4000-8000-000000000021'::uuid,'rv-admin-k@test.local'),
  ('19000000-0000-4000-8000-000000000022'::uuid,'rv-manager-k@test.local'),
  ('19000000-0000-4000-8000-000000000023'::uuid,'rv-employee-k@test.local'),
  ('19000000-0000-4000-8000-000000000024'::uuid,'rv-admin-l@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('19000000-0000-4000-8000-000000000021','19000000-0000-4000-8000-000000000001','rv-admin-k@test.local','Report','Admin K','org_admin',true),
  ('19000000-0000-4000-8000-000000000022','19000000-0000-4000-8000-000000000001','rv-manager-k@test.local','Report','Manager K','facility_manager',true),
  ('19000000-0000-4000-8000-000000000023','19000000-0000-4000-8000-000000000001','rv-employee-k@test.local','Report','Employee K','employee',true),
  ('19000000-0000-4000-8000-000000000024','19000000-0000-4000-8000-000000000002','rv-admin-l@test.local','Report','Admin L','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);set local role authenticated;end$$;
create temp table rv_ids(key text primary key, id uuid) on commit drop;
grant all on rv_ids to authenticated;

select pg_temp.act_as('19000000-0000-4000-8000-000000000023');
select throws_ok(
  $$ select public.save_report_definition('Expired list','compliance','{"reportId":"expired-training"}','[]') $$,
  '42501', null,
  'employees cannot save report views'
);

select pg_temp.act_as('19000000-0000-4000-8000-000000000022');
insert into rv_ids(key,id)
select 'view', (public.save_report_definition(
  'Weekly expired training', 'compliance',
  '{"reportId":"expired-training","facilityId":"all"}'::jsonb, '[]'::jsonb)).id;
select results_eq(
  $$ select d.name, d.report_type, (d.current_version_id is not null)
     from public.saved_report_definitions d
     where d.id = (select id from rv_ids where key='view') $$,
  $$ values ('Weekly expired training'::text, 'compliance'::text, true) $$,
  'saving creates a definition pointing at its published version'
);
select results_eq(
  $$ select v.version_number, v.state, (v.configuration_sha256 ~ '^[0-9a-f]{64}$')
     from public.saved_report_versions v
     join public.saved_report_definitions d on d.current_version_id = v.id
     where d.id = (select id from rv_ids where key='view') $$,
  $$ values (1, 'published'::text, true) $$,
  'the first save publishes version 1 with a configuration checksum'
);

select lives_ok(
  $$ select public.save_report_definition(
       'Weekly expired training', 'compliance',
       '{"reportId":"expired-training","facilityId":"f-1"}'::jsonb, '[]'::jsonb) $$,
  'saving the same name again revises the existing view'
);
select results_eq(
  $$ select v.version_number, v.state
     from public.saved_report_versions v
     join public.saved_report_definitions d on d.current_version_id = v.id
     where d.id = (select id from rv_ids where key='view') $$,
  $$ values (2, 'published'::text) $$,
  'a re-save publishes the next version'
);
select results_eq(
  $$ select state from public.saved_report_versions
     where report_definition_id = (select id from rv_ids where key='view')
       and version_number = 1 $$,
  array['superseded'::text],
  'the previous version is superseded'
);

select pg_temp.act_as('19000000-0000-4000-8000-000000000024');
select results_eq(
  $$ select count(*)::int from public.saved_report_definitions $$,
  array[0],
  'saved views are invisible to other organizations'
);
select throws_ok(
  $$ select public.delete_saved_report_definition(
       (select id from rv_ids where key='view')) $$,
  '42501', null,
  'another organization''s admin cannot delete the view'
);

select pg_temp.act_as('19000000-0000-4000-8000-000000000021');
select lives_ok(
  $$ select public.delete_saved_report_definition(
       (select id from rv_ids where key='view')) $$,
  'an org admin can delete a colleague''s view'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.saved_report_definitions
     where id = (select id from rv_ids where key='view') $$,
  array[0],
  'deletion removes the definition and its version history'
);

select * from finish();
rollback;
