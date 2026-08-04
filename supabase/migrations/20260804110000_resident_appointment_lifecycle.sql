-- Resident appointments: the lifecycle behind the last unbuilt Resident 360 tab.
--
-- THE PROBLEM THIS FIXES. `resident_appointments` has been in the schema since 20260714100000 with
-- a scheduling RPC, an outcome RPC, an RLS policy, and grants -- and nothing in the application has
-- ever read or written a row. `src/pages/app/resident-tabs/tabs.ts` records it as the one tab in the
-- Resident 360 request that was never built, on the reasoning that an empty tab reads as "no
-- appointments" rather than "not built". That reasoning was right, and it was never resolved.
--
-- Building the tab on the schema as it stands would surface three dead ends:
--
--   1. `documents_required`, `equipment_required`, and `preparation_checklist` are written once at
--      scheduling and never revisited. A resident leaves for a cardiology appointment without the
--      medication list because nothing recorded that the list was supposed to travel with them.
--   2. `new_order_ack_status` can reach 'pending_review' and stop there. There is no path to
--      'acknowledged'. Phase 5b's hospital-return work already named this failure -- "an order
--      nobody acknowledged is an order nobody is carrying out" -- and the appointment path has the
--      identical dead end with no equivalent of `complete_hospital_return_reconciliation`.
--   3. `record_appointment_outcome` opens a follow-up work item and nothing ever closes it. The
--      universal queue accumulates appointment follow-ups closable only through the generic path,
--      which severs the link back to the appointment that raised them.
--
-- HOW THE THREE DORMANT COLUMNS ARE MADE TO MEAN SOMETHING WITHOUT REWRITING THE CREATOR. A trigger
-- derives one preparation-item row per required document, piece of equipment, and checklist entry at
-- insert time. `schedule_resident_appointment` is untouched, exactly as 20260726100100 derived the
-- work-item source type from the deduplication key rather than rewriting seven creators. Callers
-- that already pass those arrays get preparation tracking with no change on their side.
--
-- Readiness carries a person and an instant, not a boolean. The citation-governance migration
-- (20260726150000) established the rule: a claim that costs nothing to make is worth nothing when
-- someone asks who made it. A CHECK enforces it here rather than a convention.
--
-- Rollback: drop the four functions and the trigger, then the preparation table, then the added
-- columns. `get_resident_timeline` and `record_appointment_outcome` must be restored from
-- 20260726070100 and 20260714100000 respectively.

-- ---------------------------------------------------------------------------
-- 1. Provenance columns for the three states that had no write path
-- ---------------------------------------------------------------------------

alter table public.resident_appointments
  add column if not exists preparation_completed_at timestamptz,
  add column if not exists preparation_completed_by uuid references public.profiles(id),
  add column if not exists new_order_ack_at timestamptz,
  add column if not exists new_order_ack_by uuid references public.profiles(id),
  add column if not exists new_order_ack_note text,
  add column if not exists follow_up_completed_at timestamptz,
  add column if not exists follow_up_completed_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text,
  add column if not exists rescheduled_to_appointment_id uuid references public.resident_appointments(id) on delete set null;

-- An acknowledgement with nobody's name on it is the state this migration exists to remove; it must
-- not be reachable by writing the enum value directly either.
alter table public.resident_appointments
  drop constraint if exists resident_appointments_ack_provenance_ck;
alter table public.resident_appointments
  add constraint resident_appointments_ack_provenance_ck
  check (new_order_ack_status <> 'acknowledged' or (new_order_ack_at is not null and new_order_ack_by is not null));

-- Same rule for the pre-departure sign-off.
alter table public.resident_appointments
  drop constraint if exists resident_appointments_preparation_provenance_ck;
alter table public.resident_appointments
  add constraint resident_appointments_preparation_provenance_ck
  check (preparation_completed_at is null or preparation_completed_by is not null);

-- A rescheduled appointment that names no successor is the appointment silently disappearing from
-- the upcoming list. `reschedule_resident_appointment` below is the only way to reach that status.
alter table public.resident_appointments
  drop constraint if exists resident_appointments_reschedule_successor_ck;
alter table public.resident_appointments
  add constraint resident_appointments_reschedule_successor_ck
  check (status <> 'rescheduled' or rescheduled_to_appointment_id is not null);

create index if not exists resident_appointments_resident_idx
  on public.resident_appointments(resident_id, starts_at desc);
create index if not exists resident_appointments_open_follow_up_idx
  on public.resident_appointments(organization_id, follow_up_due_at)
  where follow_up_completed_at is null and follow_up_due_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Preparation items, derived from what the schedule already recorded
-- ---------------------------------------------------------------------------

create table if not exists public.resident_appointment_preparation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  appointment_id uuid not null references public.resident_appointments(id) on delete cascade,
  -- Kept distinct because they fail differently: a missing document is a records problem, missing
  -- equipment is a transport problem, and an unticked task is usually a person problem.
  item_kind text not null check (item_kind in ('document', 'equipment', 'task')),
  label text not null check (btrim(label) <> ''),
  -- An item the schedule listed is required. Anything added later can be optional.
  required boolean not null default true,
  ready boolean not null default false,
  ready_at timestamptz,
  ready_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, item_kind, label),
  check (not ready or (ready_at is not null and ready_by is not null))
);

create index if not exists resident_appointment_preparation_appointment_idx
  on public.resident_appointment_preparation_items(appointment_id, item_kind, label);

alter table public.resident_appointment_preparation_items enable row level security;

-- Mirrors resident_appointments_select exactly. Two predicates that nearly agree is the divergence
-- this repository has closed twice already, so this one is derived from the appointment row rather
-- than restated over the child table's own columns.
create policy resident_appointment_preparation_select
on public.resident_appointment_preparation_items
for select to authenticated
using (
  exists (
    select 1 from public.resident_appointments a
    where a.id = appointment_id
      and (
        public.is_platform_admin()
        or a.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) in ('org_admin', 'auditor')
          or public.is_assigned_to_facility(a.facility_id)
        )
      )
  )
);

grant select on public.resident_appointment_preparation_items to authenticated;
grant all on public.resident_appointment_preparation_items to service_role;

-- A table absent from the manifest produces no row in the audit coverage report, so it cannot be
-- reported as uncovered -- it is simply invisible, and the report reads as complete. That is the
-- failure `audit_manifest_covers_every_table.test.sql` ratchets against, and it fails the moment a
-- new public table lands without a classification.
--
-- Classified rather than parked in 'unclassified'. The unclassified backlog means "added after the
-- Phase 1 snapshot and nobody has looked", and its ceiling may fall but never rise; adding a row
-- there for a table written in this same change set would be claiming nobody reviewed something
-- that was reviewed while it was being designed. `domain_evidence` is the accurate answer: the only
-- state this table holds is "is this ready", and every row carries the person and the instant who
-- said so under a CHECK -- a row trigger would copy `ready_by`/`ready_at` into audit_logs on every
-- checkbox tick and add nothing. The sign-off that actually matters,
-- `complete_appointment_preparation`, writes its own audit_logs row.
insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values (
  'resident_appointment_preparation_items',
  'domain_evidence',
  true,
  'Per-item readiness for a resident appointment. Each row is itself the evidence -- ready_by and '
  'ready_at are required by a CHECK whenever ready is true -- so a row trigger would duplicate the '
  'record rather than corroborate it. The pre-departure sign-off '
  '(complete_appointment_preparation) and the new-order acknowledgement both write audit_logs. '
  'Resident-keyed through resident_appointments.'
)
on conflict (table_name) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_resident_appointment_preparation_updated_at'
  ) then
    create trigger set_resident_appointment_preparation_updated_at
      before update on public.resident_appointment_preparation_items
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Derive the items from the arrays the creator already writes
-- ---------------------------------------------------------------------------
--
-- `preparation_checklist` is jsonb with no enforced element shape, and the scheduling RPC accepts
-- whatever it is given. Both forms actually in use are handled -- a bare string, and an object with
-- a label-ish key -- and anything else is skipped rather than stored as "null" or "[object]", which
-- would put an unactionable row in front of an aide.

create or replace function app_private.appointment_checklist_label(p_entry jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(
    case jsonb_typeof(p_entry)
      when 'string' then p_entry #>> '{}'
      when 'object' then coalesce(p_entry ->> 'label', p_entry ->> 'task', p_entry ->> 'item', p_entry ->> 'name')
      else null
    end
  ), '')
$$;

create or replace function app_private.seed_appointment_preparation_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.resident_appointment_preparation_items(
    organization_id, facility_id, appointment_id, item_kind, label
  )
  select new.organization_id, new.facility_id, new.id, source.item_kind, source.label
  from (
    select 'document'::text item_kind, btrim(d) label
    from unnest(coalesce(new.documents_required, array[]::text[])) d
    where btrim(d) <> ''
    union
    select 'equipment', btrim(e)
    from unnest(coalesce(new.equipment_required, array[]::text[])) e
    where btrim(e) <> ''
    union
    select 'task', app_private.appointment_checklist_label(entry)
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(new.preparation_checklist, '[]'::jsonb)) = 'array'
        then new.preparation_checklist else '[]'::jsonb end
    ) entry
    where app_private.appointment_checklist_label(entry) is not null
  ) source
  on conflict (appointment_id, item_kind, label) do nothing;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'seed_resident_appointment_preparation_items'
  ) then
    create trigger seed_resident_appointment_preparation_items
      after insert on public.resident_appointments
      for each row execute function app_private.seed_appointment_preparation_items();
  end if;
end $$;

-- Backfill any appointment that predates this migration, so the tab does not show an empty
-- preparation list for a row whose schedule named three documents.
insert into public.resident_appointment_preparation_items(
  organization_id, facility_id, appointment_id, item_kind, label
)
select a.organization_id, a.facility_id, a.id, source.item_kind, source.label
from public.resident_appointments a
cross join lateral (
  select 'document'::text item_kind, btrim(d) label
  from unnest(coalesce(a.documents_required, array[]::text[])) d
  where btrim(d) <> ''
  union
  select 'equipment', btrim(e)
  from unnest(coalesce(a.equipment_required, array[]::text[])) e
  where btrim(e) <> ''
  union
  select 'task', app_private.appointment_checklist_label(entry)
  from jsonb_array_elements(
    case when jsonb_typeof(coalesce(a.preparation_checklist, '[]'::jsonb)) = 'array'
      then a.preparation_checklist else '[]'::jsonb end
  ) entry
  where app_private.appointment_checklist_label(entry) is not null
) source
on conflict (appointment_id, item_kind, label) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Marking an item ready, and adding one the schedule did not foresee
-- ---------------------------------------------------------------------------

create or replace function public.set_appointment_preparation_item(
  p_item_id uuid,
  p_ready boolean,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointment_preparation_items%rowtype;
  v_appointment public.resident_appointments%rowtype;
begin
  select * into v from public.resident_appointment_preparation_items where id = p_item_id for update;
  if not found then raise exception 'Preparation item not found' using errcode = 'P0002'; end if;
  select * into v_appointment from public.resident_appointments where id = v.appointment_id;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);

  -- Reopening an item after the pre-departure sign-off would leave `preparation_completed_at`
  -- asserting something that is no longer true. Clear the sign-off in the same statement.
  if v_appointment.preparation_completed_at is not null and not p_ready then
    update public.resident_appointments
      set preparation_completed_at = null, preparation_completed_by = null, updated_at = now()
      where id = v.appointment_id;
  end if;

  update public.resident_appointment_preparation_items set
    ready = p_ready,
    ready_at = case when p_ready then now() else null end,
    ready_by = case when p_ready then auth.uid() else null end,
    note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = v.id;
  return true;
end $$;

create or replace function public.add_appointment_preparation_item(
  p_appointment_id uuid,
  p_item_kind text,
  p_label text,
  p_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointments%rowtype;
  v_id uuid;
begin
  select * into v from public.resident_appointments where id = p_appointment_id;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_item_kind not in ('document', 'equipment', 'task') then
    raise exception 'Unknown preparation item kind' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_label, '')), '') is null then
    raise exception 'A preparation item needs a label' using errcode = '22023';
  end if;

  insert into public.resident_appointment_preparation_items(
    organization_id, facility_id, appointment_id, item_kind, label, required
  )
  values (v.organization_id, v.facility_id, v.id, p_item_kind, btrim(p_label), coalesce(p_required, true))
  on conflict (appointment_id, item_kind, label) do update set required = excluded.required, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The pre-departure sign-off, gated on what is still outstanding
-- ---------------------------------------------------------------------------

create or replace function public.complete_appointment_preparation(
  p_appointment_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointments%rowtype;
  v_outstanding text[];
begin
  select * into v from public.resident_appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status not in ('scheduled', 'rescheduled') then
    raise exception 'Preparation applies only to an appointment that has not happened yet' using errcode = '22023';
  end if;

  select coalesce(array_agg(i.item_kind || ': ' || i.label order by i.item_kind, i.label), array[]::text[])
    into v_outstanding
  from public.resident_appointment_preparation_items i
  where i.appointment_id = v.id and i.required and not i.ready;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Appointment preparation is not complete while these remain: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.resident_appointments set
    preparation_completed_at = now(), preparation_completed_by = auth.uid(), updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_appointment', v.id::text,
    'appointment.preparation_completed',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Acknowledging new orders that came back with the resident
-- ---------------------------------------------------------------------------

create or replace function public.acknowledge_appointment_new_order(
  p_appointment_id uuid,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_appointments%rowtype;
begin
  select * into v from public.resident_appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.new_order_ack_status <> 'pending_review' then
    raise exception 'This appointment has no new orders awaiting acknowledgement' using errcode = '22023';
  end if;
  -- The note is what the acknowledgement is *for*: which order, and what changed as a result.
  -- "Acknowledged" on its own is the state this whole migration exists to stop being an endpoint.
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say what the new orders were and what was changed to carry them out' using errcode = '22023';
  end if;

  update public.resident_appointments set
    new_order_ack_status = 'acknowledged', new_order_ack_at = now(), new_order_ack_by = auth.uid(),
    new_order_ack_note = btrim(p_note), updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (v.organization_id, auth.uid(), 'resident_appointment', v.id::text,
    'appointment.new_order_acknowledged',
    jsonb_build_object('status', v.new_order_ack_status),
    jsonb_build_object('status', 'acknowledged'));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Closing the follow-up, and closing the work item with it
-- ---------------------------------------------------------------------------

create or replace function public.complete_appointment_follow_up(
  p_appointment_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointments%rowtype;
  v_outstanding text[] := array[]::text[];
begin
  select * into v from public.resident_appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status in ('scheduled', 'rescheduled') then
    raise exception 'Record the appointment outcome before closing its follow-up' using errcode = '22023';
  end if;
  if v.follow_up_completed_at is not null then
    raise exception 'This appointment follow-up is already closed' using errcode = '22023';
  end if;

  -- The outcome summary is what the follow-up work item's description was built from. Closing
  -- without one leaves a queue entry whose only content was "Appointment outcome requires staff
  -- follow-up" and a record that says nothing about what happened.
  if nullif(btrim(coalesce(v.outcome_summary, '')), '') is null then
    v_outstanding := v_outstanding || 'what happened at the appointment';
  end if;
  if v.new_order_ack_status = 'pending_review' then
    v_outstanding := v_outstanding || 'acknowledgement of the new orders';
  end if;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Appointment follow-up cannot be closed while these remain outstanding: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.work_items set
    state = 'closed',
    closure_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Appointment follow-up completed'), 1000),
    closed_at = now(),
    updated_at = now()
  where id = v.follow_up_work_item_id and state not in ('closed', 'canceled');

  update public.resident_appointments set
    follow_up_completed_at = now(), follow_up_completed_by = auth.uid(), updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_appointment', v.id::text,
    'appointment.follow_up_completed',
    jsonb_build_object('workItemId', v.follow_up_work_item_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Rescheduling, as a link rather than a disappearance
-- ---------------------------------------------------------------------------
--
-- Delegates to `schedule_resident_appointment` so the driver and escort conflict checks live in one
-- place. The successor inherits the transport arrangements and the preparation list, because
-- retyping five fields is how a reschedule turns into a resident travelling without their oxygen.

create or replace function public.reschedule_resident_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_reason text,
  p_expected_return_at timestamptz default null,
  p_pickup_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_appointments%rowtype;
  v_new uuid;
begin
  select * into v from public.resident_appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status not in ('scheduled', 'rescheduled') then
    raise exception 'Only an appointment that has not happened yet can be rescheduled' using errcode = '22023';
  end if;
  if v.rescheduled_to_appointment_id is not null then
    raise exception 'This appointment has already been rescheduled' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the appointment moved' using errcode = '22023';
  end if;

  -- Release this appointment's hold on its driver and escort before the successor is inserted.
  -- The successor's id is what marks the original superseded, so the original is necessarily still
  -- 'scheduled' when the conflict check inside schedule_resident_appointment runs -- and moving an
  -- appointment by thirty minutes would make it conflict with itself. Section 9b's predicate fix
  -- handles the *later* case (a superseded row must not block next month's scheduling) and cannot
  -- help here, because the marking has not happened yet. Both are needed.
  --
  -- Restored below from the `v` snapshot taken FOR UPDATE at the top, so the record of who was
  -- assigned survives. The gap exists only inside this transaction; no other session sees it, and
  -- the row is locked for the whole of it.
  update public.resident_appointments
    set driver_employee_id = null, escort_employee_id = null
    where id = v.id;

  v_new := public.schedule_resident_appointment(
    v.resident_id, v.appointment_type, v.location, p_starts_at,
    coalesce(p_expected_return_at, case when v.expected_return_at is not null and v.starts_at is not null
      then p_starts_at + (v.expected_return_at - v.starts_at) end),
    v.provider_name, v.transportation_provider, v.vehicle_identifier,
    v.driver_employee_id, v.escort_employee_id,
    coalesce(p_pickup_at, case when v.pickup_at is not null and v.starts_at is not null
      then p_starts_at + (v.pickup_at - v.starts_at) end),
    v.documents_required, v.equipment_required, v.preparation_checklist
  );

  update public.resident_appointments set
    status = 'rescheduled', rescheduled_to_appointment_id = v_new,
    cancellation_reason = btrim(p_reason),
    driver_employee_id = v.driver_employee_id, escort_employee_id = v.escort_employee_id,
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_appointment', v.id::text,
    'appointment.rescheduled',
    jsonb_build_object('replacementId', v_new, 'startsAt', p_starts_at));
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 9. `record_appointment_outcome`, re-declared for two reasons and no others
-- ---------------------------------------------------------------------------
--
-- Carried forward verbatim from 20260714100000 apart from the three changes noted inline. The body
-- is short and no migration between then and now touched it, so this re-declaration is verifiable
-- by reading both files side by side -- which is the bar this repository sets for re-declaring a
-- function at all.

create or replace function public.record_appointment_outcome(
  p_appointment_id uuid,
  p_status text,
  p_outcome_summary text default null,
  p_follow_up_due_at timestamptz default null,
  p_new_order_ack_status text default 'not_applicable',
  p_uploaded_document_id uuid default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.resident_appointments%rowtype; v_work uuid;
begin
  select * into v from public.resident_appointments where id=p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  -- CHANGE 1: 'rescheduled' is removed from this list. Reaching it here set a status whose
  -- successor column stayed null, which is the appointment vanishing from the upcoming list with
  -- nothing recording where it went. `reschedule_resident_appointment` is the path.
  if p_status not in ('attended','canceled','no_show','follow_up_required','closed') then
    if p_status = 'rescheduled' then
      raise exception 'Use reschedule_resident_appointment so the replacement is linked' using errcode='22023';
    end if;
    raise exception 'Invalid appointment outcome' using errcode='22023';
  end if;
  -- CHANGE 2: an acknowledgement cannot be granted here. This function has no note and no
  -- acknowledger, and the provenance constraint added above would reject the write anyway; saying
  -- so plainly beats a constraint-violation message.
  if p_new_order_ack_status = 'acknowledged' then
    raise exception 'Acknowledge new orders through acknowledge_appointment_new_order' using errcode='22023';
  end if;
  if p_new_order_ack_status is not null and p_new_order_ack_status not in ('not_applicable','pending_review') then
    raise exception 'Invalid new-order acknowledgement status' using errcode='22023';
  end if;
  -- An appointment whose orders were already acknowledged must not be silently reset to
  -- 'not_applicable' by a second outcome edit.
  update public.resident_appointments set status=p_status, outcome_summary=p_outcome_summary, follow_up_due_at=p_follow_up_due_at,
    new_order_ack_status=case when v.new_order_ack_status='acknowledged' then 'acknowledged' else coalesce(p_new_order_ack_status,'not_applicable') end,
    uploaded_document_id=p_uploaded_document_id, updated_at=now() where id=v.id;
  if p_status in ('no_show','follow_up_required') or p_follow_up_due_at is not null or p_new_order_ack_status='pending_review' then
    -- CHANGE 3: the work item names its real source type. 20260726100100's trigger rewrites the
    -- catch-all, so this was already landing as 'resident_appointment'; that migration asked new
    -- creators to name one rather than lean on the mapping.
    insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
    values(v.organization_id,v.facility_id,'resident_appointment',v.id,'appointment-follow-up:'||v.id,'Complete appointment follow-up',left(coalesce(p_outcome_summary,'Appointment outcome requires staff follow-up'),1000),'normal',coalesce(p_follow_up_due_at,now()+interval '1 day'),'open',auth.uid())
    on conflict (organization_id,deduplication_key) do update set updated_at=now()
    returning id into v_work;
    update public.resident_appointments set follow_up_work_item_id=v_work where id=v.id;
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'resident_appointment',v.id::text,'appointment.outcome_recorded',jsonb_build_object('status',v.status),jsonb_build_object('status',p_status,'workItemId',v_work));
  return v_work;
end $$;

-- ---------------------------------------------------------------------------
-- 9b. `schedule_resident_appointment`, re-declared for one predicate
-- ---------------------------------------------------------------------------
--
-- FOUND BY TESTING THE RESCHEDULE PATH, not by reading. Rescheduling an appointment that has a
-- driver assigned, to a time overlapping the original, failed with "Driver has a transportation
-- conflict" -- the appointment conflicting with itself. The reschedule RPC creates the successor
-- before marking the original superseded (it has to: the successor's id is what marks it), so the
-- original was still holding its driver's slot when the conflict check ran.
--
-- The narrow fix is the predicate, not the ordering. Both conflict checks matched
-- `status in ('scheduled','rescheduled')`, and before this migration `'rescheduled'` was a terminal
-- label with no successor attached, so including it was defensible -- the row kept its original
-- `starts_at` and there was nothing else holding that window. It is not defensible now:
-- `rescheduled_to_appointment_id` makes the status mean "replaced by a specific later appointment",
-- and a replaced appointment is not happening. Left as it was, every reschedule would have retired
-- that driver's window permanently.
--
-- Re-declared under the same discipline as section 9: the function is fifteen lines, no migration
-- between 20260714100000 and now touches it, and this copy was GENERATED from that file with a
-- single substitution applied and every other line asserted identical -- the technique
-- 20260803040000 established. Two lines differ, both of them the conflict checks.

create or replace function public.schedule_resident_appointment(p_resident_id uuid, p_appointment_type text, p_location text, p_starts_at timestamptz, p_expected_return_at timestamptz default null, p_provider_name text default null, p_transportation_provider text default null, p_vehicle_identifier text default null, p_driver_employee_id uuid default null, p_escort_employee_id uuid default null, p_pickup_at timestamptz default null, p_documents_required text[] default array[]::text[], p_equipment_required text[] default array[]::text[], p_preparation_checklist jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id=p_resident_id;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if p_starts_at <= now() - interval '1 day' then raise exception 'Appointment time is invalid' using errcode='22023'; end if;
  if p_driver_employee_id is not null and exists (select 1 from public.resident_appointments a where a.driver_employee_id=p_driver_employee_id and a.status in ('scheduled','rescheduled') and a.rescheduled_to_appointment_id is null and tstzrange(a.pickup_at, coalesce(a.expected_return_at,a.starts_at + interval '2 hours'),'[)') && tstzrange(coalesce(p_pickup_at,p_starts_at), coalesce(p_expected_return_at,p_starts_at + interval '2 hours'),'[)')) then raise exception 'Driver has a transportation conflict' using errcode='23P01'; end if;
  if p_escort_employee_id is not null and exists (select 1 from public.resident_appointments a where a.escort_employee_id=p_escort_employee_id and a.status in ('scheduled','rescheduled') and a.rescheduled_to_appointment_id is null and tstzrange(a.pickup_at, coalesce(a.expected_return_at,a.starts_at + interval '2 hours'),'[)') && tstzrange(coalesce(p_pickup_at,p_starts_at), coalesce(p_expected_return_at,p_starts_at + interval '2 hours'),'[)')) then raise exception 'Escort has a transportation conflict' using errcode='23P01'; end if;
  insert into public.resident_appointments(organization_id,facility_id,resident_id,appointment_type,provider_name,location,starts_at,expected_return_at,transportation_provider,vehicle_identifier,driver_employee_id,escort_employee_id,pickup_at,documents_required,equipment_required,preparation_checklist,created_by)
  values(v_res.organization_id,v_res.facility_id,v_res.id,btrim(p_appointment_type),p_provider_name,btrim(p_location),p_starts_at,p_expected_return_at,p_transportation_provider,p_vehicle_identifier,p_driver_employee_id,p_escort_employee_id,p_pickup_at,coalesce(p_documents_required,array[]::text[]),coalesce(p_equipment_required,array[]::text[]),coalesce(p_preparation_checklist,'[]'::jsonb),auth.uid()) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'resident_appointment',v_id::text,'appointment.scheduled',jsonb_build_object('residentId',v_res.id,'startsAt',p_starts_at));
  return v_id;
end $$;

-- No grant restatement for schedule_resident_appointment: `create or replace function` preserves the
-- existing ACL, and 20260714100000 already revoked it from public/anon/service_role and granted
-- execute to authenticated. Restating it risks transcribing that asymmetry wrongly.

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.set_appointment_preparation_item(uuid, boolean, text),
  public.add_appointment_preparation_item(uuid, text, text, boolean),
  public.complete_appointment_preparation(uuid, text),
  public.acknowledge_appointment_new_order(uuid, text),
  public.complete_appointment_follow_up(uuid, text),
  public.reschedule_resident_appointment(uuid, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function
  public.set_appointment_preparation_item(uuid, boolean, text),
  public.add_appointment_preparation_item(uuid, text, text, boolean),
  public.complete_appointment_preparation(uuid, text),
  public.acknowledge_appointment_new_order(uuid, text),
  public.complete_appointment_follow_up(uuid, text),
  public.reschedule_resident_appointment(uuid, timestamptz, text, timestamptz, timestamptz)
  to authenticated, service_role;

revoke all on function app_private.appointment_checklist_label(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.seed_appointment_preparation_items()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Put appointments on the resident timeline
-- ---------------------------------------------------------------------------
--
-- The timeline already unions incidents, condition changes, services, hospital stays, complaints,
-- compliance items, clinical records, medications, dietary, and finance. Appointments were absent,
-- so the record showed a resident's cardiology visit only as whatever service task happened to be
-- missed that morning. Same signature and body as 20260726070100 plus one union; this file's copy
-- was generated from that one rather than retyped, and a line-level diff confirmed nothing else
-- changed.

create or replace function public.get_resident_timeline(
  p_resident_id uuid,
  p_limit integer default 100
)
returns table(
  occurred_at timestamptz, event_type text, title text, status text,
  detail text, href text, source_id uuid
)
language sql stable security invoker set search_path = '' as $function$
  select event.occurred_at, event.event_type, event.title, event.status,
    event.detail, event.href, event.source_id
  from (
    -- NEW in this migration: the appointment union at the bottom. Every other union is carried
    -- forward verbatim from 20260726070100 -- dropping any of them would silently empty the
    -- clinical chart's timeline. This body was generated from that file rather than retyped.
    -- TRAP, carried forward: a UNION takes its column names from the FIRST branch, and the outer
    -- select references them by name (event.occurred_at). That branch must alias occurred_at
    -- explicitly -- which is why the appointment branch is appended rather than placed first.
    select h.transfer_time as occurred_at, 'hospital_transfer'::text event_type,
      'Hospital transfer: ' || coalesce(h.destination, 'hospital') title,
      h.status,
      left(concat_ws(' · ',
        nullif(h.reason, ''),
        case when h.status = 'returned' then 'Returned ' || to_char(h.return_time, 'YYYY-MM-DD') end,
        nullif(h.condition_changes, ''),
        nullif(h.diet_changes, ''),
        nullif(h.mobility_changes, '')
      ), 500) detail,
      '/app/residents/' || h.resident_id::text || '?tab=timeline' href, h.id source_id
    from public.hospital_transfer_episodes h
    where h.resident_id = p_resident_id and h.status <> 'canceled'
    union all
    select coalesce(rr.assessor_signed_at, rr.created_at), 'assessment_review',
      'Review: ' || replace(rr.template_key, '_', ' '), rr.status,
      left(coalesce(rr.assessor_name, ''), 500),
      '/app/residents/' || rr.resident_id::text || '?tab=assessments', rr.id
    from public.resident_assessment_reviews rr where rr.resident_id = p_resident_id
    union all
    select us.occurred_at, 'unscheduled_service',
      'Extra care: ' || replace(us.service_kind, '_', ' '), null::text,
      left(coalesce(us.note, ''), 500), '/app/resident-care-delivery', us.id
    from public.resident_unscheduled_services us where us.resident_id = p_resident_id
    union all
    select i.occurred_at, 'incident',
      'Incident: ' || replace(i.incident_type, '_', ' '),
      i.status, left(i.narrative, 500),
      '/app/incidents/' || i.id::text, i.id
    from public.incidents i where i.resident_id = p_resident_id
    union all
    select c.identified_at, 'change_of_condition',
      'Condition change: ' || replace(c.category, '_', ' '), c.status,
      left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
    from public.resident_change_events c where c.resident_id = p_resident_id
    union all
    -- completion_response is preferred over status so the timeline shows what staff documented
    -- ("completed with more assistance") rather than only that the task closed.
    select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
      'Service: ' || s.service_name, coalesce(s.completion_response, s.status),
      left(s.note, 500), '/app/services', s.id
    from public.resident_service_task_instances s where s.resident_id = p_resident_id
    union all
    select co.created_at, 'complaint', 'Complaint: ' || replace(co.category, '_', ' '),
      co.status, left(co.description, 500), '/app/complaints/' || co.id::text, co.id
    from public.complaints co where co.resident_id = p_resident_id
    union all
    select rc.updated_at, 'compliance', 'Compliance: ' || replace(rc.item_type, '_', ' '),
      rc.status, left(rc.notes, 500), '/app/residents/' || rc.resident_id::text, rc.id
    from public.resident_compliance_items rc where rc.resident_id = p_resident_id
    union all
    select d.occurred_at, 'dietary', 'Dietary: ' || replace(d.event_type, '_', ' '),
      null::text, left(d.summary, 500), '/app/dietary-operations?resident=' || d.resident_id::text, d.id
    from public.dietary_operations_history d where d.resident_id = p_resident_id
    union all
    select f.created_at, 'financial', 'Financial: ' || replace(f.event_type, '_', ' '),
      null::text, left(f.summary, 500), '/app/resident-finance?resident=' || f.resident_id::text, f.id
    from public.resident_financial_history f where f.resident_id = p_resident_id
    union all
    select a.occurred_at, 'external_medication',
      'External eMAR: ' || replace(a.administration_status, '_', ' '),
      a.administration_status,
      left(coalesce(o.medication_display, 'Medication administration evidence'), 500),
      '/app/medication-integration?resident=' || a.resident_id::text, a.id
    from public.external_medication_administration_events a
    left join public.external_medication_orders o
      on o.source_id = a.source_id and o.external_order_id = a.external_order_id
    where a.resident_id = p_resident_id
    union all
    select ob.observed_at, 'vital',
      'Vital: ' || replace(ob.observation_type, '_', ' '), ob.abnormal_flag,
      coalesce(ob.value_numeric::text, ob.value_text) || coalesce(' ' || ob.unit, ''),
      '/app/residents/' || ob.resident_id::text || '/chart', ob.id
    from public.clinical_observations ob
    where ob.resident_id = p_resident_id and not ob.entered_in_error
    union all
    select n.authored_at, 'progress_note',
      'Note: ' || replace(n.note_type, '_', ' '), n.status, left(n.body, 500),
      '/app/residents/' || n.resident_id::text || '/chart', n.id
    from public.clinical_progress_notes n where n.resident_id = p_resident_id
    union all
    select ca.assessed_at, 'assessment',
      'Assessment: ' || replace(ca.assessment_type, '_', ' '), ca.status,
      coalesce('Score ' || ca.score::text, '') || coalesce(' · ' || ca.risk_band, ''),
      '/app/residents/' || ca.resident_id::text || '/chart', ca.id
    from public.clinical_assessments ca where ca.resident_id = p_resident_id
    union all
    select coalesce(fc.recorded_date, fc.source_updated_at), 'diagnosis',
      'Diagnosis: ' || fc.code_display, fc.clinical_status, fc.code,
      '/app/residents/' || fc.resident_id::text || '/chart', fc.id
    from public.fhir_conditions fc where fc.resident_id = p_resident_id
    union all
    select coalesce(fm.authored_on, fm.source_updated_at), 'medication',
      'Medication: ' || fm.medication_display, fm.request_status, fm.dosage_text,
      '/app/residents/' || fm.resident_id::text || '/chart', fm.id
    from public.fhir_medication_requests fm where fm.resident_id = p_resident_id
    union all
    -- An appointment is the most common reason a resident leaves the building, and the most common
    -- source of an order change the support plan does not yet reflect. It was the one resident-level
    -- record with no timeline entry at all.
    select ap.starts_at, 'appointment',
      'Appointment: ' || ap.appointment_type, ap.status,
      left(concat_ws(' · ',
        nullif(ap.provider_name, ''),
        nullif(ap.location, ''),
        case when ap.new_order_ack_status = 'pending_review' then 'New orders awaiting acknowledgement' end,
        nullif(ap.outcome_summary, '')
      ), 500),
      '/app/residents/' || ap.resident_id::text || '?tab=appointments', ap.id
    from public.resident_appointments ap where ap.resident_id = p_resident_id
  ) event
  where event.occurred_at is not null
  order by event.occurred_at desc, event.source_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

revoke all on function public.get_resident_timeline(uuid, integer) from public, anon;
grant execute on function public.get_resident_timeline(uuid, integer) to authenticated, service_role;
