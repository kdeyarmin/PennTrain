begin;
select no_plan();

insert into public.organizations(id,name,slug,package_id)
select v.id,v.name,v.slug,p.id from (values
 ('da250000-0000-4000-8000-000000000001'::uuid,'Report organization','training-report-org'),
 ('da250000-0000-4000-8000-000000000002'::uuid,'Other report organization','training-report-other')
)v(id,name,slug) cross join public.packages p where p.name='CareMetric Train';
insert into app_private.module_access_terms(organization_id,module_key,source,reason)
select id,'modules.train','complimentary','Training report regression fixture' from public.organizations
where id in ('da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000002');
insert into public.facilities(id,organization_id,name,facility_type) values
 ('da250000-0000-4000-8000-000000000011','da250000-0000-4000-8000-000000000001','North PCH','PCH'),
 ('da250000-0000-4000-8000-000000000012','da250000-0000-4000-8000-000000000001','South PCH','PCH'),
 ('da250000-0000-4000-8000-000000000013','da250000-0000-4000-8000-000000000002','Other PCH','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('da250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'report-'||n||'@test.local','x',now(),'{}','{}',now(),now() from generate_series(101,106)n;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
select ('da250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=105 then null else 'da250000-0000-4000-8000-000000000001'::uuid end,
 'report-'||n||'@test.local','Report','Operator',
 case n when 101 then 'org_admin' when 102 then 'trainer' when 103 then 'auditor' when 104 then 'employee' when 105 then 'platform_admin' else 'facility_manager' end,true
from generate_series(101,106)n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.facility_assignments(profile_id,facility_id) values
 ('da250000-0000-4000-8000-000000000102','da250000-0000-4000-8000-000000000011'),
 ('da250000-0000-4000-8000-000000000106','da250000-0000-4000-8000-000000000011');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status,hire_date) values
 ('da250000-0000-4000-8000-000000000201','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000011','North','Learner','Aide','active','2025-01-01'),
 ('da250000-0000-4000-8000-000000000202','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000012','South','Learner','Aide','active','2025-01-01'),
 ('da250000-0000-4000-8000-000000000203','da250000-0000-4000-8000-000000000002','da250000-0000-4000-8000-000000000013','Other','Learner','Aide','active','2025-01-01');
insert into public.courses(id,title,status) values
 ('da250000-0000-4000-8000-000000000301','Annual Safety','draft'),
 ('da250000-0000-4000-8000-000000000302','Rights','draft');
insert into public.course_versions(id,course_id,version_number,title) values
 ('da250000-0000-4000-8000-000000000311','da250000-0000-4000-8000-000000000301',1,'Annual Safety'),
 ('da250000-0000-4000-8000-000000000312','da250000-0000-4000-8000-000000000302',1,'Rights');
insert into public.course_blocks(course_version_id,block_type,sort_order,title,body)
select id,'text',0,'Lesson','{"content":"Training report fixture lesson"}'::jsonb from public.course_versions
where id in ('da250000-0000-4000-8000-000000000311','da250000-0000-4000-8000-000000000312');
update public.course_versions set status='published',published_at=now()
where id in ('da250000-0000-4000-8000-000000000311','da250000-0000-4000-8000-000000000312');
update public.courses c set current_version_id=v.id,status='published' from public.course_versions v
where v.course_id=c.id and c.id in ('da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000302');
create function pg_temp.report_actor(p_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end;
$$;
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,status,assigned_at,completed_at) values
 ('da250000-0000-4000-8000-000000000401','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000011','da250000-0000-4000-8000-000000000201','da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000311','assigned','2025-12-01T15:00:00Z',null);

-- Use the production completion transaction to create the certificate and all dependent
-- evidence, then place those legitimate records in a historical reporting window.
select pg_temp.report_actor('da250000-0000-4000-8000-000000000101');
select lives_ok($$select public.complete_course_assignment('da250000-0000-4000-8000-000000000401')$$,'fixture completion uses the production certificate transaction');
reset role;
select set_config('app.privileged_write','on',true);
update public.course_assignments set completed_at='2026-01-01T02:00:00Z',completion_recorded_at='2026-01-01T02:00:00Z'
where id='da250000-0000-4000-8000-000000000401';
update public.certificates set issued_at='2026-01-03T15:00:00Z',credential_number='REPORT-CERT-1'
where course_assignment_id='da250000-0000-4000-8000-000000000401';
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,status,assigned_at,completed_at) values
 ('da250000-0000-4000-8000-000000000402','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000011','da250000-0000-4000-8000-000000000201','da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000311','assigned','2026-01-02T15:00:00Z',null),
 ('da250000-0000-4000-8000-000000000403','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000011','da250000-0000-4000-8000-000000000201','da250000-0000-4000-8000-000000000302','da250000-0000-4000-8000-000000000312','assigned','2026-01-02T15:00:00Z',null),
 ('da250000-0000-4000-8000-000000000404','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000012','da250000-0000-4000-8000-000000000202','da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000311','in_progress','2026-01-02T15:00:00Z',null),
 ('da250000-0000-4000-8000-000000000405','da250000-0000-4000-8000-000000000002','da250000-0000-4000-8000-000000000013','da250000-0000-4000-8000-000000000203','da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000311','assigned','2026-01-02T15:00:00Z',null);
update public.course_assignments set status='canceled', canceled_at='2026-01-03T15:00:00Z', cancellation_reason='Training enrollment canceled for fixture' where id='da250000-0000-4000-8000-000000000403';
insert into public.course_progress(assignment_id,percent_complete) values ('da250000-0000-4000-8000-000000000404',45)
on conflict(assignment_id) do update set percent_complete=45;
insert into public.certificates(id,organization_id,facility_id,employee_id,course_id,course_assignment_id,issued_at,credential_number,slug) values
 ('da250000-0000-4000-8000-000000000502','da250000-0000-4000-8000-000000000001','da250000-0000-4000-8000-000000000011','da250000-0000-4000-8000-000000000201','da250000-0000-4000-8000-000000000301',null,'2025-01-03T15:00:00Z','REPORT-LEGACY','training-report-legacy');
select set_config('app.privileged_write','off',true);

select ok(not (select prosecdef from pg_proc where oid='public.get_training_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer)'::regprocedure),'report preserves invoker RLS');
select ok(not has_function_privilege('anon','public.get_training_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer)','execute'),'anonymous callers cannot execute reports');

select pg_temp.report_actor('da250000-0000-4000-8000-000000000101');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'total')::int,4,'organization sees four enrollments including annual repeat and cancellation');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'students')::int,2,'distinct students are not confused with enrollment count');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'completion_denominator')::int,3,'canceled enrollment is excluded from completion denominator');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'completed')::int,1,'completion total covers all matching rows');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'certificates')::int,1,'legacy certificate does not duplicate renewal assignments');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>1)->>'total')::int,4,'page limit does not change totals');
select is(jsonb_array_length(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>1)->'rows'),1,'response obeys bounded page size');
select isnt(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>1)->'rows'->0->>'id',public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>1,p_offset=>1)->'rows'->0->>'id','tie-broken paging does not repeat an enrollment');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_facility_id=>'da250000-0000-4000-8000-000000000012')->'rows'->0->>'percent_complete')::int,45,'recorded learner progress is available');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_status=>'completed')->'rows'->0->>'percent_complete')::int,100,'completed enrollment reports 100 percent without progress row');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_course_search=>'SAFETY',p_status=>'assigned')->>'total')::int,1,'course and status filters apply to totals');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_date_basis=>'completed',p_date_from=>'2025-12-31',p_date_through=>'2025-12-31')->>'total')::int,1,'completion window uses Pennsylvania day, not UTC day');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_date_basis=>'completed',p_date_from=>'2026-01-01')->>'total')::int,0,'uncompleted and previous-day records stay out of completion window');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_date_basis=>'certificate',p_date_from=>'2026-01-03',p_date_through=>'2026-01-03')->>'total')::int,1,'certificate date window is independent of enrollment date');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000002')$$,'42501',null,'tenant cannot report on another organization');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_facility_id=>'da250000-0000-4000-8000-000000000013')$$,'42501',null,'mismatched facility is rejected');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_date_from=>'2026-02-01',p_date_through=>'2026-01-01')$$,'22023',null,'inverted dates are rejected');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>501)$$,'22023',null,'oversized normal page is rejected');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>10001)$$,'22023',null,'export size above the reserved limit is rejected');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>10000,p_offset=>1)$$,'22023',null,'export cannot begin after the first enrollment');
select is(jsonb_array_length(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_limit=>10000)->'rows'),4,'reserved export includes all matching enrollments in one response');
select set_config('request.jwt.claims',jsonb_build_object('sub','da250000-0000-4000-8000-000000000101','role','authenticated','aal','aal2','iat',extract(epoch from now()-interval '9 hours')::bigint)::text,true);
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')$$,'42501',null,'stale privileged session cannot export staff records');
select set_config('request.jwt.claims',jsonb_build_object('sub','da250000-0000-4000-8000-000000000101','role','authenticated','aal','aal1','iat',extract(epoch from now())::bigint)::text,true);
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')$$,'42501',null,'unverified privileged session cannot export staff records');

select pg_temp.report_actor('da250000-0000-4000-8000-000000000102');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'total')::int,3,'trainer report inherits assigned-facility RLS');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000106');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'total')::int,3,'facility manager report inherits assigned-facility RLS');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000103');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'total')::int,4,'auditor can report across their organization');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000104');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')$$,'42501',null,'employee cannot invoke management reports');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000105');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000002')->>'total')::int,1,'platform admin explicitly selects another organization');
select throws_ok($$select public.get_training_enrollment_report(null)$$,'42501',null,'platform report cannot silently default to all organizations');

-- Catalog edits must not rewrite a historical enrollment's assigned curriculum label.
reset role;
select set_config('app.privileged_write','on',true);
update public.courses set title='Current replacement catalog title' where id='da250000-0000-4000-8000-000000000301';
select set_config('app.privileged_write','off',true);
select pg_temp.report_actor('da250000-0000-4000-8000-000000000101');
select is(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_status=>'completed')->'rows'->0->>'course','Annual Safety','completed enrollment retains the assigned version title after a catalog rename');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_course_search=>'Annual Safety')->>'total')::int,3,'course filter uses the same assigned title displayed in the report');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_course_search=>'replacement catalog')->>'total')::int,0,'replacement catalog title cannot relabel or match old enrollments');

-- A real transfer moves open enrollments but preserves completed/canceled assignments
-- and their certificates at the original facility. The old manager must retain those
-- authorized report rows without gaining access to the employee's new facility profile.
select pg_temp.report_actor('da250000-0000-4000-8000-000000000101');
select lives_ok($$select public.apply_employee_lifecycle_transition(
 'da250000-0000-4000-8000-000000000201','transfer',public.pa_today(),
 'da250000-0000-4000-8000-000000000012','Transfer learner to South for reporting regression')$$,'production lifecycle transfers the learner');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000106');
select is((select count(*)::integer from public.employees where id='da250000-0000-4000-8000-000000000201'),0,'former manager cannot read transferred employee profile');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'total')::int,2,'former facility retains completed and canceled enrollment history');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'certificates')::int,1,'former facility retains its issued certificate in enrollment report');
select is(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_status=>'completed')->'rows'->0->>'student','Student record da250000-0000-4000-8000-000000000201','historical row uses record identifier without exposing transferred employee name');
select is(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001',p_status=>'completed')->'rows'->0->>'credential_number','REPORT-CERT-1','historical row still links the correct certificate');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')->>'completion_denominator')::int,1,'historical canceled row is excluded from completion denominator');

-- A large export is one result, not a chain of pages. Canceled history avoids open
-- enrollment uniqueness and does not synthesize a completed assignment or certificate.
reset role;
select set_config('app.privileged_write','on',true);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,status,assigned_at,canceled_at,cancellation_reason)
select ('da250000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,
 'da250000-0000-4000-8000-000000000002','da250000-0000-4000-8000-000000000013',
 'da250000-0000-4000-8000-000000000203','da250000-0000-4000-8000-000000000301','da250000-0000-4000-8000-000000000311',
 'canceled','2025-12-01T15:00:00Z','2025-12-02T15:00:00Z','Historical canceled enrollment for export-bound regression'
from generate_series(1,10000)n;
select set_config('app.privileged_write','off',true);
select pg_temp.report_actor('da250000-0000-4000-8000-000000000105');
select is(jsonb_array_length(public.get_training_enrollment_report('da250000-0000-4000-8000-000000000002',p_status=>'canceled',p_limit=>10000)->'rows'),10000,'a full 10000-enrollment export is returned in one response');
select is((public.get_training_enrollment_report('da250000-0000-4000-8000-000000000002')->>'total')::int,10001,'screen pagination still reports totals above the export limit');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000002',p_limit=>10000)$$,'54000',null,'over-limit export fails instead of returning 10000 of 10001 records');

reset role;
insert into public.session_lock_events(profile_id,organization_id,lock_reason,route_path)
values('da250000-0000-4000-8000-000000000101','da250000-0000-4000-8000-000000000001','manual','/app/train');
select pg_temp.report_actor('da250000-0000-4000-8000-000000000101');
select throws_ok($$select public.get_training_enrollment_report('da250000-0000-4000-8000-000000000001')$$,'42501',null,'locked session cannot export training records');
reset role;
select * from finish();
rollback;
