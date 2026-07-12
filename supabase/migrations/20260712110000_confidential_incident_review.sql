-- Confidential incident review command surface.
--
-- Phase 5 shipped the confidential intake family (20260712035922) with a public intake
-- path but no review path: there was no way to change an intake's status, no way to see
-- the segregated reporter identity, and -- contrary to the operating rules in
-- PHASE5_OPERATIONS.md ("views, downloads, disclosures, denials, and state changes must
-- produce access events") -- reading the protected narrative was an unaudited direct
-- table SELECT. This migration adds the audited review commands the console uses and
-- closes the unaudited read path:
--
--   * open_confidential_intake_details(intake, purpose)   -> details row + view_details event
--   * set_confidential_intake_status(intake, status, why) -> transition + status_change event
--   * reveal_confidential_reporter_identity(intake, why)  -> identity payload + view_identity event
--
-- Direct SELECT on confidential_incident_details is revoked from authenticated so the
-- purpose-stamped RPC becomes the only browser read path for protected narratives.
-- Intake summaries (confidential_incident_intakes) and the access-event ledger keep
-- their existing read policies; reporter identities remain reachable only through the
-- reveal command, which requires org_admin (or platform_admin) with a fresh AAL2
-- session, mirroring the other privileged Phase 5 commands.

-- ---------------------------------------------------------------------------
-- Authorization guard
-- ---------------------------------------------------------------------------

-- p_admin_only=false: reviewers who may read protected details (org_admin, auditor).
-- p_admin_only=true: actors who may change state or see reporter identity (org_admin).
-- platform_admin and service_role always pass, matching app_private.assert_phase5_manager.
create or replace function app_private.assert_confidential_reviewer(
  p_organization_id uuid,
  p_admin_only boolean default false
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role','') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null
     or public.current_org_id() <> p_organization_id
     or (p_admin_only and public.current_role() <> 'org_admin')
     or (not p_admin_only and public.current_role() not in ('org_admin','auditor'))
  then
    raise exception 'Confidential incident operation is outside caller scope'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_confidential_reviewer(uuid, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audited detail read
-- ---------------------------------------------------------------------------

create or replace function public.open_confidential_intake_details(
  p_intake_id uuid,
  p_purpose text
) returns setof public.confidential_incident_details
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.confidential_incident_intakes%rowtype;
begin
  select * into v from public.confidential_incident_intakes where id = p_intake_id;
  if not found then
    raise exception 'Confidential intake not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_confidential_reviewer(v.organization_id, false);
  if length(btrim(coalesce(p_purpose,''))) < 5 then
    raise exception 'A review purpose is required' using errcode = '22023';
  end if;
  insert into public.confidential_incident_access_events(
    organization_id, facility_id, intake_id, actor_profile_id, event_type, purpose
  ) values (v.organization_id, v.facility_id, v.id, auth.uid(), 'view_details', btrim(p_purpose));
  return query
    select * from public.confidential_incident_details d where d.intake_id = v.id;
end;
$$;
revoke all on function public.open_confidential_intake_details(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.open_confidential_intake_details(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Status transitions
-- ---------------------------------------------------------------------------

-- The intake enum is draft/submitted/triage/investigating/review/closed/retained.
-- Review actors may move an intake forward through triage/investigating/review/closed
-- and place a closed intake under a retention hold ('retained'). 'draft'/'submitted'
-- are intake-side states and cannot be re-entered; 'retained' is terminal.
create or replace function public.set_confidential_intake_status(
  p_intake_id uuid,
  p_target_status text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.confidential_incident_intakes%rowtype;
begin
  select * into v from public.confidential_incident_intakes where id = p_intake_id for update;
  if not found then
    raise exception 'Confidential intake not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_confidential_reviewer(v.organization_id, true);
  if p_target_status not in ('triage','investigating','review','closed','retained')
     or length(btrim(coalesce(p_reason,''))) < 5
     or p_target_status = v.status
     or v.status = 'retained'
     or (v.status = 'closed' and p_target_status <> 'retained')
  then
    raise exception 'Invalid confidential intake transition' using errcode = '22023';
  end if;
  update public.confidential_incident_intakes
    set status = p_target_status, updated_at = now()
    where id = v.id;
  insert into public.confidential_incident_access_events(
    organization_id, facility_id, intake_id, actor_profile_id, event_type, purpose
  ) values (
    v.organization_id, v.facility_id, v.id, auth.uid(), 'status_change',
    format('%s -> %s: %s', v.status, p_target_status, btrim(p_reason))
  );
  return true;
end;
$$;
revoke all on function public.set_confidential_intake_status(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_confidential_intake_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reporter identity reveal
-- ---------------------------------------------------------------------------

-- The identity table has no browser grant at all; this command is the only read path.
-- Requires org_admin (or platform_admin) plus a fresh AAL2 session, and always stamps
-- a view_identity access event -- including for anonymous intakes, so attempted reveals
-- are part of the ledger too.
create or replace function public.reveal_confidential_reporter_identity(
  p_intake_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.confidential_incident_intakes%rowtype;
  v_identity public.confidential_reporter_identities%rowtype;
  v_profile public.profiles%rowtype;
begin
  select * into v from public.confidential_incident_intakes where id = p_intake_id;
  if not found then
    raise exception 'Confidential intake not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_confidential_reviewer(v.organization_id, true);
  perform public.assert_identity_assurance('workforce_admin');
  if length(btrim(coalesce(p_purpose,''))) < 5 then
    raise exception 'A review purpose is required' using errcode = '22023';
  end if;
  insert into public.confidential_incident_access_events(
    organization_id, facility_id, intake_id, actor_profile_id, event_type, purpose
  ) values (v.organization_id, v.facility_id, v.id, auth.uid(), 'view_identity', btrim(p_purpose));

  select * into v_identity
    from public.confidential_reporter_identities where intake_id = v.id;
  if not found then
    return jsonb_build_object(
      'reporterMode', v.reporter_mode,
      'identityOnFile', false
    );
  end if;
  if v_identity.reporter_profile_id is not null then
    select * into v_profile from public.profiles where id = v_identity.reporter_profile_id;
  end if;
  return jsonb_build_object(
    'reporterMode', v.reporter_mode,
    'identityOnFile', true,
    'reporterProfileId', v_identity.reporter_profile_id,
    'reporterName', case
      when v_profile.id is not null then v_profile.first_name || ' ' || v_profile.last_name
      else null end,
    'reporterEmail', case when v_profile.id is not null then v_profile.email else null end,
    'encryptedContact', v_identity.encrypted_contact,
    'consentToContact', v_identity.consent_to_contact,
    'recordedAt', v_identity.created_at
  );
end;
$$;
revoke all on function public.reveal_confidential_reporter_identity(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reveal_confidential_reporter_identity(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the unaudited narrative read path
-- ---------------------------------------------------------------------------

-- Reviewers now read protected details exclusively through the purpose-stamped RPC.
-- The RLS policy is dropped along with the grant so a future broad grant cannot
-- silently reopen an unaudited path.
revoke select on table public.confidential_incident_details from authenticated;
drop policy if exists incident_details_select on public.confidential_incident_details;
