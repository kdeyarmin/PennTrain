-- Daily Facility Operations and Workforce Execution foundation.
-- Reuses schedules, shift_assignments, work_items, notifications, resident service tasks,
-- open-shift opportunities, and the Operations Command Center instead of creating a duplicate
-- task/notification/scheduling subsystem.

create table public.workforce_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  request_type text not null default 'time_off' check (request_type in ('time_off','call_off','partial_shift_absence')),
  absence_category text check (absence_category in ('illness','family_emergency','transportation','bereavement','jury_duty','weather','personal','other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','canceled')),
  reason text,
  manager_reason text,
  shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
  requested_by uuid references public.profiles(id),
  idempotency_key text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (request_type <> 'call_off' or shift_assignment_id is not null),
  unique (organization_id, idempotency_key)
);
create index workforce_time_off_employee_idx on public.workforce_time_off_requests(employee_id, starts_at desc);
create index workforce_time_off_facility_status_idx on public.workforce_time_off_requests(facility_id, status, starts_at);
create trigger set_updated_at before update on public.workforce_time_off_requests for each row execute function public.set_updated_at();

create table public.shift_report_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  unit_id uuid references public.facility_units(id) on delete set null,
  shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
  resident_id uuid references public.residents(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  category text not null check (category in (
    'resident_condition_change','fall_or_injury','hospital_transfer_return','order_treatment_concern',
    'behavior','skin_concern','intake_hydration_concern','missed_refused_service','appointment',
    'provider_communication','staffing','maintenance','general_operations'
  )),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  shift_period_start timestamptz not null,
  shift_period_end timestamptz not null,
  narrative text not null check (length(btrim(narrative)) between 5 and 4000),
  author_profile_id uuid not null references public.profiles(id),
  follow_up_owner_profile_id uuid references public.profiles(id),
  requires_acknowledgement boolean not null default false,
  status text not null default 'open' check (status in ('open','carried_forward','reviewed','resolved','voided')),
  manager_reviewed_by uuid references public.profiles(id),
  manager_reviewed_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  linked_incident_id uuid references public.incidents(id) on delete set null,
  linked_complaint_id uuid references public.complaints(id) on delete set null,
  linked_change_event_id uuid references public.resident_change_events(id) on delete set null,
  linked_appointment_id uuid,
  linked_work_order_id uuid references public.work_orders(id) on delete set null,
  linked_work_item_id uuid references public.work_items(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (shift_period_end > shift_period_start),
  check (status <> 'resolved' or resolved_at is not null)
);
create index shift_report_open_idx on public.shift_report_entries(facility_id, status, priority, created_at desc);
create index shift_report_resident_idx on public.shift_report_entries(resident_id, created_at desc) where resident_id is not null;
create trigger set_updated_at before update on public.shift_report_entries for each row execute function public.set_updated_at();

create table public.shift_report_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_report_entry_id uuid not null references public.shift_report_entries(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (shift_report_entry_id, profile_id)
);
create index shift_report_ack_profile_idx on public.shift_report_acknowledgements(profile_id, acknowledged_at desc);

create table public.notification_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  event_type text not null,
  severity text not null default 'normal' check (severity in ('low','normal','high','urgent','critical')),
  recipient_role text not null check (recipient_role in ('org_admin','facility_manager','trainer','employee','auditor')),
  escalation_level integer not null default 1 check (escalation_level between 1 and 10),
  channel text not null check (channel in ('in_app','email','sms')),
  quiet_hours_start time,
  quiet_hours_end time,
  urgent_override boolean not null default false,
  repeat_limit integer not null default 3 check (repeat_limit between 0 and 50),
  fallback_channel text check (fallback_channel in ('in_app','email','sms')),
  template_key text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index notification_escalation_rules_lookup_idx on public.notification_escalation_rules(organization_id, facility_id, event_type, severity, is_active);

alter table public.workforce_time_off_requests enable row level security;
alter table public.shift_report_entries enable row level security;
alter table public.shift_report_acknowledgements enable row level security;
alter table public.notification_escalation_rules enable row level security;

create policy workforce_time_off_select on public.workforce_time_off_requests for select to authenticated using (
  public.is_platform_admin() or organization_id = public.current_org_id() and (
    public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)
    or exists (select 1 from public.employees e where e.id = employee_id and e.profile_id = auth.uid())
  )
);
create policy shift_report_select on public.shift_report_entries for select to authenticated using (
  public.is_platform_admin() or organization_id = public.current_org_id() and (
    public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)
    or author_profile_id = auth.uid() or follow_up_owner_profile_id = auth.uid()
  )
);
create policy shift_report_ack_select on public.shift_report_acknowledgements for select to authenticated using (
  public.is_platform_admin() or profile_id = auth.uid() or exists (
    select 1 from public.shift_report_entries e where e.id = shift_report_entry_id and e.organization_id = public.current_org_id()
      and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(e.facility_id))
  )
);
create policy notification_escalation_rules_select on public.notification_escalation_rules for select to authenticated using (
  public.is_platform_admin() or organization_id is null or organization_id = public.current_org_id()
);

revoke all on public.workforce_time_off_requests, public.shift_report_entries, public.shift_report_acknowledgements, public.notification_escalation_rules from public, anon, authenticated, service_role;
grant all on public.workforce_time_off_requests, public.shift_report_entries, public.shift_report_acknowledgements, public.notification_escalation_rules to service_role;
grant select on public.workforce_time_off_requests, public.shift_report_entries, public.shift_report_acknowledgements, public.notification_escalation_rules to authenticated;

create or replace function app_private.assert_daily_ops_manager(p_facility_id uuid)
returns public.facilities
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (v_fac.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v_fac.id))) then
    raise exception 'Not authorized for daily operations at this facility' using errcode = '42501';
  end if;
  return v_fac;
end;
$$;

create or replace function public.submit_time_off_request(
  p_employee_id uuid,
  p_facility_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_emp public.employees%rowtype; v_id uuid; v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'time-off:' || auth.uid()::text || ':' || p_employee_id::text || ':' || p_starts_at::text);
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode='P0002'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Time-off end must be after start' using errcode='22023'; end if;
  if not (public.is_platform_admin() or (v_emp.profile_id = auth.uid()) or (v_emp.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(p_facility_id))) then
    raise exception 'Not authorized to request time off for this employee' using errcode='42501';
  end if;
  insert into public.workforce_time_off_requests(organization_id, facility_id, employee_id, request_type, starts_at, ends_at, reason, requested_by, idempotency_key)
  values(v_emp.organization_id, p_facility_id, p_employee_id, 'time_off', p_starts_at, p_ends_at, nullif(btrim(p_reason), ''), auth.uid(), v_key)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.workforce_time_off_requests where employee_id = p_employee_id and starts_at = p_starts_at and ends_at = p_ends_at and status = 'pending' order by created_at desc limit 1;
  end if;
  return v_id;
end;
$$;

create or replace function public.decide_time_off_request(p_request_id uuid, p_status text, p_manager_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_req public.workforce_time_off_requests%rowtype; v_work uuid;
begin
  if p_status not in ('approved','denied','canceled') then raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into v_req from public.workforce_time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='P0002'; end if;
  perform app_private.assert_daily_ops_manager(v_req.facility_id);
  if v_req.status <> 'pending' then return true; end if;
  update public.workforce_time_off_requests set status = p_status, manager_reason = nullif(btrim(p_manager_reason), ''), decided_by = auth.uid(), decided_at = now() where id = p_request_id;
  insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, actor_profile_id, reason, evidence)
  select w.organization_id, w.facility_id, w.id, 'time_off_decision', auth.uid(), coalesce(nullif(btrim(p_manager_reason), ''), 'Time off ' || p_status), jsonb_build_object('requestId', p_request_id, 'status', p_status)
  from public.work_items w where w.source_type='rule_exception' and w.source_id = p_request_id;
  return true;
end;
$$;

create or replace function public.record_shift_call_off(p_shift_assignment_id uuid, p_category text, p_reason text, p_partial_starts_at timestamptz default null, p_partial_ends_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_shift public.shift_assignments%rowtype; v_emp public.employees%rowtype; v_req uuid; v_work uuid; v_template uuid;
begin
  if p_category not in ('illness','family_emergency','transportation','bereavement','jury_duty','weather','personal','other') then raise exception 'Invalid call-off category' using errcode='22023'; end if;
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id for update;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  select * into v_emp from public.employees where id = v_shift.employee_id;
  if not (public.is_platform_admin() or v_emp.profile_id = auth.uid() or (v_shift.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v_shift.facility_id))) then
    raise exception 'Not authorized to call off this shift' using errcode='42501';
  end if;
  insert into public.workforce_time_off_requests(organization_id, facility_id, employee_id, request_type, absence_category, starts_at, ends_at, status, reason, shift_assignment_id, requested_by, idempotency_key)
  values(v_shift.organization_id, v_shift.facility_id, v_shift.employee_id, case when p_partial_starts_at is null then 'call_off' else 'partial_shift_absence' end, p_category,
    coalesce(p_partial_starts_at, v_shift.shift_date + v_shift.start_time), coalesce(p_partial_ends_at, v_shift.shift_date + v_shift.end_time + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end),
    'approved', nullif(btrim(p_reason), ''), v_shift.id, auth.uid(), 'call-off:' || v_shift.id::text)
  on conflict do nothing returning id into v_req;
  if v_req is null then select id into v_req from public.workforce_time_off_requests where shift_assignment_id = v_shift.id and request_type in ('call_off','partial_shift_absence') order by created_at desc limit 1; end if;
  update public.shift_assignments set status = 'called_off', updated_at = now(), notes = concat_ws(E'\n', notes, 'Call-off: ' || coalesce(nullif(btrim(p_reason), ''), p_category)) where id = v_shift.id;
  select id into v_template from public.work_item_templates where (organization_id = v_shift.organization_id or organization_id is null) and template_key = 'daily_ops.unfilled_shift' order by organization_id nulls last limit 1;
  insert into public.work_items(organization_id, facility_id, template_id, source_type, source_id, deduplication_key, title, description, owner_profile_id, priority, due_at, created_by)
  values(v_shift.organization_id, v_shift.facility_id, v_template, 'rule_exception', v_req, 'call-off:' || v_shift.id::text, 'Unfilled shift after call-off', coalesce(nullif(btrim(p_reason), ''), p_category), null, 'high', now() + interval '30 minutes', auth.uid())
  on conflict (organization_id, deduplication_key) do update set updated_at = now() returning id into v_work;
  insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason, evidence)
  values(v_shift.organization_id, v_shift.facility_id, v_work, 'created', 'open', auth.uid(), 'Call-off created unfilled-shift work', jsonb_build_object('shiftAssignmentId', v_shift.id, 'requestId', v_req));
  return v_req;
end;
$$;

create or replace function public.create_shift_report_entry(
  p_facility_id uuid,
  p_unit_id uuid,
  p_shift_assignment_id uuid,
  p_resident_id uuid,
  p_category text,
  p_priority text,
  p_shift_period_start timestamptz,
  p_shift_period_end timestamptz,
  p_narrative text,
  p_follow_up_owner_profile_id uuid default null,
  p_requires_acknowledgement boolean default false,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_fac public.facilities%rowtype; v_id uuid; v_work uuid; v_template uuid; v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), 'shift-log:' || auth.uid()::text || ':' || extensions.gen_random_uuid()::text);
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority' using errcode='22023'; end if;
  if not (public.is_platform_admin() or (v_fac.organization_id = public.current_org_id() and (public.current_role() in ('org_admin','facility_manager','trainer') or public.is_own_employee_assigned_to_facility(v_fac.id)))) then
    raise exception 'Not authorized to create shift report entry' using errcode='42501';
  end if;
  insert into public.shift_report_entries(organization_id, facility_id, unit_id, shift_assignment_id, resident_id, category, priority, shift_period_start, shift_period_end, narrative, author_profile_id, follow_up_owner_profile_id, requires_acknowledgement, idempotency_key)
  values(v_fac.organization_id, v_fac.id, p_unit_id, p_shift_assignment_id, p_resident_id, p_category, p_priority, p_shift_period_start, p_shift_period_end, btrim(p_narrative), auth.uid(), p_follow_up_owner_profile_id, p_requires_acknowledgement, v_key)
  on conflict (organization_id, idempotency_key) do update set updated_at = public.shift_report_entries.updated_at returning id into v_id;
  if p_priority in ('high','urgent') or p_requires_acknowledgement then
    select id into v_template from public.work_item_templates where (organization_id = v_fac.organization_id or organization_id is null) and template_key = 'daily_ops.shift_handoff' order by organization_id nulls last limit 1;
    insert into public.work_items(organization_id, facility_id, template_id, source_type, source_id, deduplication_key, title, description, owner_profile_id, priority, due_at, created_by)
    values(v_fac.organization_id, v_fac.id, v_template, 'rule_exception', v_id, 'shift-log:' || v_id::text, 'Urgent handoff: ' || replace(p_category,'_',' '), left(btrim(p_narrative), 500), p_follow_up_owner_profile_id, p_priority, now() + case when p_priority='urgent' then interval '1 hour' else interval '8 hours' end, auth.uid())
    on conflict (organization_id, deduplication_key) do update set updated_at=now() returning id into v_work;
    update public.shift_report_entries set linked_work_item_id = v_work where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.acknowledge_shift_report_entry(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.shift_report_entries%rowtype;
begin
  select * into v from public.shift_report_entries where id = p_entry_id;
  if not found then raise exception 'Shift report entry not found' using errcode='P0002'; end if;
  if not (public.is_platform_admin() or v.organization_id = public.current_org_id()) then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.shift_report_acknowledgements(organization_id, shift_report_entry_id, profile_id)
  values(v.organization_id, v.id, auth.uid()) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.resolve_shift_report_entry(p_entry_id uuid, p_resolution_note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.shift_report_entries%rowtype;
begin
  select * into v from public.shift_report_entries where id = p_entry_id for update;
  if not found then raise exception 'Shift report entry not found' using errcode='P0002'; end if;
  perform app_private.assert_daily_ops_manager(v.facility_id);
  if length(btrim(coalesce(p_resolution_note,''))) < 5 then raise exception 'Resolution note is required' using errcode='22023'; end if;
  update public.shift_report_entries set status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_note=btrim(p_resolution_note) where id=v.id;
  if v.linked_work_item_id is not null then perform public.transition_work_item(v.linked_work_item_id, 'closed', btrim(p_resolution_note)); end if;
  return true;
end;
$$;

create or replace function public.get_my_shift_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_employee public.employees%rowtype; v_shift jsonb; v_result jsonb;
begin
  select * into v_employee from public.employees where profile_id = auth.uid() limit 1;
  if not found then return jsonb_build_object('employee', null, 'currentOrNextShift', null, 'handoffItems', '[]'::jsonb, 'residentServiceTasks', '[]'::jsonb, 'workItems', '[]'::jsonb, 'notifications', '[]'::jsonb, 'openShiftOffers', '[]'::jsonb, 'timeOffRequests', '[]'::jsonb, 'upcomingShifts', '[]'::jsonb); end if;
  select to_jsonb(s) into v_shift from (
    select sa.*, f.name as facility_name, u.name as unit_name, sd.name as shift_name
    from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id
    where sa.employee_id=v_employee.id and sa.shift_date >= current_date and sa.status in ('scheduled','confirmed') order by sa.shift_date, sa.start_time limit 1
  ) s;
  select jsonb_build_object(
    'employee', jsonb_build_object('id', v_employee.id, 'name', btrim(v_employee.first_name || ' ' || v_employee.last_name), 'status', v_employee.status),
    'currentOrNextShift', v_shift,
    'handoffItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.created_at desc) from (select id, category, priority, narrative, requires_acknowledgement, status, created_at, linked_work_item_id from public.shift_report_entries where facility_id = coalesce((v_shift->>'facility_id')::uuid, v_employee.facility_id) and status in ('open','carried_forward') limit 20) x), '[]'::jsonb),
    'residentServiceTasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_start) from (select id, resident_id, service_name, scheduled_start, scheduled_end, status from public.resident_service_task_instances where assigned_employee_id = v_employee.id and scheduled_start >= now() - interval '4 hours' and scheduled_start < now() + interval '16 hours' and status not in ('completed','superseded') limit 20) x), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at) from (select id, title, priority, due_at, state, source_type, source_id from public.work_items where owner_profile_id = auth.uid() and state not in ('closed','canceled') order by due_at limit 20) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, notification_type, title, body, link, created_at from public.notifications where profile_id=auth.uid() and read_at is null order by created_at desc limit 10) x), '[]'::jsonb),
    'openShiftOffers', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select id, facility_id, shift_date, start_time, end_time, status from public.open_shift_opportunities where organization_id=v_employee.organization_id and status='open' and shift_date >= current_date order by shift_date, start_time limit 10) x), '[]'::jsonb),
    'timeOffRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select id, request_type, starts_at, ends_at, status, absence_category from public.workforce_time_off_requests where employee_id=v_employee.id order by starts_at desc limit 10) x), '[]'::jsonb),
    'upcomingShifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select sa.id, sa.shift_date, sa.start_time, sa.end_time, sa.status, f.name as facility_name, u.name as unit_name, sd.name as shift_name from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id where sa.employee_id=v_employee.id and sa.shift_date >= current_date order by sa.shift_date, sa.start_time limit 7) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_daily_operations_command_center(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_base jsonb := '{}'::jsonb; v_facility uuid := p_facility_id;
begin
  if v_facility is not null then v_base := public.get_operations_command_center(v_facility); end if;
  return v_base || jsonb_build_object(
    'generatedAt', now(),
    'facilityId', v_facility,
    'dailyExecution', jsonb_build_object(
      'unfilledShifts', (select count(*) from public.work_items where (v_facility is null or facility_id=v_facility) and source_type='rule_exception' and state not in ('closed','canceled') and deduplication_key like 'call-off:%'),
      'openHandoffItems', (select count(*) from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward')),
      'urgentHandoffItems', (select count(*) from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward') and priority='urgent'),
      'pendingTimeOff', (select count(*) from public.workforce_time_off_requests where (v_facility is null or facility_id=v_facility) and status='pending'),
      'openShiftOffers', (select count(*) from public.open_shift_opportunities where (v_facility is null or facility_id=v_facility) and status='open'),
      'unreadUrgentNotifications', (select count(*) from public.notifications n where n.read_at is null and n.notification_type in ('training_expired'))
    ),
    'morningHuddle', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.due_at nulls last) from (
      select 'work_item' as kind, id, title, priority, due_at, state, '/app/work/' || id::text as href from public.work_items where (v_facility is null or facility_id=v_facility) and state not in ('closed','canceled')
      union all
      select 'handoff', id, replace(category,'_',' '), priority, created_at, status, '/app/shift-log' from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward')
      limit 50
    ) x), '[]'::jsonb)
  );
end;
$$;

insert into public.work_item_templates(template_key, name, source_type, default_priority, due_interval, approval_required, default_owner_role)
values
  ('daily_ops.unfilled_shift', 'Unfilled shift coverage', 'rule_exception', 'high', interval '30 minutes', false, 'facility_manager'),
  ('daily_ops.shift_handoff', 'Urgent shift handoff follow-up', 'rule_exception', 'high', interval '8 hours', false, 'facility_manager')
on conflict (organization_id, template_key) do nothing;

revoke all on function public.submit_time_off_request(uuid,uuid,timestamptz,timestamptz,text,text) from public, anon;
revoke all on function public.decide_time_off_request(uuid,text,text) from public, anon;
revoke all on function public.record_shift_call_off(uuid,text,text,timestamptz,timestamptz) from public, anon;
revoke all on function public.create_shift_report_entry(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,uuid,boolean,text) from public, anon;
revoke all on function public.acknowledge_shift_report_entry(uuid) from public, anon;
revoke all on function public.resolve_shift_report_entry(uuid,text) from public, anon;
revoke all on function public.get_my_shift_workspace() from public, anon;
revoke all on function public.get_daily_operations_command_center(uuid) from public, anon;
grant execute on function public.submit_time_off_request(uuid,uuid,timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.decide_time_off_request(uuid,text,text) to authenticated;
grant execute on function public.record_shift_call_off(uuid,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.create_shift_report_entry(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,uuid,boolean,text) to authenticated;
grant execute on function public.acknowledge_shift_report_entry(uuid) to authenticated;
grant execute on function public.resolve_shift_report_entry(uuid,text) to authenticated;
grant execute on function public.get_my_shift_workspace() to authenticated;
grant execute on function public.get_daily_operations_command_center(uuid) to authenticated;
