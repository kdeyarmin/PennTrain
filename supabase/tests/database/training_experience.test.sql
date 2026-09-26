begin;
select no_plan();
-- Disposable metadata fixtures have no backend bytes. Exercise our DELETE
-- guard after the same Storage API opt-in used by real object removal.
select set_config('storage.allow_delete_query','true',true);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ee260000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act(n integer, assurance text default 'aal2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write', 'off', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id(n), 'role', 'authenticated',
    'aal', assurance, 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;

-- Match complimentary Train provisioning: no live paid/trial CareBase fallback.
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
select v.id,v.name,v.slug,'trial',now()-interval '1 day',p.id from (values
  (pg_temp.id(1),'Yearly plan tenant','experience-test'),
  (pg_temp.id(2),'Other yearly tenant','experience-other')
) v(id,name,slug) cross join public.packages p where p.name='CareMetric Train';
insert into app_private.module_access_terms(organization_id, module_key, source, reason) values
  (pg_temp.id(1), 'modules.train', 'complimentary', 'Disposable yearly training plan test'),
  (pg_temp.id(2), 'modules.train', 'complimentary', 'Disposable yearly training plan test');
select is(public.has_effective_entitlement(pg_temp.id(1),'modules.train'),true,'fixture has complimentary Training access');
select is(public.has_effective_entitlement(pg_temp.id(1),'modules.carebase'),false,'fixture has no CareBase access that could survive Train revocation');
insert into public.facilities(id, organization_id, name, facility_type) values
  (pg_temp.id(11), pg_temp.id(1), 'Assigned facility', 'PCH'),
  (pg_temp.id(12), pg_temp.id(1), 'Unassigned facility', 'PCH'),
  (pg_temp.id(13), pg_temp.id(2), 'Other organization', 'PCH');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.id(n), 'authenticated', 'authenticated', 'experience-' || n || '@test.local',
  'x', now(), '{}', '{}', now(), now() from generate_series(101, 106) n;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, role, email, first_name, last_name, is_active)
select pg_temp.id(n), case when n = 105 then null else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee'
    when 104 then 'trainer' when 105 then 'platform_admin' else 'auditor' end,
  'experience-' || n || '@test.local', 'Year', 'Plan', true
from generate_series(101, 106) n
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
-- Use normal role/facility provisioning. Do not add an artificial organization-wide
-- grant: it would hide the manager cancellation permission regression.
insert into public.facility_assignments(profile_id, facility_id) values
  (pg_temp.id(102), pg_temp.id(11)), (pg_temp.id(104), pg_temp.id(11)),
  (pg_temp.id(103), pg_temp.id(11));
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status) values
  (pg_temp.id(201), pg_temp.id(1), pg_temp.id(11), pg_temp.id(103), 'First', 'Student', 'Aide', 'active'),
  (pg_temp.id(202), pg_temp.id(1), pg_temp.id(11), null, 'Second', 'Student', 'Aide', 'active'),
  (pg_temp.id(203), pg_temp.id(1), pg_temp.id(12), null, 'Other', 'Facility', 'Aide', 'active'),
  (pg_temp.id(204), pg_temp.id(1), pg_temp.id(11), null, 'Former', 'Student', 'Aide', 'terminated'),
  (pg_temp.id(205), pg_temp.id(2), pg_temp.id(13), null, 'Other', 'Tenant', 'Aide', 'active'),
  (pg_temp.id(206), pg_temp.id(1), pg_temp.id(11), null, 'Direct', 'Assignment', 'Aide', 'active');

select set_config('app.privileged_write','off',true);
create temp table experience_results(name text primary key,result jsonb);
grant all on experience_results to authenticated;
insert into storage.objects(bucket_id,name,owner_id) values
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf',pg_temp.id(103)::text),
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/fresh.pdf',pg_temp.id(103)::text),
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/private-staff.pdf',pg_temp.id(104)::text),
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/legacy-forged.pdf',pg_temp.id(104)::text),
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/manager-proof.pdf',pg_temp.id(102)::text),
('external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/ownerless.pdf',null),
('external-uploads',pg_temp.id(2)::text||'/'||pg_temp.id(13)::text||'/wrong-scope.pdf',pg_temp.id(103)::text);
insert into public.training_documents(id,organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type,uploaded_by_profile_id)
values(pg_temp.id(901),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','proof.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf','application/pdf',pg_temp.id(103)),
-- These legacy metadata rows model the previous permissive registration policy.
-- Their employee scope and uploaded_by fields cannot establish actual ownership.
(pg_temp.id(902),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','legacy-forged.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/legacy-forged.pdf','application/pdf',pg_temp.id(103)),
(pg_temp.id(903),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','manager-proof.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/manager-proof.pdf','application/pdf',pg_temp.id(102)),
(pg_temp.id(904),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','ownerless.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/ownerless.pdf','application/pdf',pg_temp.id(103)),
(pg_temp.id(905),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','wrong-scope.pdf','external-uploads',pg_temp.id(2)::text||'/'||pg_temp.id(13)::text||'/wrong-scope.pdf','application/pdf',pg_temp.id(103));
select ok(not has_function_privilege('anon','public.training_experience(text,uuid,uuid,jsonb)','execute'),'anonymous callers cannot read training records');
select ok(not has_table_privilege('authenticated','app_private.training_practice_observations','update'),'clients cannot rewrite signed observations');
select pg_temp.act(102);
select lives_ok($$insert into public.training_documents(id,organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type)
values(pg_temp.id(911),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),'external_certificate','manager-proof.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/manager-proof.pdf','application/pdf')$$,'manager can still register their actual upload for assigned staff');
select lives_ok($$select public.training_experience('save_welcome',pg_temp.id(11),null,'{"welcome_message":"Welcome to your learning program","contact_name":"Training desk","contact_email":"training@example.test"}')$$,'assigned manager can configure learner welcome');
select throws_ok($$select public.training_experience('save_welcome',pg_temp.id(12),null,'{}')$$,'42501',null,'manager cannot configure an unassigned facility');
insert into experience_results values('template',public.training_experience('save_template',pg_temp.id(11),null,'{"title":"Safe equipment check","items":["Identify equipment","Explain the next step"],"instructions":"Observe each step in person."}'));
select throws_ok($$select public.training_experience('save_template',pg_temp.id(11),null,'{"title":"Missing items","items":[null]}')$$,'22023',null,'null checklist labels are rejected');
select throws_ok($$select public.training_experience('observe',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('template_id',(select result->>'id' from experience_results where name='template'),'observed_on',public.pa_today(),'notes','Observed both steps in person.','attested',true,'results','["demonstrated"]'::jsonb))$$,'22023',null,'every checklist step must be assessed');
insert into experience_results values('observation',public.training_experience('observe',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('template_id',(select result->>'id' from experience_results where name='template'),'observed_on',public.pa_today(),'notes','Observed both steps in person.','attested',true,'results','["demonstrated","needs_practice"]'::jsonb)));
select is(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'observations'->0->>'result','needs_practice','a missed step cannot produce an overall demonstrated result');
select lives_ok($$select public.training_experience('archive_template',pg_temp.id(11),null,jsonb_build_object('id',(select result->>'id' from experience_results where name='template')))$$,'checklist can be retired');
select is(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'observations'->0->'items_snapshot'->0->>'label','Identify equipment','retiring checklist preserves signed snapshot');
select pg_temp.act(103);
select is(public.training_experience('welcome')->>'facility_id',pg_temp.id(11)::text,'learner welcome resolves own facility');
select is(public.training_experience('welcome')->'welcome'->>'contact_name','Training desk','learner sees saved support contact');
select is(jsonb_array_length(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'observations'),1,'learner sees own observation');
select throws_ok($$select public.training_experience('records',pg_temp.id(11),pg_temp.id(202))$$,'42501',null,'learner cannot read another staff member');
select throws_ok($$select public.training_experience('save_welcome',pg_temp.id(11),pg_temp.id(201),'{}')$$,'42501',null,'learner cannot edit facility welcome');
select lives_ok($$insert into public.training_documents(id,organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type)
values(pg_temp.id(910),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','fresh.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/fresh.pdf','application/pdf')$$,'learner can register their actual upload without trusting a client uploader field');
select throws_ok($$update public.training_documents set storage_path=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/private-staff.pdf' where id=pg_temp.id(910)$$,'42501',null,'document path mutation is denied at the table privilege boundary');
select is((select storage_path from public.training_documents where id=pg_temp.id(910)),pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/fresh.pdf','learner cannot bypass registration guard by repointing an unsealed document');
select throws_ok($$update public.training_documents set storage_bucket='course-documents' where id=pg_temp.id(910)$$,'42501',null,'document bucket mutation is denied at the table privilege boundary');
select is((select storage_bucket from public.training_documents where id=pg_temp.id(910)),'external-uploads','learner cannot change document bucket after registration');
update storage.objects set owner_id=pg_temp.id(103)::text where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/legacy-forged.pdf';
select is((select owner_id from storage.objects where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/legacy-forged.pdf'),pg_temp.id(104)::text,'learner cannot acquire actual ownership through forged readable legacy metadata');
update storage.objects set owner_id=pg_temp.id(104)::text where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/fresh.pdf';
select is((select owner_id from storage.objects where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/fresh.pdf'),pg_temp.id(103)::text,'learner cannot transfer actual ownership of an unsealed own upload');
select throws_ok($$insert into public.training_documents(organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type,uploaded_by_profile_id)
values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','private-staff.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/private-staff.pdf','application/pdf',pg_temp.id(103))$$,'42501',null,'forging metadata cannot claim another staff member storage object');
select is((select count(*)::int from storage.objects where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/private-staff.pdf'),0,'failed metadata forgery does not grant private file reads');
select throws_ok($$insert into public.training_documents(organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type)
values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','wrong-scope.pdf','external-uploads',pg_temp.id(2)::text||'/'||pg_temp.id(13)::text||'/wrong-scope.pdf','application/pdf')$$,'42501',null,'owned object cannot be registered under a different organization or facility path');
select throws_ok($$insert into public.training_documents(organization_id,facility_id,employee_id,document_type,file_name,storage_bucket,storage_path,file_type)
values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'external_certificate','missing.pdf','external-uploads',pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/missing.pdf','application/pdf')$$,'42501',null,'metadata cannot reserve a path before an actual upload exists');
select is(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'submission_document_ids' @> jsonb_build_array(pg_temp.id(910)),true,'existing-document chooser includes actual own upload');
select is(jsonb_array_length(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'submission_document_ids'),2,'chooser excludes foreign, manager, ownerless and wrong-path legacy metadata');
select throws_ok($$select public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(902),'title','Forged proof','provider','Independent provider','minutes',60,'completed_on',public.pa_today()))$$,'42501',null,'forged legacy uploader metadata cannot seal another person file');
select throws_ok($$select public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(903),'title','Manager proof','provider','Independent provider','minutes',60,'completed_on',public.pa_today()))$$,'42501',null,'learner must upload their own copy when manager provenance cannot be verified');
select throws_ok($$select public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(904),'title','Ownerless proof','provider','Independent provider','minutes',60,'completed_on',public.pa_today()))$$,'42501',null,'ownerless service upload is not treated as learner-owned proof');
select throws_ok($$select public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(905),'title','Wrong facility','provider','Independent provider','minutes',60,'completed_on',public.pa_today()))$$,'42501',null,'forged legacy scope cannot seal an owned object outside the learner facility');
select is(jsonb_array_length(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'external'),0,'rejected proof ownership attempts create no evidence records');
select throws_ok($$select public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(901),'title','Outside class','provider','Independent provider','minutes',60,'completed_on',public.pa_today()+1))$$,'22023',null,'future completion is rejected');
insert into experience_results values('external',public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(901),'title','Outside class','provider','Independent provider','minutes',60,'completed_on',public.pa_today())));
select is(public.training_experience('submit_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('document_id',pg_temp.id(901),'title','Outside class','provider','Independent provider','minutes',60,'completed_on',public.pa_today()))->>'id',(select result->>'id' from experience_results where name='external'),'retry does not duplicate outside evidence');
select is(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'external'->0->>'status','pending','submission waits for independent review');
select throws_ok($$select public.training_experience('review_external',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('id',(select result->>'id' from experience_results where name='external'),'status','verified','review_note','I reviewed my certificate.'))$$,'42501',null,'learner cannot review own outside evidence');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('app.privileged_write','on',true);
update public.profiles set role='trainer' where id=pg_temp.id(103);
select pg_temp.act(103);
select throws_ok($$select public.save_training_workspace_item('review',pg_temp.id(11),pg_temp.id(201),jsonb_build_object('id',(select result->>'id' from experience_results where name='external'),'status','verified','review_note','Self approval through legacy command.'))$$,'42501',null,'legacy review command cannot bypass independent review');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$update public.training_documents set file_name='replacement.pdf' where id=pg_temp.id(901)$$,'55000',null,'submitted document metadata is retained');
select throws_ok($$update storage.objects set version='replacement' where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'55000',null,'trusted storage writes cannot replace submitted bytes');
select throws_ok($$update storage.objects set name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/renamed.pdf' where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'55000',null,'ignoring derived path tokens does not permit renaming submitted proof');
select throws_ok($$update storage.objects set owner_id=pg_temp.id(104)::text where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'55000',null,'trusted storage writes cannot replace submitted ownership');
select throws_ok($$update storage.objects set metadata='{"mimetype":"text/plain"}'::jsonb where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'55000',null,'trusted storage writes cannot rewrite submitted file metadata');
select throws_ok($$delete from storage.objects where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'55000',null,'trusted storage writes cannot delete submitted evidence');
select lives_ok($$update storage.objects set last_accessed_at=now() where bucket_id='external-uploads' and name=pg_temp.id(1)::text||'/'||pg_temp.id(11)::text||'/proof.pdf'$$,'storage access bookkeeping remains available');
select set_config('app.privileged_write','on',true);
update public.profiles set role='employee' where id=pg_temp.id(103);
select pg_temp.act(102);
select lives_ok($$select public.training_experience('review_external',pg_temp.id(11),null,jsonb_build_object('id',(select result->>'id' from experience_results where name='external'),'status','verified','review_note','Checked the uploaded certificate, provider and date.'))$$,'manager independently verifies submitted evidence');
select is(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'external'->0->>'status','verified','reviewed result appears in history');
select is((select count(*)::int from public.certificates where employee_id=pg_temp.id(201)),0,'outside evidence and skill sign-offs issue no course certificates');
select throws_ok($$select public.training_experience('void_observation',pg_temp.id(11),null,jsonb_build_object('id',(select result->>'id' from experience_results where name='observation')))$$,'22023',null,'void requires a correction reason');
select lives_ok($$select public.training_experience('void_observation',pg_temp.id(11),null,jsonb_build_object('id',(select result->>'id' from experience_results where name='observation'),'reason','Recorded against the wrong procedure.'))$$,'manager can void with a correction reason');
select is(jsonb_array_length(public.training_experience('records',pg_temp.id(11),pg_temp.id(201))->'observations'),1,'void retains original record');
select pg_temp.act(102,'aal1');
select throws_ok($$select public.training_experience('records',pg_temp.id(11))$$,'42501',null,'privileged record reads require current assurance');
select throws_ok($$select public.training_experience('save_welcome',pg_temp.id(11),null,'{}')$$,'42501',null,'unverified privileged session cannot change welcome');
reset role;
select set_config('request.jwt.claims','{}',true);
delete from app_private.module_access_terms where organization_id=pg_temp.id(1) and module_key='modules.train';
select pg_temp.act(103);
select throws_ok($$select public.training_experience('welcome')$$,'42501',null,'removed Training entitlement denies records');
select * from finish();
rollback;
