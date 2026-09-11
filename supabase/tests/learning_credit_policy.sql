-- Synthetic creation lifecycle only. The entire fixture is rolled back.
begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$select ('acd00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug) values(pg_temp.cid(10),'Credit policy fixture organization','credit-policy-fixture');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.cid(n),'authenticated','authenticated','credit-policy-'||n||'@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false
  from generate_series(1,3) n;
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id in(pg_temp.cid(1),pg_temp.cid(2));
update public.profiles set role='employee',is_active=true,organization_id=pg_temp.cid(10) where id=pg_temp.cid(3);
select set_config('app.privileged_write','',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
  (pg_temp.cid(100),pg_temp.cid(1),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(101),pg_temp.cid(1),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(102),pg_temp.cid(2),now()-interval '1 hour',now(),'aal1'),
  (pg_temp.cid(103),pg_temp.cid(3),now()-interval '1 hour',now(),'aal1');
create function pg_temp.actor(p_user integer default 1,p_session integer default 100) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(p_user),'role','authenticated','session_id',pg_temp.cid(p_session))::text,true);
$$;
select pg_temp.actor();
insert into public.training_types(id,organization_id,code,name,category,is_active) values
  (pg_temp.cid(11),null,'CREATE_ACTIVE','AAA active creation type','Fixture',true),
  (pg_temp.cid(12),null,'CREATE_INACTIVE','AAA inactive creation type','Fixture',false),
  (pg_temp.cid(13),pg_temp.cid(10),'CREATE_TENANT','AAA tenant creation type','Fixture',true);
create temporary table creation_fixture(label text primary key,value jsonb);
create function pg_temp.cparams(p_version integer default 31,p_type integer default 11) returns jsonb language sql as $$
  select jsonb_build_object('versionId',upper(pg_temp.cid(p_version)::text),'course',jsonb_build_object('title','Care practice curriculum','description',null,
    'category','Safety','estimatedDurationMinutes',120,'trainingTypeId',case when p_type is null then null else pg_temp.cid(p_type) end),
    'version',jsonb_build_object('title','Care practice first draft','description','Human entered draft'));
$$;
create function pg_temp.create_course(p_course integer,p_version integer,p_request integer) returns jsonb language sql as $$
  select public.execute_native_learning_draft_command(pg_temp.cid(p_request),'learning.createCourse',pg_temp.cid(p_course),pg_temp.cparams(p_version),'Reviewed new course definitions');
$$;
create function pg_temp.crevision(p_course integer default 30,p_version integer default 31) returns text language sql as $$
  select encode(extensions.digest(app_private.learning_source_payload(pg_temp.cid(p_course),pg_temp.cid(p_version)),'sha256'),'hex');
$$;


select pg_temp.create_course(30,31,32);
create function pg_temp.credit(p_id integer default 200,p_type integer default 11,p_hours text default '1.25') returns jsonb language sql as $$
  select jsonb_build_object('creditId',pg_temp.cid(p_id),'trainingTypeId',pg_temp.cid(p_type),'topicCode','SAFETY.A',
    'creditHours',p_hours,'creditMode','automatic','citationNote','A reviewed definition citation','isActive',true)
$$;
create function pg_temp.change(p_credits jsonb default null,p_policy jsonb default '{}',p_removed jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('credits',coalesce(p_credits,jsonb_build_array(pg_temp.credit())),'policy',p_policy,'removedCreditIds',p_removed)
$$;
create function pg_temp.params(p_change jsonb) returns jsonb language sql as $$
  select p_change||jsonb_build_object('versionId',pg_temp.cid(31),'sourceRevision',pg_temp.crevision())
$$;
create function pg_temp.edit(p_change jsonb,p_request uuid default gen_random_uuid()) returns jsonb language sql as $$
  select public.execute_native_learning_draft_command(p_request,'learning.editCreditPolicy',pg_temp.cid(30),pg_temp.params(p_change),'Reviewed version credit policy')
$$;
create function pg_temp.keep() returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('creditId',pg_temp.cid(200),'preserve',true))$$;
select ok(not has_function_privilege('authenticated','app_private.learning_credit_policy_model(uuid,jsonb)','EXECUTE'),'authenticated cannot bypass source CAS and ledger');
select ok(not has_function_privilege('service_role','app_private.edit_learning_credit_policy_core(uuid,jsonb)','EXECUTE'),'service cannot call raw credit writer');
select pg_temp.actor(3,103);
select throws_ok($$select pg_temp.edit(pg_temp.change())$$,'42501','Current native administrator required.','learner cannot edit credit definitions');
select pg_temp.actor();
insert into creation_fixture values('firstParams',pg_temp.params(pg_temp.change()));
insert into creation_fixture values('firstPreview',public.preview_native_learning_draft_command(pg_temp.cid(201),'learning.editCreditPolicy',pg_temp.cid(30),
  (select value from creation_fixture where label='firstParams'),'Reviewed version credit policy'));
select is((select count(*) from public.course_compliance_credits where course_version_id=pg_temp.cid(31)),0::bigint,'preview creates no definition');
select is((select value#>>'{after,aiReviewRequired}' from creation_fixture where label='firstPreview'),'false','human draft preview does not fabricate AI review');
insert into creation_fixture values('firstResult',public.apply_native_learning_draft_command(
  (select (value->>'commandId')::uuid from creation_fixture where label='firstPreview'),(select value->>'previewDigest' from creation_fixture where label='firstPreview')));
select is((select credit_hours::text from public.course_compliance_credits where id=pg_temp.cid(200)),'1.25','decimal hours saved without integer truncation');
select is((select value->>'sourceRevision' from creation_fixture where label='firstResult'),pg_temp.crevision(),'result hashes actual edited canonical source');
select is(public.execute_native_learning_draft_command(pg_temp.cid(201),'learning.editCreditPolicy',pg_temp.cid(30),
  (select value from creation_fixture where label='firstParams'),'Reviewed version credit policy')->>'replayed','true','exact request replays after source changes');
select is((select count(*) from public.course_compliance_credits where course_version_id=pg_temp.cid(31)),1::bigint,'replay does not insert another credit definition');
select is((select count(*) from public.course_completion_credits where course_version_id=pg_temp.cid(31)),0::bigint,'definition edits issue no completion credits');
select is((select count(*) from public.certificates c join public.course_assignments a on a.id=c.course_assignment_id where a.course_version_id=pg_temp.cid(31)),0::bigint,'definition edits issue no certificates');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep()))$$,'22023','No credit policy changes to apply.','all-preserved no-op refused');
select throws_ok($$select pg_temp.edit(pg_temp.change('[]'))$$,'40001','Review every removed credit identity explicitly.','implicit credit deletion refused');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep(),'{}',jsonb_build_array(pg_temp.cid(200))))$$,'22023','Credit identities and training associations must be distinct.','preserve and removal cannot overlap');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit()||'{"creditHours":0.5}')))$$,'22023','Invalid credit definition.','numeric hours rejected at SQL boundary');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'0.00'))))$$,'22023','Invalid credit definition.','zero hours rejected');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit()||'{"citationNote":"\n\t"}')))$$,'22023','Invalid credit definition.','whitespace-only citation rejected');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep(),jsonb_build_object('creditedDurationRationale',repeat(E'\n',50))))$$,'22023','Invalid governed credit policy.','whitespace-only rationale rejected');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep(),'{"providerApproved":true}'))$$,'22023','Invalid governed credit policy.','provider approval injection refused');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,12))))$$,'40001','Remove and add a new credit identity to change its training association.','retained credit cannot silently switch training type');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep()||jsonb_build_array(pg_temp.credit(202,12))))$$,'40001','Choose a current active global training type for changed credit definitions.','inactive new type refused');
select throws_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep()||jsonb_build_array(pg_temp.credit(202,13))))$$,'40001','Choose a current active global training type for changed credit definitions.','tenant type excluded from global draft');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'2.01'))))$$,'23514',null,'native duration cap remains unconditional at apply');
select is((select credit_hours::text from public.course_compliance_credits where id=pg_temp.cid(200)),'1.25','failed duration check preserves prior credit');

insert into creation_fixture values('typeDrift',public.preview_native_learning_draft_command(pg_temp.cid(210),'learning.editCreditPolicy',pg_temp.cid(30),
  pg_temp.params(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'1.50')))),'Reviewed version credit policy'));
update public.training_types set renewal_interval_days=123 where id=pg_temp.cid(11);
select throws_ok($$select public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from creation_fixture where label='typeDrift'),
  (select value->>'previewDigest' from creation_fixture where label='typeDrift'))$$,'40001','Source or authority changed since preview.','training policy drift invalidates preview even when source SHA is unchanged');
select is((select credit_hours::text from public.course_compliance_credits where id=pg_temp.cid(200)),'1.25','stale training policy leaves credit unchanged');
insert into creation_fixture values('sourceDrift',public.preview_native_learning_draft_command(pg_temp.cid(211),'learning.editCreditPolicy',pg_temp.cid(30),
  pg_temp.params(pg_temp.change(pg_temp.keep(),'{"versionLabel":"Reviewed label"}')),'Reviewed version credit policy'));
update public.course_versions set description='Concurrent material correction' where id=pg_temp.cid(31);
select throws_ok($$select public.apply_native_learning_draft_command((select (value->>'commandId')::uuid from creation_fixture where label='sourceDrift'),
  (select value->>'previewDigest' from creation_fixture where label='sourceDrift'))$$,'40001','Source changed since review.','any material drift invalidates credit preview');

-- Inactive legacy associations and out-of-editor-size citations are retained exactly.
update public.course_compliance_credits set citation_note=repeat('X',20000) where id=pg_temp.cid(200);
update public.training_types set is_active=false where id=pg_temp.cid(11);
insert into creation_fixture values('legacy', (select to_jsonb(c) from public.course_compliance_credits c where id=pg_temp.cid(200)));
select lives_ok($$select pg_temp.edit(pg_temp.change(pg_temp.keep(),'{"versionLabel":"Retained rules"}'))$$,'policy label can change while inactive legacy credit is preserved');
select is((select to_jsonb(c) from public.course_compliance_credits c where id=pg_temp.cid(200)),(select value from creation_fixture where label='legacy'),'preserved credit including timestamps and long citation is unchanged');
select throws_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'1.50'))))$$,'40001','Choose a current active global training type for changed credit definitions.','changed inactive definition refused');
update public.training_types set is_active=true where id=pg_temp.cid(11);
select lives_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit()||'{"creditMode":"verified_only","isActive":false}'),
  '{"creditedDurationRationale":"Reviewed instructional duration rationale for this version."}'))$$,'active training definition and version rationale share one transaction');
select ok((select credit_mode='verified_only' and not is_active from public.course_compliance_credits where id=pg_temp.cid(200)),'verification mode and activity are exact definitions');
select is((select count(*) from public.course_completion_credits where course_version_id=pg_temp.cid(31)),0::bigint,'verified-only mode never generates completion evidence');

-- AI material review is explicitly pinned then invalidated by credit definition edits.
update public.course_versions set ai_generated=true where id=pg_temp.cid(31);
select public.execute_native_learning_draft_command(pg_temp.cid(220),'learning.reviewDraft',pg_temp.cid(30),
  jsonb_build_object('versionId',pg_temp.cid(31),'sourceRevision',pg_temp.crevision(),'reviewed',true),'Reviewed exact generated definition');
select ok((select ai_reviewed_at is not null from public.course_versions where id=pg_temp.cid(31)),'explicit AI review exists before edit');
select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'1.50'))));
select ok((select ai_reviewed_at is null and ai_reviewed_by is null from public.course_versions where id=pg_temp.cid(31)),'credit edit invalidates approval instead of auto-refreshing its digest');
select throws_ok($$select public.publish_course_version(pg_temp.cid(31))$$,'23514',null,'unreviewed/incomplete generated draft cannot publish');
select public.execute_native_learning_draft_command(pg_temp.cid(221),'learning.reviewDraft',pg_temp.cid(30),
  jsonb_build_object('versionId',pg_temp.cid(31),'sourceRevision',pg_temp.crevision(),'reviewed',true),'Reviewed exact generated definition');
select pg_temp.edit(pg_temp.change(pg_temp.keep(),'{"versionLabel":"Reviewed credit edition"}'));
select ok((select ai_reviewed_at is null and ai_reviewed_by is null from public.course_versions where id=pg_temp.cid(31)),'policy-only version metadata edit also invalidates exact material approval');


savepoint credit_rollback;
select pg_temp.edit(pg_temp.change('[]','{}',jsonb_build_array(pg_temp.cid(200))),pg_temp.cid(225));
rollback to savepoint credit_rollback;
select is((select count(*) from public.course_compliance_credits where id=pg_temp.cid(200)),1::bigint,'transaction rollback restores removed definition');
select is((select count(*) from app_private.platform_admin_commands where request_id=pg_temp.cid(225)),0::bigint,'transaction rollback removes command and receipt');
create function pg_temp.reject_credit_audit() returns trigger language plpgsql as $$
begin if new.action='governed_learning_draft_applied' and new.metadata->>'commandAction'='learning.editCreditPolicy' then raise exception 'Synthetic credit audit refusal'; end if; return new; end;
$$;
create trigger credit_fixture_audit before insert on public.audit_logs for each row execute function pg_temp.reject_credit_audit();
select throws_ok($$select pg_temp.edit(pg_temp.change('[]','{}',jsonb_build_array(pg_temp.cid(200))),pg_temp.cid(226))$$,'P0001','Synthetic credit audit refusal','audit refusal rolls back definition and ledger together');
select is((select count(*) from public.course_compliance_credits where id=pg_temp.cid(200)),1::bigint,'audit refusal leaves definition intact');
select is((select count(*) from app_private.platform_admin_commands where request_id=pg_temp.cid(226)),0::bigint,'audit refusal leaves no successful result');
drop trigger credit_fixture_audit on public.audit_logs;
select pg_temp.edit(pg_temp.change('[]','{}',jsonb_build_array(pg_temp.cid(200))));
select is((select count(*) from public.course_compliance_credits where id=pg_temp.cid(200)),0::bigint,'explicit reviewed deletion removes only requested draft definition');

-- A trusted fixture may install an existing catalog exemption; the authoring
-- contract cannot grant one and still respects unconditional positive duration.
select set_config('app.privileged_write','on',true);
update public.courses set credited_duration_check_exempt=true where id=pg_temp.cid(30);
select set_config('app.privileged_write','',true);
select lives_ok($$select pg_temp.edit(pg_temp.change(jsonb_build_array(pg_temp.credit(200,11,'9999.99'))))$$,'retained catalog exemption remains an explicit native policy');
select is((select credit_hours::text from public.course_compliance_credits where id=pg_temp.cid(200)),'9999.99','native numeric boundary preserves exact cents');
select pg_temp.edit(pg_temp.change('[]','{}',jsonb_build_array(pg_temp.cid(200))));
select set_config('app.privileged_write','on',true);
update public.courses set estimated_duration_minutes=null where id=pg_temp.cid(30);
select set_config('app.privileged_write','',true);
select throws_ok($$select pg_temp.edit(pg_temp.change())$$,'23514',null,'even exempt course requires positive catalog duration');
select set_config('app.privileged_write','on',true);
update public.courses set estimated_duration_minutes=120,credited_duration_check_exempt=false where id=pg_temp.cid(30);
select set_config('app.privileged_write','',true);

-- Preserve actual content-distribution history even for legacy draft references.
-- No assignment publication guard is disabled to construct this case.
insert into public.offline_device_registrations(id,organization_id,profile_id,device_public_key,device_fingerprint_sha256,role_at_registration)
  values(pg_temp.cid(260),pg_temp.cid(10),pg_temp.cid(3),'synthetic-fixture-public-key',repeat('a',64),'employee');
insert into public.offline_content_manifests(id,organization_id,profile_id,device_id,course_version_id,manifest_version,
  content_sha256,encrypted_content_key,allowlisted_assets,expires_at)
  values(pg_temp.cid(261),pg_temp.cid(10),pg_temp.cid(3),pg_temp.cid(260),pg_temp.cid(31),1,repeat('b',64),'synthetic-fixture-encrypted-content','[]',now()+interval '1 hour');
select throws_ok($$select pg_temp.edit(pg_temp.change())$$,'40001','This definition is bound to learner history. Clone a new version.','actual offline content reference blocks version credit edits');
delete from public.offline_content_manifests where id=pg_temp.cid(261);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into creation_fixture values('smsPreview',public.preview_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),
  now()-interval '1 hour',now()+interval '7 hours',pg_temp.cid(252),'learning.editCreditPolicy',pg_temp.cid(30),pg_temp.params(pg_temp.change()),'Reviewed delegated credit policy','app_sms'));
select lives_ok($$select public.apply_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours',
  (select (value->>'commandId')::uuid from creation_fixture where label='smsPreview'),(select value->>'previewDigest' from creation_fixture where label='smsPreview'),'app_sms')$$,'SMS delegation invokes identical credit transaction');
select is((select authentication_method from app_private.platform_admin_commands where request_id=pg_temp.cid(252)),'app_sms','audit records actual SMS method');
select throws_ok($$select public.apply_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(253),now()-interval '1 hour',now()+interval '7 hours',
  (select (value->>'commandId')::uuid from creation_fixture where label='smsPreview'),(select value->>'previewDigest' from creation_fixture where label='smsPreview'),'app_sms')$$,
  '42501','Preview belongs to another operation or administrator session.','other SMS session cannot replay credit command');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id=pg_temp.cid(1);
select set_config('app.privileged_write','',true);
select throws_ok($$select public.apply_learning_authoring_command(pg_temp.cid(1),pg_temp.cid(250),pg_temp.cid(251),now()-interval '1 hour',now()+interval '7 hours',
  (select (value->>'commandId')::uuid from creation_fixture where label='smsPreview'),(select value->>'previewDigest' from creation_fixture where label='smsPreview'),'app_sms')$$,'42501',null,'current native revocation blocks cached result disclosure');
select * from finish();
rollback;
