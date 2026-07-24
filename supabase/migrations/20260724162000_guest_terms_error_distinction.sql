-- Review finding (wave 5): get_move_in_guest_workspace() and
-- get_resident_agreement_guest_workspace() raised one identical "access denied" error
-- for four very different situations -- token not found, revoked, expired, and "grant
-- is fine but terms not yet accepted". The public guest portals can only branch on the
-- error, so they showed their "review/accept terms" card for EVERY failure: a guest
-- with an expired or revoked link was invited to accept terms and then failed
-- confusingly, instead of seeing "link unavailable".
--
-- Fix: full-body copies of the prior definitions (20260713183435 for move-in,
-- 20260714214435 for resident agreements) with the guard split, raising a dedicated
-- '... terms acceptance required' message when the only problem is accepted_at IS
-- NULL. Still errcode 42501 and still zero information for invalid tokens (the
-- terms-pending message only appears for a live, unrevoked, unexpired grant, which
-- the link holder legitimately possesses).
create or replace function public.get_move_in_guest_workspace(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Move-in guest access denied' using errcode = '42501';
  end if;
  if v.accepted_at is null then
    raise exception 'Move-in guest terms acceptance required' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'residentProfile', jsonb_build_object(
      'preferredName', v_resident.preferred_name,
      'preferredLanguage', v_resident.preferred_language,
      'communicationPreferences', v_resident.communication_preferences,
      'contractStatus', v_resident.contract_status,
      'residentRightsAcknowledgedAt', v_resident.resident_rights_acknowledged_at
    ),
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'state', t.state,
        'requiresSignature', t.requires_signature,
        'requiresDocument', t.requires_document,
        'signed', t.signature_evidence is not null
      ) order by t.due_at), '[]'::jsonb)
      from public.move_in_tasks t where t.id = any(v.allowed_task_ids)
    )
  );
end;
$$;

-- Same guard split for the resident-agreement guest workspace. Everything below the
-- guard is unchanged from 20260714214435 (including the 'viewed' access event, which
-- still only fires once the grant is live AND terms are accepted).
create or replace function public.get_resident_agreement_guest_workspace(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_agreement_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Resident agreement access denied' using errcode = '42501';
  end if;
  if v.accepted_at is null then
    raise exception 'Resident agreement terms acceptance required' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'viewed');
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'signerRole', v.signer_role,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agreementId', a.id, 'versionId', av.id, 'agreementType', a.agreement_type,
        'title', a.title, 'versionLabel', av.version_label, 'contentText', av.content_text,
        'contentSha256', av.content_sha256, 'effectiveAt', av.effective_at,
        'requiredSignerRoles', av.required_signer_roles,
        'signerRole', v.signer_role,
        'documentLabel', coalesce(d.document_label, d.file_name),
        'responded', exists(select 1 from public.resident_agreement_signatures s
          where s.agreement_version_id = av.id and s.guest_grant_id = v.id)
      ) order by av.effective_at, a.title)
      from public.resident_agreement_versions av
      join public.resident_agreements a on a.id = av.agreement_id
      left join public.resident_documents d on d.id = av.document_id
      where av.id = any(v.allowed_version_ids)
        and av.status = 'active'
        and v.signer_role = any(av.required_signer_roles)
    ), '[]'::jsonb)
  );
end;
$$;
