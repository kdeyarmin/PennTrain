-- A reportable-incident deadline that starts when the facility knows, and says where it comes from.
--
-- THE FINDING, and the part of it a migration can fix. `create_incident_notification_presets`
-- anchors every notification deadline at `occurred_at`, always -- including when
-- `determine_incident_reportability` creates the presets days later. A resident falls on Monday,
-- goes to the emergency room, and on Thursday the facility learns the injury is serious enough to
-- report; the determination creates a `state_hotline` notification due Monday 09:00, which is
-- immediately overdue. `recalculate_incident_notifications` then raises a **critical** alert, and
-- the incident file prints a missed state deadline for a duty that did not exist until Thursday.
-- The facility's own record now says something untrue about the facility.
--
-- The deadline runs from KNOWLEDGE: `reportability_determined_at` when a determination has been
-- made, else `reported_at` when staff entered it, else `occurred_at`. One expression, evaluated
-- when the presets are created, so both paths share an anchor:
--
--   * insert-time presets (death, abuse, neglect, assault -- categories the type alone settles)
--     have no determination yet and anchor at `reported_at`, which for those categories is when
--     the facility learned of the event. Not gameable: the row exists from the moment it is filed.
--   * a later determination anchors at the determination, because that is when the duty arose.
--
-- The alternative -- keeping `occurred_at` -- does not make anyone report faster. It makes the
-- record wrong, and a permanent false "missed deadline" in an incident file is worse for the
-- facility at survey than a deadline measured from the day they found out.
--
-- WHAT THIS DOES NOT DECIDE. The two-hour window on death/abuse/neglect/assault is unsourced.
-- This repository's own reading of 55 Pa. Code 2600.16 / 2800.16 (ROADMAP.md, and the comment on
-- the migration that introduced these presets) is 24 hours; two hours matches 42 CFR 483.12(c),
-- which governs NURSING facilities, not the personal care homes and assisted living facilities
-- this product serves. Choosing between "the presets are wrong" and "this is an internal SLA and
-- should be labelled one" is a reading of the regulation, not a code change, and it belongs to
-- whoever signs the pilot's compliance posture.
--
-- So the windows move OUT OF THE FUNCTION BODY and into `incident_notification_rules`, with the
-- values unchanged and a `citation` column that cannot be null. Whoever settles the question
-- changes a row and has to name the authority in the same statement; `source_confidence` marks
-- which rows are still unverified today, so nobody has to reconstruct that from a commit message.
--
-- Rollback: restore create_incident_notification_presets from 20260810111000 and drop the table.
-- That restores deadlines that are already overdue on the day they are created.

create table if not exists public.incident_notification_rules (
  id uuid primary key default gen_random_uuid(),
  incident_type text not null,
  notification_type text not null,
  due_hours integer not null check (due_hours > 0 and due_hours <= 720),
  -- Not nullable on purpose: a deadline nobody can source is how the two-hour window got here.
  citation text not null check (length(btrim(citation)) >= 3),
  source_confidence text not null default 'unverified'
    check (source_confidence in ('verified', 'unverified')),
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_type, notification_type)
);

comment on table public.incident_notification_rules is
  'How long after knowledge each reportable incident type must be notified, and the authority for that window. Rows marked source_confidence = unverified have not been checked against the regulation text -- see BACKLOG.md I10.';

alter table public.incident_notification_rules enable row level security;

-- Readable by any signed-in caller in the product (it is regulatory reference data, not tenant
-- data, and the incident screens show the window next to the deadline). Writable by nobody through
-- the API: changing a reporting deadline is a reviewed migration, not a form submission.
create policy incident_notification_rules_select
  on public.incident_notification_rules for select to authenticated using (true);

grant select on public.incident_notification_rules to authenticated;

insert into public.incident_notification_rules (
  incident_type, notification_type, due_hours, citation, source_confidence, note
) values
  ('death', 'state_hotline', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified',
   'Two hours matches 42 CFR 483.12(c), which governs nursing facilities. This repository''s own reading of the Pennsylvania sections is 24 hours. See BACKLOG.md I10.'),
  ('abuse_allegation', 'state_hotline', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified', null),
  ('abuse_allegation', 'law_enforcement', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified', null),
  ('neglect_allegation', 'state_hotline', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified', null),
  ('assault', 'state_hotline', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified', null),
  ('assault', 'law_enforcement', 2,
   '55 Pa. Code 2600.16 / 2800.16 (window not yet confirmed against the text)', 'unverified', null),
  ('elopement', 'state_hotline', 24,
   '55 Pa. Code 2600.16 / 2800.16', 'unverified', null),
  ('medication_error', 'state_hotline', 24,
   '55 Pa. Code 2600.16 / 2800.16', 'unverified', null),
  ('significant_injury', 'state_hotline', 24,
   '55 Pa. Code 2600.16 / 2800.16', 'unverified', null),
  ('fire', 'state_hotline', 24,
   '55 Pa. Code 2600.16 / 2800.16', 'unverified', null),
  ('environmental_emergency', 'state_hotline', 24,
   '55 Pa. Code 2600.16 / 2800.16', 'unverified', null)
on conflict (incident_type, notification_type) do nothing;

create trigger set_updated_at before update on public.incident_notification_rules
  for each row execute function public.set_updated_at();

create or replace function app_private.create_incident_notification_presets(p_incident_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.incidents%rowtype;
  v_known_at timestamptz;
  v_created integer := 0;
begin
  select * into v from public.incidents where id = p_incident_id;
  if not found then return 0; end if;

  -- When the facility knew. See this migration's header for why the deadline runs from here and
  -- not from occurred_at.
  v_known_at := coalesce(v.reportability_determined_at, v.reported_at, v.occurred_at);

  insert into public.incident_notifications (
    organization_id, facility_id, incident_id, notification_type, due_at
  )
  select v.organization_id, v.facility_id, v.id, rule.notification_type,
         v_known_at + make_interval(hours => rule.due_hours)
  from public.incident_notification_rules rule
  where rule.incident_type = v.incident_type
    and rule.is_active
    -- Idempotent: a determination made twice, or made on an incident whose notifications were
    -- created at insert, must not duplicate the row.
    and not exists (
      select 1 from public.incident_notifications n
      where n.incident_id = v.id and n.notification_type = rule.notification_type
    );

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Reinstating a stood-down notification starts its clock again.
-- ---------------------------------------------------------------------------------------

create or replace function public.determine_incident_reportability(
  p_incident_id uuid,
  p_status text,
  p_rationale text
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
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
    -- Reinstating re-anchors the deadline to THIS determination (BACKLOG.md I10). It used to
    -- restore the row's original due_at -- computed from the event, when the type heuristic first
    -- created it -- and then compute `overdue` from that stale value. So the exact case this
    -- reversal exists for, a fall stood down as minor and reinstated after the emergency room came
    -- back, revived a deadline that had already passed and reported the facility as having missed
    -- a state notification it had no way to make. The window itself still comes from
    -- incident_notification_rules; only its starting point moves.
    update public.incident_notifications n
    set due_at = coalesce(
          now() + make_interval(hours => (
            select rule.due_hours
            from public.incident_notification_rules rule
            where rule.incident_type = v.incident_type
              and rule.notification_type = n.notification_type
              and rule.is_active
          )),
          n.due_at
        ),
        status = 'pending',
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
end 
$fn$;

-- ---------------------------------------------------------------------------------------
-- Classify the new table for the audit manifest.
-- ---------------------------------------------------------------------------------------
-- audit_manifest_covers_every_table.test.sql requires every public table to declare what auditing
-- it needs, so that a table added later cannot go missing from the coverage report by being absent
-- from it rather than by being reported uncovered.
insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values (
  'incident_notification_rules',
  'not_required',
  false,
  'Regulatory reference data: how long after knowledge each incident type must be notified, and '
  'the authority for that window. It holds no tenant, resident or employee data -- the same eleven '
  'rows are true for every facility in Pennsylvania. Nothing can write it through the API (select '
  'to authenticated, no other grant and no write policy), so the only way a window changes is a '
  'reviewed migration, which is itself the audit record and carries the citation the column '
  'requires. A row trigger here would log nothing that the migration history does not already say '
  'more completely.'
)
on conflict (table_name) do update
  set audit_mode = excluded.audit_mode,
      contains_regulated_data = excluded.contains_regulated_data,
      rationale = excluded.rationale,
      updated_at = now();
