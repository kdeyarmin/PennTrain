-- Close the employee-to-manager handoff lifecycle with explicit ownership,
-- due times, conversion links, and service-role escalation processing.

alter table public.shift_report_entries
  add column if not exists review_due_at timestamptz,
  add column if not exists escalation_level integer not null default 0 check (escalation_level between 0 and 10),
  add column if not exists last_escalated_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by uuid references public.profiles(id);

update public.shift_report_entries
set review_due_at = created_at + case priority
  when 'urgent' then interval '1 hour'
  when 'high' then interval '8 hours'
  when 'normal' then interval '24 hours'
  else interval '48 hours'
end
where review_due_at is null;

alter table public.shift_report_entries
  alter column review_due_at set default (now() + interval '24 hours'),
  alter column review_due_at set not null;

create or replace function app_private.set_shift_report_review_due_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.review_due_at := coalesce(new.created_at, now()) + case new.priority
    when 'urgent' then interval '1 hour'
    when 'high' then interval '8 hours'
    when 'normal' then interval '24 hours'
    else interval '48 hours'
  end;
  return new;
end;
$function$;

create trigger set_shift_report_review_due_at
before insert on public.shift_report_entries
for each row execute function app_private.set_shift_report_review_due_at();

create index if not exists shift_report_review_due_idx
  on public.shift_report_entries(review_due_at, priority)
  where status in ('open','carried_forward','reviewed');

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
  'course_assigned', 'quiz_graded', 'certificate_issued',
  'training_due_soon', 'training_expired', 'competency_recorded',
  'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
  'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
  'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
  'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
  'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
  'qualification_changed', 'course_assignment_due_soon',
  'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
  'time_off_request_changed'
));

create or replace function public.triage_shift_report_entry(
  p_entry_id uuid,
  p_owner_profile_id uuid,
  p_action text,
  p_note text
)
returns public.shift_report_entries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.shift_report_entries%rowtype;
begin
  select * into v_entry from public.shift_report_entries where id = p_entry_id for update;
  if not found then raise exception 'Shift handoff was not found' using errcode = 'P0002'; end if;
  perform app_private.assert_daily_ops_manager(v_entry.facility_id);
  if p_action not in ('review','carry_forward','void') then
    raise exception 'Unsupported handoff triage action' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'A triage note of at least 5 characters is required' using errcode = '22023';
  end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_entry.organization_id
      and p.role in ('org_admin','facility_manager') and p.is_active
  ) then
    raise exception 'The selected owner is not an active manager in this organization' using errcode = '23514';
  end if;

  update public.shift_report_entries set
    follow_up_owner_profile_id = coalesce(p_owner_profile_id, follow_up_owner_profile_id, auth.uid()),
    status = case p_action when 'review' then 'reviewed' when 'carry_forward' then 'carried_forward' else 'voided' end,
    manager_reviewed_by = auth.uid(),
    manager_reviewed_at = now(),
    resolution_note = case when p_action = 'void' then btrim(p_note) else resolution_note end,
    resolved_by = case when p_action = 'void' then auth.uid() else resolved_by end,
    resolved_at = case when p_action = 'void' then now() else resolved_at end
  where id = v_entry.id
  returning * into v_entry;

  if v_entry.follow_up_owner_profile_id is not null then
    insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
    values(v_entry.organization_id, v_entry.follow_up_owner_profile_id, 'shift_handoff_assigned',
      'Shift handoff assigned', left(btrim(p_note), 500), '/app/shift-handoffs');
  end if;
  return v_entry;
end;
$function$;

create or replace function public.convert_shift_report_entry(
  p_entry_id uuid,
  p_destination text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.shift_report_entries%rowtype;
  v_incident public.incidents%rowtype;
  v_work_order uuid;
  v_change_item public.resident_compliance_items%rowtype;
  v_change_event uuid;
  v_work_item uuid;
  v_template uuid;
begin
  select * into v_entry from public.shift_report_entries where id = p_entry_id for update;
  if not found then raise exception 'Shift handoff was not found' using errcode = 'P0002'; end if;
  perform app_private.assert_daily_ops_manager(v_entry.facility_id);
  if v_entry.status in ('resolved','voided') then
    raise exception 'The handoff is already closed' using errcode = '55000';
  end if;
  if p_destination not in ('incident','maintenance','change_of_condition','work_item') then
    raise exception 'Unsupported destination' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A conversion reason of at least 5 characters is required' using errcode = '22023';
  end if;

  if p_destination = 'incident' then
    v_incident := public.create_incident_atomic(
      v_entry.organization_id, v_entry.facility_id,
      case when v_entry.category = 'fall_or_injury' then 'significant_injury'
           when v_entry.category = 'maintenance' then 'environmental_emergency'
           else 'other' end,
      coalesce(v_entry.shift_period_start, v_entry.created_at), v_entry.resident_id, null,
      'Converted from shift handoff', v_entry.narrative || E'\n\nTriage: ' || btrim(p_reason),
      case v_entry.priority when 'urgent' then 'critical' when 'high' then 'major' else 'moderate' end,
      '[]'::jsonb, '[]'::jsonb, 'handoff:' || v_entry.id::text || ':incident'
    );
    update public.shift_report_entries set linked_incident_id = v_incident.id where id = v_entry.id;
  elsif p_destination = 'maintenance' then
    v_work_order := public.create_work_order(
      v_entry.facility_id, v_entry.narrative, null, null, 'Shift handoff', null,
      case when v_entry.priority = 'urgent' then 'immediate_danger' when v_entry.priority = 'high' then 'high' else 'moderate' end,
      case when v_entry.priority = 'urgent' then 'emergency' when v_entry.priority = 'high' then 'urgent' else 'routine' end,
      btrim(p_reason), null, null,
      case when v_entry.priority = 'urgent' then now() + interval '1 hour' else now() + interval '24 hours' end,
      null, null, case when v_entry.resident_id is not null then 'Resident-related shift handoff' else null end
    );
    update public.shift_report_entries set linked_work_order_id = v_work_order where id = v_entry.id;
  elsif p_destination = 'change_of_condition' then
    if v_entry.resident_id is null then
      raise exception 'A resident is required for change-of-condition conversion' using errcode = '23514';
    end if;
    v_change_item := public.log_resident_change_of_condition(v_entry.resident_id, v_entry.narrative || E'\n\nTriage: ' || btrim(p_reason));
    select id into v_change_event from public.resident_change_events
    where compliance_item_id = v_change_item.id order by created_at desc limit 1;
    update public.shift_report_entries set linked_change_event_id = v_change_event where id = v_entry.id;
  else
    v_work_item := v_entry.linked_work_item_id;
    if v_work_item is null then
      select id into v_template from public.work_item_templates
      where (organization_id = v_entry.organization_id or organization_id is null)
        and template_key = 'daily_ops.shift_handoff'
      order by organization_id nulls last limit 1;
      insert into public.work_items(
        organization_id, facility_id, template_id, source_type, source_id,
        deduplication_key, title, description, owner_profile_id, priority, due_at, created_by
      ) values (
        v_entry.organization_id, v_entry.facility_id, v_template, 'rule_exception', v_entry.id,
        'shift-log:' || v_entry.id::text, 'Shift handoff: ' || replace(v_entry.category, '_', ' '),
        v_entry.narrative, coalesce(v_entry.follow_up_owner_profile_id, auth.uid()), v_entry.priority,
        v_entry.review_due_at, auth.uid()
      ) on conflict (organization_id, deduplication_key) do update set updated_at = now()
      returning id into v_work_item;
      update public.shift_report_entries set linked_work_item_id = v_work_item where id = v_entry.id;
    end if;
  end if;

  update public.shift_report_entries set
    status = 'resolved', converted_by = auth.uid(), converted_at = now(),
    resolved_by = auth.uid(), resolved_at = now(), resolution_note = btrim(p_reason),
    manager_reviewed_by = coalesce(manager_reviewed_by, auth.uid()),
    manager_reviewed_at = coalesce(manager_reviewed_at, now())
  where id = v_entry.id returning * into v_entry;

  if v_entry.author_profile_id is not null then
    insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
    values(v_entry.organization_id, v_entry.author_profile_id, 'shift_handoff_resolved',
      'Shift handoff routed', 'Your handoff was converted to ' || replace(p_destination, '_', ' ') || '.',
      '/app/shift-handoffs');
  end if;

  return jsonb_build_object(
    'entryId', v_entry.id, 'destination', p_destination,
    'incidentId', v_incident.id, 'workOrderId', v_work_order,
    'changeEventId', v_change_event, 'workItemId', coalesce(v_work_item, v_entry.linked_work_item_id)
  );
end;
$function$;

create or replace function public.run_shift_handoff_escalations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.shift_report_entries%rowtype;
  v_profile uuid;
  v_count integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  for v_entry in
    select * from public.shift_report_entries
    where status in ('open','carried_forward','reviewed')
      and review_due_at <= p_now and escalation_level < 10
    order by priority desc, review_due_at
    for update skip locked
  loop
    for v_profile in
      select p.id from public.profiles p
      where p.organization_id = v_entry.organization_id and p.is_active
        and p.role in ('org_admin','facility_manager')
        and (p.role = 'org_admin' or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = p.id and fa.facility_id = v_entry.facility_id
        ))
    loop
      insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
      values(v_entry.organization_id, v_profile, 'shift_handoff_escalated',
        'Overdue shift handoff', left(v_entry.narrative, 500), '/app/shift-handoffs');
    end loop;
    update public.shift_report_entries set
      escalation_level = escalation_level + 1,
      last_escalated_at = p_now,
      review_due_at = p_now + case priority when 'urgent' then interval '30 minutes' when 'high' then interval '4 hours' else interval '12 hours' end
    where id = v_entry.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.triage_shift_report_entry(uuid,uuid,text,text),
  public.convert_shift_report_entry(uuid,text,text),
  public.run_shift_handoff_escalations(timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.triage_shift_report_entry(uuid,uuid,text,text),
  public.convert_shift_report_entry(uuid,text,text)
to authenticated;
grant execute on function public.run_shift_handoff_escalations(timestamptz) to service_role;
