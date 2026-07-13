begin;
select plan(28);

select has_table('public', 'complaints', 'complaint cases are separate from incidents');
select has_table('public', 'complaint_interviews', 'complaint interviews are structured');
select has_table('public', 'complaint_monitoring_entries', 'nonretaliation monitoring is structured');
select has_table('public', 'complaint_history', 'complaint history is append-only evidence');
select ok(not has_table_privilege('authenticated', 'public.complaints', 'INSERT'), 'browser roles cannot bypass complaint intake commands');
select ok(not has_table_privilege('authenticated', 'public.complaints', 'UPDATE'), 'browser roles cannot bypass complaint lifecycle commands');

insert into public.organizations(id, name, slug, subscription_status)
values ('70000000-0000-4000-8000-000000000001', 'Complaint Org', 'complaint-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000001', 'Complaint Facility', 'PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','70000000-0000-4000-8000-000000000101','authenticated','authenticated','complaints-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','70000000-0000-4000-8000-000000000102','authenticated','authenticated','complaints-auditor@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values
  ('70000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000001','complaints-admin@test.local','Case','Manager','org_admin',true),
  ('70000000-0000-4000-8000-000000000102','70000000-0000-4000-8000-000000000001','complaints-auditor@test.local','Case','Auditor','auditor',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date)
values ('70000000-0000-4000-8000-000000000201','70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000011','Resident','Example',current_date-30);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end
$$;
create temporary table complaint_ids(key text primary key, id uuid) on commit drop;
grant all on complaint_ids to authenticated, service_role;

select pg_temp.act_as('70000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into complaint_ids values ('ordinary', public.create_complaint(
    '70000000-0000-4000-8000-000000000011', now()-interval '2 days', 'phone',
    'family', 'Family Member', '555-0100', false,
    '70000000-0000-4000-8000-000000000201', 'food',
    'Meals have repeatedly arrived cold during the evening service.', 'low',
    'Kitchen supervisor notified.', array[]::text[],
    '70000000-0000-4000-8000-000000000101', null
  ))
$$, 'manager creates a non-incident complaint');
select ok((select incident_id is null from public.complaints where id=(select id from complaint_ids where key='ordinary')), 'ordinary complaint remains distinct from incident workflow');

select lives_ok($$
  insert into complaint_ids values ('reportable', public.create_complaint(
    '70000000-0000-4000-8000-000000000011', now()-interval '1 day', 'portal',
    'anonymous', null, null, true,
    '70000000-0000-4000-8000-000000000201', 'resident_rights',
    'Anonymous complaint alleges abuse and an immediate resident-rights threat.', 'high',
    'Resident protected and administrator notified.', array['abuse']::text[],
    '70000000-0000-4000-8000-000000000101', null
  ))
$$, 'reportability indicators atomically create a complaint and incident');
select ok((select incident_id is not null from public.complaints where id=(select id from complaint_ids where key='reportable')), 'reportable complaint links an incident');
select is((
  select i.incident_type from public.incidents i
  join public.complaints c on c.incident_id=i.id
  where c.id=(select id from complaint_ids where key='reportable')
), 'abuse_allegation', 'abuse indicator maps to reportable incident type');
select is((public.get_qapi_source_metrics(
  '70000000-0000-4000-8000-000000000011', current_date-7, current_date
)->>'complaints')::integer, 2, 'QAPI source metrics automatically count complaints');
select is((public.get_qapi_source_metrics(
  '70000000-0000-4000-8000-000000000011', current_date-7, current_date
)->>'residentRightsComplaints')::integer, 1, 'QAPI identifies resident-rights complaint trends');

select lives_ok($$select public.add_complaint_interview(
  (select id from complaint_ids where key='ordinary'), now()-interval '12 hours',
  'Dining Supervisor', 'Staff witness', 'Confirmed repeated temperature-control failures.'
)$$, 'investigator records a structured interview');
select is((select count(*)::integer from public.complaint_interviews where complaint_id=(select id from complaint_ids where key='ordinary')), 1, 'interview is linked to complaint');
select lives_ok($$select public.add_complaint_corrective_action(
  (select id from complaint_ids where key='ordinary'), 'Correct meal holding process',
  'Validate holding temperatures and retrain evening food-service staff.',
  '70000000-0000-4000-8000-000000000101', 'high', now()+interval '7 days'
)$$, 'complaint creates an owned corrective action');
select is((
  select count(*)::integer from public.complaint_corrective_actions a
  join public.work_items w on w.id=a.work_item_id
  where a.complaint_id=(select id from complaint_ids where key='ordinary') and w.source_type='complaint'
), 1, 'corrective action feeds Operational Work');
select lives_ok($$select public.add_complaint_monitoring_entry(
  (select id from complaint_ids where key='ordinary'), now()-interval '2 hours',
  'Resident reported no retaliation and meal service was respectful.', false, null
)$$, 'nonretaliation monitoring is recorded');
select is((select count(*)::integer from public.complaint_monitoring_entries where complaint_id=(select id from complaint_ids where key='ordinary')), 1, 'monitoring entry is linked to complaint');

select throws_ok($$select public.update_complaint_case(
  (select id from complaint_ids where key='ordinary'), 'closed', now()-interval '1 day',
  '70000000-0000-4000-8000-000000000101',
  'Interview and service records reviewed.', 'Food holding process was not followed.',
  'Temperature checks and retraining assigned.', 'Written response provided to complainant.', now(),
  null, null, null, null, null, true, now()-interval '1 hour', 'Approve complete case closure'
)$$, '55000', null, 'open corrective action blocks complaint closure');

select pg_temp.act_as('70000000-0000-4000-8000-000000000101', 'service_role');
select lives_ok($$
  update public.work_items set state='closed', closure_reason='Corrective action verified', closed_at=now()
  where id=(select work_item_id from public.complaint_corrective_actions where complaint_id=(select id from complaint_ids where key='ordinary'))
$$, 'authorized completion closes the corrective action');
select pg_temp.act_as('70000000-0000-4000-8000-000000000101');
select lives_ok($$select public.update_complaint_case(
  (select id from complaint_ids where key='ordinary'), 'closed', now()-interval '1 day',
  '70000000-0000-4000-8000-000000000101',
  'Interview and service records reviewed.', 'Food holding process was not followed.',
  'Temperature checks and retraining completed.', 'Written response provided to complainant.', now(),
  null, null, null, null, null, true, now()-interval '1 hour', 'Approve evidence-backed case closure'
)$$, 'evidence-backed complaint receives closure approval');
select is((select status from public.complaints where id=(select id from complaint_ids where key='ordinary')), 'closed', 'complaint closes only after workflow completion');
select ok((select closure_approved_at is not null and closure_approved_by='70000000-0000-4000-8000-000000000101' from public.complaints where id=(select id from complaint_ids where key='ordinary')), 'closure approval is attributable');
select is((select count(*)::integer from public.complaint_history where complaint_id=(select id from complaint_ids where key='ordinary')), 5, 'history retains creation, interview, action, monitoring, and closure');

reset role;
select throws_ok($$delete from public.complaint_interviews where complaint_id=(select id from complaint_ids where key='ordinary')$$, '55000', null, 'interview evidence is immutable');
select pg_temp.act_as('70000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.complaints), 2, 'auditor can review in-scope complaint cases');
select throws_ok($$select public.create_complaint(
  '70000000-0000-4000-8000-000000000011', now(), 'email', 'family', 'Blocked User', null, false,
  null, 'service', 'Auditor must not be able to create a complaint case.', 'none', null,
  array[]::text[], null, null
)$$, '42501', null, 'auditor cannot mutate complaint workflow');

select * from finish();
rollback;
