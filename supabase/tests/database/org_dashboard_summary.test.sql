begin;
select plan(14);

-- Server-side org dashboard summary: aggregation parity with the app's client-side
-- computation, and SECURITY INVOKER scoping (callers only ever aggregate rows their
-- own RLS lets them see).
--
-- Counting semantics (matching the app's selectCurrentTrainingRecords): renewals
-- insert fresh rows and leave the superseded row behind, so only the CURRENT record
-- per (employee, training type) is tracked -- due_date, then completion_date, then
-- created_at (later wins, nulls lose), with real records beating auto-instantiated
-- 'missing' placeholders on full ties. Practicums track one row per employee: the
-- latest year, preferring completion evidence within that year.
--
-- The PA rulepack engine auto-instantiates 'missing' requirement records for every
-- inserted employee (and keeps them present), so counts involving 'missing' are asserted
-- as PARITY against an independent caller-visible computation, while the statuses only
-- this fixture creates (compliant/due_soon/expired) are asserted exactly.
--
-- Fixture note: employee ...32 deliberately carries renewal history for DASH-BASIC
-- (compliant with no due date, due_soon +60, expired -10, plus the engine's missing
-- placeholder). Only the due_soon row is current; the compliant and expired rows are
-- superseded history and must NOT be counted. The compliant practicum coexists with
-- the engine's auto-created missing placeholder for the same year and must win.

insert into public.organizations(id,name,slug,subscription_status) values
  ('18000000-0000-4000-8000-000000000001','Dashboard Org I','dashboard-org-i','active'),
  ('18000000-0000-4000-8000-000000000002','Dashboard Org J','dashboard-org-j','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','Dashboard Facility I1','PCH'),
  ('18000000-0000-4000-8000-000000000012','18000000-0000-4000-8000-000000000001','Dashboard Facility I2','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('18000000-0000-4000-8000-000000000021'::uuid,'dashboard-admin-i@test.local'),
  ('18000000-0000-4000-8000-000000000022'::uuid,'dashboard-admin-j@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('18000000-0000-4000-8000-000000000021','18000000-0000-4000-8000-000000000001','dashboard-admin-i@test.local','Dash','Admin I','org_admin',true),
  ('18000000-0000-4000-8000-000000000022','18000000-0000-4000-8000-000000000002','dashboard-admin-j@test.local','Dash','Admin J','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status,trainer_status,administers_medications) values
  ('18000000-0000-4000-8000-000000000031','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','Trainer','One','Trainer','active',true,false),
  ('18000000-0000-4000-8000-000000000032','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','Aide','Two','Aide','active',false,true),
  ('18000000-0000-4000-8000-000000000033','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012','Former','Three','Aide','inactive',false,false);

insert into public.training_types(id,organization_id,code,name,category,applies_to_trainers) values
  ('18000000-0000-4000-8000-000000000041','18000000-0000-4000-8000-000000000001','DASH-TRAIN','Trainer Recert','annual',true),
  ('18000000-0000-4000-8000-000000000042','18000000-0000-4000-8000-000000000001','DASH-BASIC','Basic Training','annual',false);

select set_config('app.privileged_write','on',true);
insert into public.employee_training_records(organization_id,facility_id,employee_id,training_type_id,status,due_date,document_required) values
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000032','18000000-0000-4000-8000-000000000042','compliant',null,false),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000031','18000000-0000-4000-8000-000000000041','due_soon',current_date + 15,false),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000032','18000000-0000-4000-8000-000000000042','due_soon',current_date + 60,false),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012','18000000-0000-4000-8000-000000000032','18000000-0000-4000-8000-000000000042','expired',current_date - 10,false),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012','18000000-0000-4000-8000-000000000033','18000000-0000-4000-8000-000000000042','missing',null,true);
insert into public.practicums(organization_id,facility_id,employee_id,practicum_year,status) values
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000032',2026,'compliant');
select set_config('app.privileged_write','off',true);

insert into public.alerts(organization_id,facility_id,alert_type,title,message,severity,status) values
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','overdue','Critical A','Critical alert','critical','open'),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','due_30','Warning B','Warning alert','warning','open'),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012','overdue','Old C','Dismissed alert','critical','dismissed');

insert into public.training_documents(organization_id,facility_id,file_name,storage_bucket,storage_path,file_type,document_type,created_at) values
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','fresh.pdf','documents','18/fresh.pdf','application/pdf','certificate',now()),
  ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','stale.pdf','documents','18/stale.pdf','application/pdf','roster',now() - interval '30 days');

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);set local role authenticated;end$$;

select pg_temp.act_as('18000000-0000-4000-8000-000000000021');
-- 1 = the compliant practicum. Employee ...32's compliant training row is superseded
-- renewal history (the due_soon +60 row is that requirement's current record).
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'compliantCount')::int, 1,
  'compliant requirements count current training records and practicums together'
);
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'dueSoon30Count')::int, 1,
  'the 30-day bucket counts due_soon items due within 30 days'
);
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'dueSoon90Count')::int, 2,
  'the 90-day bucket includes the 30-day items'
);
-- The expired -10 row for employee ...32 is superseded by that requirement's
-- due_soon +60 renewal: renewal history must not read as a live expired gap.
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'expiredCount')::int, 0,
  'superseded renewal history is not counted as expired'
);
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'missingCount')::int,
  (
    (select count(*)::int from (
      select distinct on (employee_id, training_type_id) status
      from public.employee_training_records
      order by employee_id, training_type_id,
        due_date desc nulls last, completion_date desc nulls last, created_at desc,
        (status = 'missing'), id
    ) cur where cur.status = 'missing')
    + (select count(*)::int from (
      select distinct on (employee_id) status
      from public.practicums
      order by employee_id, practicum_year desc,
        completion_date desc nulls last, due_date desc nulls last, created_at desc,
        (status = 'missing'), id
    ) cur where cur.status = 'missing')
  ),
  'missing count matches the caller-visible current missing requirements'
);
select is(
  (public.get_org_dashboard_summary()->'compliance'->>'totalTrackedCount')::int,
  (
    select (c->>'compliantCount')::int + (c->>'dueSoonCount')::int
      + (c->>'expiredCount')::int + (c->>'missingCount')::int
    from (select public.get_org_dashboard_summary()->'compliance' as c) s
  ),
  'the tracked total is internally consistent with its status buckets'
);
select is(
  public.get_org_dashboard_summary()->'staff',
  '{"totalEmployees":2,"totalMedAdminStaff":1,"trainersDueForRecert":1}'::jsonb,
  'staff counts cover active employees, med-admin staff, and trainers due for recert'
);
select is(
  (public.get_org_dashboard_summary()->'alerts'->>'openCount')::int, 2,
  'open alert count excludes dismissed alerts'
);
select is(
  (public.get_org_dashboard_summary()->'alerts'->>'criticalCount')::int, 1,
  'critical count covers open critical alerts only'
);
select is(
  jsonb_array_length(public.get_org_dashboard_summary()->'alerts'->'recent'), 2,
  'recent alerts list the open alerts'
);
select is(
  public.get_org_dashboard_summary()->'uploads'->>'recentCount', '1',
  'recent uploads count the 14-day window only'
);
select is(
  (
    select x->>'complianceScore'
    from jsonb_array_elements(public.get_org_dashboard_summary()->'facilities') x
    where x->>'id' = '18000000-0000-4000-8000-000000000011'
  ),
  (
    with current_training as (
      select distinct on (employee_id, training_type_id) facility_id, status
      from public.employee_training_records
      order by employee_id, training_type_id,
        due_date desc nulls last, completion_date desc nulls last, created_at desc,
        (status = 'missing'), id
    ),
    current_practicums as (
      select distinct on (employee_id) facility_id, status
      from public.practicums
      order by employee_id, practicum_year desc,
        completion_date desc nulls last, due_date desc nulls last, created_at desc,
        (status = 'missing'), id
    ),
    tracked as (
      select status from current_training
      where facility_id = '18000000-0000-4000-8000-000000000011'
        and status in ('compliant','due_soon','expired','missing')
      union all
      select status from current_practicums
      where facility_id = '18000000-0000-4000-8000-000000000011'
        and status in ('compliant','due_soon','expired','missing')
    )
    select round((count(*) filter (where status = 'compliant')) * 100.0 / count(*))::text
    from tracked
  ),
  'per-facility scores divide compliant by relevant tracked current requirements'
);
select is(
  (
    select x->>'complianceScore'
    from jsonb_array_elements(public.get_org_dashboard_summary()->'facilities') x
    where x->>'id' = '18000000-0000-4000-8000-000000000012'
  ), '0',
  'a facility with no compliant requirements scores zero'
);

select pg_temp.act_as('18000000-0000-4000-8000-000000000022');
select is(
  public.get_org_dashboard_summary()->'compliance'->>'totalTrackedCount', '0',
  'security invoker scoping keeps other organizations'' data out of the summary'
);
reset role;

select * from finish();
rollback;
