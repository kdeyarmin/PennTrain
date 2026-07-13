-- Priority 7: a governed complaint, grievance, and resident-rights workflow.
-- Complaints remain distinct from reportable incidents, but confirmed reportability
-- indicators atomically create or link an incident. Complaint trends feed QAPI metrics.

insert into public.work_item_templates (
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values (
  'complaint.corrective_action', 'Complaint corrective action', 'complaint',
  'high', interval '14 days', true, interval '2 days', 'facility_manager'
)
on conflict (organization_id, template_key) do nothing;

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  complaint_number text not null,
  date_received timestamptz not null,
  method_received text not null check (method_received in (
    'in_person', 'phone', 'email', 'letter', 'portal', 'staff_report', 'other'
  )),
  complainant_type text not null check (complainant_type in (
    'resident', 'designated_person', 'family', 'anonymous', 'staff_on_behalf', 'other'
  )),
  complainant_name text,
  complainant_contact text,
  is_anonymous boolean not null default false,
  resident_id uuid references public.residents(id) on delete restrict,
  category text not null check (category in (
    'billing', 'food', 'staff_conduct', 'service', 'privacy',
    'resident_rights', 'environmental', 'other'
  )),
  description text not null check (length(btrim(description)) >= 10),
  immediate_risk text not null default 'none' check (immediate_risk in (
    'none', 'low', 'high', 'imminent'
  )),
  immediate_action_taken text,
  reportable_concerns text[] not null default array[]::text[],
  acknowledgement_date timestamptz,
  assigned_investigator_profile_id uuid references public.profiles(id) on delete restrict,
  investigation_notes text,
  findings text,
  corrective_action_summary text,
  written_response text,
  written_response_date timestamptz,
  appeal_requested_at timestamptz,
  appeal_or_reconsideration text,
  appeal_outcome text,
  ombudsman_referral_at timestamptz,
  ombudsman_reference text,
  nonretaliation_monitoring_required boolean not null default false,
  nonretaliation_monitoring_until timestamptz,
  incident_id uuid references public.incidents(id) on delete restrict,
  incident_escalation_reason text,
  status text not null default 'received' check (status in (
    'received', 'acknowledged', 'investigating', 'response_pending',
    'appeal', 'monitoring', 'pending_closure', 'closed'
  )),
  closure_approved_by uuid references public.profiles(id) on delete restrict,
  closure_approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, complaint_number),
  check (is_anonymous or complainant_name is not null),
  check (not is_anonymous or complainant_type = 'anonymous' or complainant_name is null),
  check (immediate_risk not in ('high', 'imminent') or length(btrim(coalesce(immediate_action_taken, ''))) >= 5),
  check (reportable_concerns <@ array['abuse','neglect','exploitation','serious_injury','other_reportable_event']::text[]),
  check (cardinality(reportable_concerns) = 0 or incident_id is not null),
  check (not nonretaliation_monitoring_required or nonretaliation_monitoring_until is not null),
  check (status <> 'closed' or closure_approved_at is not null)
);
create index complaints_queue_idx on public.complaints (
  organization_id, facility_id, status, date_received desc
);
create index complaints_qapi_idx on public.complaints (
  facility_id, date_received, category, immediate_risk
);
create index complaints_resident_idx on public.complaints (resident_id)
  where resident_id is not null;
create index complaints_incident_idx on public.complaints (incident_id)
  where incident_id is not null;

create table public.complaint_interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  interviewed_at timestamptz not null,
  person_name text not null check (length(btrim(person_name)) >= 2),
  relationship_to_case text not null check (length(btrim(relationship_to_case)) >= 2),
  notes text not null check (length(btrim(notes)) >= 5),
  recorded_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index complaint_interviews_case_idx on public.complaint_interviews (complaint_id, interviewed_at desc);

create table public.complaint_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  action_summary text not null check (length(btrim(action_summary)) >= 5),
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (complaint_id, work_item_id)
);
create index complaint_actions_case_idx on public.complaint_corrective_actions (complaint_id);

create table public.complaint_monitoring_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  observed_at timestamptz not null,
  observations text not null check (length(btrim(observations)) >= 5),
  retaliation_concern_identified boolean not null default false,
  action_taken text,
  recorded_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (not retaliation_concern_identified or length(btrim(coalesce(action_taken, ''))) >= 5)
);
create index complaint_monitoring_case_idx on public.complaint_monitoring_entries (complaint_id, observed_at desc);

create table public.complaint_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  complaint_id uuid not null references public.complaints(id) on delete restrict,
  event_type text not null,
  prior_status text,
  resulting_status text,
  reason text not null check (length(btrim(reason)) >= 3),
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index complaint_history_case_idx on public.complaint_history (complaint_id, occurred_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'complaints', 'complaint_interviews', 'complaint_corrective_actions',
    'complaint_monitoring_entries', 'complaint_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

create policy complaints_select on public.complaints for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy complaint_interviews_select on public.complaint_interviews for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy complaint_actions_select on public.complaint_corrective_actions for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy complaint_monitoring_select on public.complaint_monitoring_entries for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy complaint_history_select on public.complaint_history for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));

create trigger set_complaints_updated_at before update on public.complaints
for each row execute function public.set_updated_at();
create trigger prevent_complaint_interview_mutation before update or delete on public.complaint_interviews
for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_complaint_monitoring_mutation before update or delete on public.complaint_monitoring_entries
for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_complaint_history_mutation before update or delete on public.complaint_history
for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function app_private.assert_complaint_profile(
  p_organization_id uuid,
  p_profile_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.organization_id = p_organization_id
      and p.is_active
  ) then
    raise exception 'Selected complaint assignee is unavailable or outside the organization'
      using errcode = '22023';
  end if;
end
$$;
revoke all on function app_private.assert_complaint_profile(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.create_complaint(
  p_facility_id uuid,
  p_date_received timestamptz,
  p_method_received text,
  p_complainant_type text,
  p_complainant_name text,
  p_complainant_contact text,
  p_is_anonymous boolean,
  p_resident_id uuid,
  p_category text,
  p_description text,
  p_immediate_risk text,
  p_immediate_action_taken text,
  p_reportable_concerns text[],
  p_assigned_investigator_profile_id uuid default null,
  p_linked_incident_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac public.facilities%rowtype;
  v_resident public.residents%rowtype;
  v_incident public.incidents%rowtype;
  v_concerns text[] := coalesce(p_reportable_concerns, array[]::text[]);
  v_incident_id uuid := p_linked_incident_id;
  v_id uuid;
  v_number text;
  v_incident_type text;
  v_severity text;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  perform app_private.assert_complaint_profile(v_fac.organization_id, p_assigned_investigator_profile_id);

  if p_date_received is null
    or p_date_received > now() + interval '5 minutes'
    or p_method_received not in ('in_person', 'phone', 'email', 'letter', 'portal', 'staff_report', 'other')
    or p_complainant_type not in ('resident', 'designated_person', 'family', 'anonymous', 'staff_on_behalf', 'other')
    or p_category not in ('billing', 'food', 'staff_conduct', 'service', 'privacy', 'resident_rights', 'environmental', 'other')
    or p_immediate_risk not in ('none', 'low', 'high', 'imminent')
    or length(btrim(coalesce(p_description, ''))) < 10
    or (coalesce(p_is_anonymous, false) = false and length(btrim(coalesce(p_complainant_name, ''))) < 2)
    or (p_immediate_risk in ('high', 'imminent') and length(btrim(coalesce(p_immediate_action_taken, ''))) < 5)
    or not (v_concerns <@ array['abuse','neglect','exploitation','serious_injury','other_reportable_event']::text[])
  then
    raise exception 'Complaint intake is incomplete or invalid' using errcode = '22023';
  end if;

  if p_resident_id is not null then
    select * into v_resident from public.residents where id = p_resident_id;
    if not found or v_resident.organization_id <> v_fac.organization_id or v_resident.facility_id <> v_fac.id then
      raise exception 'Resident is outside the complaint facility' using errcode = '42501';
    end if;
  end if;

  if v_incident_id is not null then
    select * into v_incident from public.incidents where id = v_incident_id;
    if not found or v_incident.organization_id <> v_fac.organization_id or v_incident.facility_id <> v_fac.id then
      raise exception 'Linked incident is outside the complaint facility' using errcode = '42501';
    end if;
  elsif cardinality(v_concerns) > 0 then
    v_incident_type := case
      when 'abuse' = any(v_concerns) then 'abuse_allegation'
      when 'neglect' = any(v_concerns) then 'neglect_allegation'
      when 'serious_injury' = any(v_concerns) then 'significant_injury'
      else 'other'
    end;
    v_severity := case p_immediate_risk
      when 'imminent' then 'critical'
      when 'high' then 'major'
      else 'moderate'
    end;
    insert into public.incidents (
      organization_id, facility_id, incident_type, occurred_at,
      reported_by_profile_id, resident_identifier, narrative, severity
    ) values (
      v_fac.organization_id, v_fac.id, v_incident_type, p_date_received,
      auth.uid(), case when p_resident_id is null then null else v_resident.first_name || ' ' || v_resident.last_name end,
      'Created from complaint intake: ' || btrim(p_description), v_severity
    ) returning id into v_incident_id;
  end if;

  v_number := 'CMP-' || to_char(p_date_received, 'YYYY') || '-' ||
    upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.complaints (
    organization_id, facility_id, complaint_number, date_received,
    method_received, complainant_type, complainant_name, complainant_contact,
    is_anonymous, resident_id, category, description, immediate_risk,
    immediate_action_taken, reportable_concerns, assigned_investigator_profile_id,
    incident_id, incident_escalation_reason, status, created_by
  ) values (
    v_fac.organization_id, v_fac.id, v_number, p_date_received,
    p_method_received, p_complainant_type,
    case when p_is_anonymous then null else nullif(btrim(p_complainant_name), '') end,
    case when p_is_anonymous then null else nullif(btrim(p_complainant_contact), '') end,
    p_is_anonymous, p_resident_id, p_category, btrim(p_description), p_immediate_risk,
    nullif(btrim(p_immediate_action_taken), ''), v_concerns, p_assigned_investigator_profile_id,
    v_incident_id,
    case when cardinality(v_concerns) > 0 then 'Reportability indicators: ' || array_to_string(v_concerns, ', ') else null end,
    case when p_assigned_investigator_profile_id is null then 'received' else 'investigating' end,
    auth.uid()
  ) returning id into v_id;

  insert into public.complaint_history (
    organization_id, facility_id, complaint_id, event_type,
    resulting_status, reason, actor_profile_id, evidence
  ) values (
    v_fac.organization_id, v_fac.id, v_id, 'created',
    case when p_assigned_investigator_profile_id is null then 'received' else 'investigating' end,
    'Complaint intake recorded', auth.uid(),
    jsonb_build_object('incidentId', v_incident_id, 'reportableConcerns', v_concerns)
  );
  return v_id;
end
$$;

create or replace function public.update_complaint_case(
  p_complaint_id uuid,
  p_status text,
  p_acknowledgement_date timestamptz,
  p_assigned_investigator_profile_id uuid,
  p_investigation_notes text,
  p_findings text,
  p_corrective_action_summary text,
  p_written_response text,
  p_written_response_date timestamptz,
  p_appeal_requested_at timestamptz,
  p_appeal_or_reconsideration text,
  p_appeal_outcome text,
  p_ombudsman_referral_at timestamptz,
  p_ombudsman_reference text,
  p_nonretaliation_monitoring_required boolean,
  p_nonretaliation_monitoring_until timestamptz,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.complaints%rowtype;
begin
  select * into v from public.complaints where id = p_complaint_id for update;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  perform app_private.assert_complaint_profile(v.organization_id, p_assigned_investigator_profile_id);
  if v.status = 'closed' then raise exception 'Closed complaints are immutable' using errcode = '55000'; end if;
  if p_status not in ('received','acknowledged','investigating','response_pending','appeal','monitoring','pending_closure','closed')
    or length(btrim(coalesce(p_reason, ''))) < 5
  then raise exception 'Invalid complaint transition' using errcode = '22023'; end if;
  if p_acknowledgement_date is not null and p_acknowledgement_date < v.date_received then
    raise exception 'Acknowledgement cannot precede receipt' using errcode = '22023';
  end if;
  if p_nonretaliation_monitoring_required and p_nonretaliation_monitoring_until is null then
    raise exception 'Nonretaliation monitoring requires an end date' using errcode = '22023';
  end if;
  if p_status = 'closed' and (
    p_acknowledgement_date is null
    or p_assigned_investigator_profile_id is null
    or length(btrim(coalesce(p_investigation_notes, ''))) < 10
    or length(btrim(coalesce(p_findings, ''))) < 10
    or length(btrim(coalesce(p_written_response, ''))) < 10
    or p_written_response_date is null
    or (p_appeal_requested_at is not null and length(btrim(coalesce(p_appeal_outcome, ''))) < 5)
    or (p_nonretaliation_monitoring_required and (
      p_nonretaliation_monitoring_until > now()
      or not exists (select 1 from public.complaint_monitoring_entries m where m.complaint_id = v.id)
    ))
    or exists (
      select 1 from public.complaint_corrective_actions a
      join public.work_items w on w.id = a.work_item_id
      where a.complaint_id = v.id and w.state not in ('closed', 'canceled')
    )
  ) then
    raise exception 'Complaint closure evidence or corrective actions are incomplete' using errcode = '55000';
  end if;

  update public.complaints set
    status = p_status,
    acknowledgement_date = p_acknowledgement_date,
    assigned_investigator_profile_id = p_assigned_investigator_profile_id,
    investigation_notes = nullif(btrim(p_investigation_notes), ''),
    findings = nullif(btrim(p_findings), ''),
    corrective_action_summary = nullif(btrim(p_corrective_action_summary), ''),
    written_response = nullif(btrim(p_written_response), ''),
    written_response_date = p_written_response_date,
    appeal_requested_at = p_appeal_requested_at,
    appeal_or_reconsideration = nullif(btrim(p_appeal_or_reconsideration), ''),
    appeal_outcome = nullif(btrim(p_appeal_outcome), ''),
    ombudsman_referral_at = p_ombudsman_referral_at,
    ombudsman_reference = nullif(btrim(p_ombudsman_reference), ''),
    nonretaliation_monitoring_required = p_nonretaliation_monitoring_required,
    nonretaliation_monitoring_until = p_nonretaliation_monitoring_until,
    closure_approved_by = case when p_status = 'closed' then auth.uid() else closure_approved_by end,
    closure_approved_at = case when p_status = 'closed' then now() else closure_approved_at end
  where id = v.id;

  insert into public.complaint_history (
    organization_id, facility_id, complaint_id, event_type, prior_status,
    resulting_status, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, 'case_updated', v.status,
    p_status, btrim(p_reason), auth.uid()
  );
  return true;
end
$$;

create or replace function public.add_complaint_interview(
  p_complaint_id uuid,
  p_interviewed_at timestamptz,
  p_person_name text,
  p_relationship_to_case text,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v public.complaints%rowtype; v_id uuid;
begin
  select * into v from public.complaints where id = p_complaint_id;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status = 'closed' then raise exception 'Closed complaints are immutable' using errcode = '55000'; end if;
  insert into public.complaint_interviews (
    organization_id, facility_id, complaint_id, interviewed_at,
    person_name, relationship_to_case, notes, recorded_by
  ) values (
    v.organization_id, v.facility_id, v.id, p_interviewed_at,
    btrim(p_person_name), btrim(p_relationship_to_case), btrim(p_notes), auth.uid()
  ) returning id into v_id;
  insert into public.complaint_history (
    organization_id, facility_id, complaint_id, event_type,
    prior_status, resulting_status, reason, actor_profile_id, evidence
  ) values (
    v.organization_id, v.facility_id, v.id, 'interview_added',
    v.status, v.status, 'Interview recorded', auth.uid(), jsonb_build_object('interviewId', v_id)
  );
  return v_id;
end
$$;

create or replace function public.add_complaint_corrective_action(
  p_complaint_id uuid,
  p_title text,
  p_description text,
  p_owner_profile_id uuid,
  p_priority text,
  p_due_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v public.complaints%rowtype; v_template uuid; v_work uuid; v_id uuid;
begin
  select * into v from public.complaints where id = p_complaint_id;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  perform app_private.assert_complaint_profile(v.organization_id, p_owner_profile_id);
  if v.status = 'closed' or length(btrim(coalesce(p_title, ''))) < 3
    or length(btrim(coalesce(p_description, ''))) < 5
    or p_due_at <= now()
    or p_priority not in ('low','normal','high','urgent')
  then raise exception 'Corrective action is invalid' using errcode = '22023'; end if;
  select id into v_template from public.work_item_templates
  where template_key = 'complaint.corrective_action'
    and (organization_id = v.organization_id or organization_id is null)
  order by organization_id nulls last limit 1;
  insert into public.work_items (
    organization_id, facility_id, template_id, source_type, source_id,
    deduplication_key, title, description, owner_profile_id, priority, due_at, created_by
  ) values (
    v.organization_id, v.facility_id, v_template, 'complaint', v.id,
    'complaint:' || v.id || ':' || extensions.gen_random_uuid(), btrim(p_title),
    btrim(p_description), p_owner_profile_id, p_priority, p_due_at, auth.uid()
  ) returning id into v_work;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type,
    resulting_state, actor_profile_id, reason
  ) values (
    v.organization_id, v.facility_id, v_work, 'created',
    'open', auth.uid(), 'Complaint corrective action created'
  );
  insert into public.complaint_corrective_actions (
    organization_id, facility_id, complaint_id, work_item_id,
    action_summary, created_by
  ) values (
    v.organization_id, v.facility_id, v.id, v_work,
    btrim(p_description), auth.uid()
  ) returning id into v_id;
  insert into public.complaint_history (
    organization_id, facility_id, complaint_id, event_type,
    prior_status, resulting_status, reason, actor_profile_id, evidence
  ) values (
    v.organization_id, v.facility_id, v.id, 'corrective_action_added',
    v.status, v.status, 'Corrective action assigned', auth.uid(), jsonb_build_object('workItemId', v_work)
  );
  return v_id;
end
$$;

create or replace function public.add_complaint_monitoring_entry(
  p_complaint_id uuid,
  p_observed_at timestamptz,
  p_observations text,
  p_retaliation_concern_identified boolean,
  p_action_taken text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v public.complaints%rowtype; v_id uuid;
begin
  select * into v from public.complaints where id = p_complaint_id;
  if not found then raise exception 'Complaint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status = 'closed' then raise exception 'Closed complaints are immutable' using errcode = '55000'; end if;
  insert into public.complaint_monitoring_entries (
    organization_id, facility_id, complaint_id, observed_at,
    observations, retaliation_concern_identified, action_taken, recorded_by
  ) values (
    v.organization_id, v.facility_id, v.id, p_observed_at,
    btrim(p_observations), p_retaliation_concern_identified,
    nullif(btrim(p_action_taken), ''), auth.uid()
  ) returning id into v_id;
  insert into public.complaint_history (
    organization_id, facility_id, complaint_id, event_type,
    prior_status, resulting_status, reason, actor_profile_id, evidence
  ) values (
    v.organization_id, v.facility_id, v.id, 'nonretaliation_monitoring',
    v.status, v.status, 'Nonretaliation monitoring recorded', auth.uid(),
    jsonb_build_object('monitoringEntryId', v_id, 'concernIdentified', p_retaliation_concern_identified)
  );
  return v_id;
end
$$;

create or replace function public.get_complaint_trends(
  p_facility_id uuid,
  p_from date,
  p_through date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'Complaint trends outside scope' using errcode = '42501';
  end if;
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'Complaint trend period is invalid' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through),
    'open', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through and c.status <> 'closed'),
    'highRisk', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through and c.immediate_risk in ('high','imminent')),
    'residentRights', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through and c.category = 'resident_rights'),
    'ombudsmanReferrals', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through and c.ombudsman_referral_at is not null),
    'incidentLinked', (select count(*) from public.complaints c where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through and c.incident_id is not null),
    'byCategory', coalesce((
      select jsonb_object_agg(x.category, x.total)
      from (
        select c.category, count(*) as total
        from public.complaints c
        where c.facility_id = v_fac.id and c.date_received::date between p_from and p_through
        group by c.category
      ) x
    ), '{}'::jsonb),
    'periodStart', p_from,
    'periodEnd', p_through
  );
end
$$;

-- Replace the Priority 6 source snapshot so QAPI automatically receives complaint
-- counts from authoritative cases instead of the original placeholder.
create or replace function public.get_qapi_source_metrics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_complaints jsonb;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'QAPI metrics outside scope' using errcode = '42501';
  end if;
  v_complaints := public.get_complaint_trends(v_fac.id, p_from, p_through);
  return jsonb_build_object(
    'falls', (select count(*) from public.resident_change_events where facility_id = v_fac.id and category = 'fall' and identified_at::date between p_from and p_through),
    'medicationIncidents', (select count(*) from public.incidents where facility_id = v_fac.id and incident_type = 'medication_error' and occurred_at::date between p_from and p_through),
    'hospitalTransfers', (select count(*) from public.resident_change_events where facility_id = v_fac.id and (category in ('emergency_department_visit','hospital_return') or emergency_transfer) and identified_at::date between p_from and p_through),
    'missedServices', (select count(*) from public.resident_service_task_instances where facility_id = v_fac.id and status = 'not_completed' and scheduled_start::date between p_from and p_through),
    'lateServices', (select count(*) from public.resident_service_task_instances where facility_id = v_fac.id and status = 'completed_late' and scheduled_start::date between p_from and p_through),
    'lateAssessments', (select count(*) from public.resident_compliance_items where facility_id = v_fac.id and status = 'expired' and item_type in ('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')),
    'trainingGaps', (select count(*) from public.employee_training_records where facility_id = v_fac.id and status in ('missing','expired')),
    'citationRecurrence', (select count(*) from (select citation_topic_id from public.dhs_violations where facility_id = v_fac.id and inspection_date between p_from and p_through group by citation_topic_id having count(*) > 1) x),
    'inspectionDeficiencies', (select count(*) from public.inspection_events where facility_id = v_fac.id and result in ('fail','deficiency_noted') and performed_date between p_from and p_through),
    'nutritionExceptions', (select count(*) from public.resident_change_events where facility_id = v_fac.id and category in ('appetite_intake_change','weight_concern') and identified_at::date between p_from and p_through),
    'currentInactiveStaff', (select count(*) from public.employees where facility_id = v_fac.id and status <> 'active'),
    'complaints', (v_complaints ->> 'total')::integer,
    'highRiskComplaints', (v_complaints ->> 'highRisk')::integer,
    'residentRightsComplaints', (v_complaints ->> 'residentRights')::integer,
    'appointmentFailures', jsonb_build_object('available', false, 'count', 0),
    'periodStart', p_from,
    'periodEnd', p_through
  );
end
$$;

revoke all on function public.create_complaint(uuid,timestamptz,text,text,text,text,boolean,uuid,text,text,text,text,text[],uuid,uuid),
  public.update_complaint_case(uuid,text,timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,text,text,timestamptz,text,boolean,timestamptz,text),
  public.add_complaint_interview(uuid,timestamptz,text,text,text),
  public.add_complaint_corrective_action(uuid,text,text,uuid,text,timestamptz),
  public.add_complaint_monitoring_entry(uuid,timestamptz,text,boolean,text),
  public.get_complaint_trends(uuid,date,date)
from public, anon, authenticated, service_role;
grant execute on function public.create_complaint(uuid,timestamptz,text,text,text,text,boolean,uuid,text,text,text,text,text[],uuid,uuid),
  public.update_complaint_case(uuid,text,timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,text,text,timestamptz,text,boolean,timestamptz,text),
  public.add_complaint_interview(uuid,timestamptz,text,text,text),
  public.add_complaint_corrective_action(uuid,text,text,uuid,text,timestamptz),
  public.add_complaint_monitoring_entry(uuid,timestamptz,text,boolean,text),
  public.get_complaint_trends(uuid,date,date)
to authenticated;

revoke all on function public.get_qapi_source_metrics(uuid,date,date)
from public, anon, authenticated, service_role;
grant execute on function public.get_qapi_source_metrics(uuid,date,date) to authenticated;
