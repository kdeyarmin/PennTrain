begin;
select plan(8);

-- On-hire exclusion screening: a newly inserted active employee is matched against the
-- active local exclusion snapshots at insert time, behind the default-off
-- 'screening.on_hire_exclusion' release flag. Matches land in the same pending_review
-- queue and critical alert as the monthly run.

select results_eq(
  $$ select rollout_mode, is_enabled from public.release_flags
     where feature_key = 'screening.on_hire_exclusion' $$,
  $$ values ('off'::text, false) $$,
  'the on-hire screening flag is seeded default-off'
);

insert into public.organizations(id,name,slug,subscription_status) values
  ('15000000-0000-4000-8000-000000000001','On Hire Screening Org','on-hire-screening-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('15000000-0000-4000-8000-000000000011','15000000-0000-4000-8000-000000000001','Screening Facility','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values ('00000000-0000-0000-0000-000000000000','15000000-0000-4000-8000-000000000021','authenticated','authenticated','on-hire-platform@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('15000000-0000-4000-8000-000000000021',null,'on-hire-platform@test.local','OnHire','Platform','platform_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

-- Stage and activate a real OIG snapshot through the refresh RPCs so the trigger
-- matches against the same active-pointer path production uses.
create temp table on_hire_ids as
select public.begin_exclusion_source_refresh(
  '15000000-0000-4000-8000-000000000090', 'oig_leie'
) as refresh;
insert into public.exclusion_list_entries (snapshot_id, source_record_key, source, first_name, last_name, raw)
select (refresh->>'snapshotId')::uuid, 'oig-record-1', 'oig_leie', 'Wanda', 'Excludalot', '{}'::jsonb
from on_hire_ids;
select lives_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 1)$sql$,
    (select refresh->>'runId' from on_hire_ids)
  ),
  'an OIG snapshot stages and activates'
);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;

-- Flag off: a matching hire is not screened at insert time.
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status) values
  ('15000000-0000-4000-8000-000000000031','15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000011','Wanda','Excludalot','Aide','active');
select results_eq(
  $$ select count(*)::int from public.exclusion_screening_matches
     where employee_id = '15000000-0000-4000-8000-000000000031' $$,
  array[0],
  'with the flag off, hires are not screened at insert time'
);

select pg_temp.act_as('15000000-0000-4000-8000-000000000021','aal2');
select lives_ok(
  $$ select public.set_release_flag(
       'screening.on_hire_exclusion','global',true,'screening','pgTAP: enable on-hire screening',null) $$,
  'a platform admin with step-up can enable on-hire screening'
);
reset role;

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status) values
  ('15000000-0000-4000-8000-000000000032','15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000011','Wanda','Excludalot','Aide','active');
select results_eq(
  $$ select status, source from public.exclusion_screening_matches
     where employee_id = '15000000-0000-4000-8000-000000000032' $$,
  $$ values ('pending_review'::text, 'oig_leie'::text) $$,
  'a matching hire is screened at insert and queued for human review'
);
select results_eq(
  $$ select count(*)::int from public.alerts
     where employee_id = '15000000-0000-4000-8000-000000000032'
       and alert_type = 'exclusion_match_found' $$,
  array[1],
  'a critical exclusion alert is raised for the matching hire'
);

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status) values
  ('15000000-0000-4000-8000-000000000033','15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000011','Zebulon','Nomatch','Aide','active');
select results_eq(
  $$ select count(*)::int from public.exclusion_screening_matches
     where employee_id = '15000000-0000-4000-8000-000000000033' $$,
  array[0],
  'a non-matching hire produces no review work'
);

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status) values
  ('15000000-0000-4000-8000-000000000034','15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000011','Wanda','Excludalot','Aide','inactive');
select results_eq(
  $$ select count(*)::int from public.exclusion_screening_matches
     where employee_id = '15000000-0000-4000-8000-000000000034' $$,
  array[0],
  'inactive records are not screened at insert time'
);

select * from finish();
rollback;
