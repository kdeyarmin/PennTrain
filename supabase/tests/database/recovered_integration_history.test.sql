begin;
select no_plan();

-- Recovered production history must replay cleanly without opening browser
-- access or silently disappearing from the schema-wide audit inventory.
select is((select count(*)::integer from pg_class c
  where c.relnamespace='public'::regnamespace and c.relname in
    ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget') and c.relrowsecurity),3,
  'all recovered integration tables retain row-level security');
select is((select count(*)::integer from app_private.audit_entity_manifest
  where table_name in ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget')
    and audit_mode='not_required' and length(rationale)>100),3,
  'all recovered service-only tables have explicit audit classifications');
select is((select count(*)::integer from app_private.audit_entity_manifest
  where table_name in ('cm_integration_jobs','cm_integration_files') and contains_regulated_data),2,
  'encrypted results and private file bindings are classified as potentially regulated');
select is((select count(*)::integer from pg_class c
  cross join (values ('anon'),('authenticated')) r(role_name)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) a(priv)
  where c.relnamespace='public'::regnamespace and c.relname in
    ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget')
    and has_table_privilege(r.role_name,c.oid,a.priv)),0,
  'no recovered integration table grants browser reads or writes');
select is((select count(*)::integer from pg_policies
  where schemaname='public' and tablename in
    ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget')
    and permissive='PERMISSIVE'),0,
  'no permissive browser policy was added to make schema guards pass');
select is((select count(*)::integer from pg_policies
  where schemaname='public' and tablename in
    ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget')
    and permissive='RESTRICTIVE'
    and policyname in ('sms_mfa_session_required','impersonation_session_lifetime')),6,
  'each recovered table carries both current session restrictions');
select is((select count(*)::integer from pg_proc p
  cross join (values ('anon'),('authenticated')) r(role_name)
  where p.pronamespace='public'::regnamespace and p.proname in
    ('cm_integration_reserve','cm_integration_finish','cm_integration_file_record','cm_integration_file_get','cm_integration_expire_results')
    and has_function_privilege(r.role_name,p.oid,'EXECUTE')),0,
  'all recovered integration RPCs remain unavailable to browser roles');
select is((select count(*)::integer from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname in
    ('cm_integration_reserve','cm_integration_finish','cm_integration_file_record','cm_integration_file_get','cm_integration_expire_results')
    and has_function_privilege('service_role',p.oid,'EXECUTE')),5,
  'the five recovered RPCs remain executable by the service worker');
select is((select public from storage.buckets where id='pennsync-external-integrations'),false,
  'recovered integration storage remains private');

create temporary table integration_recovery_result(value jsonb);
grant all on integration_recovery_result to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into integration_recovery_result(value)
select public.cm_integration_reserve('recovered_history_test',repeat('a',64),'InvokeLLM',
  'first-request',repeat('b',64),'fc000000-0000-4000-8000-000000000001',5);
select is((select value->>'outcome' from integration_recovery_result),'owned',
  'the recovered payload-binding correction permits a first reservation');
select is(public.cm_integration_reserve('recovered_history_test',repeat('a',64),'InvokeLLM',
  'first-request',repeat('b',64),'fc000000-0000-4000-8000-000000000001',5)->>'outcome','pending',
  'an exact in-flight retry does not acquire duplicate provider execution');
select is(public.cm_integration_reserve('recovered_history_test',repeat('a',64),'InvokeLLM',
  'first-request',repeat('c',64),'fc000000-0000-4000-8000-000000000002',5)->>'outcome','conflict',
  'an idempotency key cannot be rebound to another payload');
select is(public.cm_integration_finish((select (value->>'id')::uuid from integration_recovery_result),
  'fc000000-0000-4000-8000-000000000001','failed',null),true,
  'a confirmed pre-execution failure can release its exact ownership claim');
select is(public.cm_integration_reserve('recovered_history_test',repeat('a',64),'InvokeLLM',
  'first-request',repeat('b',64),'fc000000-0000-4000-8000-000000000002',5)->>'outcome','owned',
  'a fresh claim can safely retry a confirmed pre-execution failure');
reset role;
select is((select attempt_count from public.cm_integration_jobs
  where app_id='recovered_history_test' and request_id='first-request'),2,
  'the recovered retry tracks both attempts on one durable receipt');
select is((select attempts from public.cm_integration_daily_budget
  where app_id='recovered_history_test' and subject=repeat('a',64)
    and budget_day=(now() at time zone 'UTC')::date),2,
  'daily quota counts safe retries but not conflicting or in-flight replay');

select * from finish();
rollback;
