-- Incident investigation pathways and eleven-stage follow-through (program plan Phase 6a/6b).
--
-- THE CENTRAL CHANGE, AND THE ONE THAT COULD DO DAMAGE IF DONE CARELESSLY.
-- `incidents.incident_type` is the PA *reportable-event* list, and
-- `auto_create_incident_notifications` keys the required state/law-enforcement notifications off it
-- with 2-hour and 24-hour deadlines. Operationally, facilities investigate a much wider set of
-- events -- falls, skin tears, behavioural events, property loss -- most of which are NOT reportable.
--
-- Widening `incident_type` to cover those would make the notification trigger invent a state hotline
-- call for a bruise. Leaving them out keeps every fall off the system. So instead: the pathway
-- decides which questions are asked, and reportability becomes an explicit determination.
--
-- BEHAVIOUR PRESERVED EXACTLY. The trigger keeps firing for every incident that would have fired
-- before:
--   * `reportability_status` is backfilled to 'reportable' for every existing incident of a type
--     that has a notification preset, so no historical row changes meaning.
--   * On insert, an incident with NO pathway chosen (the existing IncidentForm path) is defaulted to
--     'reportable' for exactly those preset types -- identical to today.
--   * Only a pathway whose posture is 'determination_required' produces 'pending_review', and
--     `determine_incident_reportability` creates the same preset notifications the moment a human
--     says the event is reportable.
-- The net effect for existing callers is zero change; the new behaviour only appears when a pathway
-- is deliberately chosen.
--
-- Rollback: drop the RPCs and the two new triggers, restore
-- `auto_create_incident_notifications` from 20260705144728, then drop the added columns and the
-- `incident_pathways` table.

------------------------------------------------------------------------------------------------
-- 1. Pathway catalogue.
--
-- Only the routing lives here -- which legacy incident_type a pathway records against, and whether
-- it is presumed reportable. The questions themselves stay in src/lib/incidentPathways.ts, for the
-- same reason assessment template content does: they are UI content, they change often, and a
-- second copy in SQL would drift. What the server must own is the part a client could otherwise lie
-- about, which is reportability.
------------------------------------------------------------------------------------------------
create table if not exists public.incident_pathways (
  key text primary key,
  label text not null,
  -- The `incidents.incident_type` value this pathway records against. Several pathways share one:
  -- a skin tear and a fracture are both `significant_injury` to the state.
  incident_type text not null,
  reportability text not null check (reportability in ('presumed_reportable', 'determination_required')),
  version integer not null default 1 check (version > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.incident_pathways (key, label, incident_type, reportability, version, sort_order)
values
  ('fall', 'Fall', 'significant_injury', 'determination_required', 1, 10),
  ('medication_event', 'Medication-related event', 'medication_error', 'presumed_reportable', 1, 20),
  ('elopement', 'Elopement', 'elopement', 'presumed_reportable', 1, 30),
  ('missing_resident', 'Missing resident', 'elopement', 'determination_required', 1, 40),
  ('abuse_allegation', 'Abuse allegation', 'abuse_allegation', 'presumed_reportable', 1, 50),
  ('injury', 'Injury', 'significant_injury', 'determination_required', 1, 60),
  ('skin_tear', 'Skin tear', 'significant_injury', 'determination_required', 1, 70),
  ('behavioral_event', 'Behavioral event', 'other', 'determination_required', 1, 80),
  ('emergency_transfer', 'Emergency transfer', 'significant_injury', 'determination_required', 1, 90),
  ('property_loss', 'Property loss or damage', 'other', 'determination_required', 1, 100),
  ('death', 'Death', 'death', 'presumed_reportable', 1, 110),
  ('staff_resident_altercation', 'Staff-resident altercation', 'abuse_allegation', 'presumed_reportable', 1, 120)
on conflict (key) do update set
  label = excluded.label,
  incident_type = excluded.incident_type,
  reportability = excluded.reportability,
  version = excluded.version,
  sort_order = excluded.sort_order;

alter table public.incident_pathways enable row level security;
create policy incident_pathways_select on public.incident_pathways
  for select to authenticated using (true);
revoke all on public.incident_pathways from public, anon;
grant select on public.incident_pathways to authenticated;

------------------------------------------------------------------------------------------------
-- 2. Investigation and follow-through columns.
------------------------------------------------------------------------------------------------
alter table public.incidents
  add column if not exists pathway_key text references public.incident_pathways(key),
  add column if not exists pathway_version integer,
  add column if not exists pathway_answers jsonb not null default '{}'::jsonb,
  add column if not exists pathway_completed_at timestamptz,
  -- What was done for the resident in the first minutes. Kept separate from `narrative` (what
  -- happened) because a write-up that blurs the two cannot answer "what did you do about it".
  add column if not exists immediate_response text,
  add column if not exists reportability_status text not null default 'pending_review',
  add column if not exists reportability_determined_at timestamptz,
  add column if not exists reportability_determined_by uuid references public.profiles(id),
  add column if not exists reportability_rationale text,
  add column if not exists root_cause_method text,
  add column if not exists qapi_consideration text not null default 'pending',
  -- A direct pointer rather than reusing qapi_projects.source_id: an incident is often linked to an
  -- EXISTING project (the standing falls project), and the source_id dedupe index allows only one
  -- row per source.
  add column if not exists qapi_project_id uuid references public.qapi_projects(id) on delete set null,
  add column if not exists administrator_approved_at timestamptz,
  add column if not exists administrator_approved_by uuid references public.profiles(id),
  add column if not exists administrator_approval_note text;

-- Backfill BEFORE the check constraints go on, so no historical row can violate them.
-- Every type in this list has a notification preset in auto_create_incident_notifications, which
-- means the system has already been treating those incidents as reportable.
update public.incidents
set reportability_status = 'reportable'
where reportability_status = 'pending_review'
  and incident_type in (
    'death', 'abuse_allegation', 'neglect_allegation', 'assault', 'elopement',
    'medication_error', 'significant_injury', 'fire', 'environmental_emergency'
  );

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'incidents_reportability_status_check') then
    alter table public.incidents add constraint incidents_reportability_status_check
      check (reportability_status in ('pending_review', 'reportable', 'not_reportable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_qapi_consideration_check') then
    alter table public.incidents add constraint incidents_qapi_consideration_check
      check (qapi_consideration in ('pending', 'linked', 'not_indicated'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_root_cause_method_check') then
    -- Deliberately a superset of qapi_projects.root_cause_method: an incident review commonly uses a
    -- timeline reconstruction, which that column would have to record as 'other'.
    alter table public.incidents add constraint incidents_root_cause_method_check
      check (root_cause_method is null
             or root_cause_method in ('five_whys', 'fishbone', 'timeline', 'process_review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_pathway_answers_object_check') then
    alter table public.incidents add constraint incidents_pathway_answers_object_check
      check (jsonb_typeof(pathway_answers) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_qapi_linked_project_check') then
    alter table public.incidents add constraint incidents_qapi_linked_project_check
      check (qapi_consideration <> 'linked' or qapi_project_id is not null);
  end if;
end $$;

create index if not exists incidents_reportability_idx
  on public.incidents(organization_id, reportability_status)
  where reportability_status = 'pending_review';
create index if not exists incidents_pathway_idx
  on public.incidents(pathway_key) where pathway_key is not null;

------------------------------------------------------------------------------------------------
-- 3. Default reportability at insert.
--
-- Runs BEFORE INSERT, and must run before auto_create_incident_notifications (an AFTER trigger), so
-- the notification trigger sees the resolved value.
------------------------------------------------------------------------------------------------
create or replace function app_private.default_incident_reportability()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pathway public.incident_pathways%rowtype;
  v_has_preset boolean;
begin
  -- Only fill in a value nobody set. An explicit determination passed at insert is honoured.
  if new.reportability_status is distinct from 'pending_review' then
    return new;
  end if;

  if new.pathway_key is not null then
    select * into v_pathway from public.incident_pathways where key = new.pathway_key;
    if found then
      new.pathway_version := coalesce(new.pathway_version, v_pathway.version);
      if v_pathway.reportability = 'presumed_reportable' then
        new.reportability_status := 'reportable';
      end if;
      return new;
    end if;
  end if;

  -- No pathway: preserve today's behaviour exactly. Every type with a notification preset has been
  -- treated as reportable since 20260705144728, and this keeps it that way.
  v_has_preset := new.incident_type in (
    'death', 'abuse_allegation', 'neglect_allegation', 'assault', 'elopement',
    'medication_error', 'significant_injury', 'fire', 'environmental_emergency'
  );
  if v_has_preset then
    new.reportability_status := 'reportable';
  end if;
  return new;
end $$;
revoke all on function app_private.default_incident_reportability() from public, anon, authenticated;

drop trigger if exists default_incident_reportability on public.incidents;
-- Named to sort after `protect_incident_creation_state`, which blanks investigation state for
-- authenticated inserts. BEFORE triggers on one table fire in name order, and this one must see the
-- final incident_type/pathway_key.
create trigger z_default_incident_reportability
before insert on public.incidents
for each row execute function app_private.default_incident_reportability();

-- Re-declared to blank the new investigation columns on a direct authenticated insert, exactly as
-- it already does for findings, root cause, and closure.
--
-- THIS IS THE HOLE IT CLOSES. Without it, a client inserting straight into `incidents` could set
-- `reportability_status = 'not_reportable'` on a death and the notification trigger would create no
-- state-hotline row at all -- strictly worse than before this migration. Blanking the field forces
-- the value to come from `default_incident_reportability` (which reproduces today's behaviour) and
-- any change to it to go through `determine_incident_reportability`, which demands a rationale and
-- creates the notifications.
--
-- Every assignment from 20260716224753 is preserved; the new ones are appended.
create or replace function public.protect_incident_creation_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated' then
    new.status := 'reported';
    new.reported_by_profile_id := auth.uid();
    new.reported_at := now();
    new.investigator_profile_id := null;
    new.investigator_name := null;
    new.investigation_started_at := null;
    new.investigation_findings := null;
    new.root_cause := null;
    new.closed_at := null;
    new.closed_by_profile_id := null;
    new.final_report_submitted_at := null;
    new.final_report_document_id := null;
    new.report_pdf_storage_bucket := null;
    new.report_pdf_storage_path := null;
    new.state_form_pdf_storage_bucket := null;
    new.state_form_pdf_storage_path := null;
    new.state_form_pdf_generated_at := null;
    new.created_at := now();
    new.updated_at := now();
    -- Added by 20260726080000.
    new.pathway_key := null;
    new.pathway_version := null;
    new.pathway_answers := '{}'::jsonb;
    new.pathway_completed_at := null;
    new.immediate_response := null;
    new.reportability_status := 'pending_review';
    new.reportability_determined_at := null;
    new.reportability_determined_by := null;
    new.reportability_rationale := null;
    new.root_cause_method := null;
    new.qapi_consideration := 'pending';
    new.qapi_project_id := null;
    new.administrator_approved_at := null;
    new.administrator_approved_by := null;
    new.administrator_approval_note := null;
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Notification presets, extracted so the insert trigger and the later determination create
--    exactly the same rows rather than two drifting copies.
------------------------------------------------------------------------------------------------
create or replace function app_private.create_incident_notification_presets(p_incident_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
  v_created integer := 0;
begin
  select * into v from public.incidents where id = p_incident_id;
  if not found then return 0; end if;

  insert into public.incident_notifications (
    organization_id, facility_id, incident_id, notification_type, due_at
  )
  select v.organization_id, v.facility_id, v.id, preset.notification_type,
         v.occurred_at + (preset.due_hours || ' hours')::interval
  from (
    values
      ('death', 'state_hotline', 2),
      ('abuse_allegation', 'state_hotline', 2),
      ('abuse_allegation', 'law_enforcement', 2),
      ('neglect_allegation', 'state_hotline', 2),
      ('assault', 'state_hotline', 2),
      ('assault', 'law_enforcement', 2),
      ('elopement', 'state_hotline', 24),
      ('medication_error', 'state_hotline', 24),
      ('significant_injury', 'state_hotline', 24),
      ('fire', 'state_hotline', 24),
      ('environmental_emergency', 'state_hotline', 24)
  ) as preset(incident_type, notification_type, due_hours)
  where preset.incident_type = v.incident_type
    -- Idempotent: a determination made twice, or made on an incident whose notifications were
    -- created at insert, must not duplicate the row.
    and not exists (
      select 1 from public.incident_notifications n
      where n.incident_id = v.id and n.notification_type = preset.notification_type
    );

  get diagnostics v_created = row_count;
  return v_created;
end $$;
revoke all on function app_private.create_incident_notification_presets(uuid) from public, anon, authenticated;

-- A fourth notification status.
--
-- WHY THIS IS NEEDED, AND WHY NOTHING IS DELETED. `significant_injury` has a 24-hour state-hotline
-- preset, and it is also the type a fall is recorded under. So today every fall auto-creates a state
-- notification. Item 13 exists precisely because most falls are not reportable, and a queue where
-- most entries are noise is a queue nobody reads.
--
-- The fix is NOT to delete the auto-created rows: a notification obligation that vanishes without
-- trace is exactly what a survey asks about. Instead a determination of 'not_reportable' marks the
-- still-pending presets 'not_required' and writes the rationale onto them. The row survives, it says
-- who decided and why, and it stops counting as outstanding work.
do $$ begin
  alter table public.incident_notifications drop constraint if exists incident_notifications_status_check;
  alter table public.incident_notifications add constraint incident_notifications_status_check
    check (status in ('pending', 'completed', 'overdue', 'not_required'));
end $$;

-- Re-declared so the nightly sweep cannot resurrect a stood-down notification. Every other line is
-- unchanged from 20260724160000; the only difference is that 'not_required' and 'completed' rows are
-- left alone instead of being recomputed from due_at.
create or replace function public.recalculate_incident_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_notifications n
  set status = case
    when n.completed_at is not null then 'completed'
    when n.due_at < now() then 'overdue'
    else 'pending'
  end
  where n.status <> 'not_required';

  insert into public.alerts (organization_id, facility_id, incident_notification_id, alert_type, title, message, severity)
  select
    n.organization_id, n.facility_id, n.id,
    'incident_notification_overdue',
    'Incident notification overdue',
    replace(n.notification_type, '_', ' ') || ' notification is overdue for an incident reported ' || to_char(i.reported_at, 'Mon DD, YYYY HH12:MI AM'),
    'critical'
  from public.incident_notifications n
  join public.incidents i on i.id = n.incident_id
  where n.status = 'overdue'
    and not exists (
      select 1 from public.alerts a
      where a.incident_notification_id = n.id and a.status = 'open'
    );

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.incident_notifications n
  where a.incident_notification_id = n.id
    and a.status = 'open'
    and a.alert_type = 'incident_notification_overdue'
    and n.status <> 'overdue';
end;
$$;
revoke all on function public.recalculate_incident_notifications() from public, anon, authenticated;
grant execute on function public.recalculate_incident_notifications() to service_role;

-- Re-declared to gate on the determination instead of the type alone. The presets and the deadlines
-- are unchanged; what changed is that an incident still awaiting a reportability determination does
-- not get state notifications invented for it.
create or replace function public.auto_create_incident_notifications()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.reportability_status = 'reportable' then
    perform app_private.create_incident_notification_presets(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.auto_create_incident_notifications() from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 5. Write path: one RPC per stage that needs a rule enforced. Stages that are plain text
--    (immediate response, findings) go through save_incident_investigation_step so the client is
--    not updating the incidents table field-by-field.
------------------------------------------------------------------------------------------------
create or replace function app_private.assert_incident_manager(p_org uuid, p_fac uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null
     or (select public.current_org_id()) is distinct from p_org
     or (select public.current_role()) not in ('org_admin', 'facility_manager')
     or ((select public.current_role()) = 'facility_manager'
         and not public.is_assigned_to_facility(p_fac)) then
    raise exception 'Incident operation is outside caller scope' using errcode = '42501';
  end if;
end $$;
revoke all on function app_private.assert_incident_manager(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.save_incident_pathway(
  p_incident_id uuid,
  p_pathway_key text,
  p_answers jsonb,
  p_complete boolean default false
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
  v_pathway public.incident_pathways%rowtype;
begin
  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);
  if v.status = 'closed' then
    raise exception 'A closed incident cannot be edited' using errcode = '55000';
  end if;

  select * into v_pathway from public.incident_pathways where key = p_pathway_key and active;
  if not found then
    raise exception 'Unknown investigation pathway %', p_pathway_key using errcode = '22023';
  end if;
  if v_pathway.incident_type <> v.incident_type then
    raise exception 'Pathway % does not apply to a % incident', p_pathway_key, v.incident_type
      using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Pathway answers must be an object' using errcode = '22023';
  end if;

  update public.incidents set
    pathway_key = v_pathway.key,
    -- Pinned at first save so a later pathway revision cannot retroactively change what was asked.
    pathway_version = coalesce(pathway_version, v_pathway.version),
    pathway_answers = coalesce(p_answers, '{}'::jsonb),
    pathway_completed_at = case when p_complete then coalesce(pathway_completed_at, now()) else null end,
    investigation_started_at = coalesce(investigation_started_at, now()),
    status = case when status = 'reported' then 'investigating' else status end,
    -- Choosing a pathway whose posture is 'determination_required' hands the reportability question
    -- back to a person -- but only when the current value came from the type heuristic at insert
    -- (`reportability_determined_at is null`). A determination somebody actually made is never
    -- overwritten by picking a pathway.
    reportability_status = case
      when v_pathway.reportability = 'determination_required' and v.reportability_determined_at is null
        then 'pending_review'
      when v_pathway.reportability = 'presumed_reportable'
        then 'reportable'
      else reportability_status end,
    updated_at = now()
  where id = v.id;
  return true;
end $$;
revoke all on function public.save_incident_pathway(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.save_incident_pathway(uuid, text, jsonb, boolean) to authenticated, service_role;

-- The reportability determination. Deliberately requires a rationale in BOTH directions: "not
-- reportable" is the answer that has to be defensible, and an unexplained one is worthless in a
-- survey.
create or replace function public.determine_incident_reportability(
  p_incident_id uuid,
  p_status text,
  p_rationale text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
  v_created integer := 0;
begin
  if p_status not in ('reportable', 'not_reportable') then
    raise exception 'Reportability must be determined as reportable or not_reportable, not %', p_status
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_rationale, ''))) < 10 then
    raise exception 'A reportability determination requires a written rationale of at least 10 characters'
      using errcode = '22023';
  end if;

  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);

  update public.incidents set
    reportability_status = p_status,
    reportability_determined_at = now(),
    reportability_determined_by = auth.uid(),
    reportability_rationale = btrim(p_rationale),
    updated_at = now()
  where id = v.id;

  if p_status = 'reportable' then
    -- Reactivate anything a previous 'not_reportable' determination stood down. Without this a
    -- reversal would leave the obligation permanently dormant, because create_incident_notification
    -- _presets skips a type that already has a row -- the worst possible outcome of a reversal.
    update public.incident_notifications n
    set status = case when n.due_at < now() then 'overdue' else 'pending' end,
        notes = coalesce(n.notes || E'\n', '') || 'Reinstated: ' || btrim(p_rationale),
        updated_at = now()
    where n.incident_id = v.id and n.status = 'not_required';

    v_created := app_private.create_incident_notification_presets(v.id);
  else
    -- Stand down the presets the type heuristic created at insert, without destroying them. A
    -- notification that was already completed is a fact and is never touched: the call was made,
    -- and un-recording it would be falsifying the file.
    update public.incident_notifications n
    set status = 'not_required',
        notes = coalesce(n.notes || E'\n', '')
                || 'Determined not reportable: ' || btrim(p_rationale),
        updated_at = now()
    where n.incident_id = v.id
      and n.status <> 'completed'
      and n.completed_at is null;
  end if;
  return v_created;
end $$;
revoke all on function public.determine_incident_reportability(uuid, text, text) from public, anon;
grant execute on function public.determine_incident_reportability(uuid, text, text) to authenticated, service_role;

create or replace function public.save_incident_investigation_step(
  p_incident_id uuid,
  p_immediate_response text default null,
  p_investigation_findings text default null,
  p_root_cause text default null,
  p_root_cause_method text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
begin
  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);
  if v.status = 'closed' then
    raise exception 'A closed incident cannot be edited' using errcode = '55000';
  end if;
  if p_root_cause_method is not null
     and p_root_cause_method not in ('five_whys', 'fishbone', 'timeline', 'process_review') then
    raise exception 'Unknown root cause method %', p_root_cause_method using errcode = '22023';
  end if;

  update public.incidents set
    immediate_response = coalesce(nullif(btrim(coalesce(p_immediate_response, '')), ''), immediate_response),
    investigation_findings = coalesce(nullif(btrim(coalesce(p_investigation_findings, '')), ''), investigation_findings),
    root_cause = coalesce(nullif(btrim(coalesce(p_root_cause, '')), ''), root_cause),
    root_cause_method = coalesce(p_root_cause_method, root_cause_method),
    investigation_started_at = case
      when p_investigation_findings is not null or p_root_cause is not null
        then coalesce(investigation_started_at, now())
      else investigation_started_at end,
    updated_at = now()
  where id = v.id;
  return true;
end $$;
revoke all on function public.save_incident_investigation_step(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_incident_investigation_step(uuid, text, text, text, text) to authenticated, service_role;

create or replace function public.set_incident_qapi_consideration(
  p_incident_id uuid,
  p_consideration text,
  p_qapi_project_id uuid default null,
  p_note text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
begin
  if p_consideration not in ('linked', 'not_indicated') then
    raise exception 'QAPI consideration must be recorded as linked or not_indicated, not %', p_consideration
      using errcode = '22023';
  end if;
  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);

  if p_consideration = 'linked' then
    if p_qapi_project_id is null then
      raise exception 'Linking to QAPI requires a project' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.qapi_projects q
      where q.id = p_qapi_project_id
        and q.organization_id = v.organization_id
        and q.facility_id = v.facility_id
    ) then
      raise exception 'QAPI project is outside this incident''s facility' using errcode = '23514';
    end if;
  end if;

  update public.incidents set
    qapi_consideration = p_consideration,
    qapi_project_id = case when p_consideration = 'linked' then p_qapi_project_id else null end,
    -- A "not indicated" decision is only meaningful with the reasoning attached to it.
    investigation_findings = case
      when p_consideration = 'not_indicated' and nullif(btrim(coalesce(p_note, '')), '') is not null
        then coalesce(investigation_findings || E'\n\n', '') || 'QAPI not indicated: ' || btrim(p_note)
      else investigation_findings end,
    updated_at = now()
  where id = v.id;
  return true;
end $$;
revoke all on function public.set_incident_qapi_consideration(uuid, text, uuid, text) from public, anon;
grant execute on function public.set_incident_qapi_consideration(uuid, text, uuid, text) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 6. Administrator approval -- the server-side mirror of buildIncidentFollowThrough().canClose.
--
-- Every stage rule lives here as well as in incidentStages.ts. That duplication is deliberate and
-- narrow: the TypeScript version drives what a person SEES, and this one decides what the database
-- ACCEPTS. A gate that only exists in the client is not a gate.
------------------------------------------------------------------------------------------------
create or replace function public.approve_incident_investigation(
  p_incident_id uuid,
  p_note text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v public.incidents%rowtype;
  v_open_notifications integer;
  v_open_actions integer;
  v_unverified_actions integer;
  v_reviews_apply boolean;
begin
  select * into v from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id, v.facility_id);

  if length(btrim(coalesce(v.immediate_response, ''))) = 0 then
    raise exception 'Record the immediate response before approving the investigation'
      using errcode = '55000';
  end if;
  if v.reportability_status = 'pending_review' then
    raise exception 'Determine whether this incident is reportable before approving it'
      using errcode = '55000';
  end if;

  select count(*) into v_open_notifications
  from public.incident_notifications n
  where n.incident_id = v.id
    and n.status not in ('completed', 'not_required')
    and n.completed_at is null;
  if v_open_notifications > 0 then
    raise exception '% required notification(s) are still outstanding', v_open_notifications
      using errcode = '55000';
  end if;

  if v.pathway_completed_at is null then
    raise exception 'Complete the investigation pathway before approving it' using errcode = '55000';
  end if;
  if length(btrim(coalesce(v.investigation_findings, ''))) = 0 then
    raise exception 'Record the investigation findings before approving it' using errcode = '55000';
  end if;
  if length(btrim(coalesce(v.root_cause, ''))) = 0 or v.root_cause_method is null then
    raise exception 'Record the root cause and the method used to reach it' using errcode = '55000';
  end if;

  select count(*) filter (where c.status not in ('completed', 'cancelled') and c.completed_date is null),
         count(*) filter (where c.status = 'completed' and length(btrim(coalesce(c.verification_notes, ''))) = 0)
    into v_open_actions, v_unverified_actions
  from public.corrective_actions c
  where c.incident_id = v.id;
  if v_open_actions > 0 then
    raise exception '% corrective action(s) are still open', v_open_actions using errcode = '55000';
  end if;
  if v_unverified_actions > 0 then
    raise exception '% completed corrective action(s) have no verification recorded', v_unverified_actions
      using errcode = '55000';
  end if;

  -- Mirrors REVIEW_REQUIRED_SEVERITIES in incidentStages.ts.
  v_reviews_apply := v.resident_id is not null and v.severity in ('major', 'critical');
  if v_reviews_apply then
    if not exists (
      select 1 from public.resident_assessment_reviews r
      where r.incident_id = v.id and r.status = 'final'
    ) then
      raise exception 'Finalize the post-incident assessment review before approving it'
        using errcode = '55000';
    end if;
    if not exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id and p.created_at >= v.occurred_at
    ) then
      raise exception 'Revise the support plan, or record a review of it, before approving this incident'
        using errcode = '55000';
    end if;
  end if;

  -- Mirrors QAPI_ALWAYS_CONSIDERED_TYPES in incidentStages.ts.
  if v.qapi_consideration = 'pending'
     and (v.incident_type in ('abuse_allegation', 'neglect_allegation', 'death', 'elopement', 'medication_error')
          or v.severity in ('major', 'critical')) then
    raise exception 'Record whether this incident warrants a QAPI project before approving it'
      using errcode = '55000';
  end if;

  update public.incidents set
    administrator_approved_at = now(),
    administrator_approved_by = auth.uid(),
    administrator_approval_note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = v.id;
  return true;
end $$;
revoke all on function public.approve_incident_investigation(uuid, text) from public, anon;
grant execute on function public.approve_incident_investigation(uuid, text) to authenticated, service_role;

-- Re-declared to add the approval requirement. The final-report rule from 20260705144728 is
-- preserved verbatim -- it is the existing gate and nothing here weakens it.
create or replace function public.enforce_incident_final_report_before_close()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    if new.final_report_submitted_at is null then
      raise exception 'Cannot close an incident before recording the final report submission date.'
        using errcode = 'check_violation';
    end if;
    if new.administrator_approved_at is null then
      raise exception 'Cannot close an incident before an administrator approves the investigation.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------------------------
-- 7. Link a post-incident assessment review to the incident that prompted it.
--
-- Without the link, "was the resident reassessed after this event" is a date heuristic, and two
-- incidents in one week make it wrong.
------------------------------------------------------------------------------------------------
alter table public.resident_assessment_reviews
  add column if not exists incident_id uuid references public.incidents(id) on delete set null;

create index if not exists resident_assessment_reviews_incident_idx
  on public.resident_assessment_reviews(incident_id)
  where incident_id is not null;

-- Re-declared with p_incident_id. The old 7-argument signature is dropped rather than left as an
-- overload: two live versions of a write path is how a caller silently keeps using the old rules.
-- Every existing named-argument caller keeps working, since the new parameter has a default.
drop function if exists public.save_resident_assessment_review(uuid, text, integer, jsonb, uuid, uuid, date);

create or replace function public.save_resident_assessment_review(
  p_resident_id uuid,
  p_template_key text,
  p_template_version integer,
  p_answers jsonb,
  p_review_id uuid default null,
  p_hospital_episode_id uuid default null,
  p_review_date date default null,
  p_incident_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_existing public.resident_assessment_reviews%rowtype;
  v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v_resident.organization_id, v_resident.facility_id);

  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Review answers must be an object' using errcode = '22023';
  end if;
  if p_review_date is not null and p_review_date > current_date then
    raise exception 'A review cannot be dated in the future' using errcode = '22023';
  end if;
  if p_hospital_episode_id is not null and not exists (
    select 1 from public.hospital_transfer_episodes h
    where h.id = p_hospital_episode_id and h.resident_id = p_resident_id
  ) then
    raise exception 'Hospital episode belongs to a different resident' using errcode = '23514';
  end if;
  if p_incident_id is not null and not exists (
    select 1 from public.incidents i
    where i.id = p_incident_id and i.resident_id = p_resident_id
  ) then
    raise exception 'Incident belongs to a different resident' using errcode = '23514';
  end if;

  if p_review_id is not null then
    select * into v_existing from public.resident_assessment_reviews
      where id = p_review_id and resident_id = p_resident_id for update;
    if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
    -- A finalized review is evidence. Correcting one means superseding it with a new review, not
    -- editing the record a signature already attests to.
    if v_existing.status <> 'draft' then
      raise exception 'Only a draft review can be edited; supersede the finalized one instead'
        using errcode = '55000';
    end if;
    update public.resident_assessment_reviews set
      answers = coalesce(p_answers, '{}'::jsonb),
      hospital_episode_id = coalesce(p_hospital_episode_id, hospital_episode_id),
      incident_id = coalesce(p_incident_id, incident_id),
      review_date = coalesce(p_review_date, review_date),
      updated_at = now()
    where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.resident_assessment_reviews(
    organization_id, facility_id, resident_id, template_key, template_version,
    answers, hospital_episode_id, incident_id, review_date, created_by
  )
  values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_template_key,
    p_template_version, coalesce(p_answers, '{}'::jsonb), p_hospital_episode_id, p_incident_id,
    coalesce(p_review_date, current_date), auth.uid()
  )
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.save_resident_assessment_review(uuid, text, integer, jsonb, uuid, uuid, date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_resident_assessment_review(uuid, text, integer, jsonb, uuid, uuid, date, uuid)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 8. Read path: one call that returns an incident with everything the eleven stages need.
------------------------------------------------------------------------------------------------
create or replace function public.get_incident_follow_through(p_incident_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v public.incidents%rowtype;
begin
  -- security invoker: the incidents RLS select policy decides visibility, exactly as it does for a
  -- direct read. No SECURITY DEFINER widening here -- there is nothing this needs that the caller
  -- cannot already see.
  select * into v from public.incidents where id = p_incident_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'incident', to_jsonb(v),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'notification_type', n.notification_type, 'status', n.status,
        'due_at', n.due_at, 'completed_at', n.completed_at
      ) order by n.due_at)
      from public.incident_notifications n where n.incident_id = v.id
    ), '[]'::jsonb),
    'corrective_actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', c.status, 'due_date', c.due_date,
        'completed_date', c.completed_date, 'verification_notes', c.verification_notes
      ) order by c.due_date)
      from public.corrective_actions c where c.incident_id = v.id
    ), '[]'::jsonb),
    'assessment_review_finalized', exists (
      select 1 from public.resident_assessment_reviews r
      where r.incident_id = v.id and r.status = 'final'
    ),
    'support_plan_revised_after_incident', v.resident_id is not null and exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id and p.created_at >= v.occurred_at
    )
  );
end $$;
revoke all on function public.get_incident_follow_through(uuid) from public, anon;
grant execute on function public.get_incident_follow_through(uuid) to authenticated, service_role;
