-- Support-plan lifecycle expansion (program plan Phase 2c).
--
-- The plan state machine had six states (draft, in_review, approved, effective, superseded,
-- archived). PA facilities actually move a plan through participation and signature steps between
-- clinical review and approval, and need an explicit "this needs rework" state that is not the same
-- as "back to draft". This migration expands to the nine states the request names and records who
-- did what at each step.
--
-- STATE MAPPING (additive; no row changes meaning):
--   draft       -> draft
--   in_review   -> awaiting_clinical_review
--   approved    -> approved
--   effective   -> active
--   superseded  -> superseded
--   archived    -> closed
--
-- This is the riskiest kind of change in this program: an enum widening on a table that already has
-- an immutability trigger, a partial unique expectation, and downstream readers. The order below is
-- deliberate -- drop the old constraint, migrate the data, install the new constraint, then update
-- every function that names a state -- so the table is never left with rows that violate a live
-- constraint. `prevent_effective_support_plan_mutation` is replaced FIRST because it would
-- otherwise reject the very UPDATE that renames the historical states.

-- ---------------------------------------------------------------------------
-- 1. Stand down the immutability trigger for the duration of the rename
-- ---------------------------------------------------------------------------

create or replace function app_private.prevent_effective_support_plan_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  -- 'active'/'superseded'/'closed' are the post-migration names for what were previously
  -- 'effective'/'superseded'/'archived'. Both spellings are listed so this function is correct
  -- both during the migration below and afterwards.
  if old.state in ('effective','active','superseded','archived','closed')
    and coalesce(current_setting('app.allow_support_plan_history_update', true), '') <> 'true'
    and row(old.*) is distinct from row(new.*) then
    raise exception 'Effective and historical support plans are immutable; create a new version' using errcode = '55000';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Widen the state constraint, migrate rows, then narrow to the new set
-- ---------------------------------------------------------------------------

alter table public.resident_support_plans drop constraint if exists resident_support_plans_state_check;
-- The approval invariant names 'effective', which is about to stop existing. Drop it by definition
-- match rather than by name, since it was declared inline and carries a generated name.
do $$
declare v_conname text;
begin
  for v_conname in
    select conname from pg_constraint
    where conrelid = 'public.resident_support_plans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%effective%approved_by%'
  loop
    execute format('alter table public.resident_support_plans drop constraint %I', v_conname);
  end loop;
end $$;

do $$
begin
  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set state = 'awaiting_clinical_review' where state = 'in_review';
  update public.resident_support_plans set state = 'active' where state = 'effective';
  update public.resident_support_plans set state = 'closed' where state = 'archived';
  perform set_config('app.allow_support_plan_history_update','false',true);
end $$;

alter table public.resident_support_plans
  add constraint resident_support_plans_state_check check (state in (
    'draft',
    'awaiting_clinical_review',
    'awaiting_participation',
    'awaiting_signature',
    'approved',
    'active',
    'revision_required',
    'superseded',
    'closed'
  ));

-- A plan can only claim approval once it actually has an approver, a timestamp, and a start date.
alter table public.resident_support_plans
  add constraint resident_support_plans_approved_evidence_check check (
    state not in ('approved','active')
    or (approved_by is not null and approved_at is not null and effective_date is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. Lifecycle tracking the request names
-- ---------------------------------------------------------------------------
-- Already present and reused rather than duplicated: created_by (who initiated),
-- assessment_form_id (source assessment), effective_date, staff_controlled_signature,
-- prior_plan_id, and version_number.

alter table public.resident_support_plans
  add column revision_reason text,
  add column participation_date date,
  -- Who took part in developing the plan. The resident and their designated person have a right to
  -- participate, and "declined" / "unable" are legitimate recorded outcomes, not failures.
  add column participation_record jsonb not null default '{}'::jsonb
    check (jsonb_typeof(participation_record) = 'object'),
  add column resident_signature jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resident_signature) = 'object'),
  add column staff_notified_at timestamptz,
  add column closed_at timestamptz,
  add column closure_reason text,
  add constraint resident_support_plans_participation_check check (
    state not in ('awaiting_signature','approved','active') or participation_date is not null
  ),
  add constraint resident_support_plans_closure_check check (
    state <> 'closed' or closed_at is not null
  );

comment on column public.resident_support_plans.revision_reason is
  'Why this version exists. Required when a plan is sent back for revision, so the next version records what prompted it.';
comment on column public.resident_support_plans.participation_record is
  'Who participated in developing this plan, including declined/unable outcomes with a reason.';

-- Staff acknowledgment is per-person evidence, so it gets a table rather than a jsonb blob: "which
-- aides have read the revised plan" is a question a surveyor asks by name.
create table public.support_plan_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  plan_id uuid not null references public.resident_support_plans(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  plan_version integer not null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  note text,
  unique (plan_id, profile_id)
);

create index support_plan_acknowledgments_plan_idx
  on public.support_plan_acknowledgments(plan_id, acknowledged_at desc);
create index support_plan_acknowledgments_scope_idx
  on public.support_plan_acknowledgments(organization_id, facility_id, resident_id);

alter table public.support_plan_acknowledgments enable row level security;
revoke all on table public.support_plan_acknowledgments from public, anon, authenticated, service_role;
grant all on table public.support_plan_acknowledgments to service_role;
grant select on table public.support_plan_acknowledgments to authenticated;

create policy support_plan_acknowledgments_select on public.support_plan_acknowledgments
  for select to authenticated
  using (app_private.admission_row_visible(organization_id, facility_id));

-- ---------------------------------------------------------------------------
-- 4. The legal transition table
-- ---------------------------------------------------------------------------
-- Expressed once, in one place, so the UI cannot invent a path the server does not allow. Every
-- edge here is a transition a facility actually performs; anything absent is rejected with the
-- attempted move named, not a generic failure.

create or replace function app_private.support_plan_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    -- Authoring
    ('draft', 'awaiting_clinical_review'),
    ('draft', 'closed'),
    -- Clinical review outcome
    ('awaiting_clinical_review', 'awaiting_participation'),
    ('awaiting_clinical_review', 'revision_required'),
    -- Resident / designated-person participation
    ('awaiting_participation', 'awaiting_signature'),
    ('awaiting_participation', 'revision_required'),
    -- Signature
    ('awaiting_signature', 'approved'),
    ('awaiting_signature', 'revision_required'),
    -- Approval to in-force. approve_support_plan() owns the move to 'active' because it also
    -- generates service requirements; it is not reachable through the generic transition RPC.
    ('approved', 'revision_required'),
    ('active', 'revision_required'),
    ('active', 'closed'),
    -- Rework restarts the review cycle rather than silently reactivating.
    ('revision_required', 'draft'),
    ('revision_required', 'closed'),
    -- Superseded plans are terminal except for archival closure.
    ('superseded', 'closed')
  );
$$;

revoke all on function app_private.support_plan_transition_allowed(text, text) from public, anon, authenticated, service_role;

create or replace function public.transition_support_plan_state(
  p_plan_id uuid,
  p_next_state text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);

  if p_next_state = 'active' then
    raise exception 'Use approve_support_plan to put a plan in force; it also generates the service requirements'
      using errcode = '22023';
  end if;

  if not app_private.support_plan_transition_allowed(v.state, p_next_state) then
    raise exception 'A support plan cannot move from % to %', v.state, p_next_state using errcode = '22023';
  end if;

  -- Sending a plan back for rework without saying why leaves the next author guessing, and leaves
  -- the survey record unable to explain the revision.
  if p_next_state = 'revision_required' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A revision reason is required when returning a support plan for rework' using errcode = '22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    state = p_next_state,
    revision_reason = case when p_next_state = 'revision_required' then btrim(p_reason) else revision_reason end,
    closure_reason = case when p_next_state = 'closed' then nullif(btrim(coalesce(p_reason, '')), '') else closure_reason end,
    closed_at = case when p_next_state = 'closed' then now() else closed_at end,
    updated_at = now()
  where id = v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (v.organization_id, auth.uid(), 'resident_support_plan', v.id::text, 'support_plan.state_changed',
    jsonb_build_object('state', v.state),
    jsonb_build_object('state', p_next_state, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return true;
end $$;

revoke all on function public.transition_support_plan_state(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.transition_support_plan_state(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Participation and signature
-- ---------------------------------------------------------------------------

create or replace function public.record_support_plan_participation(
  p_plan_id uuid,
  p_participation_date date,
  p_participation_record jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state <> 'awaiting_participation' then
    raise exception 'Participation can only be recorded while a plan is awaiting participation' using errcode = '22023';
  end if;
  if p_participation_date is null or p_participation_date > current_date then
    raise exception 'Participation date must be a real date that is not in the future' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_participation_record, '{}'::jsonb)) <> 'object' then
    raise exception 'Participation record must be an object' using errcode = '22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    participation_date = p_participation_date,
    participation_record = coalesce(p_participation_record, '{}'::jsonb),
    state = 'awaiting_signature',
    updated_at = now()
  where id = v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_support_plan', v.id::text, 'support_plan.participation_recorded',
    jsonb_build_object('participationDate', p_participation_date, 'participants', coalesce(p_participation_record, '{}'::jsonb)));
  return true;
end $$;

revoke all on function public.record_support_plan_participation(uuid, date, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_support_plan_participation(uuid, date, jsonb) to authenticated, service_role;

create or replace function public.record_support_plan_signature(
  p_plan_id uuid,
  p_signature jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state <> 'awaiting_signature' then
    raise exception 'A signature can only be recorded while a plan is awaiting signature' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_signature, '{}'::jsonb)) <> 'object'
    or nullif(btrim(coalesce(p_signature->>'outcome', '')), '') is null then
    raise exception 'Signature must record an outcome' using errcode = '22023';
  end if;
  -- A refusal or an inability to sign is a documented outcome, exactly as it is on the state form.
  if (p_signature->>'outcome') not in ('signed','declined','unable_to_sign','unavailable') then
    raise exception 'Unrecognized signature outcome %', p_signature->>'outcome' using errcode = '22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    resident_signature = coalesce(p_signature, '{}'::jsonb),
    updated_at = now()
  where id = v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_support_plan', v.id::text, 'support_plan.signature_recorded',
    jsonb_build_object('outcome', p_signature->>'outcome'));
  return true;
end $$;

revoke all on function public.record_support_plan_signature(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_support_plan_signature(uuid, jsonb) to authenticated, service_role;

create or replace function public.acknowledge_support_plan(p_plan_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  if not app_private.admission_row_visible(v.organization_id, v.facility_id) then
    raise exception 'Support plan is outside caller scope' using errcode = '42501';
  end if;
  if v.state <> 'active' then
    raise exception 'Only the active plan can be acknowledged' using errcode = '22023';
  end if;

  insert into public.support_plan_acknowledgments(
    organization_id, facility_id, plan_id, resident_id, plan_version, profile_id, note
  )
  values (v.organization_id, v.facility_id, v.id, v.resident_id, v.version_number, auth.uid(),
    nullif(btrim(coalesce(p_note, '')), ''))
  -- Acknowledging twice is a double-tap, not an error worth failing the aide's screen over.
  on conflict (plan_id, profile_id) do nothing;
  return true;
end $$;

revoke all on function public.acknowledge_support_plan(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_support_plan(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Re-point the functions that named the old states
-- ---------------------------------------------------------------------------

create or replace function public.submit_support_plan_for_review(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state <> 'draft' then raise exception 'Only draft plans can be submitted' using errcode='22023'; end if;
  update public.resident_support_plans set state='awaiting_clinical_review', updated_at=now() where id=v.id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values)
  values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.submitted',
    jsonb_build_object('state',v.state),jsonb_build_object('state','awaiting_clinical_review'));
  return true;
end $$;

-- Activation is separated from approval because the nine-state model makes 'approved' and 'active'
-- genuinely different: a plan can be signed off today with an effective date next Monday. The old
-- single-step version superseded the prior plan and regenerated service requirements at approval
-- time, which for a future-dated plan would leave the resident with NO plan in force and NO active
-- service requirements for the days in between. Everything that changes what staff actually do now
-- happens at activation.
create or replace function app_private.activate_support_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.resident_support_plans%rowtype; svc jsonb;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  if v.state = 'active' then return; end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set state='superseded', updated_at=now()
    where resident_id=v.resident_id and state='active' and id<>v.id;
  update public.resident_support_plans set state='active', staff_notified_at=now(), updated_at=now()
    where id=v.id;
  update public.resident_service_requirements set status='superseded', superseded_at=now(), updated_at=now()
    where resident_id=v.resident_id and status='active';
  for svc in select * from jsonb_array_elements(coalesce(v.services,'[]'::jsonb)) loop
    insert into public.resident_service_requirements(organization_id,facility_id,resident_id,source_assessment_form_id,source_plan_version,source_section,source_key,service_code,service_name,need_description,special_instructions,frequency,frequency_detail,time_window_start,time_window_end,responsible_role,requires_two_staff,documentation_mode,effective_from)
    values(v.organization_id,v.facility_id,v.resident_id,coalesce(v.assessment_form_id, (select id from public.resident_assessment_forms where resident_id=v.resident_id order by created_at desc limit 1)),v.version_number,'support_plan_services',(v.id::text || ':' || coalesce(svc->>'key',svc->>'service_code',extensions.gen_random_uuid()::text)),coalesce(svc->>'service_code','support_plan_service'),coalesce(svc->>'service_name',svc->>'name','Support-plan service'),svc->>'need',coalesce(svc->>'staff_instructions',v.staff_instructions,''),coalesce(nullif(svc->>'frequency',''),'daily'),svc->>'frequency_detail',coalesce((svc->>'time_window_start')::time,'09:00'::time),coalesce((svc->>'time_window_end')::time,'11:00'::time),coalesce(svc->>'responsible_role','employee'),coalesce((svc->>'requires_two_staff')::boolean,false),coalesce(svc->>'documentation_mode','every_task'),coalesce(v.effective_date, current_date))
    on conflict (source_assessment_form_id, source_section, source_key) do nothing;
  end loop;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.active',
    jsonb_build_object('effectiveDate',v.effective_date,'reviewDueDate',v.review_due_date));
end $$;

revoke all on function app_private.activate_support_plan(uuid) from public, anon, authenticated, service_role;

create or replace function public.approve_support_plan(p_plan_id uuid, p_effective_date date, p_review_due_date date, p_staff_signature jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id=p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  -- 'awaiting_signature' is accepted so a facility that records the signature and approves in one
  -- action is not forced through a second round trip; 'approved' stays re-enterable so a corrected
  -- effective date can be applied before the plan goes in force.
  if v.state not in ('awaiting_signature','approved') or p_effective_date is null or p_review_due_date < p_effective_date then
    raise exception 'Invalid support plan approval request' using errcode='22023';
  end if;
  if v.participation_date is null then
    raise exception 'Record resident/designated-person participation before approving the plan' using errcode='22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    state='approved', effective_date=p_effective_date, review_due_date=p_review_due_date,
    approved_by=auth.uid(), approved_at=now(),
    staff_controlled_signature=coalesce(p_staff_signature,'{}'::jsonb),
    printable_snapshot=jsonb_build_object('planId',v.id,'version',v.version_number,'effectiveDate',p_effective_date,'needs',v.needs,'goals',v.goals,'services',v.services,'interventions',v.interventions),
    updated_at=now()
  where id=v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.approved',
    jsonb_build_object('effectiveDate',p_effective_date,'reviewDueDate',p_review_due_date));

  -- Same-day approval still goes in force immediately, so the common case stays one action.
  if p_effective_date <= current_date then
    perform app_private.activate_support_plan(v.id);
  end if;
  return true;
end $$;

-- Promotes approved plans whose effective date has arrived. Without this, a future-dated plan would
-- sit in 'approved' forever and the resident would keep running on the prior version.
create or replace function public.activate_due_support_plans()
returns integer language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_count integer := 0;
begin
  for v_id in
    select id from public.resident_support_plans
    where state = 'approved' and effective_date is not null and effective_date <= current_date
    order by resident_id, version_number
  loop
    perform app_private.activate_support_plan(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.activate_due_support_plans() from public, anon, authenticated;
grant execute on function public.activate_due_support_plans() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('activate-due-support-plans');
  end if;
exception when others then null;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('activate-due-support-plans', '10 5 * * *',
      $cron$select public.activate_due_support_plans();$cron$);
  end if;
end $$;

-- generate_support_plan_proposal() and get_resident_care_header() both look up the plan in force.
create or replace function public.get_resident_care_header(p_resident_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_diet public.resident_dietary_profiles%rowtype;
  v_hospital public.hospital_transfer_episodes%rowtype;
  v_plan public.resident_support_plans%rowtype;
  v_assessment_at date;
  v_assessment_label text;
  v_hospital_state text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident was not found or is outside caller scope' using errcode = 'P0002';
  end if;

  select * into v_facility from public.facilities where id = v_resident.facility_id;

  select * into v_diet from public.resident_dietary_profiles d
    where d.resident_id = v_resident.id
    order by d.effective_date desc, d.version desc limit 1;

  select * into v_hospital from public.hospital_transfer_episodes h
    where h.resident_id = v_resident.id and h.status <> 'canceled'
    order by h.transfer_time desc limit 1;

  select * into v_plan from public.resident_support_plans p
    where p.resident_id = v_resident.id
    order by (p.state = 'active') desc, p.version_number desc limit 1;

  select c.completed_date,
         case c.item_type
           when 'preadmission_screening' then 'Preadmission screening'
           when 'initial_assessment_15day' then 'Initial assessment'
           when 'annual_reassessment' then 'Annual reassessment'
           when 'significant_change_reassessment' then 'Significant change reassessment'
           else c.item_type
         end
    into v_assessment_at, v_assessment_label
    from public.resident_compliance_items c
    where c.resident_id = v_resident.id
      and c.completed_date is not null
      and c.item_type in (
        'preadmission_screening', 'initial_assessment_15day',
        'annual_reassessment', 'significant_change_reassessment'
      )
    order by c.completed_date desc limit 1;

  if v_assessment_at is null then
    select f.finalized_at::date, 'Digital ' || f.form_type || ' (' || f.reason || ')'
      into v_assessment_at, v_assessment_label
      from public.resident_assessment_forms f
      where f.resident_id = v_resident.id and f.status = 'finalized' and f.finalized_at is not null
      order by f.finalized_at desc limit 1;
  end if;

  v_hospital_state := case
    when v_hospital.id is null then 'in_facility'
    when v_hospital.status = 'out' then 'out_at_hospital'
    when v_hospital.status = 'returned'
      and v_hospital.return_time >= now() - interval '30 days'
      and (
        v_hospital.medication_reconciliation_status = 'pending'
        or v_hospital.changed_order_ack_status = 'pending_review'
      ) then 'returned_reconciliation_incomplete'
    else 'in_facility'
  end;

  return jsonb_build_object(
    'generatedAt', now(),
    'resident', jsonb_build_object(
      'id', v_resident.id,
      'firstName', v_resident.first_name,
      'lastName', v_resident.last_name,
      'preferredName', v_resident.preferred_name,
      'photoDocumentId', v_resident.photo_document_id,
      'room', v_resident.room,
      'status', v_resident.status,
      'admissionDate', v_resident.admission_date,
      'dischargeDate', v_resident.discharge_date,
      'hospice', v_resident.hospice,
      'sdcu', v_resident.sdcu
    ),
    'facility', case when v_facility.id is null then null else jsonb_build_object(
      'id', v_facility.id, 'name', v_facility.name, 'facilityType', v_facility.facility_type
    ) end,
    'care', jsonb_build_object(
      'levelOfCare', v_resident.level_of_care,
      'transferAssistance', v_resident.transfer_assistance,
      'ambulationStatus', v_resident.ambulation_status,
      'fallRisk', v_resident.fall_risk,
      'elopementRisk', v_resident.elopement_risk,
      'cognitiveStatus', v_resident.cognitive_status,
      'codeStatus', v_resident.code_status,
      'advanceDirectiveStatus', v_resident.advance_directive_status,
      'allergies', to_jsonb(v_resident.allergies),
      'foodAllergies', to_jsonb(v_resident.food_allergies),
      'mobilitySummary', v_resident.mobility_summary,
      'supervisionRequirements', v_resident.supervision_requirements,
      'asOf', v_resident.care_profile_reviewed_at
    ),
    'diet', case when v_diet.id is null then null else jsonb_build_object(
      'dietOrder', coalesce(v_diet.diet_order, v_diet.prescribed_diet),
      'textureConsistency', v_diet.texture_consistency,
      'liquidConsistency', v_diet.liquid_consistency,
      'asOf', v_diet.effective_date
    ) end,
    'hospital', jsonb_build_object(
      'state', v_hospital_state,
      'episodeId', case when v_hospital_state = 'in_facility' then null else v_hospital.id end,
      'destination', case when v_hospital_state = 'in_facility' then null else v_hospital.destination end,
      'since', case
        when v_hospital_state = 'out_at_hospital' then v_hospital.transfer_time
        when v_hospital_state = 'returned_reconciliation_incomplete' then v_hospital.return_time
        else null end,
      'expectedReturnAt', case when v_hospital_state = 'out_at_hospital' then v_hospital.expected_return_at else null end
    ),
    'lastAssessment', case when v_assessment_at is null then null else jsonb_build_object(
      'completedOn', v_assessment_at, 'label', v_assessment_label
    ) end,
    'supportPlan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'versionNumber', v_plan.version_number,
      'state', v_plan.state,
      'effectiveDate', v_plan.effective_date,
      'reviewDueDate', v_plan.review_due_date
    ) end
  );
end;
$$;

-- generate_support_plan_proposal(): only the state literal changes.
create or replace function public.generate_support_plan_proposal(p_assessment_form_id uuid, p_reason text default 'Assessment change requires support-plan review')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_assess public.resident_assessment_forms%rowtype; v_res public.residents%rowtype; v_current uuid; v_id uuid; v_work uuid; v_payload jsonb;
begin
  select * into v_assess from public.resident_assessment_forms where id=p_assessment_form_id;
  if not found then raise exception 'Assessment not found' using errcode='P0002'; end if;
  select * into v_res from public.residents where id=v_assess.resident_id;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  select id into v_current from public.resident_support_plans where resident_id=v_res.id and state='active' order by effective_date desc limit 1;
  select jsonb_build_object('source','assessment_mapping_rules','assessmentFormId',v_assess.id,'proposedNeeds',coalesce(jsonb_agg(r.proposed_need) filter (where r.id is not null),'[]'::jsonb),'proposedServices',coalesce(jsonb_agg(r.proposed_service) filter (where r.id is not null),'[]'::jsonb),'proposedInterventions',coalesce(jsonb_agg(r.proposed_intervention) filter (where r.id is not null),'[]'::jsonb),'proposedDme',coalesce(jsonb_agg(r.proposed_dme) filter (where r.id is not null),'[]'::jsonb))
  into v_payload
  from public.support_plan_assessment_mapping_rules r
  where r.is_active and (r.organization_id is null or r.organization_id=v_res.organization_id) and (r.facility_id is null or r.facility_id=v_res.facility_id) and current_date between r.effective_from and coalesce(r.effective_to,current_date);
  insert into public.support_plan_proposals(organization_id,facility_id,resident_id,assessment_form_id,current_plan_id,proposal,conflict_warnings,rationale,owner_profile_id,due_at)
  values(v_res.organization_id,v_res.facility_id,v_res.id,v_assess.id,v_current,coalesce(v_payload,'{}'::jsonb),case when v_current is null then array['No support plan is currently in force.']::text[] else array[]::text[] end,btrim(coalesce(p_reason,'')),auth.uid(),now()+interval '3 days')
  on conflict (organization_id, assessment_form_id, resident_id) do update set proposal=excluded.proposal, conflict_warnings=excluded.conflict_warnings, rationale=excluded.rationale, updated_at=now()
  returning id into v_id;
  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,owner_profile_id,priority,due_at,state,created_by)
  values(v_res.organization_id,v_res.facility_id,'rule_exception',v_id,'support-plan-proposal:'||v_id,'Review support-plan proposal','Assessment information suggests the support plan may need human review.',auth.uid(),'high',now()+interval '3 days','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;
  update public.support_plan_proposals set work_item_id=v_work where id=v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'support_plan_proposal',v_id::text,'support_plan.proposal_generated',jsonb_build_object('assessmentFormId',v_assess.id,'workItemId',v_work));
  return v_id;
end $$;

-- get_resident_care_delivery_analytics counts plans in force by state name. Left unchanged it
-- would silently report zero overdue plan reviews for every facility, which reads as "all current"
-- rather than "this metric is broken" -- the worst possible failure for a compliance number.
-- Only the state literal and the definition string change; the rest is the 20260714180000 body.
create or replace function public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or public.is_platform_admin() or (public.current_org_id()=v_fac.organization_id and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id)))) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and c.identified_at::date between p_from and p_through),'definition','Change-of-condition events identified in the reporting period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='active' and p.review_due_date < current_date),'definition','Support plans in force with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and h.return_time::date between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $$;
