begin;
select no_plan();

select has_table('public', 'resident_change_events', 'structured change events exist');
select has_table('public', 'resident_change_monitoring_entries', 'monitoring observations are append-only records');
select has_table('public', 'resident_change_follow_ups', 'assigned follow-ups are first-class records');
select has_table('public', 'resident_change_event_history', 'change event history is retained');
select ok(
  not has_table_privilege('authenticated', 'public.resident_change_events', 'UPDATE'),
  'browser roles cannot rewrite structured events directly'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('59000000-0000-4000-8000-000000000001', 'Change Org', 'change-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('59000000-0000-4000-8000-000000000011', '59000000-0000-4000-8000-000000000001', 'Change Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '59000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'change-manager@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '59000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'change-worker@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values
  ('59000000-0000-4000-8000-000000000101', '59000000-0000-4000-8000-000000000001',
   'change-manager@test.local', 'Change', 'Manager', 'org_admin', true),
  ('59000000-0000-4000-8000-000000000102', '59000000-0000-4000-8000-000000000001',
   'change-worker@test.local', 'Change', 'Worker', 'employee', true)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values (
  '59000000-0000-4000-8000-000000000111', '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000011', '59000000-0000-4000-8000-000000000102',
  'Change', 'Worker', 'change-worker@test.local', 'Direct Care Staff', public.pa_today(), 'active'
);
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values (
  '59000000-0000-4000-8000-000000000201', '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000011', 'Jordan', 'Resident', public.pa_today() - 30, 'active'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id, 'role', p_role, 'aal', 'aal1',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table change_ids(key text primary key, id uuid) on commit drop;
grant all on change_ids to authenticated, service_role;

select pg_temp.act_as('59000000-0000-4000-8000-000000000101');
insert into change_ids(key,id) values ('medical', public.create_resident_change_event(
  '59000000-0000-4000-8000-000000000201','infection_symptoms',now()-interval '1 day',
  'New fever and observable decline in function.','Called the provider for instructions.',
  'completed','completed',false,null,null,null,null,null,now(),'not_required',false,false,null,true));
reset role;
select ok((select medical_condition_changed from public.resident_change_events where id=(select id from change_ids where key='medical')),'explicit medical-condition choice persists');
select is((select count(*)::integer from public.resident_compliance_items where resident_id='59000000-0000-4000-8000-000000000201' and item_type='change_medical_evaluation'),1,'creates a medical evaluation independently of the reassessment decision');
select ok((select i.renewal_interval_days is null and i.grace_period_days=0 and i.due_date=public.pa_day(e.identified_at) from public.resident_compliance_items i join public.resident_change_events e on e.medical_evaluation_item_id=i.id where e.id=(select id from change_ids where key='medical')),'internal follow-up target uses the change date and creates no annual cycle');
select throws_ok($$update public.resident_change_events set status='closed' where id=(select id from change_ids where key='medical')$$,'55000',null,'unfinished medical evaluation blocks closure even by a privileged writer');
select throws_ok($$update public.resident_compliance_items set status='compliant',completed_date=public.pa_today() where id=(select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical'))$$,'23514',null,'a completed flag without a signed DME cannot satisfy the medical evaluation');
insert into public.resident_documents(id,organization_id,facility_id,resident_id,storage_bucket,storage_path,file_name,file_type,is_state_form,state_form_source_label,compliance_item_id,uploaded_by_profile_id)
select '59000000-0000-4000-8000-000000000301',i.organization_id,i.facility_id,i.resident_id,'resident-documents','review/medical-change.pdf','medical-change.pdf','application/pdf',true,'PA DHS Personal Care Home DME',i.id,'59000000-0000-4000-8000-000000000101'
from public.resident_compliance_items i join public.resident_change_events e on e.medical_evaluation_item_id=i.id where e.id=(select id from change_ids where key='medical');
select pg_temp.act_as('59000000-0000-4000-8000-000000000101');
select throws_ok($$select public.complete_resident_compliance_item((select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical')),'59000000-0000-4000-8000-000000000301',public.pa_today()-2)$$,'23514',null,'an examination predating the change cannot complete this obligation');
select throws_ok($$select public.complete_resident_compliance_item((select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical')),'59000000-0000-4000-8000-000000000301')$$,'22023',null,'the actual examination date must be supplied rather than stamped today');
select lives_ok($$select public.complete_resident_compliance_item((select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical')),'59000000-0000-4000-8000-000000000301',public.pa_today())$$,'signed DME with a current exam completes the linked obligation');
reset role;
select is((select count(*)::integer from public.resident_compliance_items where resident_id='59000000-0000-4000-8000-000000000201' and item_type='change_medical_evaluation'),1,'completion does not schedule recurring change evaluations');
select lives_ok($$update public.resident_change_events set status='closed',closed_at=now(),final_review_summary='Signed DME reviewed by supervisor' where id=(select id from change_ids where key='medical')$$,'medical closure guard releases only after the evaluation is completed');
-- Model a source form no longer available after a lawful retention purge, without
-- exercising the separate deletion/retention workflow in this evaluation test.
update public.resident_documents set is_state_form=false where id='59000000-0000-4000-8000-000000000301';
select lives_ok($$update public.resident_compliance_items set status='compliant',notes=notes||E'\nRetained completion history' where id=(select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical'))$$,'recalculating unchanged validated history does not demand a purged source form');
select throws_ok($$update public.resident_compliance_items set completed_date=public.pa_today()-1 where id=(select medical_evaluation_item_id from public.resident_change_events where id=(select id from change_ids where key='medical'))$$,'23514',null,'changing historical completion evidence requires validation again');
select ok(not has_function_privilege('authenticated','app_private.create_resident_change_event_core(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid)','EXECUTE'),'clients cannot bypass the explicit medical-evaluation wrapper');
select * from finish();
rollback;
