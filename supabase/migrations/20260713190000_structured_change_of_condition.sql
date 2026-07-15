-- Priority 5: structured, non-diagnostic change-of-condition operations.
-- These records guide observation, notification, monitoring, reassessment, support-plan
-- review, incident linkage, and supervisor closure without creating clinical orders.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi', 'change_of_condition'
  ));

insert into public.work_item_templates(
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values (
  'resident.change_of_condition', 'Resident change-of-condition follow-up',
  'change_of_condition', 'high', interval '4 hours', true, interval '1 hour',
  'facility_manager'
)
on conflict (organization_id, template_key) do nothing;

create table public.resident_change_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  category text not null check (category in (
    'fall', 'emergency_department_visit', 'hospital_return', 'mobility_decline',
    'skin_concern', 'appetite_intake_change', 'weight_concern',
    'mental_status_change', 'behavioral_change', 'infection_symptoms',
    'continence_change', 'new_supervision_concern',
    'hospice_end_of_life_change', 'other_significant_change'
  )),
  identified_at timestamptz not null,
  identified_by_profile_id uuid references public.profiles(id),
  identified_by_name text,
  immediate_observations text not null,
  immediate_action_taken text not null,
  provider_notification_status text not null default 'pending' check (
    provider_notification_status in ('not_required', 'pending', 'completed', 'unable_to_reach')
  ),
  provider_notified_at timestamptz,
  provider_notification_method text,
  provider_notification_contact text,
  provider_notification_notes text,
  designated_person_notification_status text not null default 'pending' check (
    designated_person_notification_status in ('not_required', 'pending', 'completed', 'unable_to_reach')
  ),
  designated_person_notified_at timestamptz,
  designated_person_notification_method text,
  designated_person_notification_contact text,
  designated_person_notification_notes text,
  emergency_transfer boolean not null default false,
  emergency_transfer_at timestamptz,
  emergency_transfer_destination text,
  monitoring_instructions text,
  monitoring_frequency text,
  monitoring_duration_hours integer check (
    monitoring_duration_hours is null or monitoring_duration_hours between 1 and 720
  ),
  monitoring_ends_at timestamptz,
  assigned_profile_id uuid references public.profiles(id),
  follow_up_due_at timestamptz not null,
  incident_decision text not null default 'pending' check (
    incident_decision in ('pending', 'required', 'not_required')
  ),
  incident_id uuid references public.incidents(id) on delete set null,
  reassessment_required boolean not null default true,
  compliance_item_id uuid references public.resident_compliance_items(id) on delete set null,
  support_plan_revision_required boolean not null default true,
  source_service_alert_id uuid references public.service_task_alerts(id) on delete set null,
  status text not null default 'open' check (status in (
    'open', 'monitoring', 'follow_up_due', 'pending_supervisor_review', 'closed'
  )),
  final_review_summary text,
  closed_by_profile_id uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not emergency_transfer or emergency_transfer_at is not null),
  check (status <> 'closed' or (closed_at is not null and final_review_summary is not null))
);
create index resident_change_events_queue_idx
  on public.resident_change_events(organization_id, facility_id, status, follow_up_due_at);
create index resident_change_events_resident_idx
  on public.resident_change_events(resident_id, identified_at desc);

create table public.resident_change_monitoring_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_change_events(id) on delete restrict,
  observed_at timestamptz not null default now(),
  observations text not null,
  action_taken text,
  supervisor_notified boolean not null default false,
  recorded_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index resident_change_monitoring_event_idx
  on public.resident_change_monitoring_entries(event_id, observed_at desc);

create table public.resident_change_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_change_events(id) on delete restrict,
  assigned_profile_id uuid references public.profiles(id),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'overdue', 'completed', 'canceled')),
  result text,
  completed_by_profile_id uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or (result is not null and completed_at is not null))
);
create index resident_change_followups_queue_idx
  on public.resident_change_follow_ups(organization_id, facility_id, status, due_at);

create table public.resident_change_event_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_change_events(id) on delete restrict,
  event_type text not null,
  prior_status text,
  resulting_status text,
  reason text not null,
  actor_profile_id uuid references public.profiles(id),
  evidence jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index resident_change_history_event_idx
  on public.resident_change_event_history(event_id, occurred_at desc);

alter table public.resident_change_events enable row level security;
alter table public.resident_change_monitoring_entries enable row level security;
alter table public.resident_change_follow_ups enable row level security;
alter table public.resident_change_event_history enable row level security;

create or replace function app_private.change_event_visible(
  p_org uuid,
  p_fac uuid,
  p_identified_by uuid,
  p_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or (
      p_org = public.current_org_id()
      and (
        public.current_role() in ('org_admin', 'auditor')
        or (
          public.current_role() = 'facility_manager'
          and public.is_assigned_to_facility(p_fac)
        )
        or (
          public.current_role() = 'employee'
          and auth.uid() in (p_identified_by, p_assigned_to)
        )
      )
    )
$$;
revoke all on function app_private.change_event_visible(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.change_event_visible(uuid, uuid, uuid, uuid)
  to authenticated;

create policy resident_change_events_select on public.resident_change_events
for select to authenticated
using (
  app_private.change_event_visible(
    organization_id, facility_id, identified_by_profile_id, assigned_profile_id
  )
);
create policy resident_change_monitoring_select on public.resident_change_monitoring_entries
for select to authenticated
using (
  exists (
    select 1 from public.resident_change_events e
    where e.id = event_id
      and app_private.change_event_visible(
        e.organization_id, e.facility_id, e.identified_by_profile_id, e.assigned_profile_id
      )
  )
);
create policy resident_change_followups_select on public.resident_change_follow_ups
for select to authenticated
using (
  exists (
    select 1 from public.resident_change_events e
    where e.id = event_id
      and app_private.change_event_visible(
        e.organization_id, e.facility_id, e.identified_by_profile_id, e.assigned_profile_id
      )
  )
);
create policy resident_change_history_select on public.resident_change_event_history
for select to authenticated
using (
  exists (
    select 1 from public.resident_change_events e
    where e.id = event_id
      and app_private.change_event_visible(
        e.organization_id, e.facility_id, e.identified_by_profile_id, e.assigned_profile_id
      )
  )
);

do $$
declare t text;
begin
  foreach t in array array[
    'resident_change_events', 'resident_change_monitoring_entries',
    'resident_change_follow_ups', 'resident_change_event_history'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

create trigger prevent_resident_change_history_mutation
before update or delete on public.resident_change_event_history
for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_resident_change_monitoring_mutation
before update or delete on public.resident_change_monitoring_entries
for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function app_private.assert_change_event_contributor(
  p_org uuid,
  p_fac uuid,
  p_assigned_profile_id uuid default null,
  p_manager_required boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_employee public.employees%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null or public.current_org_id() <> p_org then
    raise exception 'Change event operation is outside caller scope' using errcode = '42501';
  end if;
  if public.current_role() in ('org_admin', 'facility_manager') then
    if public.current_role() = 'facility_manager' and not public.is_assigned_to_facility(p_fac) then
      raise exception 'Change event operation is outside caller scope' using errcode = '42501';
    end if;
    return;
  end if;
  if p_manager_required or public.current_role() <> 'employee' then
    raise exception 'Manager access is required' using errcode = '42501';
  end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active' and e.facility_id = p_fac;
  if v_employee.id is null
    or (p_assigned_profile_id is not null and p_assigned_profile_id <> auth.uid()) then
    raise exception 'Change event operation is outside employee scope' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_change_event_contributor(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.create_resident_change_event(
  p_resident_id uuid,
  p_category text,
  p_identified_at timestamptz,
  p_immediate_observations text,
  p_immediate_action_taken text,
  p_provider_notification_status text,
  p_designated_person_notification_status text,
  p_emergency_transfer boolean,
  p_emergency_transfer_destination text,
  p_monitoring_instructions text,
  p_monitoring_frequency text,
  p_monitoring_duration_hours integer,
  p_assigned_profile_id uuid,
  p_follow_up_due_at timestamptz,
  p_incident_decision text,
  p_reassessment_required boolean,
  p_support_plan_revision_required boolean,
  p_source_service_alert_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_facility_type text;
  v_assigned uuid;
  v_event uuid;
  v_item uuid;
  v_incident uuid;
  v_citation uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_change_event_contributor(
    v_resident.organization_id, v_resident.facility_id, p_assigned_profile_id, false
  );
  select facility_type into v_facility_type from public.facilities where id = v_resident.facility_id;
  if v_facility_type not in ('PCH', 'ALR') then
    raise exception 'Change-of-condition workflow is not supported for this facility type'
      using errcode = '0A000';
  end if;
  if p_category not in (
    'fall', 'emergency_department_visit', 'hospital_return', 'mobility_decline',
    'skin_concern', 'appetite_intake_change', 'weight_concern',
    'mental_status_change', 'behavioral_change', 'infection_symptoms',
    'continence_change', 'new_supervision_concern',
    'hospice_end_of_life_change', 'other_significant_change'
  ) or length(btrim(coalesce(p_immediate_observations, ''))) < 3
    or length(btrim(coalesce(p_immediate_action_taken, ''))) < 3
    or p_provider_notification_status not in ('not_required', 'pending', 'completed', 'unable_to_reach')
    or p_designated_person_notification_status not in ('not_required', 'pending', 'completed', 'unable_to_reach')
    or p_incident_decision not in ('pending', 'required', 'not_required')
    or p_follow_up_due_at < p_identified_at
    or (p_emergency_transfer and length(btrim(coalesce(p_emergency_transfer_destination, ''))) < 2)
    or (p_monitoring_duration_hours is not null and p_monitoring_duration_hours not between 1 and 720) then
    raise exception 'Invalid change-of-condition event' using errcode = '22023';
  end if;
  v_assigned := coalesce(p_assigned_profile_id, auth.uid());
  if v_assigned is not null and not exists (
    select 1 from public.profiles p
    where p.id = v_assigned and p.organization_id = v_resident.organization_id and p.is_active
  ) then raise exception 'Assigned staff is outside organization' using errcode = '22023'; end if;
  if p_source_service_alert_id is not null and not exists (
    select 1 from public.service_task_alerts a
    where a.id = p_source_service_alert_id
      and a.resident_id = v_resident.id
      and a.facility_id = v_resident.facility_id
  ) then raise exception 'Service alert is outside resident scope' using errcode = '22023'; end if;

  if p_reassessment_required then
    select id into v_citation from public.dhs_citation_topics
    where citation_ref = case when v_facility_type = 'ALR' then '2800.225' else '2600.225' end
    limit 1;
    insert into public.resident_compliance_items(
      organization_id, facility_id, resident_id, item_type, due_date,
      renewal_interval_days, warning_days, grace_period_days, notes, citation_topic_id
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id,
      'significant_change_reassessment', current_date, null, 2, 0,
      btrim(p_immediate_observations), v_citation
    ) returning id into v_item;
  end if;
  if p_incident_decision = 'required' then
    insert into public.incidents(
      organization_id, facility_id, incident_type, occurred_at,
      reported_by_profile_id, resident_identifier, narrative, severity
    ) values (
      v_resident.organization_id, v_resident.facility_id, 'other', p_identified_at,
      auth.uid(), v_resident.id::text,
      'Change-of-condition event: ' || btrim(p_immediate_observations)
        || E'\nImmediate action: ' || btrim(p_immediate_action_taken),
      case when p_emergency_transfer then 'major' else 'moderate' end
    ) returning id into v_incident;
  end if;
  insert into public.resident_change_events(
    organization_id, facility_id, resident_id, category, identified_at,
    identified_by_profile_id, identified_by_name,
    immediate_observations, immediate_action_taken,
    provider_notification_status, designated_person_notification_status,
    emergency_transfer, emergency_transfer_at, emergency_transfer_destination,
    monitoring_instructions, monitoring_frequency, monitoring_duration_hours,
    monitoring_ends_at, assigned_profile_id, follow_up_due_at,
    incident_decision, incident_id, reassessment_required, compliance_item_id,
    support_plan_revision_required, source_service_alert_id, status
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_category,
    p_identified_at, auth.uid(),
    (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = auth.uid()),
    btrim(p_immediate_observations), btrim(p_immediate_action_taken),
    p_provider_notification_status, p_designated_person_notification_status,
    p_emergency_transfer, case when p_emergency_transfer then p_identified_at else null end,
    nullif(btrim(p_emergency_transfer_destination), ''),
    nullif(btrim(p_monitoring_instructions), ''), nullif(btrim(p_monitoring_frequency), ''),
    p_monitoring_duration_hours,
    case when p_monitoring_duration_hours is null then null
      else p_identified_at + make_interval(hours => p_monitoring_duration_hours) end,
    v_assigned, p_follow_up_due_at, p_incident_decision, v_incident,
    p_reassessment_required, v_item, p_support_plan_revision_required,
    p_source_service_alert_id,
    case when nullif(btrim(p_monitoring_instructions), '') is not null then 'monitoring' else 'open' end
  ) returning id into v_event;
  insert into public.resident_change_follow_ups(
    organization_id, facility_id, event_id, assigned_profile_id, due_at
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_event, v_assigned, p_follow_up_due_at
  );
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, resulting_status,
    reason, actor_profile_id, evidence
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_event, 'created',
    case when nullif(btrim(p_monitoring_instructions), '') is not null then 'monitoring' else 'open' end,
    'Structured change-of-condition event created', auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'complianceItemId', v_item, 'incidentId', v_incident,
      'sourceServiceAlertId', p_source_service_alert_id
    ))
  );
  perform app_private.create_automatic_work_item(
    v_resident.organization_id, v_resident.facility_id,
    'resident.change_of_condition', 'change_of_condition', v_event,
    'Follow up ' || replace(p_category, '_', ' ') || ' for '
      || v_resident.first_name || ' ' || v_resident.last_name,
    'Complete notifications, monitoring, follow-up, reassessment decision, and supervisor review.',
    case when p_emergency_transfer then 'urgent' else 'high' end,
    p_follow_up_due_at
  );
  if p_source_service_alert_id is not null then
    update public.service_task_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
    where id = p_source_service_alert_id and status = 'open';
  end if;
  return v_event;
end;
$$;

create or replace function public.get_change_event_resident_options()
returns table (id uuid, first_name text, last_name text, room text, facility_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.current_role();
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  return query
  select r.id, r.first_name, r.last_name, r.room, r.facility_id
  from public.residents r
  where r.status in ('active', 'temporarily_out', 'hospital_leave')
    and (
      public.is_platform_admin()
      or (
        r.organization_id = public.current_org_id()
        and (
          v_role in ('org_admin', 'auditor')
          or (v_role = 'facility_manager' and public.is_assigned_to_facility(r.facility_id))
          or (v_role = 'employee' and r.facility_id = v_employee.facility_id)
        )
      )
    )
  order by r.last_name, r.first_name;
end;
$$;

create or replace function public.record_change_event_notification(
  p_event_id uuid,
  p_party text,
  p_status text,
  p_notified_at timestamptz,
  p_method text,
  p_contact text,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_change_events%rowtype;
begin
  select * into v from public.resident_change_events where id = p_event_id for update;
  if not found then raise exception 'Change event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_change_event_contributor(
    v.organization_id, v.facility_id, v.assigned_profile_id, false
  );
  if p_party not in ('provider', 'designated_person')
    or p_status not in ('not_required', 'pending', 'completed', 'unable_to_reach')
    or (p_status = 'completed' and p_notified_at is null) then
    raise exception 'Invalid notification update' using errcode = '22023';
  end if;
  if p_party = 'provider' then
    update public.resident_change_events
    set provider_notification_status = p_status,
      provider_notified_at = p_notified_at,
      provider_notification_method = nullif(btrim(p_method), ''),
      provider_notification_contact = nullif(btrim(p_contact), ''),
      provider_notification_notes = nullif(btrim(p_notes), ''),
      updated_at = now()
    where id = v.id;
  else
    update public.resident_change_events
    set designated_person_notification_status = p_status,
      designated_person_notified_at = p_notified_at,
      designated_person_notification_method = nullif(btrim(p_method), ''),
      designated_person_notification_contact = nullif(btrim(p_contact), ''),
      designated_person_notification_notes = nullif(btrim(p_notes), ''),
      updated_at = now()
    where id = v.id;
  end if;
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, prior_status,
    resulting_status, reason, actor_profile_id, evidence
  ) values (
    v.organization_id, v.facility_id, v.id, 'notification', v.status, v.status,
    replace(p_party, '_', ' ') || ' notification updated to ' || replace(p_status, '_', ' '),
    auth.uid(), jsonb_strip_nulls(jsonb_build_object(
      'party', p_party, 'status', p_status, 'notifiedAt', p_notified_at,
      'method', nullif(btrim(p_method), ''), 'contact', nullif(btrim(p_contact), '')
    ))
  );
  return true;
end;
$$;

create or replace function public.add_change_event_monitoring(
  p_event_id uuid,
  p_observed_at timestamptz,
  p_observations text,
  p_action_taken text default null,
  p_supervisor_notified boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_change_events%rowtype;
  v_id uuid;
begin
  select * into v from public.resident_change_events where id = p_event_id for update;
  if not found then raise exception 'Change event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_change_event_contributor(
    v.organization_id, v.facility_id, v.assigned_profile_id, false
  );
  if v.status = 'closed' or length(btrim(coalesce(p_observations, ''))) < 3 then
    raise exception 'Invalid monitoring entry' using errcode = '22023';
  end if;
  insert into public.resident_change_monitoring_entries(
    organization_id, facility_id, event_id, observed_at, observations,
    action_taken, supervisor_notified, recorded_by_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, p_observed_at,
    btrim(p_observations), nullif(btrim(p_action_taken), ''),
    p_supervisor_notified, auth.uid()
  ) returning id into v_id;
  update public.resident_change_events set status = 'monitoring', updated_at = now()
  where id = v.id and status in ('open', 'follow_up_due');
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, prior_status,
    resulting_status, reason, actor_profile_id, evidence
  ) values (
    v.organization_id, v.facility_id, v.id, 'monitoring_entry', v.status,
    case when v.status in ('open', 'follow_up_due') then 'monitoring' else v.status end,
    'Monitoring observation recorded', auth.uid(),
    jsonb_build_object('monitoringEntryId', v_id, 'supervisorNotified', p_supervisor_notified)
  );
  return v_id;
end;
$$;

create or replace function public.complete_change_event_follow_up(
  p_follow_up_id uuid,
  p_result text,
  p_next_follow_up_due_at timestamptz default null,
  p_next_assigned_profile_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_follow public.resident_change_follow_ups%rowtype;
  v_event public.resident_change_events%rowtype;
  v_resulting text;
begin
  select * into v_follow from public.resident_change_follow_ups
  where id = p_follow_up_id for update;
  if not found then raise exception 'Follow-up not found' using errcode = 'P0002'; end if;
  select * into v_event from public.resident_change_events where id = v_follow.event_id for update;
  perform app_private.assert_change_event_contributor(
    v_event.organization_id, v_event.facility_id, v_follow.assigned_profile_id, false
  );
  if v_follow.status not in ('open', 'overdue')
    or length(btrim(coalesce(p_result, ''))) < 3
    or (p_next_follow_up_due_at is not null and p_next_follow_up_due_at <= now()) then
    raise exception 'Invalid follow-up completion' using errcode = '22023';
  end if;
  update public.resident_change_follow_ups
  set status = 'completed', result = btrim(p_result),
    completed_by_profile_id = auth.uid(), completed_at = now()
  where id = v_follow.id;
  if p_next_follow_up_due_at is not null then
    insert into public.resident_change_follow_ups(
      organization_id, facility_id, event_id, assigned_profile_id, due_at
    ) values (
      v_event.organization_id, v_event.facility_id, v_event.id,
      coalesce(p_next_assigned_profile_id, v_event.assigned_profile_id),
      p_next_follow_up_due_at
    );
    update public.resident_change_events
    set follow_up_due_at = p_next_follow_up_due_at, status = 'monitoring', updated_at = now()
    where id = v_event.id;
    v_resulting := 'monitoring';
  else
    update public.resident_change_events
    set status = 'pending_supervisor_review', updated_at = now()
    where id = v_event.id;
    v_resulting := 'pending_supervisor_review';
  end if;
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, prior_status,
    resulting_status, reason, actor_profile_id, evidence
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'follow_up_completed',
    v_event.status, v_resulting, btrim(p_result), auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'followUpId', v_follow.id, 'nextDueAt', p_next_follow_up_due_at
    ))
  );
  return true;
end;
$$;

create or replace function public.close_resident_change_event(
  p_event_id uuid,
  p_final_review_summary text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_change_events%rowtype;
begin
  select * into v from public.resident_change_events where id = p_event_id for update;
  if not found then raise exception 'Change event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_change_event_contributor(
    v.organization_id, v.facility_id, v.assigned_profile_id, true
  );
  if v.status <> 'pending_supervisor_review'
    or exists (
      select 1 from public.resident_change_follow_ups f
      where f.event_id = v.id and f.status in ('open', 'overdue')
    )
    or v.provider_notification_status = 'pending'
    or v.designated_person_notification_status = 'pending'
    or v.incident_decision = 'pending'
    or length(btrim(coalesce(p_final_review_summary, ''))) < 5 then
    raise exception 'Change event closure requirements are incomplete' using errcode = '55000';
  end if;
  update public.resident_change_events
  set status = 'closed', final_review_summary = btrim(p_final_review_summary),
    closed_by_profile_id = auth.uid(), closed_at = now(), updated_at = now()
  where id = v.id;
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, prior_status,
    resulting_status, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, 'supervisor_closed',
    v.status, 'closed', btrim(p_final_review_summary), auth.uid()
  );
  return true;
end;
$$;

create or replace function public.escalate_overdue_change_follow_ups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with overdue as (
    update public.resident_change_follow_ups
    set status = 'overdue'
    where status = 'open' and due_at < now()
    returning event_id
  ), events as (
    update public.resident_change_events e
    set status = 'follow_up_due', updated_at = now()
    where e.id in (select event_id from overdue) and e.status <> 'closed'
    returning e.id
  )
  select count(*)::integer into v_count from events;
  return v_count;
end;
$$;
revoke all on function public.escalate_overdue_change_follow_ups()
  from public, anon, authenticated;
grant execute on function public.escalate_overdue_change_follow_ups() to service_role;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'escalate-change-followups';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'escalate-change-followups',
    '*/15 * * * *',
    'select public.escalate_overdue_change_follow_ups()'
  );
end
$$;

-- Keep the legacy notes-only command working by routing it into the structured lifecycle.
create or replace function public.log_resident_change_of_condition(
  p_resident_id uuid,
  p_notes text default null
)
returns public.resident_compliance_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_item public.resident_compliance_items%rowtype;
begin
  v_event := public.create_resident_change_event(
    p_resident_id, 'other_significant_change', now(),
    coalesce(nullif(btrim(p_notes), ''), 'Significant change identified'),
    'Manager review initiated', 'pending', 'pending', false, null,
    null, null, null, auth.uid(), now(), 'pending', true, true, null
  );
  select c.* into v_item
  from public.resident_compliance_items c
  join public.resident_change_events e on e.compliance_item_id = c.id
  where e.id = v_event;
  return v_item;
end;
$$;

revoke all on function public.create_resident_change_event(
  uuid, text, timestamptz, text, text, text, text, boolean, text,
  text, text, integer, uuid, timestamptz, text, boolean, boolean, uuid
), public.record_change_event_notification(
  uuid, text, text, timestamptz, text, text, text
), public.add_change_event_monitoring(
  uuid, timestamptz, text, text, boolean
), public.complete_change_event_follow_up(
  uuid, text, timestamptz, uuid
), public.close_resident_change_event(uuid, text)
  , public.get_change_event_resident_options()
from public, anon, authenticated, service_role;
grant execute on function public.create_resident_change_event(
  uuid, text, timestamptz, text, text, text, text, boolean, text,
  text, text, integer, uuid, timestamptz, text, boolean, boolean, uuid
), public.record_change_event_notification(
  uuid, text, text, timestamptz, text, text, text
), public.add_change_event_monitoring(
  uuid, timestamptz, text, text, boolean
), public.complete_change_event_follow_up(
  uuid, text, timestamptz, uuid
), public.close_resident_change_event(uuid, text)
  , public.get_change_event_resident_options()
to authenticated;
revoke all on function public.log_resident_change_of_condition(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.log_resident_change_of_condition(uuid, text)
  to authenticated;
