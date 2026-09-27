begin;
select plan(14);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e9270946-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;

insert into public.organizations(id,name,slug,subscription_status)
values(pg_temp.id(1),'Workforce evidence trigger fixture','workforce-evidence-trigger-fixture','active');
insert into public.facilities(id,organization_id,name,facility_type)
values(pg_temp.id(11),pg_temp.id(1),'Workforce evidence facility','PCH');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status,hire_date)
values(pg_temp.id(101),pg_temp.id(1),pg_temp.id(11),'Evidence','Fixture','Aide','active',public.pa_today());

-- Use the real employee's automatically provisioned person. These isolated
-- events carry no downstream references, so a positive DELETE tests the guard
-- instead of failing on a retention FK. The actual import RPC is also covered
-- by carebase_activation_wave and import_control_plane_trust.
insert into public.employment_lifecycle_events(id,organization_id,facility_id,person_id,employee_id,
  event_type,effective_on,reason,evidence)
select pg_temp.id(n),pg_temp.id(1),pg_temp.id(11),l.person_id,pg_temp.id(101),
  'hired',public.pa_today(),'Original fixture evidence',
  case n when 201 then '{"source":"employee_insert"}'::jsonb
    when 202 then '{"source":"governed_transition"}'::jsonb else '{}'::jsonb end
from public.workforce_employee_links l cross join generate_series(201,203) n
where l.employee_id=pg_temp.id(101) and l.effective_to is null;
insert into public.employment_lifecycle_dispositions(id,organization_id,facility_id,employee_id,
  lifecycle_event_id,target_type,target_id,disposition_action,prior_state,resulting_state)
values(pg_temp.id(301),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),pg_temp.id(202),
  'course_assignment',pg_temp.id(401),'paused','{"status":"assigned"}','{"status":"paused"}');

select is((select count(*)::integer from public.employment_lifecycle_events where id in(pg_temp.id(201),pg_temp.id(202),pg_temp.id(203))),
  3,'all three guard cases use real lifecycle event rows');
select ok(not has_function_privilege('authenticated','app_private.prevent_immutable_workforce_evidence_mutation()','EXECUTE')
  and not has_function_privilege('service_role','app_private.prevent_immutable_workforce_evidence_mutation()','EXECUTE'),
  'the trigger helper remains inaccessible to application roles');

select set_config('app.allow_employee_import_rollback','off',true);
select throws_ok($$delete from public.employment_lifecycle_events where id=pg_temp.id(201)$$,
  '55000','employment lifecycle evidence is append-only','an import-created event is retained without the governed rollback flag');
select throws_ok($$update public.employment_lifecycle_events set reason='Changed' where id=pg_temp.id(201)$$,
  '55000','employment lifecycle evidence is append-only','lifecycle event updates remain forbidden');
select throws_ok($$update public.employment_lifecycle_dispositions set resulting_state='{}' where id=pg_temp.id(301)$$,
  '55000','employment lifecycle evidence is append-only','disposition updates return the intended retention error without reading an absent field');
select throws_ok($$delete from public.employment_lifecycle_dispositions where id=pg_temp.id(301)$$,
  '55000','employment lifecycle evidence is append-only','disposition deletes return the intended retention error');

select set_config('app.allow_employee_import_rollback','on',true);
select throws_ok($$update public.employment_lifecycle_dispositions set resulting_state='{}' where id=pg_temp.id(301)$$,
  '55000','employment lifecycle evidence is append-only','the import flag never authorizes disposition updates');
select throws_ok($$delete from public.employment_lifecycle_dispositions where id=pg_temp.id(301)$$,
  '55000','employment lifecycle evidence is append-only','the import flag never authorizes disposition deletion');
select throws_ok($$update public.employment_lifecycle_events set reason='Changed' where id=pg_temp.id(201)$$,
  '55000','employment lifecycle evidence is append-only','the import flag permits no rewrite of an import-created event');
select throws_ok($$delete from public.employment_lifecycle_events where id=pg_temp.id(202)$$,
  '55000','employment lifecycle evidence is append-only','the import flag does not authorize events from another source');
select throws_ok($$delete from public.employment_lifecycle_events where id=pg_temp.id(203)$$,
  '55000','employment lifecycle evidence is append-only','missing source evidence cannot authorize rollback');
select lives_ok($$delete from public.employment_lifecycle_events where id=pg_temp.id(201)$$,
  'the exact import-created event rollback exception still permits deletion');
select is((select count(*)::integer from public.employment_lifecycle_events where id=pg_temp.id(201)),0,
  'the permitted import event was actually removed');
select ok((select count(*)=2 and bool_and(reason='Original fixture evidence')
    from public.employment_lifecycle_events where id in(pg_temp.id(202),pg_temp.id(203)))
  and (select prior_state='{"status":"assigned"}'::jsonb and resulting_state='{"status":"paused"}'::jsonb
    from public.employment_lifecycle_dispositions where id=pg_temp.id(301)),
  'all rejected event and disposition writes preserve the original evidence');

select * from finish();
rollback;
