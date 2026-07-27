-- Survey Day workspace: surveyors, requests, observations and the packet (Phase 10a, item 23).
--
-- WHAT ALREADY EXISTED. `survey_day_sessions`, a pre-built entrance-conference checklist with
-- dispositions, an append-only event log, staff roster paging, and binder/evidence pinning. The
-- session model, its expiry sweep, and `assert_survey_day_manager` are untouched.
--
-- WHAT ITEM 23 NAMES THAT DID NOT EXIST: who the surveyors are and when they arrived; ad-hoc
-- requests with an assignee and a deadline (the checklist is a *predicted* list, not what was
-- actually asked for on the day); interviews and observations; potential findings; and the packet
-- that assembles all of it afterwards.
--
-- WHY REQUESTS ARE A SEPARATE TABLE FROM CHECKLIST ITEMS. A checklist item is something the facility
-- prepared in advance and can mark ready. A request is something a surveyor asked for at 10:40 with
-- a deadline of 11:15, and it has an owner. Recording the second as a disposition on the first would
-- lose the clock, which is the part that matters while a survey is running.
--
-- PHI STAYS OUT OF THE EVENT LOG. `survey_day_metadata_is_safe` rejects metadata keys that look like
-- contact details, narrative or document content, and every event written below passes only ids and
-- enum values. The substance lives in the tables, under the same RLS as the session.
--
-- Rollback: drop the RPCs, then the three tables, then restore the event_type check constraint from
-- 20260721160000.

------------------------------------------------------------------------------------------------
-- 1. Who is here.
------------------------------------------------------------------------------------------------
create table if not exists public.survey_day_surveyors (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.survey_day_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  surveyor_name text not null check (length(btrim(surveyor_name)) between 2 and 200),
  title text,
  agency text,
  arrived_at timestamptz not null default now(),
  departed_at timestamptz,
  is_lead boolean not null default false,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departed_at is null or departed_at >= arrived_at)
);
create index if not exists survey_day_surveyors_session_idx
  on public.survey_day_surveyors(session_id, arrived_at);

------------------------------------------------------------------------------------------------
-- 2. What was asked for.
------------------------------------------------------------------------------------------------
create table if not exists public.survey_day_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.survey_day_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  surveyor_id uuid references public.survey_day_surveyors(id) on delete set null,
  requested_at timestamptz not null default now(),
  request_text text not null check (length(btrim(request_text)) between 3 and 2000),
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'provided', 'unavailable', 'withdrawn')),
  -- What was actually handed over, in the words the facility would use describing it later.
  provided_note text,
  provided_at timestamptz,
  provided_by uuid references public.profiles(id) on delete set null,
  evidence_collection_id uuid references public.evidence_collections(id) on delete set null,
  binder_job_id uuid references public.binder_export_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A request marked provided with no record of what was provided is the gap this table exists to
  -- close; "we gave them something" is not an answer three months later.
  check (status <> 'provided' or (provided_at is not null and length(btrim(coalesce(provided_note, ''))) > 0))
);
create index if not exists survey_day_requests_session_idx
  on public.survey_day_requests(session_id, status, due_at);

------------------------------------------------------------------------------------------------
-- 3. What was seen and said.
--
-- Interviews, observations and potential findings share a table because they share a shape and a
-- lifecycle -- they are all "something happened during the survey that we need on the record" --
-- and separating them would triple the write paths for no difference in handling.
------------------------------------------------------------------------------------------------
create table if not exists public.survey_day_observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.survey_day_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  entry_type text not null check (entry_type in ('interview', 'observation', 'potential_finding')),
  surveyor_id uuid references public.survey_day_surveyors(id) on delete set null,
  occurred_at timestamptz not null default now(),
  summary text not null check (length(btrim(summary)) between 3 and 4000),
  -- Who was interviewed or observed, by role rather than by name where a name is not needed.
  subject_role text,
  subject_employee_id uuid references public.employees(id) on delete set null,
  subject_resident_id uuid references public.residents(id) on delete set null,
  -- The regulation a potential finding is about, when one has been identified.
  citation text,
  -- 'potential' until the facility has decided how to treat it. A finding recorded as disputed with
  -- no basis written down is worse than one recorded plainly.
  finding_disposition text check (finding_disposition is null or finding_disposition in (
    'potential', 'accepted', 'disputed', 'resolved_on_site'
  )),
  finding_basis text,
  follow_up_work_item_id uuid references public.work_items(id) on delete set null,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A potential finding without a disposition is an open question; a disposition on something that
  -- is not a finding is a category error.
  check (entry_type = 'potential_finding' or finding_disposition is null),
  check (finding_disposition is distinct from 'disputed' or length(btrim(coalesce(finding_basis, ''))) > 0)
);
create index if not exists survey_day_observations_session_idx
  on public.survey_day_observations(session_id, entry_type, occurred_at);

------------------------------------------------------------------------------------------------
-- 4. RLS, mirroring the session's own posture: select for the facility's managers and auditors,
--    every write through an RPC.
------------------------------------------------------------------------------------------------
-- Written out per table rather than generated in a loop: a static reader -- human or the migration
-- policy linter -- has to be able to see that each table has RLS and a policy without mentally
-- executing a format() call.
alter table public.survey_day_surveyors enable row level security;
alter table public.survey_day_requests enable row level security;
alter table public.survey_day_observations enable row level security;

revoke all on public.survey_day_surveyors from public, anon, authenticated, service_role;
revoke all on public.survey_day_requests from public, anon, authenticated, service_role;
revoke all on public.survey_day_observations from public, anon, authenticated, service_role;

grant select on public.survey_day_surveyors to authenticated;
grant select on public.survey_day_requests to authenticated;
grant select on public.survey_day_observations to authenticated;
grant all on public.survey_day_surveyors to service_role;
grant all on public.survey_day_requests to service_role;
grant all on public.survey_day_observations to service_role;

create policy survey_day_surveyors_select on public.survey_day_surveyors
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager'
                 and public.is_assigned_to_facility(facility_id))))
  );
create policy survey_day_requests_select on public.survey_day_requests
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager'
                 and public.is_assigned_to_facility(facility_id))))
  );
create policy survey_day_observations_select on public.survey_day_observations
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager'
                 and public.is_assigned_to_facility(facility_id))))
  );

create trigger set_survey_day_surveyors_updated_at before update on public.survey_day_surveyors
  for each row execute function public.set_updated_at();
create trigger set_survey_day_requests_updated_at before update on public.survey_day_requests
  for each row execute function public.set_updated_at();
create trigger set_survey_day_observations_updated_at before update on public.survey_day_observations
  for each row execute function public.set_updated_at();

create trigger audit_survey_day_surveyors after insert or update or delete on public.survey_day_surveyors
  for each row execute function public.audit_log_trigger();
create trigger audit_survey_day_requests after insert or update or delete on public.survey_day_requests
  for each row execute function public.audit_log_trigger();
create trigger audit_survey_day_observations after insert or update or delete on public.survey_day_observations
  for each row execute function public.audit_log_trigger();

-- The event log gains the new activity types. Every prior value is preserved.
alter table public.survey_day_events drop constraint survey_day_events_event_type_check;
alter table public.survey_day_events add constraint survey_day_events_event_type_check
  check (event_type in (
    'activated', 'checks_refreshed', 'checklist_disposition_recorded',
    'binder_requested', 'binder_pinned', 'binder_downloaded',
    'evidence_collection_opened', 'staff_roster_opened',
    'closed', 'expired',
    'surveyor_recorded', 'request_recorded', 'request_resolved',
    'observation_recorded', 'packet_assembled'
  ));

------------------------------------------------------------------------------------------------
-- 5. Write path.
------------------------------------------------------------------------------------------------
create or replace function app_private.survey_day_session_for_write(p_session_id uuid)
returns public.survey_day_sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.survey_day_sessions%rowtype;
begin
  select * into v from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v.organization_id, v.facility_id);
  -- A closed session is the record of a survey that finished. Appending to it later would change
  -- what the facility says happened on the day.
  if v.status <> 'active' then
    raise exception 'This Survey Day session is % and cannot be added to', v.status
      using errcode = '55000';
  end if;
  return v;
end $$;
revoke all on function app_private.survey_day_session_for_write(uuid) from public, anon, authenticated;

create or replace function public.record_survey_day_surveyor(
  p_session_id uuid,
  p_surveyor_name text,
  p_title text default null,
  p_agency text default null,
  p_is_lead boolean default false,
  p_arrived_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.survey_day_sessions%rowtype; v_id uuid;
begin
  v := app_private.survey_day_session_for_write(p_session_id);
  insert into public.survey_day_surveyors(
    session_id, organization_id, facility_id, surveyor_name, title, agency, is_lead,
    arrived_at, recorded_by
  ) values (
    v.id, v.organization_id, v.facility_id, btrim(p_surveyor_name),
    nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_agency, '')), ''),
    coalesce(p_is_lead, false), coalesce(p_arrived_at, now()), auth.uid()
  ) returning id into v_id;

  insert into public.survey_day_events(session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v.id, v.organization_id, v.facility_id, auth.uid(), 'surveyor_recorded',
    jsonb_build_object('surveyorId', v_id, 'isLead', coalesce(p_is_lead, false)));
  return v_id;
end $$;
revoke all on function public.record_survey_day_surveyor(uuid, text, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.record_survey_day_surveyor(uuid, text, text, text, boolean, timestamptz) to authenticated, service_role;

create or replace function public.record_survey_day_request(
  p_session_id uuid,
  p_request_text text,
  p_surveyor_id uuid default null,
  p_assigned_to uuid default null,
  p_due_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.survey_day_sessions%rowtype; v_id uuid;
begin
  v := app_private.survey_day_session_for_write(p_session_id);
  if p_surveyor_id is not null and not exists (
    select 1 from public.survey_day_surveyors s where s.id = p_surveyor_id and s.session_id = v.id
  ) then
    raise exception 'That surveyor belongs to a different session' using errcode = '23514';
  end if;

  insert into public.survey_day_requests(
    session_id, organization_id, facility_id, surveyor_id, request_text, assigned_to, due_at
  ) values (
    v.id, v.organization_id, v.facility_id, p_surveyor_id, btrim(p_request_text),
    p_assigned_to, p_due_at
  ) returning id into v_id;

  insert into public.survey_day_events(session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v.id, v.organization_id, v.facility_id, auth.uid(), 'request_recorded',
    jsonb_build_object('requestId', v_id, 'hasDeadline', p_due_at is not null));
  return v_id;
end $$;
revoke all on function public.record_survey_day_request(uuid, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.record_survey_day_request(uuid, text, uuid, uuid, timestamptz) to authenticated, service_role;

create or replace function public.resolve_survey_day_request(
  p_request_id uuid,
  p_status text,
  p_provided_note text default null,
  p_evidence_collection_id uuid default null,
  p_binder_job_id uuid default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_request public.survey_day_requests%rowtype; v public.survey_day_sessions%rowtype;
begin
  select * into v_request from public.survey_day_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  v := app_private.survey_day_session_for_write(v_request.session_id);

  if p_status not in ('provided', 'unavailable', 'withdrawn') then
    raise exception 'A request is resolved as provided, unavailable, or withdrawn, not %', p_status
      using errcode = '22023';
  end if;
  -- "Unavailable" is a legitimate answer to a surveyor and must be recordable -- but it needs a
  -- reason, because "we could not produce it" is exactly what a finding is written from.
  if length(btrim(coalesce(p_provided_note, ''))) = 0 then
    raise exception 'Resolving a request requires a note saying what was provided or why it was not'
      using errcode = '22023';
  end if;

  update public.survey_day_requests set
    status = p_status,
    provided_note = btrim(p_provided_note),
    provided_at = now(),
    provided_by = auth.uid(),
    evidence_collection_id = coalesce(p_evidence_collection_id, evidence_collection_id),
    binder_job_id = coalesce(p_binder_job_id, binder_job_id),
    updated_at = now()
  where id = v_request.id;

  insert into public.survey_day_events(session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v.id, v.organization_id, v.facility_id, auth.uid(), 'request_resolved',
    jsonb_build_object('requestId', v_request.id, 'status', p_status));
  return true;
end $$;
revoke all on function public.resolve_survey_day_request(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.resolve_survey_day_request(uuid, text, text, uuid, uuid) to authenticated, service_role;

create or replace function public.record_survey_day_observation(
  p_session_id uuid,
  p_entry_type text,
  p_summary text,
  p_surveyor_id uuid default null,
  p_subject_role text default null,
  p_citation text default null,
  p_finding_disposition text default null,
  p_finding_basis text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.survey_day_sessions%rowtype; v_id uuid;
begin
  v := app_private.survey_day_session_for_write(p_session_id);
  if p_entry_type not in ('interview', 'observation', 'potential_finding') then
    raise exception 'Unknown Survey Day entry type %', p_entry_type using errcode = '22023';
  end if;

  insert into public.survey_day_observations(
    session_id, organization_id, facility_id, entry_type, surveyor_id, summary,
    subject_role, citation, finding_disposition, finding_basis, recorded_by
  ) values (
    v.id, v.organization_id, v.facility_id, p_entry_type, p_surveyor_id, btrim(p_summary),
    nullif(btrim(coalesce(p_subject_role, '')), ''), nullif(btrim(coalesce(p_citation, '')), ''),
    case when p_entry_type = 'potential_finding' then coalesce(p_finding_disposition, 'potential') end,
    nullif(btrim(coalesce(p_finding_basis, '')), ''), auth.uid()
  ) returning id into v_id;

  insert into public.survey_day_events(session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v.id, v.organization_id, v.facility_id, auth.uid(), 'observation_recorded',
    jsonb_build_object('observationId', v_id, 'entryType', p_entry_type));
  return v_id;
end $$;
revoke all on function public.record_survey_day_observation(uuid, text, text, uuid, text, text, text, text) from public, anon;
grant execute on function public.record_survey_day_observation(uuid, text, text, uuid, text, text, text, text) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 6. The packet.
--
-- A read, not a stored artefact: the packet is whatever the session contains at the moment it is
-- assembled, and freezing a copy would create a second version of the truth that drifts from the
-- record it summarises. What IS recorded is that somebody assembled one, and when.
------------------------------------------------------------------------------------------------
create or replace function public.get_survey_day_packet(p_session_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.survey_day_sessions%rowtype;
begin
  select * into v from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'sessionId', v.id,
    'facilityId', v.facility_id,
    'status', v.status,
    'activatedAt', v.activated_at,
    'closedAt', v.closed_at,
    'surveyors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.surveyor_name, 'title', s.title, 'agency', s.agency,
        'isLead', s.is_lead, 'arrivedAt', s.arrived_at, 'departedAt', s.departed_at
      ) order by s.is_lead desc, s.arrived_at)
      from public.survey_day_surveyors s where s.session_id = v.id
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requestedAt', r.requested_at, 'request', r.request_text,
        'dueAt', r.due_at, 'status', r.status, 'providedAt', r.provided_at,
        'providedNote', r.provided_note,
        'assignedTo', case when p.id is null then null
          else btrim(p.first_name || ' ' || p.last_name) end
      ) order by r.requested_at)
      from public.survey_day_requests r
      left join public.profiles p on p.id = r.assigned_to
      where r.session_id = v.id
    ), '[]'::jsonb),
    -- Counts a person reads first: what is still outstanding while the surveyors are in the building.
    'openRequests', (
      select count(*) from public.survey_day_requests r
      where r.session_id = v.id and r.status = 'open'
    ),
    'overdueRequests', (
      select count(*) from public.survey_day_requests r
      where r.session_id = v.id and r.status = 'open'
        and r.due_at is not null and r.due_at < now()
    ),
    'interviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'occurredAt', o.occurred_at, 'summary', o.summary, 'subjectRole', o.subject_role
      ) order by o.occurred_at)
      from public.survey_day_observations o
      where o.session_id = v.id and o.entry_type = 'interview'
    ), '[]'::jsonb),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'occurredAt', o.occurred_at, 'summary', o.summary, 'subjectRole', o.subject_role
      ) order by o.occurred_at)
      from public.survey_day_observations o
      where o.session_id = v.id and o.entry_type = 'observation'
    ), '[]'::jsonb),
    'potentialFindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'occurredAt', o.occurred_at, 'summary', o.summary,
        'citation', o.citation, 'disposition', o.finding_disposition, 'basis', o.finding_basis,
        'followUpWorkItemId', o.follow_up_work_item_id
      ) order by o.occurred_at)
      from public.survey_day_observations o
      where o.session_id = v.id and o.entry_type = 'potential_finding'
    ), '[]'::jsonb),
    'pinnedBinderJobId', v.pinned_binder_job_id,
    'pinnedEvidenceCollectionId', v.pinned_evidence_collection_id,
    'assembledAt', now()
  );
end $$;
revoke all on function public.get_survey_day_packet(uuid) from public, anon;
grant execute on function public.get_survey_day_packet(uuid) to authenticated, service_role;

-- Assembling a packet is itself an event worth recording: it is the moment somebody took a position
-- on what the survey contained.
create or replace function public.record_survey_day_packet_assembled(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.survey_day_sessions%rowtype;
begin
  select * into v from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v.organization_id, v.facility_id);
  insert into public.survey_day_events(session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v.id, v.organization_id, v.facility_id, auth.uid(), 'packet_assembled', '{}'::jsonb);
  return true;
end $$;
revoke all on function public.record_survey_day_packet_assembled(uuid) from public, anon;
grant execute on function public.record_survey_day_packet_assembled(uuid) to authenticated, service_role;
