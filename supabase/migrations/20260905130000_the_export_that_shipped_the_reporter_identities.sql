-- Boundaries that stopped one level short of where the data actually lives (BACKLOG.md I16).
--
-- 1. THE ORGANIZATION EXPORT SHIPPED THE CONFIDENTIAL INTAKE TABLES.
--
-- `get_organization_export_catalog` is, literally, every table in `public` carrying an
-- `organization_id` column. `confidential_incident_details` and `confidential_reporter_identities`
-- carry one. So an org_admin's `request_organization_export` produced a seven-day archive holding
-- the identity of everyone who filed a confidential report -- the one table in this schema whose
-- whole purpose is that the organization cannot see it. Those rows are reviewer-gated behind RPCs
-- that write an access event precisely because reading them is supposed to be a recorded act; the
-- export read them with no reviewer check, no AAL2 and no event.
--
-- A confidential report is filed by a member of staff alleging something about the facility. The
-- person who can request the export is very often the person being reported. This is the finding
-- in this cluster that could hurt a real person.
--
-- The catalogue now excludes `confidential\_%` by name and the exclusion is stated as a rule
-- rather than a list, so a future `confidential_witness_statements` is out by construction. It is
-- deliberately a deny-list on the CATALOGUE rather than a permission check inside the worker: the
-- catalogue is what enumerates the export, so a table missing from it cannot be reached by any
-- caller, including the service role.
--
-- 2. THE SURVEY EVIDENCE PACKET BUCKET STOPPED AT THE ORGANIZATION PREFIX.
--
-- Worth stating precisely, because the recorded finding named two buckets and only one is true.
-- `binder-exports read` is ALREADY facility-scoped -- it joins `binder_export_jobs` and requires
-- `j.facility_ids <@` the manager's assignments. `survey-evidence-packets read` is not: it checks
-- `foldername(name)[1] = current_org_id` and then admits org_admin, auditor and facility_manager
-- alike. A manager assigned to one facility could read another facility's survey packet -- which is
-- the binder for a state inspection, containing exactly what a surveyor asked for.
--
-- The recorded FIX was also wrong, and following it would have broken the bucket: it proposed
-- `is_assigned_to_facility((storage.foldername(name))[2])`, but the packet path is
-- `{orgId}/{sessionId|binderJobId|"packet"}/{sha}.zip` -- segment 2 is a session id, never a
-- facility id, so that test would deny every read. The packets have their own ledger,
-- `survey_evidence_packet_exports`, carrying facility_id and storage_path, so this scopes through
-- that the way the binder policy already does.
--
-- 3. A READ-ONLY ROLE COULD START WORK. `auditor` is documented as read-only in three places
-- (ARCHITECTURE.md, HIPAA_CLINICAL_DATA.md: "auditor read-only", role template carries zero
-- permissions). `request_binder_export` and `request_confidential_intake_escalation` both admit it.
-- Requesting a binder export enqueues a job that renders PHI into a downloadable archive;
-- escalating an intake opens a work item and notifies. Neither is reading. Dropped from both.
--
-- 4. ROTATING A SAFETY-REPORT TOKEN PROTECTED NOTHING. `resolve_safety_report_facility` accepts
-- either the opaque poster token or -- for legacy QR codes -- a facility UUID, and in BOTH cases
-- returns `'token', v_fac.safety_report_token`. Facility UUIDs are not secret; they are in URLs
-- throughout the product. So anyone holding one could ask for, and receive, the facility's current
-- safety-report token, and rotating it after a leak simply issued them the new one. The legacy
-- branch now returns the facility's id and name so an old QR code still resolves, and no token:
-- a legacy link's holder can file a report, which is the point, without being handed the
-- credential that was meant to replace their link.
--
-- 5. A CERTIFICATE VERIFICATION PAGE DISCLOSED AN EXAM SCORE. `verify_certificate` takes a slug
-- and answers with the holder's full name, the course, the issuer, the dates, the credential
-- number -- and `score_percent`, the learner's mark on the final exam. Verification exists so a
-- surveyor or a prospective employer can confirm a credential is real. The score is nobody's
-- business but the learner's and their employer's, and the slug is a bearer token that ends up in
-- emails and PDFs. It is dropped from the payload; every other field a verifier actually needs
-- stays.
--
-- NOT FIXED HERE, and left on the row: throttling the anonymous RPC surface, writing an event on a
-- failed token lookup, the move-in trio's handling of organization suspension, and a cap on
-- move-in guest grant expiry. Each is a real finding and none is a one-line change; they need a
-- rate-limit mechanism this schema does not yet have (`scim_rate_limit` and `client_error_rate_limit`
-- are per-endpoint bespoke), and inventing a sixth one in a migration whose subject is data
-- boundaries would make both harder to review.
--
-- Rollback: restore the five functions and the one policy from 20260725020000, 20260726190000,
-- 20260713220001 and 20260704081318. Nothing here changes stored data.

-- returns TABLE(table_name text), not setof text: export_organization_table selects
-- `c.table_name` from it, so a bare setof would rename the column and break every export.
create or replace function public.get_organization_export_catalog()
returns table(table_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'organization_id'
        and a.attnum > 0 and not a.attisdropped
    )
    -- Confidential intake is reviewer-gated behind RPCs that write an access event. An export is
    -- neither a reviewer nor an event, and the person who can request one is often the person a
    -- report is about. Excluded by name pattern so a later confidential_* table is out by
    -- construction rather than by somebody remembering.
    and c.relname not like 'confidential\_%'
  order by c.relname;
$$;

comment on function public.get_organization_export_catalog() is
  'Tables an organization export may read: every public table with an organization_id EXCEPT '
  'confidential_* , which are reviewer-gated with access events and must not leave through a bulk '
  'archive (BACKLOG.md I16).';

-- Managers see the packets for facilities they are assigned to, through the packet ledger -- the
-- same shape as the binder-exports policy, and for the same reason.
drop policy if exists "survey-evidence-packets read" on storage.objects;
create policy "survey-evidence-packets read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'survey-evidence-packets'
    and (
      public.is_platform_admin()
      or exists (
        select 1
        from public.survey_evidence_packet_exports p
        where p.storage_bucket = storage.objects.bucket_id
          and p.storage_path = storage.objects.name
          and p.organization_id = (select public.current_org_id())
          and (
            (select public."current_role"()) in ('org_admin', 'auditor')
            or (
              (select public."current_role"()) = 'facility_manager'
              and public.is_assigned_to_facility(p.facility_id)
            )
          )
      )
    )
  );

-- A legacy QR code still resolves to its facility; it no longer collects the current token.
create or replace function public.resolve_safety_report_facility(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_fac public.facilities%rowtype;
  v_matched_by_token boolean := false;
begin
  if length(v_token) < 8 then
    return null;
  end if;

  -- Preferred: opaque non-enumerable token printed on facility posters / QR codes.
  select * into v_fac
  from public.facilities f
  where f.safety_report_token = v_token
  limit 1;
  v_matched_by_token := found;

  -- Legacy QR links still carry the facility UUID; resolve name without listing facilities.
  if not found and v_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_fac
    from public.facilities f
    where f.id = v_token::uuid
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'facilityId', v_fac.id,
    'facilityName', v_fac.name,
    -- Only a caller who already held the token gets it back. Facility UUIDs appear in URLs all
    -- over the product, so returning it on the legacy branch handed the credential to anyone who
    -- had a link -- and handed them the NEW one after every rotation.
    'token', case when v_matched_by_token then v_fac.safety_report_token else null end
  );
end;
$$;

comment on function public.resolve_safety_report_facility(text) is
  'Resolves a safety-report poster token, or a legacy facility UUID, to the facility. Returns the '
  'current token only to a caller who already presented it -- never on the legacy UUID branch, or '
  'rotation would protect nothing.';

-- auditor is documented read-only in three places; requesting a binder export enqueues a job that
-- renders PHI into a downloadable archive. Otherwise byte-identical to the deployed definition.
create or replace function public.request_binder_export(
  p_organization_id uuid default null,
  p_facility_ids uuid[] default null
) returns public.binder_export_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles%rowtype;
  v_org uuid;
  v_scope uuid[] := '{}'::uuid[];
  v_job public.binder_export_jobs%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or not v_profile.is_active
     or v_profile.role not in ('platform_admin', 'org_admin', 'facility_manager') then
    raise exception 'Binder export is outside caller scope' using errcode = '42501';
  end if;

  if v_profile.role = 'platform_admin' then
    v_org := coalesce(p_organization_id, v_profile.organization_id);
  else
    v_org := v_profile.organization_id;
  end if;
  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'A valid organization is required' using errcode = '22023';
  end if;

  if v_profile.role = 'facility_manager' then
    -- Managers are always auto-scoped to their assigned facilities.
    select coalesce(array_agg(fa.facility_id), '{}'::uuid[]) into v_scope
    from public.facility_assignments fa
    join public.facilities f on f.id = fa.facility_id
    where fa.profile_id = v_profile.id and f.organization_id = v_org;
    if coalesce(array_length(v_scope, 1), 0) = 0 then
      raise exception 'No facility assignments found for this manager' using errcode = '42501';
    end if;
  elsif p_facility_ids is not null and coalesce(array_length(p_facility_ids, 1), 0) > 0 then
    select coalesce(array_agg(distinct f.id), '{}'::uuid[]) into v_scope
    from public.facilities f
    where f.id = any(p_facility_ids) and f.organization_id = v_org;
    if coalesce(array_length(v_scope, 1), 0) <> (select count(distinct u) from unnest(p_facility_ids) u) then
      raise exception 'Facility scope does not belong to the organization' using errcode = '22023';
    end if;
  end if;

  -- One active export per requester per organization and scope: repeated clicks return
  -- the in-flight job instead of stacking duplicate renders, while a request with a
  -- different facility scope still starts its own export.
  select j.* into v_job
  from public.binder_export_jobs j
  where j.organization_id = v_org
    and j.requested_by = v_profile.id
    and j.facility_ids = v_scope
    and j.status in ('pending', 'processing')
  order by j.requested_at desc
  limit 1;
  if v_job.id is not null then
    return v_job;
  end if;

  insert into public.binder_export_jobs (organization_id, requested_by, facility_ids)
  values (v_org, v_profile.id, v_scope)
  returning * into v_job;
  return v_job;
end;
$fn$;

-- Same role, same reason: escalating an intake opens a work item and notifies.
create or replace function public.request_confidential_intake_escalation(
  p_intake_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v public.confidential_incident_intakes%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_work uuid;
  v_dedupe text;
begin
  select * into v
  from public.confidential_incident_intakes
  where id = p_intake_id
  for update;

  if not found then
    raise exception 'Confidential intake not found' using errcode = 'P0002';
  end if;

  if length(v_reason) < 5 then
    raise exception 'An escalation reason is required' using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      public.current_org_id() = v.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (
        public.current_role() = 'org_admin'
        or public.is_assigned_to_facility(v.facility_id)
      )
    )
  ) then
    raise exception 'Confidential escalation is outside caller scope'
      using errcode = '42501';
  end if;

  v_dedupe := 'confidential-escalation:' || v.id::text;

  select id into v_work
  from public.work_items
  where organization_id = v.organization_id
    and deduplication_key = v_dedupe;

  if not found then
    insert into public.work_items (
      organization_id, facility_id, source_type, source_id, deduplication_key,
      title, description, priority, due_at, state, created_by
    ) values (
      v.organization_id,
      v.facility_id,
      'incident',
      v.id,
      v_dedupe,
      'Confidential report escalation: ' || v.intake_number,
      'Facility staff requested org-admin review of protected details. Reason: ' || v_reason,
      case when v.severity in ('critical', 'high') then 'high' else 'normal' end,
      now() + interval '4 hours',
      'open',
      auth.uid()
    )
    returning id into v_work;

    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type, resulting_state,
      actor_profile_id, reason
    ) values (
      v.organization_id, v.facility_id, v_work, 'created', 'open',
      auth.uid(), 'Confidential intake escalation requested'
    );

    if v.triage_work_item_id is null then
      update public.confidential_incident_intakes
      set triage_work_item_id = v_work,
          updated_at = now()
      where id = v.id;
    end if;
  end if;

  insert into public.confidential_incident_access_events (
    organization_id, facility_id, intake_id, actor_profile_id, event_type, purpose
  ) values (
    v.organization_id,
    v.facility_id,
    v.id,
    auth.uid(),
    'disclose',
    'Escalation requested: ' || v_reason
  );

  return jsonb_build_object(
    'workItemId', v_work,
    'intakeId', v.id,
    'intakeNumber', v.intake_number
  );
end;
$fn$;

-- Verification confirms a credential is real. It does not report the holder's mark: the slug is a
-- bearer token that travels in emails and printed PDFs, and an exam score is between the learner
-- and their employer. Signature changes, so the column goes rather than being nulled.
drop function if exists public.verify_certificate(text);
create or replace function public.verify_certificate(p_slug text)
returns table(
  employee_name text,
  course_title text,
  organization_name text,
  issued_at timestamptz,
  expires_at timestamptz,
  is_valid boolean,
  course_code text,
  course_version text,
  credential_number text,
  training_provider text,
  provider_credential text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    (e.first_name || ' ' || e.last_name)::text,
    c.title,
    o.name,
    cert.issued_at,
    cert.expires_at,
    (cert.expires_at is null or cert.expires_at > now()),
    c.catalog_code,
    cv.title_version,
    cert.credential_number,
    -- Switched on provider_snapshot_at, NOT on whether each field happens to be null. A
    -- coalesce per field would read a legitimately empty credential as "no snapshot" and serve
    -- whatever the live profile says today -- so adding a credential to the profile would
    -- retroactively put one on certificates issued without it, which is the exact restatement
    -- this migration exists to stop. pp is consulted only for rows issued before snapshotting.
    case when cert.provider_snapshot_at is not null
         then cert.training_provider else pp.provider_full_name end,
    case when cert.provider_snapshot_at is not null
         then cert.provider_credential else pp.credential end
  from public.certificates cert
  join public.employees     e on e.id = cert.employee_id
  join public.courses       c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  left join public.course_provider_profiles pp on pp.course_id = c.id
  left join lateral (
    -- The version the learner actually took, not whatever the course points at today: a
    -- certificate issued in 2026 must keep saying 2026.1 after 2027.1 publishes.
    select coalesce(cvv.version_label, 'v' || cvv.version_number::text) as title_version
    from public.course_assignments ca
    join public.course_versions cvv on cvv.id = ca.course_version_id
    where ca.id = cert.course_assignment_id
  ) cv on true
  where cert.slug = p_slug;
$fn$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;

comment on function public.verify_certificate(text) is
  'Public certificate verification by slug. Deliberately excludes the final exam score: the slug is '
  'a bearer token and the mark is not what a verifier needs (BACKLOG.md I16).';
