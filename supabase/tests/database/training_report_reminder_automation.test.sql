begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('eb270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.act(n integer, assurance text default 'aal2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('app.privileged_write','off',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','aal',assurance,'iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end;
$$;
insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Training automation tenant','training-automation-fixture','active'),
  (pg_temp.id(2),'Other training tenant','training-automation-other','active');
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values
  (pg_temp.id(1),'modules.train','complimentary','Disposable training automation test'),
  (pg_temp.id(2),'modules.train','complimentary','Disposable training automation test');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Training first facility','PCH'),
  (pg_temp.id(12),pg_temp.id(1),'Training second facility','PCH'),
  (pg_temp.id(13),pg_temp.id(2),'Other tenant facility','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'authenticated','authenticated','training-automation-'||n||'@test.local','x',now(),'{}','{}',now(),now() from generate_series(101,107) n;
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,role,email,first_name,last_name,is_active)
select pg_temp.id(n),case when n=105 then null when n=106 then pg_temp.id(2) else pg_temp.id(1) end,
  case n when 101 then 'org_admin' when 102 then 'facility_manager' when 103 then 'employee' when 104 then 'trainer' when 105 then 'platform_admin' when 106 then 'org_admin' else 'facility_manager' end,
  'training-automation-'||n||'@test.local','Training','Person '||n,true from generate_series(101,107) n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.organization_settings(organization_id,email_notifications_enabled) values(pg_temp.id(1),true) on conflict(organization_id) do update set email_notifications_enabled=true;
insert into public.facility_assignments(profile_id,facility_id) values
  (pg_temp.id(102),pg_temp.id(11)),(pg_temp.id(103),pg_temp.id(11)),(pg_temp.id(104),pg_temp.id(11)),(pg_temp.id(107),pg_temp.id(12));
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status,department) values
  (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(103),'Active','Student','Aide','active','Nursing'),
  (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),null,'Second','Student','Aide','active','Housekeeping'),
  (pg_temp.id(203),pg_temp.id(1),pg_temp.id(12),null,'Other','Facility','Aide','active','Nursing'),
  (pg_temp.id(204),pg_temp.id(2),pg_temp.id(13),null,'Other','Tenant','Aide','active','Nursing');
insert into public.courses(id,organization_id,title,status) select pg_temp.id(n),pg_temp.id(1),'Automation course '||n,'draft' from generate_series(301,303) n;
insert into public.course_versions(id,course_id,organization_id,version_number,title)
select pg_temp.id(n+100),id,organization_id,1,title from public.courses c join generate_series(301,303) n on c.id=pg_temp.id(n);
insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body)
select id,organization_id,'text',0,'Lesson','{"content":"Disposable classroom lesson"}' from public.course_versions where id in(pg_temp.id(401),pg_temp.id(402),pg_temp.id(403));
update public.course_versions set status='published',published_at=now() where id in(pg_temp.id(401),pg_temp.id(402),pg_temp.id(403));
update public.courses c set status='published',current_version_id=v.id from public.course_versions v where v.course_id=c.id and c.id in(pg_temp.id(301),pg_temp.id(302),pg_temp.id(303));
select set_config('app.privileged_write','off',true);
create temp table automation_results(name text primary key,id uuid);
grant all on automation_results to authenticated;

select pg_temp.act(102);
insert into public.course_assignments(id,organization_id,facility_id,employee_id,course_id,course_version_id,assigned_by,due_date)
values(pg_temp.id(801),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(301),pg_temp.id(401),pg_temp.id(102),public.pa_today()-20),
  (pg_temp.id(802),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),pg_temp.id(301),pg_temp.id(401),pg_temp.id(102),public.pa_today()+3),
  (pg_temp.id(803),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(302),pg_temp.id(402),pg_temp.id(102),public.pa_today()+5),
  (pg_temp.id(804),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(303),pg_temp.id(403),pg_temp.id(102),public.pa_today()-5);
update public.course_assignments set is_required=false where id=pg_temp.id(804);
select lives_ok($$select public.complete_course_assignment(pg_temp.id(803))$$,'completion fixture uses the supported completion command');
select lives_ok($$select public.get_training_automation(pg_temp.id(11))$$,'Training-only manager reads facility automation');
select is((public.get_training_automation(pg_temp.id(11))->'settings'->>'repeat_days')::integer,7,'unconfigured learner cadence remains seven days');
select is(jsonb_array_length(public.get_training_automation(pg_temp.id(11))->'recipients'),2,'recipient picker includes org administrator and assigned manager only');
select throws_ok($$select public.get_training_automation(pg_temp.id(12))$$,'42501',null,'manager cannot inspect another facility configuration');
select throws_ok($$select public.get_training_automation(pg_temp.id(13))$$,'42501',null,'manager cannot inspect another tenant');
select throws_ok($$select public.save_training_reminder_policy(pg_temp.id(11),'{"learner_enabled":true,"lead_days":7,"repeat_days":0,"digest_enabled":true,"digest_weekday":1,"escalation_days":14,"recipient_ids":[]}'::jsonb)$$,'22023',null,'zero repeat cadence is rejected');
select throws_ok($$select public.save_training_reminder_policy(pg_temp.id(11),jsonb_build_object('learner_enabled',true,'lead_days',7,'repeat_days',7,'digest_enabled',true,'digest_weekday',1,'escalation_days',14,'recipient_ids',jsonb_build_array(pg_temp.id(107))))$$,'22023',null,'another facility manager cannot be made a recipient');
select throws_ok($$select public.save_training_reminder_policy(pg_temp.id(11),jsonb_build_object('learner_enabled',true,'lead_days',7,'repeat_days',7,'digest_enabled',true,'digest_weekday',1,'escalation_days',14,'recipient_ids',jsonb_build_array(pg_temp.id(105))))$$,'22023',null,'owner scope does not make the owner an eligible facility follow-up recipient');
select lives_ok($$select public.save_training_reminder_policy(pg_temp.id(11),jsonb_build_object('learner_enabled',true,'lead_days',2,'repeat_days',3,'digest_enabled',true,'digest_weekday',extract(isodow from public.pa_today())::integer,'escalation_days',14,'recipient_ids',jsonb_build_array(pg_temp.id(102))))$$,'manager saves explicit lead, cadence, summary day, escalation and recipient');
select is((select due_date from public.course_assignments where id=pg_temp.id(801)),public.pa_today()-20,'automation never changes explicit assignment deadline');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad report','{}','weekly',1,array[pg_temp.id(106)])$$,'22023',null,'foreign tenant recipient rejected');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Owner recipient','{}','weekly',1,array[pg_temp.id(105)])$$,'22023',null,'scheduled recipients must be actual administrators in this organization');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad day','{}','weekly',8,array[pg_temp.id(102)])$$,'22023',null,'weekly schedule refuses invalid weekday');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad month','{}','monthly',31,array[pg_temp.id(102)])$$,'22023',null,'monthly schedule refuses a day missing in some months');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad filters','{"facilityId":"outside"}','weekly',1,array[pg_temp.id(102)])$$,'22023',null,'saved filters cannot override facility authority');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad dates','{"dateFrom":"2026-12-31","dateThrough":"2026-01-01"}','weekly',1,array[pg_temp.id(102)])$$,'22023',null,'saved report validates date ordering');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Bad employee',jsonb_build_object('employeeId',pg_temp.id(203)),'weekly',1,array[pg_temp.id(102)])$$,'22023',null,'saved report refuses another facility employee filter');
insert into automation_results values('weekly',public.save_training_report_schedule(pg_temp.id(11),'Nursing required report','{"department":"Nursing","purpose":"required","status":"all","dateBasis":"assigned"}',
  'weekly',extract(isodow from public.pa_today())::integer,array[pg_temp.id(102)]));
select is(public.get_saved_training_report((select id from automation_results where name='weekly'))->'filters'->>'department','Nursing','saved report retains filters');
select is(public.get_saved_training_report((select id from automation_results where name='weekly'))->>'facilityId',pg_temp.id(11)::text,'saved report returns server-authorized facility');
select pg_temp.act(103,'aal1');
select throws_ok($$select public.get_training_automation(pg_temp.id(11))$$,'42501',null,'student cannot see automation or recipient roster');
select throws_ok($$select public.get_training_report_analytics(pg_temp.id(11))$$,'42501',null,'student cannot read staff analytics');
select pg_temp.act(104,'aal1');
select throws_ok($$select public.save_training_report_schedule(pg_temp.id(11),'Trainer attempt','{}','weekly',1,array[pg_temp.id(102)])$$,'42501',null,'trainer cannot configure administrator report deliveries');
select pg_temp.act(102,'aal1');
select throws_ok($$select public.save_training_reminder_policy(pg_temp.id(11),'{}')$$,'42501',null,'privileged manager cannot bypass MFA');
select pg_temp.act(107);
select throws_ok($$select public.get_saved_training_report((select id from automation_results where name='weekly'))$$,'42501',null,'saved link never grants cross-facility access');
select pg_temp.act(106);
select throws_ok($$select public.get_saved_training_report((select id from automation_results where name='weekly'))$$,'42501',null,'saved link never grants cross-tenant access');

reset role;
select set_config('request.jwt.claims','{}',true);
select is(app_private.training_report_next_date('weekly',1,'2026-09-27'),date '2026-09-28','weekly date calculation crosses Sunday into Monday');
select is(app_private.training_report_next_date('monthly',28,'2026-01-29'),date '2026-02-28','monthly recurrence survives February');
select is(app_private.training_report_next_date('monthly',1,'2026-12-02'),date '2027-01-01','monthly recurrence crosses year');
select lives_ok($$select public.queue_course_assignment_due_reminders()$$,'existing registered daily job consumes configured reminders and report subscriptions');
select is((select count(*)::integer from public.notifications where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(801)),1,'overdue required course gets learner reminder');
select is((select count(*)::integer from public.notifications where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(804)),0,'elective overdue course gets no required reminder');
select is((select count(*)::integer from public.notifications where notification_type='training_overdue_summary' and profile_id=pg_temp.id(102)),1,'registered administrator summary actually queues');
select is((select count(*)::integer from public.notifications where notification_type='training_escalation_summary' and profile_id=pg_temp.id(102)),1,'escalation threshold produces follow-up');
select is((select count(*)::integer from public.notifications where notification_type in ('training_overdue_summary','training_escalation_summary') and profile_id=pg_temp.id(101)),0,'selected follow-up audience excludes other administrator');
select is((select count(*)::integer from public.notifications where notification_type='report_subscription_ready' and profile_id=pg_temp.id(102)),1,'scheduled report creates one secure notification');
select is((select recipient_count from app_private.training_report_schedule_runs where schedule_id=(select id from automation_results where name='weekly')),1,'run ledger records the actual authorized recipient count');
select ok(exists(select 1 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='report_subscription_ready' and n.profile_id=pg_temp.id(102)),'scheduled report reuses provider delivery queue');
select ok(not exists(select 1 from public.notifications where notification_type='report_subscription_ready' and profile_id=pg_temp.id(102) and (body like '%Active%' or body like '%Nursing%')),'scheduled message contains no student identity or department data');
select lives_ok($$select public.queue_course_assignment_due_reminders()$$,'daily retry is safe');
select is((select count(*)::integer from public.notifications where notification_type='report_subscription_ready' and profile_id=pg_temp.id(102)),1,'same-day report retry does not duplicate');
select is((select count(*)::integer from public.notifications where notification_type='training_overdue_summary' and profile_id=pg_temp.id(102)),1,'same-day summary retry does not duplicate');
update public.notifications set created_at=now()-interval '4 days' where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(801);
select lives_ok($$select public.queue_course_assignment_due_reminders()$$,'configured three-day repeat runs');
select is((select count(*)::integer from public.notifications where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(801)),2,'configured repeat differs from old fixed seven-day behavior');
select pg_temp.act(102);
update public.course_assignments set due_date=public.pa_today()+3,is_required=true where id=pg_temp.id(804);
reset role;
select set_config('request.jwt.claims','{}',true);
select lives_ok($$select public.queue_course_assignment_due_reminders()$$,'course outside the configured lead window is evaluated');
select is((select count(*)::integer from public.notifications where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(804)),0,'two-day lead excludes course due in three days');
update app_private.training_reminder_policies set lead_days=4 where facility_id=pg_temp.id(11);
select lives_ok($$select public.queue_course_assignment_due_reminders()$$,'expanded lead window is consumed by existing job');
select is((select count(*)::integer from public.notifications where notification_type='course_assignment_due_soon' and link='/me/courses/'||pg_temp.id(804)),1,'four-day lead includes course due in three days');
select pg_temp.act(102);
update public.course_assignments set is_required=false where id=pg_temp.id(804);
reset role;
select set_config('request.jwt.claims','{}',true);

-- Delivery-time facts can differ from the work that originally entered the queue.
insert into automation_results(name,id)
select 'learner-delivery',d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
where n.notification_type='course_assignment_due_soon' and n.link='/me/courses/'||pg_temp.id(801) order by n.created_at desc limit 1;
insert into automation_results(name,id)
select 'overdue-delivery',d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
where n.notification_type='training_overdue_summary' and n.profile_id=pg_temp.id(102) limit 1;
insert into automation_results(name,id)
select 'escalated-delivery',d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
where n.notification_type='training_escalation_summary' and n.profile_id=pg_temp.id(102) limit 1;
select ok(app_private.training_delivery_scope_is_current((select id from automation_results where name='learner-delivery')),'unchanged required deadline remains deliverable');
select set_config('app.privileged_write','on',true);
update public.course_assignments set due_date=public.pa_today()+90 where id=pg_temp.id(801);
select set_config('app.privileged_write','off',true);
select ok(not app_private.training_delivery_scope_is_current((select id from automation_results where name='learner-delivery')),'extending a deadline beyond the lead window suppresses its queued learner reminder');
select ok(not app_private.training_delivery_scope_is_current((select id from automation_results where name='overdue-delivery')),'resolving all overdue work suppresses the queued summary');
update public.notification_deliveries set status='processing' where id=(select id from automation_results where name='learner-delivery');
select is((select count(*)::integer from public.begin_notification_delivery_attempt((select id from automation_results where name='learner-delivery'),'sendgrid',repeat('b',64))),0,'provider attempt refuses the reminder after its deadline is extended');
select is((select status from public.notification_deliveries where id=(select id from automation_results where name='learner-delivery')),'skipped','extended deadline produces a skipped delivery receipt');
select set_config('app.privileged_write','on',true);
update public.course_assignments set due_date=public.pa_today()-19 where id=pg_temp.id(801);
select set_config('app.privileged_write','off',true);
select ok(not app_private.training_delivery_scope_is_current((select id from automation_results where name='learner-delivery')),'changing a deadline within the reminder window suppresses the old date in the queued body');
select ok(app_private.training_delivery_scope_is_current((select id from automation_results where name='escalated-delivery')),'current threshold still permits an unresolved escalated summary');
select set_config('app.privileged_write','on',true);
update public.course_assignments set due_date=public.pa_today()-5 where id=pg_temp.id(801);
select set_config('app.privileged_write','off',true);
select ok(app_private.training_delivery_scope_is_current((select id from automation_results where name='overdue-delivery')),'remaining overdue work still permits the regular summary');
select ok(not app_private.training_delivery_scope_is_current((select id from automation_results where name='escalated-delivery')),'moving overdue work below the escalation threshold suppresses its old escalation');
update public.notification_deliveries set status='processing' where id=(select id from automation_results where name='escalated-delivery');
select is((select count(*)::integer from public.begin_notification_delivery_attempt((select id from automation_results where name='escalated-delivery'),'sendgrid',repeat('c',64))),0,'provider attempt refuses a resolved escalation');
select pg_temp.act(102);
update public.course_assignments set is_required=false where id=pg_temp.id(801);
reset role;
select set_config('request.jwt.claims','{}',true);
select ok(not app_private.training_delivery_scope_is_current((select id from automation_results where name='overdue-delivery')),'optional work cannot sustain an already queued required-training summary');
update public.notification_deliveries set status='processing' where id=(select id from automation_results where name='overdue-delivery');
select is((select count(*)::integer from public.begin_notification_delivery_attempt((select id from automation_results where name='overdue-delivery'),'sendgrid',repeat('d',64))),0,'provider attempt refuses a resolved required-training summary');
select pg_temp.act(102);
update public.course_assignments set is_required=true,due_date=public.pa_today()-20 where id=pg_temp.id(801);
reset role;
select set_config('request.jwt.claims','{}',true);

-- Fixed UTC clock proves the scheduler uses the PA calendar day, not UTC midnight.
delete from app_private.training_report_schedule_runs where schedule_id=(select id from automation_results where name='weekly');
update app_private.training_report_schedules set next_run_on='2026-09-28' where id=(select id from automation_results where name='weekly');
select is(app_private.process_training_report_schedules('2026-09-28 00:30:00+00'),0,'UTC Monday is still Sunday in Pennsylvania');
select is(app_private.process_training_report_schedules('2026-09-28 12:30:00+00'),1,'Monday PA date runs its due report');
select is(app_private.process_training_report_schedules('2026-09-28 12:31:00+00'),0,'fixed-clock retry is idempotent');

-- A role/facility change after queueing must suppress actual provider attempts.
delete from public.facility_assignments where profile_id=pg_temp.id(102) and facility_id=pg_temp.id(11);
select ok(not app_private.training_delivery_scope_is_current((select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='report_subscription_ready' and n.profile_id=pg_temp.id(102) limit 1)),'queued report loses permission after manager facility removal');
update public.notification_deliveries set status='processing' where id=(select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='report_subscription_ready' and n.profile_id=pg_temp.id(102) limit 1);
select is((select count(*)::integer from public.begin_notification_delivery_attempt((select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='report_subscription_ready' and n.profile_id=pg_temp.id(102) and d.status='processing' limit 1),'sendgrid',repeat('a',64))),0,'actual attempt command refuses revoked facility access before any send');
select ok(exists(select 1 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='report_subscription_ready' and n.profile_id=pg_temp.id(102) and d.status='skipped' and d.skip_reason='Training access, assignment, or reminder settings changed'),'suppressed delivery has visible skip receipt');
insert into public.facility_assignments(profile_id,facility_id) values(pg_temp.id(102),pg_temp.id(11));

-- Analytics must use the entire authorized filtered report, not the visible page.
select set_config('app.privileged_write','on',true);
update public.course_assignments set status='in_progress' where id=pg_temp.id(801);
insert into public.course_progress(assignment_id,percent_complete,started_at,updated_at) values(pg_temp.id(801),20,now()-interval '20 days',now()-interval '15 days')
on conflict(assignment_id) do update set percent_complete=20,started_at=excluded.started_at,updated_at=excluded.updated_at;
select set_config('app.privileged_write','off',true);
select pg_temp.act(102);
select ok(not (select prosecdef from pg_proc where oid='public.get_training_report_analytics(uuid,jsonb,integer)'::regprocedure),'analytics retains caller RLS rather than bypassing employee and enrollment policies');
select lives_ok($$select public.get_training_report_analytics(pg_temp.id(11))$$,'Training-only manager loads analytics without private-schema access');
select is((public.get_training_report_analytics(pg_temp.id(11))->>'matching_enrollments')::integer,4,'analytics sees all four facility assignments');
select is((public.get_training_report_analytics(pg_temp.id(11),'{}',14)->>'stalled_total')::integer,1,'started learning with stale progress appears for follow-up');
select is((public.get_training_report_analytics(pg_temp.id(11),'{}',30)->>'stalled_total')::integer,0,'longer inactivity window excludes recent progress');
select is((public.get_training_report_analytics(pg_temp.id(11),'{"department":"Housekeeping"}')->>'matching_enrollments')::integer,1,'analytics preserves department report filter');
select is((public.get_training_report_analytics(pg_temp.id(11),'{"purpose":"required"}')->>'matching_enrollments')::integer,3,'analytics preserves effective required denominator');
select is((select (d->>'required')::integer from jsonb_array_elements(public.get_training_report_analytics(pg_temp.id(11))->'departments') d where d->>'department'='Nursing'),2,'department denominator excludes optional learning');
select is((select (d->>'completed')::integer from jsonb_array_elements(public.get_training_report_analytics(pg_temp.id(11))->'departments') d where d->>'department'='Nursing'),1,'department completion uses actual completed work');
select is(jsonb_array_length(public.get_training_report_analytics(pg_temp.id(11))->'months'),12,'completion trend includes empty months');
select is((select sum((m->>'completions')::integer)::integer from jsonb_array_elements(public.get_training_report_analytics(pg_temp.id(11))->'months') m),1,'completion trend counts enrollments not people');
select throws_ok($$select public.get_training_report_analytics(pg_temp.id(11),'{}',0)$$,'22023',null,'inactivity window is bounded');
select throws_ok($$select public.get_training_report_analytics(pg_temp.id(12))$$,'42501',null,'analytics denies an unassigned facility');
select lives_ok($$select public.save_training_reminder_policy(pg_temp.id(11),'{"learner_enabled":false,"lead_days":2,"repeat_days":3,"digest_enabled":false,"digest_weekday":1,"escalation_days":14,"recipient_ids":[]}'::jsonb)$$,'administrator can disable follow-up and learner reminders');
reset role;
select set_config('request.jwt.claims','{}',true);
select ok(not app_private.training_delivery_scope_is_current((select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.notification_type='training_escalation_summary' and n.profile_id=pg_temp.id(102) limit 1)),'disabled digest suppresses queued escalation delivery');
select is((select due_date from public.course_assignments where id=pg_temp.id(801)),public.pa_today()-20,'all reporting and reminder actions preserve original deadline');
select * from finish();
rollback;
