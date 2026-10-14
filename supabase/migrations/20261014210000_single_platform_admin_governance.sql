-- PennTrain has one platform administrator. A workflow that can only finish when a
-- second administrator approves the same person's work cannot be operated.
-- Reviewed_by, approved_by, published_by, and the break-glass requester stay on
-- the row, so the audit still names who performed each step. What changes is that
-- those columns may name the same person.
--
-- Clinical second signatures (an assessor and a different clinical reviewer) and
-- competency separation (an employee and a different assessor) are unchanged.
-- They do not require a second platform administrator.

-- ---------------------------------------------------------------------------
-- Regulatory rule versions: the author may approve their own version.
-- ---------------------------------------------------------------------------

do $drop_rule_separation$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'regulatory_rule_versions'
    and pg_get_constraintdef(con.oid) like '%reviewed_by <> authored_by%';
  if v_name is not null then
    execute format('alter table public.regulatory_rule_versions drop constraint %I', v_name);
  end if;
end
$drop_rule_separation$;

create or replace function public.guard_regulatory_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_superseded_pack_id uuid;
  v_transition_allowed boolean;
begin
  if new.supersedes_version_id is not null then
    select rule_pack_id into v_superseded_pack_id
    from public.regulatory_rule_versions
    where id = new.supersedes_version_id;
    if v_superseded_pack_id is distinct from new.rule_pack_id then
      raise exception 'superseded version must belong to the same rule pack'
        using errcode = '23514';
    end if;
  end if;

  new.content_checksum_sha256 := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'rulePackId', new.rule_pack_id,
      'version', new.version_number,
      'jurisdiction', new.jurisdiction_code,
      'authority', new.authority_name,
      'citation', new.citation,
      'sourceUri', new.source_uri,
      'sourceChecksum', new.source_checksum_sha256,
      'applicability', new.applicability,
      'parameters', new.calculation_parameters,
      'effectiveFrom', new.effective_from,
      'effectiveTo', new.effective_to,
      'supersedes', new.supersedes_version_id,
      'releaseNotes', new.release_notes
    )::text,
    'utf8'
  ), 'sha256'), 'hex');

  if tg_op = 'UPDATE' then
    if old.state <> 'draft' and (
      new.rule_pack_id,
      new.version_number,
      new.jurisdiction_code,
      new.authority_name,
      new.citation,
      new.source_uri,
      new.source_checksum_sha256,
      new.applicability,
      new.calculation_parameters,
      new.effective_from,
      new.effective_to,
      new.supersedes_version_id,
      new.release_notes,
      new.authored_by
    ) is distinct from (
      old.rule_pack_id,
      old.version_number,
      old.jurisdiction_code,
      old.authority_name,
      old.citation,
      old.source_uri,
      old.source_checksum_sha256,
      old.applicability,
      old.calculation_parameters,
      old.effective_from,
      old.effective_to,
      old.supersedes_version_id,
      old.release_notes,
      old.authored_by
    ) then
      raise exception 'approved regulatory rule content is immutable'
        using errcode = '55000';
    end if;

    if new.state is distinct from old.state then
      if coalesce(current_setting('app.regulatory_rule_transition', true), '') <> 'on' then
        raise exception 'regulatory rule state changes require a governed transition RPC'
          using errcode = '42501';
      end if;
      v_transition_allowed := (old.state, new.state) in (
        ('draft', 'review'),
        ('review', 'approved'),
        ('review', 'draft'),
        ('approved', 'shadow'),
        ('approved', 'active'),
        ('approved', 'withdrawn'),
        ('shadow', 'active'),
        ('shadow', 'withdrawn'),
        ('active', 'superseded'),
        ('active', 'withdrawn')
      );
      if not v_transition_allowed then
        raise exception 'invalid regulatory rule transition: % -> %', old.state, new.state
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.approve_regulatory_rule_version(
  p_version_id uuid,
  p_review_notes text
)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
begin
  perform public.require_platform_rule_admin('regulatory_rule_approval');
  if length(btrim(coalesce(p_review_notes, ''))) < 10 then
    raise exception 'review notes must explain the approval'
      using errcode = '22023';
  end if;
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null or v_row.state <> 'review' then
    raise exception 'rule version must be in review before approval'
      using errcode = '22023';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  update public.regulatory_rule_versions
  set state = 'approved', reviewed_by = auth.uid(), review_notes = btrim(p_review_notes),
      approved_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

comment on function public.approve_regulatory_rule_version(uuid, text) is
  'Approves a rule version that is in review. The author may approve their own version. '
  'reviewed_by and approved_at still record the administrator who approved it.';

-- ---------------------------------------------------------------------------
-- Break-glass, billing grants, governed publication, credential review.
-- ---------------------------------------------------------------------------

do $drop_other_separation$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'identity_break_glass_events'
    and pg_get_constraintdef(con.oid) like '%requested_by <> approved_by%';
  if v_name is not null then
    execute format('alter table public.identity_break_glass_events drop constraint %I', v_name);
  end if;

  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'organization_entitlement_grants'
    and pg_get_constraintdef(con.oid) like '%created_by <> approved_by%';
  if v_name is not null then
    execute format('alter table public.organization_entitlement_grants drop constraint %I', v_name);
  end if;
end
$drop_other_separation$;

create or replace function public.grant_identity_break_glass(
  p_target_profile_id uuid,
  p_requested_by uuid,
  p_reason text,
  p_ticket_reference text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_id uuid;
  v_hash text;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform administrator may approve break-glass access'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('break_glass');
  select organization_id into v_org_id from public.profiles where id = p_target_profile_id;
  if not found then
    raise exception 'break-glass target profile was not found'
      using errcode = 'P0002';
  end if;
  -- A different requester still has to belong to the target's organization.
  -- The sole platform administrator may record themselves as the requester;
  -- their profile often has no organization.
  if p_requested_by is distinct from auth.uid() and not exists (
    select 1 from public.profiles requester
    where requester.id = p_requested_by
      and requester.organization_id is not distinct from v_org_id
  ) then
    raise exception 'break-glass requester and target must exist in the same organization'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles requester where requester.id = p_requested_by) then
    raise exception 'break-glass requester was not found'
      using errcode = 'P0002';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'organizationId', v_org_id, 'targetProfileId', p_target_profile_id,
    'requestedBy', p_requested_by, 'approvedBy', auth.uid(),
    'reason', btrim(p_reason), 'ticket', btrim(p_ticket_reference),
    'expiresAt', p_expires_at
  )::text, 'utf8'), 'sha256'), 'hex');
  insert into public.identity_break_glass_events (
    organization_id, target_profile_id, requested_by, approved_by, reason,
    ticket_reference, expires_at, evidence_checksum_sha256
  ) values (
    v_org_id, p_target_profile_id, p_requested_by, auth.uid(), btrim(p_reason),
    btrim(p_ticket_reference), p_expires_at, v_hash
  ) returning id into v_id;
  return v_id;
end;
$function$;

comment on function public.grant_identity_break_glass(uuid, uuid, text, text, timestamptz) is
  'Records emergency-access authorization -- requester, approver, reason, ticket and expiry -- '
  'and returns its id. The platform administrator may be both requester and approver; '
  'requested_by and approved_by are still stored. It does NOT change anyone''s permissions; see '
  'the comment on identity_break_glass_events.';

comment on table public.identity_break_glass_events is
  'Authorization RECORD for emergency access: who asked, who approved, why, against which ticket, '
  'and until when, hashed at the moment of the decision. The same administrator may be both '
  'requester and approver. It confers no permissions and nothing reads it for authorization -- '
  'has_effective_permission, current_role() and every RLS policy are unaware of it. The access '
  'itself is granted separately (a role change, or support impersonation), each audited on its '
  'own. Wiring this table into authorization would create a row that silently widens a session, '
  'which is a deliberate decision nobody has taken. BACKLOG.md I22.';

create or replace function public.set_organization_entitlement_grant(
  p_organization_id uuid,
  p_feature_key text,
  p_decision text,
  p_entitlement_value jsonb,
  p_reason text,
  p_effective_from timestamptz default now(),
  p_effective_to timestamptz default null,
  p_contract_reference text default null,
  p_approved_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_id uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may change contractual grants'
      using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Grant reason required'; end if;
  if p_approved_by is not null and not exists (
    select 1 from public.profiles approver where approver.id = p_approved_by
  ) then
    raise exception 'Entitlement approver was not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.organization_entitlement_grants g
    where g.organization_id = p_organization_id and g.feature_key = p_feature_key
      and g.effective_to is null and g.effective_from >= p_effective_from
  ) then
    raise exception 'New organization grant must start after the current grant' using errcode = '22023';
  end if;
  update public.organization_entitlement_grants
  set effective_to = p_effective_from,
      updated_at = now()
  where organization_id = p_organization_id and feature_key = p_feature_key
    and effective_to is null;
  insert into public.organization_entitlement_grants (
    organization_id, feature_key, decision, entitlement_value, reason,
    contract_reference, effective_from, effective_to, created_by, approved_by
  ) values (
    p_organization_id, p_feature_key, p_decision,
    case when p_decision = 'deny' then null else p_entitlement_value end,
    trim(p_reason), p_contract_reference, p_effective_from, p_effective_to,
    auth.uid(), coalesce(p_approved_by, auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.review_governed_content_revision(p_revision_id uuid, p_decision text, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_revision public.governed_content_revisions%rowtype; v_state text;
begin
  select * into v_revision from public.governed_content_revisions where id = p_revision_id for update;
  if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  perform app_private.assert_content_permission(v_revision.organization_id, 'content.studio.review');
  if v_revision.state <> 'in_review' or p_decision not in ('approve', 'request_changes')
     or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Review decision is invalid' using errcode = '42501';
  end if;
  v_state := case when p_decision = 'approve' then 'approved' else 'changes_requested' end;
  update public.governed_content_revisions
  set state = v_state, reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
  where id = p_revision_id;
  insert into public.governed_content_publication_events(
    organization_id, asset_id, revision_id, event_type, actor_profile_id, reason
  ) values (
    v_revision.organization_id, v_revision.asset_id, v_revision.id,
    case when p_decision = 'approve' then 'approved' else 'changes_requested' end,
    auth.uid(), btrim(p_reason)
  );
  return true;
end; $$;

create or replace function public.publish_governed_content_revision(p_revision_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_revision public.governed_content_revisions%rowtype;
  v_asset public.governed_content_assets%rowtype;
  v_prior uuid;
begin
  select * into v_revision from public.governed_content_revisions where id = p_revision_id for update;
  select * into v_asset from public.governed_content_assets where id = v_revision.asset_id for update;
  if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  perform app_private.assert_content_permission(v_revision.organization_id, 'content.studio.publish');
  if v_revision.state <> 'approved' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Publication requires an approved revision' using errcode = '42501';
  end if;
  v_prior := v_asset.current_published_revision_id;
  update public.governed_content_revisions set state = 'superseded' where id = v_prior and state = 'published';
  update public.governed_content_revisions
  set state = 'published', published_by = auth.uid(), published_at = now()
  where id = p_revision_id;
  update public.governed_content_assets
  set current_published_revision_id = p_revision_id, updated_at = now()
  where id = v_asset.id;
  insert into public.governed_content_publication_events(
    organization_id, asset_id, revision_id, event_type, actor_profile_id, reason, evidence
  ) values (
    v_revision.organization_id, v_asset.id, v_revision.id, 'published', auth.uid(), btrim(p_reason),
    jsonb_build_object(
      'priorRevisionId', v_prior,
      'snapshotSha256', v_revision.snapshot_sha256,
      'materialChange', v_revision.material_change,
      'materialChangeAction', v_revision.material_change_action
    )
  );
  return p_revision_id;
end; $$;

create or replace function public.review_credential_renewal_submission(
  p_submission_id uuid,
  p_decision text,
  p_confirmed_fields jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_submission public.credential_renewal_submissions%rowtype;
  v_credential_id uuid;
begin
  select * into v_submission from public.credential_renewal_submissions
  where id = p_submission_id for update;
  if not found then raise exception 'Credential renewal submission not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_submission.organization_id, 'credentials.renewal.review', v_submission.facility_id
  );
  if v_submission.status <> 'needs_review' or v_submission.scan_status not in ('clean', 'not_scanned')
     or p_decision not in ('approve', 'reject')
     or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Credential renewal is not ready for a human decision' using errcode = '55000';
  end if;
  if p_decision = 'reject' then
    update public.credential_renewal_submissions set
      status = 'rejected', human_confirmed_fields = coalesce(p_confirmed_fields, '{}'::jsonb),
      reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
    where id = v_submission.id;
    return null;
  end if;
  if jsonb_typeof(p_confirmed_fields) <> 'object'
     or length(btrim(coalesce(p_confirmed_fields->>'issuingAuthority', ''))) = 0
     or coalesce(p_confirmed_fields->>'expirationDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Human-confirmed issuer and expiration date are required' using errcode = '22023';
  end if;
  if v_submission.credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type,
      credential_label, issuing_authority, credential_number, issue_date,
      expiration_date, status, verification_method, verified_by_profile_id, verified_at
    ) values (
      v_submission.organization_id, v_submission.facility_id, v_submission.employee_id,
      v_submission.credential_type, nullif(p_confirmed_fields->>'credentialLabel', ''),
      btrim(p_confirmed_fields->>'issuingAuthority'), nullif(p_confirmed_fields->>'credentialNumber', ''),
      nullif(p_confirmed_fields->>'issueDate', '')::date,
      (p_confirmed_fields->>'expirationDate')::date,
      case when (p_confirmed_fields->>'expirationDate')::date > public.pa_today() then 'compliant' else 'expired' end,
      'human_reviewed_ocr', auth.uid(), now()
    ) returning id into v_credential_id;
  else
    update public.employee_credentials set
      issuing_authority = btrim(p_confirmed_fields->>'issuingAuthority'),
      credential_number = nullif(p_confirmed_fields->>'credentialNumber', ''),
      issue_date = nullif(p_confirmed_fields->>'issueDate', '')::date,
      expiration_date = (p_confirmed_fields->>'expirationDate')::date,
      status = case when (p_confirmed_fields->>'expirationDate')::date > public.pa_today() then 'compliant' else 'expired' end,
      verification_method = 'human_reviewed_ocr',
      verified_by_profile_id = auth.uid(), verified_at = now()
    where id = v_submission.credential_id and employee_id = v_submission.employee_id
    returning id into v_credential_id;
    if v_credential_id is null then
      raise exception 'Credential does not belong to the submitted employee' using errcode = '23514';
    end if;
  end if;
  update public.credential_renewal_submissions set
    status = 'approved', human_confirmed_fields = p_confirmed_fields,
    reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason),
    approved_credential_id = v_credential_id
  where id = v_submission.id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_submission.organization_id, e.profile_id, 'credential_renewal_changed',
    'Credential renewal approved', 'Your reviewed credential renewal is now effective.',
    case when p.role in ('employee', 'trainer') then '/me/credentials' else '/app/credentials' end
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = v_submission.employee_id and e.profile_id is not null;
  return v_credential_id;
end;
$function$;

comment on function public.review_credential_renewal_submission(uuid, text, jsonb, text) is
  'Human decision on an OCR-extracted credential renewal. The reviewer is recorded even when '
  'they also submitted the renewal. Accepts scan_status clean or not_scanned.';

-- ---------------------------------------------------------------------------
-- regulatory_governance belongs on the AAL2 baseline. Install was checking an
-- operation name the baseline did not contain, so the MFA check never ran.
-- ---------------------------------------------------------------------------

create or replace function public.identity_operation_requires_aal2(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_role text := public.current_role();
  v_org_id uuid := public.current_org_id();
  v_policy public.identity_security_policies%rowtype;
  v_is_demo boolean := false;
  v_baseline text[] := array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'regulatory_governance',
    'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin',
    'confidential_identity_reveal'
  ]::text[];
begin
  if v_role = 'platform_admin' then
    return p_operation = any(v_baseline);
  end if;

  if v_org_id is not null then
    select o.is_demo into v_is_demo from public.organizations o where o.id = v_org_id;
    if coalesce(v_is_demo, false) then
      return false;
    end if;
  end if;

  select * into v_policy
  from public.identity_security_policies
  where organization_id = v_org_id;

  if not found then
    return v_role = any(array['org_admin', 'facility_manager']::text[])
      and p_operation = any(v_baseline);
  end if;

  return v_policy.require_aal2
    and v_role = any(v_policy.privileged_roles)
    and p_operation = any(v_policy.sensitive_operations);
end;
$function$;

comment on function public.identity_operation_requires_aal2(text) is
  'Whether this operation requires a fresh privileged session. regulatory_governance is on '
  'the platform baseline so installing a rule pack requires current MFA. Demo organizations '
  'stay exempt. operational_admin stays off the baseline.';

alter table public.identity_security_policies
  alter column sensitive_operations set default array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'regulatory_governance',
    'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin',
    'confidential_identity_reveal'
  ]::text[];

update public.identity_security_policies
set sensitive_operations = array_append(sensitive_operations, 'regulatory_governance'),
    updated_at = now()
where not ('regulatory_governance' = any(sensitive_operations));

-- ---------------------------------------------------------------------------
-- Personnel-hour fixtures. The shipped Pennsylvania expected results are the
-- hour floors in calculation_parameters, so activation can record a real pass
-- instead of waiting for a manual reconciliation that has nothing to reconcile.
-- ---------------------------------------------------------------------------

create or replace function app_private.evaluate_personnel_rule_fixture(
  p_parameters jsonb,
  p_input jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_required jsonb := p_parameters -> 'generalAnnualHours';
  v_required_hours numeric;
  v_hours numeric;
  v_ojt numeric;
  v_classroom numeric;
  v_max_ojt numeric;
  v_compliant boolean;
begin
  if v_required is null or jsonb_typeof(v_required) <> 'number' then
    raise exception 'personnel rule is missing generalAnnualHours' using errcode = '22023';
  end if;
  v_required_hours := (v_required #>> '{}')::numeric;

  if p_input ? 'onTheJobTrainingHours' then
    if p_parameters -> 'maxOnTheJobTrainingHours' is null
       or jsonb_typeof(p_parameters -> 'maxOnTheJobTrainingHours') <> 'number' then
      raise exception 'personnel rule is missing maxOnTheJobTrainingHours' using errcode = '22023';
    end if;
    v_ojt := (p_input ->> 'onTheJobTrainingHours')::numeric;
    v_classroom := coalesce((p_input ->> 'classroomHours')::numeric, 0);
    v_max_ojt := (p_parameters ->> 'maxOnTheJobTrainingHours')::numeric;
    v_compliant := least(v_ojt, v_max_ojt) + v_classroom >= v_required_hours
      and v_ojt <= v_max_ojt;
    return jsonb_build_object(
      'compliant', v_compliant,
      'requiredHours', v_required,
      'maxOnTheJobTrainingHours', p_parameters -> 'maxOnTheJobTrainingHours'
    );
  end if;

  if p_input ? 'eligibleAnnualHours' then
    v_hours := (p_input ->> 'eligibleAnnualHours')::numeric;
    v_compliant := v_hours >= v_required_hours;
    if p_input ? 'dementiaAdditionalHours'
       and p_parameters ? 'dementiaAdditionalHoursDoNotCountTowardGeneral' then
      return jsonb_build_object(
        'compliant', v_compliant,
        'requiredHours', v_required,
        'dementiaAdditionalHoursDoNotCountTowardGeneral',
          p_parameters -> 'dementiaAdditionalHoursDoNotCountTowardGeneral'
      );
    end if;
    return jsonb_build_object('compliant', v_compliant, 'requiredHours', v_required);
  end if;

  raise exception 'personnel fixture input is not recognized' using errcode = '22023';
end;
$function$;

revoke all on function app_private.evaluate_personnel_rule_fixture(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.install_and_activate_regulatory_rule_pack(
  p_template_key text,
  p_review_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version public.regulatory_rule_versions%rowtype;
  v_fixture public.regulatory_rule_golden_fixtures%rowtype;
  v_actual jsonb;
  v_run_id uuid;
  v_passed boolean;
  v_active_id uuid;
begin
  if p_template_key not in ('pa.pch.2600.65.personnel', 'pa.alf.2800.65.personnel') then
    raise exception 'Only the Pennsylvania personnel packs can be installed and activated together'
      using errcode = '22023';
  end if;
  if not public.is_platform_admin()
     or not public.identity_assurance_is_current('regulatory_governance') then
    raise exception 'AAL2 platform administration is required to install and activate a rule pack'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_review_notes, ''))) < 10 then
    raise exception 'review notes must explain the approval'
      using errcode = '22023';
  end if;

  select v.id into v_active_id
  from public.regulatory_rule_versions v
  join public.regulatory_rule_packs p on p.id = v.rule_pack_id
  where p.rule_key = p_template_key
    and v.state = 'active'
  limit 1;
  if v_active_id is not null then
    return v_active_id;
  end if;

  if not exists (
    select 1
    from public.regulatory_rule_versions v
    join public.regulatory_rule_packs p on p.id = v.rule_pack_id
    where p.rule_key = p_template_key
  ) then
    perform public.install_regulatory_rule_pack_template(p_template_key);
  end if;

  select v.* into v_version
  from public.regulatory_rule_versions v
  join public.regulatory_rule_packs p on p.id = v.rule_pack_id
  where p.rule_key = p_template_key
    and v.state not in ('withdrawn', 'superseded')
  order by v.version_number desc
  limit 1
  for update of v;
  if v_version.id is null then
    raise exception 'The rule pack has no version that can be activated'
      using errcode = '22023';
  end if;
  if v_version.state = 'active' then
    return v_version.id;
  end if;

  if v_version.state = 'draft' then
    update public.regulatory_rule_versions
    set release_notes = 'Installed by the platform administrator from the counsel-cleared '
      || 'Pennsylvania template. Golden fixtures are evaluated against the shipped hour floors '
      || 'before activation. Shadow mode is optional.'
    where id = v_version.id
    returning * into v_version;
    perform set_config('app.regulatory_rule_transition', 'on', true);
    update public.regulatory_rule_versions
    set state = 'review', submitted_by = auth.uid(), submitted_at = now()
    where id = v_version.id
    returning * into v_version;
  end if;

  if v_version.state = 'review' then
    perform set_config('app.regulatory_rule_transition', 'on', true);
    update public.regulatory_rule_versions
    set state = 'approved',
        reviewed_by = auth.uid(),
        review_notes = btrim(p_review_notes),
        approved_at = now()
    where id = v_version.id
    returning * into v_version;
  end if;

  if v_version.state not in ('approved', 'shadow') then
    raise exception 'only an approved or shadow rule version may be activated'
      using errcode = '22023';
  end if;

  for v_fixture in
    select * from public.regulatory_rule_golden_fixtures
    where rule_version_id = v_version.id
    order by fixture_key
  loop
    v_actual := app_private.evaluate_personnel_rule_fixture(
      v_version.calculation_parameters, v_fixture.input_payload
    );
    v_run_id := public.record_regulatory_fixture_result(
      v_fixture.id,
      'personnel-hours-v1',
      v_actual,
      'install-activate-' || v_fixture.id::text
    );
    select passed into v_passed
    from public.regulatory_rule_fixture_runs
    where id = v_run_id;
    if coalesce(v_passed, false) = false then
      raise exception 'golden fixture % did not match the personnel-hours engine', v_fixture.fixture_key
        using errcode = '23514';
    end if;
  end loop;

  v_version := public.activate_regulatory_rule_version(v_version.id);
  return v_version.id;
end;
$function$;

comment on function public.install_and_activate_regulatory_rule_pack(text, text) is
  'Installs, approves, fixture-checks, and activates a Pennsylvania personnel pack in one '
  'MFA-verified action. Shadow mode is not required. A pack that is already active is returned '
  'unchanged. reviewed_by records the administrator who approved it.';

revoke all on function public.install_and_activate_regulatory_rule_pack(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.install_and_activate_regulatory_rule_pack(text, text)
  to authenticated;

update public.regulatory_rule_pack_templates
set description = '55 Pa. Code §2600.65 personnel training for personal care homes. '
  'One platform administrator can install, approve, and activate this pack. Golden fixtures '
  'are evaluated against the shipped hour floors. Shadow mode is optional. Counsel-cleared '
  'product path (SG-2 option 2).'
where template_key = 'pa.pch.2600.65.personnel';

update public.regulatory_rule_pack_templates
set description = '55 Pa. Code §2800.65 personnel training for Assisted Living Facilities (ALF). '
  'One platform administrator can install, approve, and activate this pack. Golden fixtures '
  'are evaluated against the shipped hour floors. Shadow mode is optional. Counsel-cleared '
  'product path (SG-2 option 2). Additional §2800.69 dementia hours are separate and do not '
  'count toward the 16-hour floor.'
where template_key = 'pa.alf.2800.65.personnel';
