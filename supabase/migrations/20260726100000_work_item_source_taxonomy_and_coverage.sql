-- Work item source taxonomy, backfill, and registration coverage (program plan Phase 7a, item 17b).
--
-- THE PROBLEM THIS FIXES. `work_items.source_type` is free text, and seven genuinely different kinds
-- of work were all being filed as the catch-all `'rule_exception'`: support-plan proposals, service
-- exceptions, appointment follow-ups, hospital-return follow-ups, facility licences, unfilled shifts,
-- and shift handoffs. `get_work_item_queue` already accepts a `p_source_type` filter, so the queue
-- was built to be grouped and filtered -- it just had nothing meaningful to group by. A universal
-- queue where four fifths of the rows share one meaningless label is a list, not a queue.
--
-- HOW THE EXISTING CREATORS ARE FIXED WITHOUT TOUCHING THEM. Seven functions across six migrations
-- write those rows inline. Re-declaring all seven would mean seven full-body copies, and this
-- program has already had one re-declaration silently drop a validation that a later migration had
-- added. Instead the true type is derived from the deduplication key -- which each creator already
-- sets to a distinct, stable prefix -- by one function used by both the backfill and a trigger. One
-- place to review, one mapping to test, and no creator is rewritten.
--
-- The trigger only ever rewrites the catch-all value. A creator that names a real source type is
-- left alone, and new creators should name one.
--
-- Rollback: drop the trigger and the sweep, then the two functions, then the taxonomy table. The
-- backfilled source_type values can be returned to 'rule_exception' with the inverse update, though
-- there is no reason to.

------------------------------------------------------------------------------------------------
-- 1. The taxonomy.
------------------------------------------------------------------------------------------------
create table if not exists public.work_item_source_types (
  key text primary key,
  label text not null,
  -- Groups the queue into the handful of headings a person actually thinks in.
  category text not null check (category in ('resident_care', 'compliance', 'workforce', 'facility', 'quality')),
  description text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.work_item_source_types (key, label, category, description, sort_order) values
  -- Resident care
  ('assessment', 'Assessment due', 'resident_care', 'A required resident assessment is due or overdue.', 10),
  ('support_plan', 'Support plan', 'resident_care', 'A support plan needs writing, reviewing, or revising.', 20),
  ('service_delivery', 'Service exception', 'resident_care', 'A scheduled service was refused, missed, or delivered differently than planned.', 30),
  ('resident_appointment', 'Appointment follow-up', 'resident_care', 'An appointment outcome needs acting on.', 40),
  ('hospital_return', 'Hospital return', 'resident_care', 'A resident returned from hospital and the reconciliation is outstanding.', 50),
  ('change_of_condition', 'Change of condition', 'resident_care', 'A recorded change in a resident''s condition needs review.', 60),
  ('resident_agreement', 'Resident agreement', 'resident_care', 'A resident agreement is unsigned or needs renewal.', 70),
  ('admission_document', 'Admission document', 'resident_care', 'An admission document is missing or unsigned.', 80),
  ('move_in', 'Move-in readiness', 'resident_care', 'A move-in task is outstanding.', 90),
  ('resident_finance', 'Resident finance', 'resident_care', 'A resident account needs attention.', 100),
  -- Compliance
  ('regulatory_requirement', 'Regulatory requirement', 'compliance', 'A recurring regulatory obligation is due.', 200),
  ('violation', 'Violation remediation', 'compliance', 'A cited violation needs remediation.', 210),
  ('inspection', 'Inspection finding', 'compliance', 'An inspection finding needs correcting.', 220),
  ('finding', 'Audit finding', 'compliance', 'An internal audit finding needs closing.', 230),
  ('policy', 'Policy review', 'compliance', 'A policy is due for review or acknowledgement.', 240),
  ('corrective_action', 'Corrective action', 'compliance', 'A corrective action is open or awaiting verification.', 250),
  -- Workforce
  ('credential', 'Credential', 'workforce', 'A staff credential is expiring or expired.', 300),
  ('training_gap', 'Training gap', 'workforce', 'Required training is overdue.', 310),
  ('exclusion_match', 'Exclusion match', 'workforce', 'A federal or state exclusion list check needs resolving.', 320),
  ('staffing', 'Staffing', 'workforce', 'A shift is unfilled or a staffing rule was breached.', 330),
  ('shift_handoff', 'Shift handoff', 'workforce', 'A handoff item needs picking up.', 340),
  -- Facility
  ('facility_license', 'Facility licence', 'facility', 'A facility licence or registration is expiring.', 400),
  ('maintenance', 'Maintenance', 'facility', 'A maintenance inspection or hazard needs attention.', 410),
  ('emergency_drill', 'Emergency drill', 'facility', 'A required drill is due or its after-action is outstanding.', 420),
  -- Quality
  ('incident', 'Incident', 'quality', 'An incident investigation or follow-up step is outstanding.', 500),
  ('near_miss', 'Near miss', 'quality', 'A near miss needs reviewing.', 510),
  ('complaint', 'Complaint', 'quality', 'A complaint has a response deadline.', 520),
  ('qapi', 'QAPI', 'quality', 'A QAPI project action is due.', 530),
  ('medication_integration', 'Medication integration', 'quality', 'A medication interface exception needs resolving.', 540),
  ('automation', 'Automation follow-up', 'quality', 'An automation rule raised work for a person.', 550),
  ('copilot_draft', 'Assistant draft', 'quality', 'A drafted action is waiting for a person to accept or discard.', 560),
  -- The catch-all is kept as a real member of the taxonomy rather than removed. Anything that
  -- genuinely does not fit still has somewhere to go, and a queue filtered to this value is a
  -- readable to-do list for whoever maintains the taxonomy.
  ('rule_exception', 'Other rule exception', 'compliance', 'Work raised by a rule that has no more specific source type.', 900)
on conflict (key) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  sort_order = excluded.sort_order;

alter table public.work_item_source_types enable row level security;
create policy work_item_source_types_select on public.work_item_source_types
  for select to authenticated using (true);
revoke all on public.work_item_source_types from public, anon;
grant select on public.work_item_source_types to authenticated;

------------------------------------------------------------------------------------------------
-- 2. The mapping.
--
-- Each prefix below is the deduplication key its creator already writes. They are listed with the
-- migration that owns them so the next person can check the mapping against the source rather than
-- trusting this comment.
------------------------------------------------------------------------------------------------
create or replace function app_private.work_item_source_type_for(
  p_source_type text,
  p_deduplication_key text
)
returns text language sql immutable set search_path = '' as $$
  select case
    -- Only the catch-all is reinterpreted. A creator that named a real type is authoritative.
    when p_source_type is distinct from 'rule_exception' then p_source_type
    -- 20260726040000 conflict_dispositions_and_proposal_engine
    when p_deduplication_key like 'support-plan-proposal:%' then 'support_plan'
    -- 20260726060000 exception_documentation_and_unscheduled_services
    when p_deduplication_key like 'service-exception:%' then 'service_delivery'
    -- 20260713230000 resident_services_calendar
    when p_deduplication_key like 'appointment-follow-up:%' then 'resident_appointment'
    -- 20260714100000 resident_care_admission_transition / 20260726070000 hospital_return_reconciliation
    when p_deduplication_key like 'hospital-return-follow-up:%' then 'hospital_return'
    -- 20260714205323 facility_license_lifecycle
    when p_deduplication_key like 'facility-license:%' then 'facility_license'
    -- 20260714093000 daily_facility_operations_workforce
    when p_deduplication_key like 'call-off:%' then 'staffing'
    -- 20260714202956 shift_handoff_lifecycle
    when p_deduplication_key like 'shift-log:%' then 'shift_handoff'
    else 'rule_exception'
  end;
$$;
revoke all on function app_private.work_item_source_type_for(text, text) from public, anon, authenticated;

-- Backfill BEFORE the trigger and the validation go on, so no existing row can trip them.
update public.work_items
set source_type = app_private.work_item_source_type_for(source_type, deduplication_key)
where source_type = 'rule_exception';

create or replace function app_private.classify_work_item_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.source_type := app_private.work_item_source_type_for(new.source_type, new.deduplication_key);
  -- A type outside the taxonomy is a bug in a creator, and it is far cheaper to find here than in a
  -- queue where the row is invisible to every filter.
  if not exists (select 1 from public.work_item_source_types t where t.key = new.source_type) then
    raise exception 'Unknown work item source type %', new.source_type using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app_private.classify_work_item_source() from public, anon, authenticated;

drop trigger if exists classify_work_item_source on public.work_items;
create trigger classify_work_item_source
before insert or update of source_type, deduplication_key on public.work_items
for each row execute function app_private.classify_work_item_source();

create index if not exists work_items_source_type_idx
  on public.work_items(organization_id, source_type, state);

------------------------------------------------------------------------------------------------
-- 3. Registration coverage.
--
-- Three record types carry a due date, are unambiguously somebody's work, and created no work item
-- at all: resident compliance items (assessments and support plans), corrective actions, and
-- recurring regulatory requirement instances. This sweep registers them.
--
-- It is deliberately idempotent through `deduplication_key` rather than through a "have I run"
-- flag: the sweep can run twice in a minute, or be run by hand after a data fix, without producing a
-- second copy of anybody's work.
------------------------------------------------------------------------------------------------
create or replace function app_private.register_work_item(
  p_org uuid,
  p_fac uuid,
  p_source_type text,
  p_source_id uuid,
  p_dedupe text,
  p_title text,
  p_description text,
  p_owner uuid,
  p_priority text,
  p_due_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.work_items
  where organization_id = p_org and deduplication_key = p_dedupe;
  if found then
    -- The due date is the one thing worth refreshing on an existing item: a requirement whose date
    -- moved should move in the queue too, and closing then recreating would lose its history.
    update public.work_items
    set due_at = p_due_at, updated_at = now()
    where id = v_id and state not in ('closed', 'canceled') and due_at is distinct from p_due_at;
    return v_id;
  end if;

  insert into public.work_items(
    organization_id, facility_id, source_type, source_id, deduplication_key,
    title, description, owner_profile_id, priority, due_at
  ) values (
    p_org, p_fac, p_source_type, p_source_id, p_dedupe,
    btrim(p_title), p_description, p_owner, coalesce(p_priority, 'normal'), p_due_at
  )
  returning id into v_id;

  insert into public.work_item_history(
    organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason
  ) values (
    p_org, p_fac, v_id, 'created', 'open', auth.uid(), 'Registered by the work coverage sweep'
  );
  return v_id;
end $$;
revoke all on function app_private.register_work_item(uuid, uuid, text, uuid, text, text, text, uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.register_outstanding_work_items()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_assessments integer := 0;
  v_actions integer := 0;
  v_requirements integer := 0;
  r record;
begin
  -- Resident compliance items: assessments and support plans that are missing, due soon, or expired.
  -- 'compliant' and 'not_applicable' are settled and create nothing.
  for r in
    select i.id, i.organization_id, i.facility_id, i.item_type, i.due_date, i.status,
           res.first_name, res.last_name
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.status in ('missing', 'due_soon', 'expired')
      and i.due_date is not null
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id,
      case when r.item_type = 'support_plan_30day' then 'support_plan' else 'assessment' end,
      r.id, 'resident-compliance:' || r.id::text,
      initcap(replace(r.item_type, '_', ' ')) || ' — ' || r.first_name || ' ' || r.last_name,
      'A required resident compliance item is ' || r.status || '.',
      null,
      case when r.status = 'expired' then 'urgent' else 'high' end,
      (r.due_date + time '23:59')::timestamptz
    );
    v_assessments := v_assessments + 1;
  end loop;

  -- Corrective actions that are open, in progress, or overdue.
  for r in
    select c.id, c.organization_id, c.facility_id, c.description, c.due_date, c.status,
           c.owner_profile_id
    from public.corrective_actions c
    where c.status in ('open', 'in_progress', 'overdue')
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id, 'corrective_action',
      r.id, 'corrective-action:' || r.id::text,
      'Corrective action: ' || left(r.description, 80),
      r.description, r.owner_profile_id,
      case when r.status = 'overdue' then 'urgent' else 'normal' end,
      (r.due_date + time '23:59')::timestamptz
    );
    v_actions := v_actions + 1;
  end loop;

  -- Recurring regulatory obligations that are not yet complete.
  for r in
    select ci.id, ci.organization_id, ci.facility_id, ci.due_date, ci.status,
           ci.responsible_profile_id, req.title
    from public.compliance_requirement_instances ci
    join public.compliance_requirements req on req.id = ci.requirement_id
    where ci.status in ('not_started', 'in_progress', 'awaiting_review', 'overdue')
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id, 'regulatory_requirement',
      r.id, 'compliance-requirement:' || r.id::text,
      r.title, 'A recurring regulatory obligation is due.', r.responsible_profile_id,
      case when r.status = 'overdue' then 'urgent' else 'normal' end,
      (r.due_date + time '23:59')::timestamptz
    );
    v_requirements := v_requirements + 1;
  end loop;

  return jsonb_build_object(
    'assessments', v_assessments,
    'correctiveActions', v_actions,
    'regulatoryRequirements', v_requirements
  );
end $$;
revoke all on function public.register_outstanding_work_items() from public, anon, authenticated;
grant execute on function public.register_outstanding_work_items() to service_role;

-- Hourly rather than daily: a corrective action created this morning should appear in somebody's
-- queue this morning, not tomorrow.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('register-outstanding-work-items', '20 * * * *',
      $cron$select public.register_outstanding_work_items();$cron$);
  end if;
end $$;
