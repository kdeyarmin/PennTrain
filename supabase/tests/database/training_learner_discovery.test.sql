begin;
select no_plan();

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('ed260000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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

insert into public.organizations(id, name, slug, subscription_status) values
  (pg_temp.id(1), 'Yearly plan tenant', 'discovery-test', 'active'),
  (pg_temp.id(2), 'Other yearly tenant', 'discovery-other', 'active');
insert into app_private.module_access_terms(organization_id, module_key, source, reason) values
  (pg_temp.id(1), 'modules.train', 'complimentary', 'Disposable yearly training plan test'),
  (pg_temp.id(2), 'modules.train', 'complimentary', 'Disposable yearly training plan test');
insert into public.facilities(id, organization_id, name, facility_type) values
  (pg_temp.id(11), pg_temp.id(1), 'Assigned facility', 'PCH'),
  (pg_temp.id(12), pg_temp.id(1), 'Unassigned facility', 'PCH'),
  (pg_temp.id(13), pg_temp.id(2), 'Other organization', 'PCH');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.id(n), 'authenticated', 'authenticated', 'discovery-' || n || '@test.local',
  'x', now(), '{}', '{}', now(), now() from generate_series(101, 106) n;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, role, email, first_name, last_name, is_active)
select pg_temp.id(n), case when n = 105 then null else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee'
    when 104 then 'trainer' when 105 then 'platform_admin' else 'auditor' end,
  'discovery-' || n || '@test.local', 'Year', 'Plan', true
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
insert into public.courses(id, organization_id, title, status)
select pg_temp.id(n), case when n = 302 then null when n = 305 then pg_temp.id(2) else pg_temp.id(1) end,
  'Yearly course ' || n, 'draft' from generate_series(301, 305) n;
insert into public.course_versions(id, course_id, organization_id, version_number, title)
select pg_temp.id(n + 100), id, organization_id, 1, title from public.courses c
join generate_series(301, 305) n on c.id = pg_temp.id(n);
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body)
select id, organization_id, 'text', 0, 'Lesson', '{"content":"Legacy classroom course lesson"}'
from public.course_versions where id in (pg_temp.id(401), pg_temp.id(402), pg_temp.id(403), pg_temp.id(404), pg_temp.id(405));
update public.course_versions set status = 'published', published_at = now()
where id in (pg_temp.id(401), pg_temp.id(402), pg_temp.id(403), pg_temp.id(405));
update public.courses c set status = 'published', current_version_id = v.id
from public.course_versions v where v.course_id = c.id
  and c.id in (pg_temp.id(301), pg_temp.id(302), pg_temp.id(303), pg_temp.id(305));
select set_config('app.privileged_write', 'off', true);

create temp table discovery_results(name text primary key,result jsonb);
grant all on discovery_results to authenticated;
select ok(not has_function_privilege('anon','public.training_discovery(text,jsonb)','execute'),'anonymous discovery access denied');
select ok(not has_table_privilege('authenticated','app_private.training_refresher_lessons','select'),'answer keys are inaccessible outside scoped commands');
select ok(not has_table_privilege('authenticated','app_private.training_saved_courses','insert'),'bookmarks cannot be spoofed by direct writes');

select pg_temp.act(103);
select lives_ok($$select public.training_discovery('save_course',jsonb_build_object('course_id',pg_temp.id(302),'saved',true))$$,'learner saves system course');
select is(jsonb_array_length(public.training_discovery('library')->'saved'),1,'learner sees own saved courses');
select lives_ok($$select public.training_discovery('save_course',jsonb_build_object('course_id',pg_temp.id(302),'saved',true))$$,'saving is idempotent');
select throws_ok($$select public.training_discovery('save_course',jsonb_build_object('course_id',pg_temp.id(305),'saved',true))$$,'42501','Course is not available','cannot bookmark another tenant course');
select throws_ok($$select public.training_discovery('save_course',jsonb_build_object('course_id',pg_temp.id(304),'saved',true))$$,'42501','Course is not available','draft course cannot be bookmarked');
select lives_ok($$select public.training_discovery('save_interests','{"interests":["Communication"]}')$$,'interests saved privately');
select throws_ok($$select public.training_discovery('save_interests','{"interests":[null]}')$$,'22023','Choose up to 20 interests','null interests cannot poison learner library response');
select throws_ok($$select public.training_discovery('save_interests','{}')$$,'22023','Choose up to 20 interests','missing interests list rejected');
select is(public.training_discovery('library')->'interests','["Communication"]'::jsonb,'interest persists');
select throws_ok($$select public.training_discovery('owner_library')$$,'42501','Platform administrator required','learners cannot read drafts and answer keys');
select throws_ok($$select public.training_discovery('save_collection','{"title":"Spoof"}')$$,'42501','Platform administrator required','learner cannot publish collections');
select throws_ok($$select public.training_discovery('save_refresher_settings',jsonb_build_object('facility_id',pg_temp.id(11),'enabled',true,'frequency_days',7))$$,'42501','Assigned Training facility required','learner cannot change facility policy');

select pg_temp.act(105);
select lives_ok($$select public.training_discovery('owner_library')$$,'owner can review authoring library');
select lives_ok($$select public.training_discovery('save_collection',jsonb_build_object('id',pg_temp.id(501),'title','Communication','description','Useful optional learning','interests',jsonb_build_array('Communication'),'job_titles',jsonb_build_array('Aide'),'course_ids',jsonb_build_array(pg_temp.id(302)),'published',true))$$,'owner publishes a collection of existing system courses');
select throws_ok($$select public.training_discovery('save_collection',jsonb_build_object('title','Private tenant content','course_ids',jsonb_build_array(pg_temp.id(301)),'published',true))$$,'22023','Choose available system courses; published collections need at least one course','global collection rejects tenant-private content');
select lives_ok($$select public.training_discovery('save_metadata',jsonb_build_object('course_id',pg_temp.id(302),'language','English'))$$,'owner records documented language without implying credit');
select throws_ok($$select public.training_discovery('save_metadata',jsonb_build_object('course_id',pg_temp.id(302),'credit_statement','Approved CE'))$$,'23514',null,'credit claim requires supporting evidence');
select lives_ok($$select public.training_discovery('save_lesson',jsonb_build_object('id',pg_temp.id(601),'title','Review communication','body','Pause and invite your colleague to explain the next step in their own words.','question','Which response checks understanding?','choices',jsonb_build_array('Ask an open question','Make an assumption'),'correct_choice',0,'explanation','An open question lets you check and clarify shared understanding.','published',true))$$,'owner publishes original general refresher');
select throws_ok($$select public.training_discovery('save_lesson',jsonb_build_object('title','Invalid lesson','choices',jsonb_build_array(null,'Valid answer')))$$,'22023','Each answer needs text','null answer cannot poison the shared lesson feed');
select throws_ok($$select public.training_discovery('save_lesson',jsonb_build_object('title','Invalid lesson','choices',jsonb_build_array(7,'Valid answer')))$$,'22023','Each answer needs text','answer choices must be actual strings');
select throws_ok($$select public.training_discovery('save_lesson','{"title":"Invalid lesson"}')$$,'22023','Enter 2 to 4 answer choices','missing choices are rejected before publication');
select throws_ok($$select public.training_discovery('save_collection',jsonb_build_object('title','Invalid collection','course_ids',jsonb_build_array(pg_temp.id(302)),'interests',jsonb_build_array(null)))$$,'22023','Audience tags must contain 1 to 100 characters','null global tags cannot poison every learner library');
select lives_ok($$select public.training_discovery('save_lesson',jsonb_build_object('id',pg_temp.id(602),'course_id',pg_temp.id(302),'title','Linked course follow-up','body','Review the communication steps from your completed course and reflect on a recent handoff.','question','Which response checks understanding?','choices',jsonb_build_array('Ask an open question','Make an assumption'),'correct_choice',0,'explanation','An open question lets you check and clarify shared understanding.','published',true))$$,'owner publishes linked refresher');
select pg_temp.act(105,'aal1');
select throws_ok($$select public.training_discovery('owner_library')$$,'42501',null,'owner authoring requires identity assurance');

select pg_temp.act(102);
select is(jsonb_array_length(public.training_discovery('library')->'saved'),0,'bookmarks are isolated by caller');
select lives_ok($$select public.training_discovery('save_refresher_settings',jsonb_build_object('facility_id',pg_temp.id(11),'enabled',true,'frequency_days',7))$$,'assigned manager enables facility refreshers');
select throws_ok($$select public.training_discovery('facility_refreshers',jsonb_build_object('facility_id',pg_temp.id(12)))$$,'42501','Assigned Training facility required','manager cannot read unassigned facility practice');
select throws_ok($$select public.training_discovery('save_refresher_settings',jsonb_build_object('facility_id',pg_temp.id(13),'enabled',true,'frequency_days',7))$$,'42501','Assigned Training facility required','manager cannot change another tenant policy');
select throws_ok($$select public.training_discovery('save_refresher_settings',jsonb_build_object('facility_id',pg_temp.id(11),'enabled',true,'frequency_days',0))$$,'23514',null,'frequency is bounded');

select pg_temp.act(103);
insert into discovery_results values('feed',public.training_discovery('refresher_feed'));
select is(jsonb_array_length((select result->'lessons' from discovery_results where name='feed')),1,'only general lesson visible before related course completion');
select is((select result->'lessons'->0->>'correct_choice' from discovery_results where name='feed'),null::text,'feed never includes answer key');
select is((select result->'lessons'->0->>'explanation' from discovery_results where name='feed'),null::text,'explanation withheld until response');
select throws_ok($$select public.training_discovery('answer_refresher',jsonb_build_object('lesson_id',pg_temp.id(602),'revision',1,'choice_index',0))$$,'42501','Refresher is not available','linked lesson cannot bypass course completion');
select throws_ok($$select public.training_discovery('answer_refresher',jsonb_build_object('lesson_id',pg_temp.id(601),'revision',99,'choice_index',0))$$,'22023','This refresher changed; reopen it before answering','stale content version cannot produce misleading evidence');
select throws_ok($$select public.training_discovery('answer_refresher',jsonb_build_object('lesson_id',pg_temp.id(601),'revision',1,'choice_index',7))$$,'22023','Choose a listed answer','invalid answer rejected');
insert into discovery_results values('answer',public.training_discovery('answer_refresher',jsonb_build_object('lesson_id',pg_temp.id(601),'revision',1,'choice_index',1)));
select is((select (result->>'correct')::boolean from discovery_results where name='answer'),false,'server scores actual response');
select is((select result->>'correct_answer' from discovery_results where name='answer'),'Ask an open question','response includes correct answer and teaching explanation');
select throws_ok($$select public.training_discovery('answer_refresher',jsonb_build_object('lesson_id',pg_temp.id(601),'revision',1,'choice_index',0))$$,'22023','You have already answered this refresher for this interval','duplicate submissions cannot overwrite practice history');
select is(jsonb_array_length(public.training_discovery('refresher_feed')->'lessons'),0,'answered lesson respects facility interval');
select is(jsonb_array_length(public.training_discovery('refresher_feed')->'history'),1,'learner sees personal practice history');
select is((select count(*) from public.course_assignments where employee_id=pg_temp.id(201)),0::bigint,'optional practice creates no assignments');
select is((select count(*) from public.certificates where employee_id=pg_temp.id(201)),0::bigint,'optional practice issues no certificates');
select lives_ok($$select public.training_discovery('save_course',jsonb_build_object('course_id',pg_temp.id(302),'saved',false))$$,'learner removes saved course');
select is(jsonb_array_length(public.training_discovery('library')->'saved'),0,'removed bookmark stays removed');

select pg_temp.act(102);
select is(jsonb_array_length(public.training_discovery('facility_refreshers',jsonb_build_object('facility_id',pg_temp.id(11)))->'responses'),1,'assigned manager sees scoped optional practice report');
select lives_ok($$select public.training_discovery('save_refresher_settings',jsonb_build_object('facility_id',pg_temp.id(11),'enabled',false,'frequency_days',7))$$,'facility can pause refreshers');
select pg_temp.act(103);
select is((public.training_discovery('refresher_feed')->>'enabled')::boolean,false,'learner sees paused setting without losing history');
reset role;
update app_private.module_access_terms set revoked_at=now() where organization_id=pg_temp.id(1) and module_key='modules.train';
select pg_temp.act(103);
select throws_ok($$select public.training_discovery('library')$$,'42501','Active Training access required','revoked complimentary Training access cannot read discovery data');
reset role;
select * from finish();
rollback;
