-- Evidence room lifecycle (END_USER_REVIEW.md recommendation #9, second slice).
--
-- Phase 5 shipped the auditor evidence room schema (evidence_collections /
-- evidence_collection_artifacts / evidence_guest_grants / evidence_guest_access_events)
-- with SELECT-only staff access and exactly two RPCs: issuing a guest grant and
-- authorizing one artifact access. Nothing could create or publish a collection, bind
-- an artifact into one, accept the guest terms, or revoke a grant -- so a guest grant
-- could never actually authorize anything (authorization requires accepted_at, which
-- nothing set). This migration adds the caller-authorized lifecycle around that core:
--
--   staff  create_evidence_collection, add_binder_export_to_evidence_collection,
--          set_evidence_collection_status, set_evidence_collection_legal_hold,
--          withdraw_evidence_collection_artifact, revoke_evidence_guest_grant
--   guest  accept_evidence_guest_terms, get_evidence_guest_room (anon, token-scoped,
--          fail closed -- the same model as authorize_evidence_guest_artifact)
--
-- Artifacts enter a collection by promoting a completed binder export
-- (binder_export_jobs) into the Phase 5 snapshot ledger: the binder worker now records
-- each PDF's SHA-256 and byte size, and promotion creates the report_snapshots /
-- report_snapshot_artifacts rows under the schema's checksum contract. Live database
-- access is never an evidence-room feature (PHASE5_OPERATIONS.md) -- only stored,
-- checksummed artifacts can be shared with a guest.

-- ---------------------------------------------------------------------------
-- Binder exports carry a content checksum so they can become evidence artifacts
-- ---------------------------------------------------------------------------

alter table public.binder_export_jobs
  add column content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add column byte_size bigint check (byte_size is null or byte_size > 0);

-- The finish RPC gains two optional checksum parameters. The old six-argument
-- signature is dropped first: keeping both overloads would make the existing
-- named-argument worker calls ambiguous.
drop function public.finish_binder_export_job(uuid, uuid, text, text, text, text);

create or replace function public.finish_binder_export_job(
  p_job_id uuid,
  p_run_id uuid,
  p_bucket text default null,
  p_path text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_content_sha256 text default null,
  p_byte_size bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.binder_export_jobs%rowtype;
  v_success boolean;
  v_retry boolean;
begin
  select j.* into v_job
  from public.binder_export_jobs j
  where j.id = p_job_id
  for update of j;

  if v_job.id is null
     or v_job.status <> 'processing'
     or v_job.current_run_id is distinct from p_run_id then
    return false;
  end if;

  v_success := p_bucket is not null and p_path is not null and p_error_message is null;
  v_retry := not v_success and v_job.attempt_count < v_job.max_attempts;

  if v_success then
    update public.binder_export_jobs
    set status = 'succeeded',
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        completed_at = now(),
        storage_bucket = p_bucket,
        storage_path = p_path,
        content_sha256 = p_content_sha256,
        byte_size = p_byte_size,
        last_error_code = null,
        last_error_message = null
    where id = v_job.id;
  else
    update public.binder_export_jobs
    set status = case when v_retry then 'pending' else 'failed' end,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        available_at = case
          when v_retry then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, v_job.attempt_count - 1))))
          else available_at
        end,
        completed_at = case when v_retry then null else now() end,
        last_error_code = left(coalesce(p_error_code, 'render_failed'), 120),
        last_error_message = left(coalesce(p_error_message, 'Compliance binder generation failed'), 2000)
    where id = v_job.id;
  end if;

  return true;
end;
$function$;
revoke all on function public.finish_binder_export_job(uuid, uuid, text, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.finish_binder_export_job(uuid, uuid, text, text, text, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- Staff lifecycle: create a collection
-- ---------------------------------------------------------------------------

create or replace function public.create_evidence_collection(
  p_facility_id uuid,
  p_name text,
  p_purpose text,
  p_terms_version text default 'v1'
)
returns public.evidence_collections
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_facility public.facilities%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_row public.evidence_collections%rowtype;
begin
  select f.* into v_facility from public.facilities f where f.id = p_facility_id;
  if v_facility.id is null then
    raise exception 'Facility not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_facility.organization_id, v_facility.id);
  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'A collection name of 3-120 characters is required' using errcode = '22023';
  end if;
  if length(v_purpose) < 3 or length(v_purpose) > 500 then
    raise exception 'A collection purpose of 3-500 characters is required' using errcode = '22023';
  end if;

  insert into public.evidence_collections (organization_id, facility_id, name, purpose, terms_version, created_by)
  values (
    v_facility.organization_id, v_facility.id, v_name, v_purpose,
    coalesce(nullif(btrim(p_terms_version), ''), 'v1'), auth.uid())
  returning * into v_row;
  return v_row;
end;
$function$;
revoke all on function public.create_evidence_collection(uuid, text, text, text) from public, anon;
grant execute on function public.create_evidence_collection(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff lifecycle: promote a completed binder export into a collection
-- ---------------------------------------------------------------------------

create or replace function public.add_binder_export_to_evidence_collection(
  p_collection_id uuid,
  p_binder_job_id uuid,
  p_display_name text
)
returns public.evidence_collection_artifacts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_col public.evidence_collections%rowtype;
  v_job public.binder_export_jobs%rowtype;
  v_display text := btrim(coalesce(p_display_name, ''));
  v_as_of timestamptz;
  v_definition_id uuid;
  v_version_id uuid;
  v_config jsonb;
  v_config_sha text;
  v_snapshot_id uuid;
  v_snapshot_artifact_id uuid;
  v_row public.evidence_collection_artifacts%rowtype;
begin
  select c.* into v_col from public.evidence_collections c where c.id = p_collection_id for update;
  if v_col.id is null then
    raise exception 'Evidence collection not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_col.organization_id, v_col.facility_id);
  if v_col.status not in ('draft', 'published') then
    raise exception 'Artifacts can only be added to a draft or published collection' using errcode = '22023';
  end if;
  if length(v_display) < 3 or length(v_display) > 200 then
    raise exception 'A display name of 3-200 characters is required' using errcode = '22023';
  end if;

  select j.* into v_job
  from public.binder_export_jobs j
  where j.id = p_binder_job_id and j.organization_id = v_col.organization_id;
  if v_job.id is null then
    raise exception 'Binder export not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'succeeded' or v_job.storage_bucket is null or v_job.storage_path is null then
    raise exception 'Only completed binder exports can be added as evidence' using errcode = '22023';
  end if;
  -- Guest access is facility-scoped end to end (IMPLEMENTATION_PLAN.md P5.5 acceptance
  -- criteria). An export whose scope is wider than this collection's facility -- org-wide
  -- or multi-facility -- would leak other facilities' data through the room, so only an
  -- export generated for exactly this facility can be promoted.
  if v_job.facility_ids <> array[v_col.facility_id] then
    raise exception 'The binder export scope must exactly match the collection facility' using errcode = '22023';
  end if;
  if v_job.content_sha256 is null or v_job.byte_size is null then
    raise exception 'This export predates checksum recording; generate a fresh binder export' using errcode = '22023';
  end if;

  -- Serialize per organization: saved_report_definitions has no per-name uniqueness, so
  -- two concurrent promotions could otherwise double-create the system-owned definition.
  perform pg_advisory_xact_lock(hashtext('evidence_binder_definition:' || v_col.organization_id::text)::bigint);

  -- Binder exports hang off one system-owned definition per organization so they satisfy
  -- report_snapshots' not-null definition/version contract without polluting user views.
  select d.id into v_definition_id
  from public.saved_report_definitions d
  where d.organization_id = v_col.organization_id
    and d.report_type = 'binder'
    and d.name = 'Compliance binder exports';
  if v_definition_id is null then
    insert into public.saved_report_definitions (organization_id, name, report_type)
    values (v_col.organization_id, 'Compliance binder exports', 'binder')
    returning id into v_definition_id;
  end if;

  select v.id into v_version_id
  from public.saved_report_versions v
  where v.report_definition_id = v_definition_id and v.version_number = 1;
  if v_version_id is null then
    v_config := jsonb_build_object('filters', '{}'::jsonb, 'columns', '[]'::jsonb, 'timeZone', 'UTC');
    insert into public.saved_report_versions (
      report_definition_id, organization_id, version_number, filters, columns,
      configuration_sha256, state, published_at)
    values (
      v_definition_id, v_col.organization_id, 1, '{}'::jsonb, '[]'::jsonb,
      encode(extensions.digest(convert_to(v_config::text, 'utf8'), 'sha256'), 'hex'),
      'published', now())
    returning id into v_version_id;
    update public.saved_report_definitions
    set current_version_id = v_version_id
    where id = v_definition_id;
  end if;

  -- The snapshot records the export as a direct render: the PDF is generated straight
  -- from the live source in a single worker pass and checksummed at generation time, so
  -- there is no separate ledger to reconcile against -- reconciliation_detail carries
  -- the method rather than a comparison result.
  v_as_of := coalesce(v_job.completed_at, v_job.updated_at, now());
  v_config := jsonb_build_object(
    'source', 'binder_export',
    'binderJobId', v_job.id,
    'facilityIds', to_jsonb(v_job.facility_ids));
  v_config_sha := encode(extensions.digest(convert_to(v_config::text, 'utf8'), 'sha256'), 'hex');

  insert into public.report_snapshots (
    organization_id, facility_id, report_definition_id, report_version_id,
    as_of, configuration, configuration_sha256, source_watermarks,
    included_record_ids, row_counts, material_totals,
    reconciliation_status, reconciliation_detail, snapshot_sha256, status, generated_by)
  values (
    v_col.organization_id, v_col.facility_id, v_definition_id, v_version_id,
    v_as_of, v_config, v_config_sha, '{}'::jsonb,
    '{}'::jsonb, jsonb_build_object('binderPdfBytes', v_job.byte_size), '{}'::jsonb,
    'reconciled', jsonb_build_object('method', 'direct_export', 'binderJobId', v_job.id),
    encode(extensions.digest(convert_to((v_config || jsonb_build_object('contentSha256', v_job.content_sha256))::text, 'utf8'), 'sha256'), 'hex'),
    'ready', v_job.requested_by)
  on conflict (report_version_id, as_of, configuration_sha256) do nothing
  returning id into v_snapshot_id;
  if v_snapshot_id is null then
    select s.id into v_snapshot_id
    from public.report_snapshots s
    where s.report_version_id = v_version_id
      and s.as_of = v_as_of
      and s.configuration_sha256 = v_config_sha;
  end if;

  insert into public.report_snapshot_artifacts (
    organization_id, facility_id, snapshot_id, artifact_type,
    storage_bucket, storage_path, content_sha256, byte_size, manifest)
  values (
    v_col.organization_id, v_col.facility_id, v_snapshot_id, 'binder',
    v_job.storage_bucket, v_job.storage_path, v_job.content_sha256, v_job.byte_size,
    jsonb_build_object(
      'binderJobId', v_job.id,
      'requestedBy', v_job.requested_by,
      'completedAt', v_job.completed_at,
      'facilityIds', to_jsonb(v_job.facility_ids)))
  on conflict (snapshot_id, artifact_type) do nothing
  returning id into v_snapshot_artifact_id;
  if v_snapshot_artifact_id is null then
    select a.id into v_snapshot_artifact_id
    from public.report_snapshot_artifacts a
    where a.snapshot_id = v_snapshot_id and a.artifact_type = 'binder';
  end if;

  insert into public.evidence_collection_artifacts (
    organization_id, facility_id, collection_id, snapshot_artifact_id, display_name, added_by)
  values (v_col.organization_id, v_col.facility_id, v_col.id, v_snapshot_artifact_id, v_display, auth.uid())
  on conflict (collection_id, snapshot_artifact_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select a.* into v_row
    from public.evidence_collection_artifacts a
    where a.collection_id = v_col.id and a.snapshot_artifact_id = v_snapshot_artifact_id;
    if v_row.withdrawn_at is not null then
      -- Withdrawal is a deliberate audit action; silently resurrecting the artifact
      -- would contradict the withdrawn event already on the access log.
      raise exception 'This export was withdrawn from the collection and cannot be re-added' using errcode = '22023';
    end if;
  end if;
  return v_row;
end;
$function$;
revoke all on function public.add_binder_export_to_evidence_collection(uuid, uuid, text) from public, anon;
grant execute on function public.add_binder_export_to_evidence_collection(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff lifecycle: status transitions (publish / close / withdraw)
-- ---------------------------------------------------------------------------

create or replace function public.set_evidence_collection_status(
  p_collection_id uuid,
  p_status text
)
returns public.evidence_collections
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_col public.evidence_collections%rowtype;
begin
  select c.* into v_col from public.evidence_collections c where c.id = p_collection_id for update;
  if v_col.id is null then
    raise exception 'Evidence collection not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_col.organization_id, v_col.facility_id);

  if p_status not in ('published', 'closed', 'withdrawn') then
    raise exception 'Target status must be published, closed, or withdrawn' using errcode = '22023';
  end if;
  if not (
    (v_col.status = 'draft' and p_status in ('published', 'withdrawn'))
    or (v_col.status = 'published' and p_status in ('closed', 'withdrawn'))
    or (v_col.status = 'closed' and p_status = 'withdrawn')
  ) then
    raise exception 'Cannot move a % collection to %', v_col.status, p_status using errcode = '22023';
  end if;

  if p_status = 'published'
     and not exists (
       select 1 from public.evidence_collection_artifacts a
       where a.collection_id = v_col.id and a.withdrawn_at is null
     ) then
    raise exception 'Publishing requires at least one active artifact in the collection' using errcode = '22023';
  end if;

  -- Fail closed: shutting the room ends every outstanding guest grant immediately and
  -- attributably instead of leaving live tokens pointed at a closed collection.
  if p_status in ('closed', 'withdrawn') then
    with revoked as (
      update public.evidence_guest_grants g
      set revoked_at = now(),
          revoked_by = auth.uid(),
          revocation_reason = format('Collection %s', p_status)
      where g.collection_id = v_col.id and g.revoked_at is null
      returning g.id, g.organization_id, g.facility_id, g.collection_id
    )
    insert into public.evidence_guest_access_events (
      organization_id, facility_id, guest_grant_id, collection_id, event_type, reason)
    select r.organization_id, r.facility_id, r.id, r.collection_id, 'revoked',
      format('Guest access ended because the collection was %s', p_status)
    from revoked r;
  end if;

  update public.evidence_collections
  set status = p_status,
      published_at = case when p_status = 'published' then now() else published_at end,
      updated_at = now()
  where id = v_col.id
  returning * into v_col;
  return v_col;
end;
$function$;
revoke all on function public.set_evidence_collection_status(uuid, text) from public, anon;
grant execute on function public.set_evidence_collection_status(uuid, text) to authenticated;

-- Legal hold prevents retention deletion (PHASE5_OPERATIONS.md); it does not extend or
-- restrict guest access. It is an organization-level legal decision, so facility
-- managers -- who otherwise manage their facility's rooms -- cannot toggle it.
create or replace function public.set_evidence_collection_legal_hold(
  p_collection_id uuid,
  p_hold boolean
)
returns public.evidence_collections
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_col public.evidence_collections%rowtype;
begin
  select c.* into v_col from public.evidence_collections c where c.id = p_collection_id for update;
  if v_col.id is null then
    raise exception 'Evidence collection not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_col.organization_id, v_col.facility_id);
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_platform_admin()
     and public.current_role() <> 'org_admin' then
    raise exception 'Legal hold is limited to organization administrators' using errcode = '42501';
  end if;

  if v_col.legal_hold is distinct from p_hold then
    update public.evidence_collections
    set legal_hold = p_hold, updated_at = now()
    where id = v_col.id
    returning * into v_col;
  end if;
  return v_col;
end;
$function$;
revoke all on function public.set_evidence_collection_legal_hold(uuid, boolean) from public, anon;
grant execute on function public.set_evidence_collection_legal_hold(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff lifecycle: withdraw an artifact / revoke a guest grant
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_evidence_collection_artifact(
  p_artifact_id uuid,
  p_reason text
)
returns public.evidence_collection_artifacts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_art public.evidence_collection_artifacts%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select a.* into v_art from public.evidence_collection_artifacts a where a.id = p_artifact_id for update;
  if v_art.id is null then
    raise exception 'Evidence artifact not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_art.organization_id, v_art.facility_id);
  if length(v_reason) < 5 then
    raise exception 'A withdrawal reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_art.withdrawn_at is not null then
    raise exception 'Artifact is already withdrawn' using errcode = '22023';
  end if;

  update public.evidence_collection_artifacts
  set withdrawn_at = now()
  where id = v_art.id
  returning * into v_art;

  insert into public.evidence_guest_access_events (
    organization_id, facility_id, collection_id, artifact_id, event_type, reason)
  values (
    v_art.organization_id, v_art.facility_id, v_art.collection_id, v_art.id,
    'withdrawn', format('Withdrawn by staff: %s', v_reason));
  return v_art;
end;
$function$;
revoke all on function public.withdraw_evidence_collection_artifact(uuid, text) from public, anon;
grant execute on function public.withdraw_evidence_collection_artifact(uuid, text) to authenticated;

create or replace function public.revoke_evidence_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns public.evidence_guest_grants
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select g.* into v_grant from public.evidence_guest_grants g where g.id = p_grant_id for update;
  if v_grant.id is null then
    raise exception 'Guest grant not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_grant.organization_id, v_grant.facility_id);
  if length(v_reason) < 5 then
    raise exception 'A revocation reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_grant.revoked_at is not null then
    raise exception 'Guest grant is already revoked' using errcode = '22023';
  end if;

  update public.evidence_guest_grants
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = v_reason
  where id = v_grant.id
  returning * into v_grant;

  insert into public.evidence_guest_access_events (
    organization_id, facility_id, guest_grant_id, collection_id, event_type, reason)
  values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
    'revoked', format('Guest access revoked by staff: %s', v_reason));
  return v_grant;
end;
$function$;
revoke all on function public.revoke_evidence_guest_grant(uuid, text) from public, anon;
grant execute on function public.revoke_evidence_guest_grant(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest surface (anon-callable, token-scoped, fail closed)
-- ---------------------------------------------------------------------------

-- Terms acceptance is the gate authorize_evidence_guest_artifact already requires
-- (accepted_at is not null) but nothing could ever set. Idempotent: re-accepting
-- keeps the original timestamp and logs nothing new.
create or replace function public.accept_evidence_guest_terms(
  p_token text,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
begin
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if v_grant.id is null then
    return jsonb_build_object('accepted', false, 'reason', 'access_denied');
  end if;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;
  if v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_col.status <> 'published'
     or v_org.subscription_status in ('suspended', 'canceled') then
    return jsonb_build_object('accepted', false, 'reason', 'access_denied');
  end if;

  if v_grant.accepted_at is null then
    update public.evidence_guest_grants
    set accepted_at = now()
    where id = v_grant.id
    returning * into v_grant;
    insert into public.evidence_guest_access_events (
      organization_id, facility_id, guest_grant_id, collection_id,
      event_type, request_fingerprint_sha256, reason)
    values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
      'terms_accepted', p_fingerprint, format('Guest accepted terms %s', v_grant.terms_version));
  end if;
  return jsonb_build_object(
    'accepted', true,
    'termsVersion', v_grant.terms_version,
    'acceptedAt', v_grant.accepted_at);
end;
$function$;
revoke all on function public.accept_evidence_guest_terms(text, text) from public;
grant execute on function public.accept_evidence_guest_terms(text, text) to anon, authenticated;

-- The guest room view: collection metadata plus the allowed, non-withdrawn artifacts.
-- Before terms acceptance only the collection name/purpose and terms version are
-- returned; artifacts stay hidden. Every authorized open is logged as a view event.
create or replace function public.get_evidence_guest_room(
  p_token text,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
  v_artifacts jsonb;
begin
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if v_grant.id is null then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;
  if v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_col.status <> 'published'
     or v_org.subscription_status in ('suspended', 'canceled') then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  if v_grant.step_up_required and v_grant.step_up_verified_at is null then
    return jsonb_build_object('authorized', false, 'reason', 'step_up_required');
  end if;
  if v_grant.accepted_at is null then
    return jsonb_build_object(
      'authorized', false,
      'needsTerms', true,
      'guestLabel', v_grant.guest_label,
      'termsVersion', v_grant.terms_version,
      'expiresAt', v_grant.expires_at,
      'collection', jsonb_build_object('name', v_col.name, 'purpose', v_col.purpose));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'displayName', a.display_name,
      'addedAt', a.added_at,
      'artifactType', sa.artifact_type,
      'byteSize', sa.byte_size,
      'contentSha256', sa.content_sha256)
      order by a.added_at), '[]'::jsonb)
  into v_artifacts
  from public.evidence_collection_artifacts a
  join public.report_snapshot_artifacts sa on sa.id = a.snapshot_artifact_id
  where a.collection_id = v_grant.collection_id
    and a.id = any(v_grant.allowed_artifact_ids)
    and a.withdrawn_at is null
    and sa.withdrawn_at is null;

  insert into public.evidence_guest_access_events (
    organization_id, facility_id, guest_grant_id, collection_id,
    event_type, request_fingerprint_sha256, reason)
  values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
    'view', p_fingerprint, 'Guest opened the evidence room');

  return jsonb_build_object(
    'authorized', true,
    'guestLabel', v_grant.guest_label,
    'termsVersion', v_grant.terms_version,
    'acceptedAt', v_grant.accepted_at,
    'expiresAt', v_grant.expires_at,
    'collection', jsonb_build_object('name', v_col.name, 'purpose', v_col.purpose),
    'artifacts', v_artifacts);
end;
$function$;
revoke all on function public.get_evidence_guest_room(text, text) from public;
grant execute on function public.get_evidence_guest_room(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tighten per-artifact authorization: the collection itself must be published
-- ---------------------------------------------------------------------------

-- Same body and event contract as the shipped function, plus a collection-status
-- check: PHASE5_OPERATIONS.md publishes artifacts into a *published* collection, and
-- the status transitions above revoke grants when a room closes -- this makes the
-- per-artifact check agree even for grants that predate those transitions.
create or replace function public.authorize_evidence_guest_artifact(
  p_token text,
  p_artifact_id uuid,
  p_event_type text,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_art public.evidence_collection_artifacts%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
  v_allowed boolean;
  v_reason text;
begin
  if p_event_type not in ('view', 'download', 'comment', 'share') then
    raise exception 'Invalid guest event type' using errcode = '22023';
  end if;
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select a.* into v_art from public.evidence_collection_artifacts a where a.id = p_artifact_id;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;

  v_allowed := coalesce(
    v_grant.id is not null
    and v_art.id is not null
    and v_art.collection_id = v_grant.collection_id
    and v_art.facility_id = v_grant.facility_id
    and p_artifact_id = any(v_grant.allowed_artifact_ids)
    and v_grant.revoked_at is null
    and v_grant.expires_at > now()
    and v_grant.accepted_at is not null
    and (not v_grant.step_up_required or v_grant.step_up_verified_at is not null)
    and v_art.withdrawn_at is null
    and v_col.status = 'published'
    and v_org.subscription_status not in ('suspended', 'canceled'), false);
  v_reason := case
    when v_allowed then 'authorized'
    else 'grant expired, revoked, unaccepted, unverified, withdrawn, suspended, or outside scope'
  end;
  if v_grant.id is not null and v_art.id is not null then
    insert into public.evidence_guest_access_events (
      organization_id, facility_id, guest_grant_id, collection_id, artifact_id,
      event_type, request_fingerprint_sha256, reason)
    values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id, v_art.id,
      case when v_allowed then p_event_type else 'denied' end, p_fingerprint, v_reason);
  end if;
  if not v_allowed then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  return jsonb_build_object(
    'artifactId', v_art.id,
    'displayName', v_art.display_name,
    'scope', v_art.artifact_scope,
    'authorized', true);
end;
$function$;
-- CREATE OR REPLACE keeps the original grants (anon, authenticated). The evidence-guest-
-- download edge function calls this through a service-role client to authorize and log a
-- download before signing the stored object, so service_role needs execute as well.
grant execute on function public.authorize_evidence_guest_artifact(text, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Facility managers can see the grants and events for rooms they manage
-- ---------------------------------------------------------------------------

-- assert_phase5_manager lets a facility-assigned facility_manager issue grants, but the
-- shipped SELECT policies hid grant and event rows from them entirely -- a manager could
-- mint a token and then never see or revoke it. Visibility now matches the write
-- surface, scoped to their assigned facilities; org_admin and auditor keep org-wide read.
drop policy evidence_grants_select on public.evidence_guest_grants;
create policy evidence_grants_select on public.evidence_guest_grants
for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id())
     and ((select public.current_role()) in ('org_admin', 'auditor')
          or (select public.current_role()) = 'facility_manager'
             and public.is_assigned_to_facility(facility_id))
);

drop policy evidence_events_select on public.evidence_guest_access_events;
create policy evidence_events_select on public.evidence_guest_access_events
for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id())
     and ((select public.current_role()) in ('org_admin', 'auditor')
          or (select public.current_role()) = 'facility_manager'
             and public.is_assigned_to_facility(facility_id))
);
