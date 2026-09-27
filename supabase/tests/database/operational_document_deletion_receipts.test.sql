begin;
select no_plan();
-- SQL objects below are synthetic metadata for RLS testing. The paired native
-- database test uses the Storage API and verifies actual file bytes.
select set_config('storage.allow_delete_query','true',true);
create function pg_temp.id(i integer) returns uuid language sql immutable as $$
  select ('da270000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.path(i integer) returns text language sql immutable as $$
  select pg_temp.id(1)::text || '/' || pg_temp.id(11)::text || '/file-' || i || '.pdf';
$$;
insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Operational deletion A','operational-deletion-a','active'),
  (pg_temp.id(2),'Operational deletion B','operational-deletion-b','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Deletion A','PCH'),(pg_temp.id(12),pg_temp.id(2),'Deletion B','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000'::uuid,pg_temp.id(i),'authenticated','authenticated',
  'operational-deletion-' || i || '@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from generate_series(101,105) i;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select pg_temp.id(i),case when i=105 then null when i=102 then pg_temp.id(2) else pg_temp.id(1) end,
  'operational-deletion-' || i || '@test.local','Deletion',i::text,
  case i when 103 then 'facility_manager' when 104 then 'employee' when 105 then 'platform_admin' else 'org_admin' end,true
from generate_series(101,105) i on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values(pg_temp.id(103),pg_temp.id(11));
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status)
values(pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(104),'Deletion','Employee','Aide','active');
insert into public.employee_credentials(id,organization_id,facility_id,employee_id,credential_type,status,issue_date,expiration_date)
values(pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'tb_screening','compliant',public.pa_today()-30,public.pa_today()+300);
insert into public.work_orders(id,organization_id,facility_id,work_order_number,problem_description,safety_risk,priority,status)
values(pg_temp.id(203),pg_temp.id(1),pg_temp.id(11),'WO-DELETION','Broken fixture','none','routine','open');
insert into public.incidents(id,organization_id,facility_id,incident_type,occurred_at,narrative)
values(pg_temp.id(204),pg_temp.id(1),pg_temp.id(11),'significant_injury',now(),'Document deletion fixture');
insert into public.dhs_violations(id,organization_id,facility_id,inspection_date,poc_due_date,description)
values(pg_temp.id(205),pg_temp.id(1),pg_temp.id(11),public.pa_today(),public.pa_today()+30,'Document deletion fixture');
insert into public.compliance_requirements(id,organization_id,facility_id,category,title)
values(pg_temp.id(206),pg_temp.id(1),pg_temp.id(11),'other','Document deletion fixture');
insert into public.compliance_requirement_instances(id,organization_id,facility_id,requirement_id,due_date,evidence_count)
values(pg_temp.id(207),pg_temp.id(1),pg_temp.id(11),pg_temp.id(206),public.pa_today(),1);

insert into public.training_documents(id,organization_id,facility_id,file_name,storage_bucket,storage_path,file_type)
select pg_temp.id(i),pg_temp.id(1),pg_temp.id(11),'file-' || i || '.pdf',
  case i when 309 then 'course-documents' when 310 then 'learning-packages' else 'external-uploads' end,
  pg_temp.path(case when i=308 then 307 else i end),'application/pdf'
from unnest(array[301,307,308,309,310,311]) i;
insert into public.maintenance_documents(id,organization_id,facility_id,work_order_id,document_type,file_name,storage_path,file_type)
values(pg_temp.id(302),pg_temp.id(1),pg_temp.id(11),pg_temp.id(203),'after_photo','maintenance.pdf',pg_temp.path(302),'application/pdf');
insert into public.employee_credential_documents(id,organization_id,facility_id,employee_id,credential_id,file_name,storage_path,file_type)
values(pg_temp.id(303),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(202),'credential.pdf',pg_temp.path(303),'application/pdf');
insert into public.incident_documents(id,organization_id,facility_id,incident_id,file_name,storage_path,file_type)
values(pg_temp.id(304),pg_temp.id(1),pg_temp.id(11),pg_temp.id(204),'incident.pdf',pg_temp.path(304),'application/pdf');
insert into public.violation_documents(id,organization_id,facility_id,violation_id,file_name,storage_path,file_type)
values(pg_temp.id(305),pg_temp.id(1),pg_temp.id(11),pg_temp.id(205),'violation.pdf',pg_temp.path(305),'application/pdf');
insert into public.compliance_requirement_documents(id,organization_id,facility_id,requirement_id,instance_id,file_name,storage_path,file_type)
values(pg_temp.id(306),pg_temp.id(1),pg_temp.id(11),pg_temp.id(206),pg_temp.id(207),'compliance.pdf',pg_temp.path(306),'application/pdf');
insert into storage.objects(bucket_id,name)
select storage_bucket,storage_path from public.training_documents where organization_id=pg_temp.id(1) group by storage_bucket,storage_path
union all select storage_bucket,storage_path from public.maintenance_documents where organization_id=pg_temp.id(1)
union all select storage_bucket,storage_path from public.employee_credential_documents where organization_id=pg_temp.id(1)
union all select storage_bucket,storage_path from public.incident_documents where organization_id=pg_temp.id(1)
union all select storage_bucket,storage_path from public.violation_documents where organization_id=pg_temp.id(1)
union all select storage_bucket,storage_path from public.compliance_requirement_documents where organization_id=pg_temp.id(1);
-- Same non-deferrable retention contract as certificate/roster references.
create table app_private.operational_deletion_test_reference(document_id uuid references public.training_documents(id) on delete restrict);
insert into app_private.operational_deletion_test_reference values(pg_temp.id(311));
create function pg_temp.act_as(i integer) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(i),'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
end;
$$;

select ok(not has_table_privilege('authenticated','app_private.document_deletions','SELECT'),'receipt storage is private');
select ok(not has_function_privilege('anon','public.begin_document_deletion(text,uuid)','EXECUTE'),'anonymous users cannot start deletion');
select ok(not has_function_privilege('anon','public.list_pending_document_deletions(text,uuid)','EXECUTE'),'anonymous users cannot list receipts');
select ok(not has_function_privilege('anon','public.confirm_document_deletion(text,uuid)','EXECUTE'),'anonymous users cannot confirm');
select ok(not (select prosecdef from pg_proc where oid='public.begin_document_deletion(text,uuid)'::regprocedure),'ordinary table DELETE keeps invoker RLS');
select pg_temp.act_as(101);
with removed as(delete from storage.objects where bucket_id='external-uploads' and name=pg_temp.path(301) returning 1)
select is(count(*)::integer,0,'old storage-first clients cannot remove a registered document') from removed;
select throws_ok($$select * from public.begin_document_deletion('training',pg_temp.id(311))$$,'23503',null,'retention FK rejects deletion before bytes can be touched');
select is((select count(*)::integer from public.list_pending_document_deletions()),0,'rejected metadata delete leaves no receipt');
select is((select count(*)::integer from storage.objects where name=pg_temp.path(311)),1,'retained document bytes remain present');
select throws_ok($$select * from public.begin_document_deletion('training',pg_temp.id(309))$$,'P0002',null,'course bucket remains platform-delete only');
select throws_ok($$select * from public.begin_document_deletion('unknown',pg_temp.id(301))$$,'22023',null,'unsupported document kind cannot select an arbitrary table');

select pg_temp.act_as(103);
select throws_ok($$select * from public.begin_document_deletion('training',pg_temp.id(310))$$,'P0002',null,'learning package deletion does not broaden to facility managers');
select throws_ok($$select * from public.begin_document_deletion('credential',pg_temp.id(303))$$,'P0002',null,'credential deletion remains org-admin only');
select throws_ok($$select * from public.begin_document_deletion('incident',pg_temp.id(304))$$,'P0002',null,'incident deletion remains org-admin only');
select throws_ok($$select * from public.begin_document_deletion('violation',pg_temp.id(305))$$,'P0002',null,'violation deletion remains org-admin only');
select is((select count(*)::integer from public.begin_document_deletion('maintenance',pg_temp.id(302))),1,'assigned manager can begin maintenance cleanup');
select is((select count(*)::integer from public.list_pending_document_deletions('maintenance')),1,'assigned manager retains maintenance retry access');

select pg_temp.act_as(101);
select is((select storage_path from public.begin_document_deletion('training',pg_temp.id(301))),pg_temp.path(301),'training returns the authoritative path');
select is((select count(*)::integer from public.begin_document_deletion('credential',pg_temp.id(303))),1,'credential deletion commits a receipt');
select is((select count(*)::integer from public.begin_document_deletion('incident',pg_temp.id(304))),1,'incident deletion commits a receipt');
select is((select count(*)::integer from public.begin_document_deletion('violation',pg_temp.id(305))),1,'violation deletion commits a receipt');
select is((select count(*)::integer from public.begin_document_deletion('compliance',pg_temp.id(306))),1,'compliance deletion commits a receipt through its existing workflow');
select is((select evidence_count from public.compliance_requirement_instances where id=pg_temp.id(207)),0,'compliance evidence count decrements exactly once');
select is((select count(*)::integer from public.compliance_requirement_events where instance_id=pg_temp.id(207) and event_type='evidence_removed'),1,'compliance removal keeps its audit event');
select throws_ok($$select * from public.begin_document_deletion('compliance',pg_temp.id(306))$$,'P0002',null,'repeated compliance begin is explicit missing-row failure');
select is((select count(*)::integer from public.compliance_requirement_events where instance_id=pg_temp.id(207) and event_type='evidence_removed'),1,'failed duplicate begin cannot duplicate the audit');
select is((select count(*)::integer from public.list_pending_document_deletions()),6,'all families are discoverable without a parent filter');
select is(public.confirm_document_deletion('training',pg_temp.id(301)),false,'zero removed bytes cannot falsely complete a receipt');
select is((select count(*)::integer from storage.objects where bucket_id='external-uploads' and name=pg_temp.path(301)),1,'external upload SELECT survives metadata removal');
select is((select count(*)::integer from storage.objects where bucket_id='credential-documents' and name=pg_temp.path(303)),1,'credential SELECT survives metadata removal');

select pg_temp.act_as(102);
select is((select count(*)::integer from public.list_pending_document_deletions()),0,'another tenant cannot enumerate pending filenames');
select throws_ok($$select public.confirm_document_deletion('training',pg_temp.id(301))$$,'42501',null,'another tenant cannot complete a known receipt');
select throws_ok($$select * from public.begin_document_deletion('training',pg_temp.id(307))$$,'P0002',null,'begin cannot bypass cross-tenant RLS');
select pg_temp.act_as(104);
select is((select count(*)::integer from public.list_pending_document_deletions()),0,'employee cannot enumerate administrative cleanup');
select throws_ok($$select public.confirm_document_deletion('credential',pg_temp.id(303))$$,'42501',null,'owning an employee credential does not grant deletion');
select pg_temp.act_as(103);
select is((select count(*)::integer from public.list_pending_document_deletions('credential')),0,'manager cannot recover org-admin-only credential deletion');

reset role;
insert into public.organization_entitlement_grants(id,organization_id,feature_key,decision,reason)
values(pg_temp.id(401),pg_temp.id(1),'modules.train','deny','Deletion regression'),
  (pg_temp.id(402),pg_temp.id(1),'modules.carebase','deny','Deletion regression');
select pg_temp.act_as(101);
select is((select count(*)::integer from public.list_pending_document_deletions('training')),0,'definer list honors revoked training module');
select throws_ok($$select public.confirm_document_deletion('training',pg_temp.id(301))$$,'42501',null,'definer confirmation honors revoked training module');
reset role;
delete from public.organization_entitlement_grants where id in(pg_temp.id(401),pg_temp.id(402));
insert into app_private.sms_mfa_accounts(profile_id) values(pg_temp.id(101));
select pg_temp.act_as(101);
select is((select count(*)::integer from public.list_pending_document_deletions()),0,'required SMS verification gates receipt reads');
select throws_ok($$select public.confirm_document_deletion('training',pg_temp.id(301))$$,'42501',null,'required SMS verification gates completion');
reset role;
delete from app_private.sms_mfa_accounts where profile_id=pg_temp.id(101);
insert into public.session_lock_events(id,profile_id,organization_id,route_path,lock_reason)
values(pg_temp.id(403),pg_temp.id(101),pg_temp.id(1),'/app/documents','manual');
select pg_temp.act_as(101);
select is((select count(*)::integer from public.list_pending_document_deletions()),0,'idle/manual session lock gates receipt reads');
select throws_ok($$select public.confirm_document_deletion('training',pg_temp.id(301))$$,'42501',null,'session lock gates confirmation');
reset role;
delete from public.session_lock_events where id=pg_temp.id(403);

-- Parent navigation/deletion cannot make cleanup undiscoverable.
insert into storage.objects(bucket_id,name) values('maintenance-documents',pg_temp.path(312));
insert into public.maintenance_documents(id,organization_id,facility_id,work_order_id,document_type,file_name,storage_path,file_type)
values(pg_temp.id(312),pg_temp.id(1),pg_temp.id(11),pg_temp.id(203),'after_photo','cascade.pdf',pg_temp.path(312),'application/pdf');
delete from public.work_orders where id=pg_temp.id(203);
select pg_temp.act_as(101);
select is((select count(*)::integer from public.list_pending_document_deletions('maintenance')),2,'work-order deletion preserves earlier receipts and creates cleanup for cascading documents');
select is((select count(*)::integer from public.list_pending_document_deletions(null,pg_temp.id(12))),0,'explicit facility filter does not escape authorization');
with removed as(delete from storage.objects where name in(pg_temp.path(301),pg_temp.path(303)) returning 1)
select is(count(*)::integer,2,'receipt bridges authorize actual external/credential cleanup after metadata is gone') from removed;
select is(public.confirm_document_deletion('training',pg_temp.id(301)),true,'absence completes the receipt');
select is(public.confirm_document_deletion('credential',pg_temp.id(303)),true,'credential receipt also confirms');
select is(public.confirm_document_deletion('training',pg_temp.id(301)),true,'confirmation retry after a lost response is idempotent');
select throws_ok($$insert into storage.objects(bucket_id,name) values('external-uploads',pg_temp.path(301))$$,'23514',null,'retired path cannot be reused and erased by a delayed retry');

select is((select count(*)::integer from public.begin_document_deletion('training',pg_temp.id(307))),1,'first shared-path metadata reference may be removed');
with removed as(delete from storage.objects where name=pg_temp.path(307) returning 1)
select is(count(*)::integer,0,'another live metadata reference protects shared bytes') from removed;
select is(public.confirm_document_deletion('training',pg_temp.id(307)),false,'shared bytes keep the first receipt pending');
select is((select count(*)::integer from public.begin_document_deletion('training',pg_temp.id(308))),1,'second reference removal has its own receipt');
with removed as(delete from storage.objects where name=pg_temp.path(307) returning 1)
select is(count(*)::integer,1,'last reference removal permits physical cleanup') from removed;
select is(public.confirm_document_deletion('training',pg_temp.id(307)),true,'first shared receipt can now finish');
select is(public.confirm_document_deletion('training',pg_temp.id(308)),true,'second shared receipt independently confirms absence');

reset role;
select ok((select storage_path is null and file_name is null and length(storage_path_sha256)=64 from app_private.document_deletions where document_id=pg_temp.id(301)),'completed receipts redact names and retain only a path hash reservation');
select throws_ok($$update storage.objects set version='replacement' where name=pg_temp.path(311)$$,'23514',null,'privileged Storage finalization cannot replace registered bytes');
select throws_ok($$insert into storage.objects(bucket_id,name,version) values('external-uploads',pg_temp.path(301),'late-upload')$$,'23514',null,'privileged Storage finalization cannot resurrect retired bytes');
select lives_ok($$update storage.objects set last_accessed_at=now() where name=pg_temp.path(311)$$,'Storage bookkeeping remains possible');
select throws_ok($$delete from public.facilities where id=pg_temp.id(11)$$,'23503',null,'pending cleanup cannot be orphaned by facility deletion');
select throws_ok($$delete from public.organizations where id=pg_temp.id(1)$$,'23503',null,'pending cleanup cannot be orphaned by organization purge');
select pg_temp.act_as(105);
select is((select count(*)::integer from public.begin_document_deletion('training',pg_temp.id(309))),1,'platform operator retains course document deletion');
select is((select count(*)::integer from public.list_pending_document_deletions('training')),1,'platform operator can recover the course bucket receipt');
select * from finish();
rollback;
