-- Certification attempts: the capability had no entry point at all (BACKLOG.md G8).
--
-- WHAT WAS ACTUALLY WRONG. `20260711213000` built observed-competency certification in full:
-- `certification_definitions`, versioned checklists, `assessor_qualifications`, `certification_attempts`,
-- `certification_attempt_items`, and `approve_certification_attempt` -- which is a genuinely rigorous
-- function. It re-checks that the assessor was qualified *at observation time*, that the checklist
-- version was published and effective then, that separation of duties was respected, that every
-- required checklist item carries evidence and a signature, and it writes a signed decision plus an
-- evidence checksum.
--
-- And **nothing anywhere creates an attempt or records a checklist item.** No RPC, no edge function,
-- no trigger. Searching the whole repository for a writer of `certification_attempts` returns
-- nothing. So `approve_certification_attempt` approves rows that cannot exist, and both
-- `certification_attempt_items` and the `in_progress` / `submitted` states are unreachable.
--
-- That makes this migration different in kind from the other Tier G fixes. Those wired an existing
-- RPC to a button. Here there was no dead *end* -- there was no beginning. The three functions below
-- are the missing observation path, deliberately scoped to exactly what makes the existing approval
-- function reachable and nothing more.
--
-- WHY THE PRECONDITION CHECK IS A SUBSET, NOT A SECOND GATE. `approve_certification_attempt` holds
-- the authoritative rules and re-runs all of them at decision time; that is correct and is not
-- touched here. `app_private.certification_attempt_blockers` checks the three that are knowable
-- before any observation happens, so an assessor is refused *before* spending an hour on a bedside
-- observation rather than after. It is deliberately not a copy of the approval gate: it cannot check
-- checklist completeness (nothing is recorded yet) and it does not try. Approve remains the gate.
--
-- Rollback: drop the three public functions, then the app_private helper. No schema changes.

-- ---------------------------------------------------------------------------
-- 1. What would stop this attempt being approvable, knowable before it starts
-- ---------------------------------------------------------------------------

create or replace function app_private.certification_attempt_blockers(
  p_certification_version_id uuid,
  p_employee_id uuid,
  p_assessor_profile_id uuid,
  p_observed_at timestamptz
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.certification_definition_versions%rowtype;
  v_definition public.certification_definitions%rowtype;
  v_blockers text[] := array[]::text[];
begin
  select * into v_version from public.certification_definition_versions
  where id = p_certification_version_id;
  if not found then
    return array['the checklist version does not exist'];
  end if;
  select * into v_definition from public.certification_definitions
  where id = v_version.certification_definition_id;

  if v_version.lifecycle_state <> 'published'
     or v_version.effective_from is null
     or v_version.effective_from > p_observed_at
     or (v_version.effective_to is not null and v_version.effective_to <= p_observed_at) then
    v_blockers := v_blockers || 'the checklist version was not published and effective at the observation time';
  end if;

  -- Self-assessment, where the definition forbids it. Checked here as well as at approval because
  -- discovering it afterwards means the whole observation is wasted.
  if v_definition.separation_of_duties and exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.profile_id = p_assessor_profile_id
  ) then
    v_blockers := v_blockers || 'this certification forbids assessing yourself';
  end if;

  if not exists (
    select 1 from public.assessor_qualifications a
    where a.certification_definition_id = v_definition.id
      and a.assessor_profile_id = p_assessor_profile_id
      and a.effective_from <= p_observed_at
      and (a.effective_to is null or a.effective_to > p_observed_at)
  ) then
    v_blockers := v_blockers || 'you were not a qualified assessor for this certification at the observation time';
  end if;

  return v_blockers;
end $$;

revoke all on function app_private.certification_attempt_blockers(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Starting an observation
-- ---------------------------------------------------------------------------

create or replace function public.start_certification_attempt(
  p_employee_id uuid,
  p_certification_version_id uuid,
  p_observed_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_blockers text[];
  v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_employee.organization_id, 'qualifications.manage', v_employee.facility_id);

  -- A future observation is not an observation. The approval path pins the assessor's qualification
  -- and the checklist version to this instant, so letting it be set forward would let someone pin
  -- them to a state that has not happened.
  if p_observed_at > now() then
    raise exception 'An observation cannot be recorded in the future' using errcode = '22023';
  end if;

  v_blockers := app_private.certification_attempt_blockers(
    p_certification_version_id, p_employee_id, auth.uid(), p_observed_at);
  if cardinality(v_blockers) > 0 then
    raise exception 'This attempt could never be approved: %', array_to_string(v_blockers, '; ')
      using errcode = '42501';
  end if;

  -- One open attempt per employee per checklist version. Two people observing the same competency
  -- at once produces two half-filled checklists and no way to say which is the record.
  if exists (
    select 1 from public.certification_attempts a
    where a.employee_id = p_employee_id
      and a.certification_version_id = p_certification_version_id
      and a.status in ('in_progress', 'submitted')
  ) then
    raise exception 'An attempt for this certification is already open for this employee'
      using errcode = '23505';
  end if;

  insert into public.certification_attempts(
    organization_id, facility_id, employee_id, certification_version_id,
    assessor_profile_id, status, observed_at, created_by
  ) values (
    v_employee.organization_id, v_employee.facility_id, p_employee_id, p_certification_version_id,
    auth.uid(), 'in_progress', p_observed_at, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_employee.organization_id, auth.uid(), 'certification_attempt', v_id::text,
    'certification_attempt.started',
    jsonb_build_object('employeeId', p_employee_id, 'versionId', p_certification_version_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Recording one checklist item
-- ---------------------------------------------------------------------------

create or replace function public.record_certification_attempt_item(
  p_attempt_id uuid,
  p_checklist_item_id uuid,
  p_result text,
  p_evidence jsonb default '{}'::jsonb,
  p_sign boolean default false,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.certification_attempts%rowtype;
  v_item public.certification_checklist_items%rowtype;
  v_evidence jsonb;
  v_id uuid;
begin
  select * into v_attempt from public.certification_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Certification attempt not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_attempt.organization_id, 'qualifications.manage', v_attempt.facility_id);

  -- Only the assigned assessor records what they observed. Approval enforces the same identity rule;
  -- allowing a different person to fill the checklist would make that signature meaningless.
  if auth.uid() <> v_attempt.assessor_profile_id then
    raise exception 'Only the assigned assessor may record observations on this attempt'
      using errcode = '42501';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Only an in-progress attempt can be edited' using errcode = '55000';
  end if;
  if p_result not in ('met', 'not_met', 'not_applicable') then
    raise exception 'Unknown checklist result' using errcode = '22023';
  end if;

  select * into v_item from public.certification_checklist_items where id = p_checklist_item_id;
  if not found or v_item.certification_version_id <> v_attempt.certification_version_id then
    raise exception 'Checklist item does not belong to this attempt''s checklist version'
      using errcode = '23514';
  end if;

  v_evidence := case when jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) = 'object'
    then coalesce(p_evidence, '{}'::jsonb) else '{}'::jsonb end;

  -- The approval gate refuses an attempt whose evidence-required items carry `'{}'`, so saying so
  -- here means the assessor learns it on the item rather than at the end of the whole observation.
  if v_item.evidence_required and v_evidence = '{}'::jsonb and p_result <> 'not_applicable' then
    raise exception 'This item requires evidence' using errcode = '23514';
  end if;
  if v_item.signature_required and not coalesce(p_sign, false) and p_result <> 'not_applicable' then
    raise exception 'This item requires the assessor''s signature' using errcode = '23514';
  end if;

  insert into public.certification_attempt_items(
    certification_attempt_id, checklist_item_id, result, evidence,
    evidence_checksum_sha256, signed_at, notes
  ) values (
    v_attempt.id, v_item.id, p_result, v_evidence,
    encode(extensions.digest(convert_to(v_evidence::text, 'UTF8'), 'sha256'), 'hex'),
    case when coalesce(p_sign, false) then now() end,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (certification_attempt_id, checklist_item_id) do update set
    result = excluded.result,
    evidence = excluded.evidence,
    evidence_checksum_sha256 = excluded.evidence_checksum_sha256,
    signed_at = excluded.signed_at,
    notes = excluded.notes
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Submitting the completed observation
-- ---------------------------------------------------------------------------
--
-- `approve_certification_attempt` accepts `in_progress` as well as `submitted`, so this step is not
-- strictly required to reach a decision. It exists because `submitted` is a state the schema models
-- and nothing could reach -- the same defect this migration is fixing, one level down -- and because
-- an assessor finishing an observation and a decision-maker approving it are frequently the same
-- person on different days, who needs a way to say "the observation is done".

create or replace function public.submit_certification_attempt(p_attempt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.certification_attempts%rowtype;
  v_missing text[];
begin
  select * into v_attempt from public.certification_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Certification attempt not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_attempt.organization_id, 'qualifications.manage', v_attempt.facility_id);
  if auth.uid() <> v_attempt.assessor_profile_id then
    raise exception 'Only the assigned assessor may submit this attempt' using errcode = '42501';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Only an in-progress attempt can be submitted' using errcode = '55000';
  end if;

  -- The same completeness rule approve enforces, named per item instead of as one refusal. Approve
  -- re-checks it; this is what stops an assessor submitting and only then learning what is missing.
  select coalesce(array_agg(i.item_key order by i.sort_order, i.item_key), array[]::text[])
    into v_missing
  from public.certification_checklist_items i
  left join public.certification_attempt_items ai
    on ai.checklist_item_id = i.id and ai.certification_attempt_id = v_attempt.id
  where i.certification_version_id = v_attempt.certification_version_id
    and (ai.id is null
      or (i.evidence_required and ai.evidence = '{}'::jsonb)
      or (i.signature_required and ai.signed_at is null));

  if cardinality(v_missing) > 0 then
    raise exception 'These checklist items are not complete: %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  update public.certification_attempts
    set status = 'submitted', submitted_at = now(), updated_at = now()
    where id = v_attempt.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_attempt.organization_id, auth.uid(), 'certification_attempt', v_attempt.id::text,
    'certification_attempt.submitted', jsonb_build_object('employeeId', v_attempt.employee_id));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.start_certification_attempt(uuid, uuid, timestamptz),
  public.record_certification_attempt_item(uuid, uuid, text, jsonb, boolean, text),
  public.submit_certification_attempt(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.start_certification_attempt(uuid, uuid, timestamptz),
  public.record_certification_attempt_item(uuid, uuid, text, jsonb, boolean, text),
  public.submit_certification_attempt(uuid)
  to authenticated;
