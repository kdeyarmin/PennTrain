-- A checklist item that does not apply must not block approval.
--
-- `record_certification_attempt_item` already accepts `not_applicable` without evidence or a
-- signature (20260804120000, and the same rule in the record path it replaced): an item that
-- genuinely does not apply to this observation has nothing to photograph and nobody to sign it.
-- Both completeness gates then ignored `result` and asked for evidence and a signature anyway, so
-- any checklist carrying a required item that a particular observation could not exercise could be
-- recorded in full and never submitted or approved. The submit gate is fixed in its own migration;
-- this one fixes approve, which predates this branch and so cannot be edited in place.
--
-- The body below is `approve_certification_attempt` as 20260711213000 declared it, copied
-- programmatically rather than retyped, with one predicate changed. `ai.id is null` is deliberately
-- untouched: an item nobody recorded at all is still missing. Not applicable has to be said.

create or replace function public.approve_certification_attempt(
  p_attempt_id uuid,
  p_decision text,
  p_reason text,
  p_assessor_signature_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.certification_attempts%rowtype;
  v_version public.certification_definition_versions%rowtype;
  v_definition public.certification_definitions%rowtype;
  v_qualification_id uuid;
  v_expiry timestamptz;
begin
  select * into v_attempt from public.certification_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Certification attempt not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_attempt.organization_id, 'qualifications.manage', v_attempt.facility_id);
  if v_attempt.status not in ('in_progress', 'submitted') or p_decision not in ('passed', 'failed') then
    raise exception 'Invalid certification decision transition' using errcode = '55000';
  end if;
  if auth.uid() <> v_attempt.assessor_profile_id then
    raise exception 'Only the assigned qualified assessor may decide this attempt' using errcode = '42501';
  end if;
  select * into v_version from public.certification_definition_versions
  where id = v_attempt.certification_version_id;
  select * into v_definition from public.certification_definitions
  where id = v_version.certification_definition_id;
  if v_version.lifecycle_state <> 'published'
     or v_version.effective_from is null or v_version.effective_from > v_attempt.observed_at
     or (v_version.effective_to is not null and v_version.effective_to <= v_attempt.observed_at) then
    raise exception 'Attempt did not use an effective published checklist version' using errcode = '23514';
  end if;
  if v_definition.separation_of_duties and exists (
    select 1 from public.employees e
    where e.id = v_attempt.employee_id and e.profile_id = auth.uid()
  ) then
    raise exception 'Self-assessment is prohibited for this certification' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.assessor_qualifications a
    where a.certification_definition_id = v_definition.id
      and a.assessor_profile_id = auth.uid()
      and a.effective_from <= v_attempt.observed_at
      and (a.effective_to is null or a.effective_to > v_attempt.observed_at)
  ) then
    raise exception 'Assessor was not qualified at observation time' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.certification_checklist_items i
    left join public.certification_attempt_items ai
      on ai.checklist_item_id = i.id and ai.certification_attempt_id = v_attempt.id
    where i.certification_version_id = v_version.id
      and (ai.id is null
        or (i.evidence_required and ai.evidence = '{}'::jsonb and ai.result <> 'not_applicable')
        or (i.signature_required and ai.signed_at is null and ai.result <> 'not_applicable'))
  ) then
    raise exception 'Required checklist evidence or signature is missing' using errcode = '23514';
  end if;
  if p_assessor_signature_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Signed decision evidence and reason are required' using errcode = '22023';
  end if;
  update public.certification_attempts set
    status = p_decision, decided_at = now(), decision_reason = btrim(p_reason),
    assessor_signature_sha256 = p_assessor_signature_sha256,
    evidence_checksum_sha256 = encode(extensions.digest(convert_to(jsonb_build_object(
      'attemptId', id, 'versionChecksum', v_version.criteria_checksum_sha256,
      'decision', p_decision, 'reason', btrim(p_reason),
      'signature', p_assessor_signature_sha256
    )::text, 'utf8'), 'sha256'), 'hex')
  where id = v_attempt.id;
  if p_decision = 'failed' then return null; end if;
  v_expiry := case when v_definition.default_validity_days is null then null
    else v_attempt.observed_at + make_interval(days => v_definition.default_validity_days) end;
  update public.employee_qualifications set
    state = 'superseded', effective_to = now(), state_reason = 'Superseded by certification attempt ' || v_attempt.id
  where employee_id = v_attempt.employee_id
    and certification_definition_id = v_definition.id
    and effective_to is null;
  insert into public.employee_qualifications(
    organization_id, facility_id, employee_id, certification_definition_id,
    certification_version_id, source_attempt_id, state, issued_at,
    effective_from, expires_at, renewal_window_opens_at, approved_by
  ) values (
    v_attempt.organization_id, v_attempt.facility_id, v_attempt.employee_id,
    v_definition.id, v_version.id, v_attempt.id, 'active', now(),
    v_attempt.observed_at, v_expiry,
    case when v_expiry is null then null else v_expiry - make_interval(days => v_definition.renewal_window_days) end,
    auth.uid()
  ) returning id into v_qualification_id;
  insert into public.qualification_lifecycle_events(
    organization_id, employee_qualification_id, event_type, resulting_state,
    reason, actor_profile_id, evidence
  ) values (
    v_attempt.organization_id, v_qualification_id, 'issued', 'active',
    btrim(p_reason), auth.uid(), jsonb_build_object(
      'attemptId', v_attempt.id, 'criteriaChecksum', v_version.criteria_checksum_sha256
    )
  );
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_attempt.organization_id, e.profile_id, 'qualification_changed',
    'Qualification approved', v_definition.name || ' is active.', '/app/credentials'
  from public.employees e where e.id = v_attempt.employee_id and e.profile_id is not null;
  return v_qualification_id;
end;
$$;
revoke all on function public.approve_certification_attempt(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_certification_attempt(uuid, text, text, text)
  to authenticated;
