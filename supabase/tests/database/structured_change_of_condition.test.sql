begin;
select plan(20);

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
  'Change', 'Worker', 'change-worker@test.local', 'Direct Care Staff', current_date, 'active'
);
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values (
  '59000000-0000-4000-8000-000000000201', '59000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000011', 'Jordan', 'Resident', current_date - 30, 'active'
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

select pg_temp.act_as('59000000-0000-4000-8000-000000000102');
insert into change_ids(key, id)
values (
  'event',
  public.create_resident_change_event(
    '59000000-0000-4000-8000-000000000201', 'fall', now(),
    'Resident found seated on floor beside chair; awake and responsive.',
    'Stayed with resident, ensured immediate safety, and notified supervisor.',
    'pending', 'pending', false, null,
    'Observe mobility, comfort, and behavior for any change.',
    'Every 2 hours', 24, '59000000-0000-4000-8000-000000000102',
    now() + interval '1 hour', 'required', true, true, null
  )
);
select is(
  (select category from public.resident_change_events where id = (select id from change_ids where key = 'event')),
  'fall',
  'frontline staff can capture a structured category and observations'
);
select ok(
  exists (
    select 1 from public.resident_compliance_items c
    join public.resident_change_events e on e.compliance_item_id = c.id
    where e.id = (select id from change_ids where key = 'event')
      and c.item_type = 'significant_change_reassessment'
      and c.due_date = current_date
  ),
  'human reassessment decision creates immediately due compliance work'
);
select ok(
  exists (
    select 1 from public.incidents i
    join public.resident_change_events e on e.incident_id = i.id
    where e.id = (select id from change_ids where key = 'event')
  ),
  'human incident-required decision creates a linked incident'
);
select ok(
  exists (
    select 1 from public.work_items w
    where w.source_type = 'change_of_condition'
      and w.source_id = (select id from change_ids where key = 'event')
  ),
  'change event creates owned follow-up work'
);
insert into change_ids(key, id)
select 'follow_up', id from public.resident_change_follow_ups
where event_id = (select id from change_ids where key = 'event');

select lives_ok(
  $$select public.add_change_event_monitoring(
    (select id from change_ids where key = 'event'), now(),
    'Resident resting comfortably; no new mobility or behavior change observed.',
    'Continued scheduled observation.', true
  )$$,
  'assigned employee records monitoring and supervisor notification'
);
select lives_ok(
  $$select public.record_change_event_notification(
    (select id from change_ids where key = 'event'), 'provider', 'completed',
    now(), 'phone', 'Primary care office', 'Provider informed; continue observation.'
  );
  select public.record_change_event_notification(
    (select id from change_ids where key = 'event'), 'designated_person', 'completed',
    now(), 'phone', 'Designated person', 'Designated person informed.'
  )$$,
  'provider and designated-person notifications are attributable'
);
select lives_ok(
  $$select public.complete_change_event_follow_up(
    (select id from change_ids where key = 'follow_up'),
    'No additional change observed during monitoring; submit for supervisor review.',
    null, null
  )$$,
  'assigned employee records follow-up results'
);
select is(
  (select status from public.resident_change_events where id = (select id from change_ids where key = 'event')),
  'pending_supervisor_review',
  'completed follow-up routes to final supervisor review'
);
select throws_ok(
  $$select public.close_resident_change_event(
    (select id from change_ids where key = 'event'), 'Employee attempting closure'
  )$$,
  '42501',
  null,
  'employee cannot perform final supervisor closure'
);

select pg_temp.act_as('59000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.close_resident_change_event(
    (select id from change_ids where key = 'event'),
    'Notifications, monitoring, incident linkage, and reassessment follow-up reviewed.'
  )$$,
  'manager completes final review and closure'
);
select is(
  (select status from public.resident_change_events where id = (select id from change_ids where key = 'event')),
  'closed',
  'event closes after all required decisions and follow-ups'
);
select is(
  (select count(*)::integer from public.resident_change_event_history
   where event_id = (select id from change_ids where key = 'event')),
  6,
  'immutable history retains create, monitoring, notifications, follow-up, and closure'
);
select throws_ok(
  $$delete from public.resident_change_event_history
    where event_id = (select id from change_ids where key = 'event')$$,
  '55000',
  null,
  'change event history cannot be deleted'
);

reset role;
update public.resident_change_events
set status = 'monitoring' where id = (select id from change_ids where key = 'event');
update public.resident_change_follow_ups
set status = 'open', due_at = now() - interval '1 minute',
  result = null, completed_by_profile_id = null, completed_at = null
where id = (select id from change_ids where key = 'follow_up');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(
  public.escalate_overdue_change_follow_ups(),
  1,
  'overdue follow-up escalation processes one event'
);
select is(
  (select status from public.resident_change_events where id = (select id from change_ids where key = 'event')),
  'follow_up_due',
  'overdue event is visible in urgent follow-up queue'
);

select * from finish();
rollback;
