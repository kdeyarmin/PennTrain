begin;
select no_plan();

insert into public.organizations(id, name, slug, subscription_status) values
  ('62700000-0000-4000-8000-000000000001', 'Agreement Org', 'wet-agreement-org', 'active'),
  ('62700000-0000-4000-8000-000000000002', 'Other Agreement Org', 'other-wet-agreement-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('62700000-0000-4000-8000-000000000011', '62700000-0000-4000-8000-000000000001', 'Agreement Facility', 'PCH'),
  ('62700000-0000-4000-8000-000000000012', '62700000-0000-4000-8000-000000000002', 'Other Agreement Facility', 'ALR');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '62700000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'agreement-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '62700000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'agreement-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '62700000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'other-agreement-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('62700000-0000-4000-8000-000000000101', '62700000-0000-4000-8000-000000000001', 'agreement-admin@test.local', 'Agreement', 'Admin', 'org_admin', true),
  ('62700000-0000-4000-8000-000000000102', '62700000-0000-4000-8000-000000000001', 'agreement-auditor@test.local', 'Agreement', 'Auditor', 'auditor', true),
  ('62700000-0000-4000-8000-000000000103', '62700000-0000-4000-8000-000000000002', 'other-agreement-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('62700000-0000-4000-8000-000000000201', '62700000-0000-4000-8000-000000000001', '62700000-0000-4000-8000-000000000011', 'Avery', 'Resident', public.pa_today(), 'reserved'),
  ('62700000-0000-4000-8000-000000000202', '62700000-0000-4000-8000-000000000002', '62700000-0000-4000-8000-000000000012', 'Other', 'Resident', public.pa_today(), 'active');
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_bucket, storage_path,
  file_name, file_type, document_label
) values
  ('62700000-0000-4000-8000-000000000301', '62700000-0000-4000-8000-000000000001', '62700000-0000-4000-8000-000000000011', '62700000-0000-4000-8000-000000000201', 'resident-documents', 'agreements/contract-v1.pdf', 'contract-v1.pdf', 'application/pdf', 'Resident-home contract v1'),
  ('62700000-0000-4000-8000-000000000302', '62700000-0000-4000-8000-000000000002', '62700000-0000-4000-8000-000000000012', '62700000-0000-4000-8000-000000000202', 'resident-documents', 'agreements/other.pdf', 'other.pdf', 'application/pdf', 'Other resident document');

create temporary table wet_ids(key text primary key,id uuid) on commit drop;
grant all on wet_ids to authenticated,service_role;
select set_config('request.jwt.claims','{"role":"service_role","sub":"62700000-0000-4000-8000-000000000101"}',true);
insert into wet_ids select 'version',(public.publish_resident_agreement_version(
 '62700000-0000-4000-8000-000000000201','resident_home_contract','Resident contract','1.0',
 'Complete resident-home contract terms for this signed version.',now()-interval '10 days',array['resident'],null,null,null)->>'versionId')::uuid;

select ok(not has_function_privilege('anon','public.record_resident_agreement_wet_outcome(uuid,text,text,text,text,text,text,text,text,text,timestamptz,uuid,text,timestamptz,text)','EXECUTE'),'anonymous callers cannot import wet signatures');
select ok(not has_function_privilege('authenticated','app_private.insert_resident_agreement_outcome_evidence(uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz,text,timestamptz,uuid)','EXECUTE'),'browser callers cannot invoke the private evidence writer');
select throws_ok($q$ select public.record_resident_agreement_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'wet_signature_import','I signed the complete contract.',null,null,null,null,null,null)
$q$,'23514',null,'legacy undated wet-import RPC path refuses to invent a signing time');
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,null,'62700000-0000-4000-8000-000000000301')
$q$,'23514',null,'an actual signing timestamp is required');
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days',null)
$q$,'23514',null,'a signed resident document is required');
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,now()+interval '1 day','62700000-0000-4000-8000-000000000301')
$q$,'23514',null,'a future signature cannot be imported');
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days','62700000-0000-4000-8000-000000000302')
$q$,'23514',null,'another resident document cannot establish this signature');
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days','62700000-0000-4000-8000-000000000301',null,now()-interval '3 days','printed')
$q$,'23514',null,'copy delivery cannot precede the documented signature');

insert into wet_ids values('first',public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Avery Resident','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days','62700000-0000-4000-8000-000000000301'));
select is((select signed_at from public.resident_agreement_signatures where id=(select id from wet_ids where key='first')),now()-interval '2 days','actual signing time is stored without replacement by import time');
select is((select created_at from public.resident_agreement_signatures where id=(select id from wet_ids where key='first')),now(),'import time remains independently recorded');
select is((select signed_document_id from public.resident_agreement_signatures where id=(select id from wet_ids where key='first')),'62700000-0000-4000-8000-000000000301'::uuid,'signed document evidence is retained');
insert into wet_ids select 'first_duty',id from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='first');
select is((select due_at from public.resident_regulatory_actions where id=(select id from wet_ids where key='first_duty')),now()+interval '1 day','72-hour rescission window begins at actual signing');
update public.resident_regulatory_actions set status='completed',completed_at=now()-interval '1 day',evidence='Resident exercised the written rescission right.' where id=(select id from wet_ids where key='first_duty');
insert into wet_ids values('earlier',public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Earlier Resident','resident','Self',null,'Earlier original signature documented.',null,null,null,now()-interval '3 days','62700000-0000-4000-8000-000000000301'));
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id='62700000-0000-4000-8000-000000000201' and action_type='contract_rescission_window'),2,'earlier documented signing appends a correction duty');
select is((select details->>'corrects_action_id' from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='earlier')),(select id::text from wet_ids where key='first_duty'),'correction links the immutable original duty');
select is((select status from public.resident_regulatory_actions where id=(select id from wet_ids where key='first_duty')),'completed','completed original rescission evidence remains completed');
select is((select anchor_at from public.resident_regulatory_actions where id=(select id from wet_ids where key='first_duty')),now()-interval '2 days','original source anchor is never rewritten');
insert into wet_ids values('earliest',public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Earliest Resident','resident','Self',null,'Earliest original signature documented.',null,null,null,now()-interval '4 days','62700000-0000-4000-8000-000000000301'));
select is((select status from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='earlier')),'not_applicable','an outdated pending window is retired after appending its correction');
select matches((select exception_basis from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='earlier')),'correction .*; signed document 62700000','retired window records the correction and signed document');
select is((select anchor_at from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='earlier')),now()-interval '3 days','retired pending window retains its actual source anchor');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id='62700000-0000-4000-8000-000000000201' and action_type='contract_rescission_window' and status='pending'),1,'only the earliest documented window remains pending');
select is((select due_at from public.resident_regulatory_actions where source_signature_id=(select id from wet_ids where key='earliest')),now()-interval '1 day','a late import does not restart an elapsed rescission window');
select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Later Resident','resident','Self',null,'Later signature also retained.',null,null,null,now()-interval '1 day','62700000-0000-4000-8000-000000000301');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id='62700000-0000-4000-8000-000000000201' and action_type='contract_rescission_window'),3,'later signer cannot restart the deadline or add a new window');
select throws_ok($q$update public.resident_agreement_signatures set signed_at=now() where id=(select id from wet_ids where key='first')$q$,'55000',null,'stored actual signature evidence is immutable');

-- Old electronic flows retain their original timestamp behavior.
insert into wet_ids values('electronic',public.record_resident_agreement_outcome(
 (select id from wet_ids where key='version'),'signed','Electronic Resident','resident','Self',null,'staff_session','I electronically sign the contract.',null,null,null,null,null,null));
select is((select signed_at from public.resident_agreement_signatures where id=(select id from wet_ids where key='electronic')),now(),'electronic signing retains its current signature time');
select is((select signed_document_id from public.resident_agreement_signatures where id=(select id from wet_ids where key='electronic')),null::uuid,'electronic signature does not invent a wet document reference');

-- The new RPC must retain the manager and tenant boundaries.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"62700000-0000-4000-8000-000000000103","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Other Admin','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days','62700000-0000-4000-8000-000000000301')
$q$,'42501',null,'another tenant manager cannot import a resident signature');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"62700000-0000-4000-8000-000000000102","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($q$ select public.record_resident_agreement_wet_outcome(
 (select id from wet_ids where key='version'),'signed','Read Only Auditor','resident','Self',null,'I signed the complete contract.',null,null,null,now()-interval '2 days','62700000-0000-4000-8000-000000000301')
$q$,'42501',null,'an auditor cannot import a signature');
reset role;
select * from finish();
rollback;
