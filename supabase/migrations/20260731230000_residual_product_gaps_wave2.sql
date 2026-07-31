-- Residual product gaps wave 2 (2026-07-31)
-- 1) Multi-domain import rollback for credentials/rooms/residents/contacts
-- 2) Credential renewal claim RPC + OCR cron
-- 3) SCORM package register/accept control plane
-- 4) Survey evidence packet selection ledger

-- ---------------------------------------------------------------------------
-- 1. Extended rollback for additional import domains
-- ---------------------------------------------------------------------------
create or replace function public.rollback_data_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
  v_row record;
  v_reverted integer := 0;
  v_blocked integer := 0;
  v_cutoff timestamptz;
  v_target text;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;

  if v_job.domain = 'employees' then
    return public.rollback_employee_import_job(p_job_id);
  end if;

  if v_job.domain not in (
    'training_records', 'credentials', 'rooms', 'residents', 'resident_contacts'
  ) then
    raise exception 'Rollback is not implemented for domain %', v_job.domain
      using errcode = '22023';
  end if;
  if v_job.status <> 'applied' then
    raise exception 'Only an applied, unfinalized import may be rolled back' using errcode = '22023';
  end if;
  if v_job.applied_at is not null and v_job.applied_at < now() - interval '24 hours' then
    raise exception 'The 24-hour rollback window has closed' using errcode = '22023';
  end if;

  v_target := case v_job.domain
    when 'training_records' then 'employee_training_records'
    when 'credentials' then 'employee_credentials'
    when 'rooms' then 'facility_rooms'
    when 'residents' then 'residents'
    when 'resident_contacts' then 'resident_contacts'
  end;

  for v_row in
    select r.id as import_row_id, r.target_id, r.applied_at, r.target_table
    from public.data_import_rows r
    where r.job_id = p_job_id
      and r.status = 'applied'
      and r.proposed_action = 'create'
      and r.target_table = v_target
    order by r.row_number desc
  loop
    begin
      v_cutoff := coalesce(v_row.applied_at, now()) + interval '1 second';
      if v_job.domain = 'training_records' then
        delete from public.employee_training_records t
        where t.id = v_row.target_id and t.organization_id = v_org
          and t.completion_method = 'csv_import'
          and t.created_at >= v_job.created_at and t.updated_at <= v_cutoff;
      elsif v_job.domain = 'credentials' then
        delete from public.employee_credentials c
        where c.id = v_row.target_id and c.organization_id = v_org
          and c.verification_method = 'csv_import'
          and c.created_at >= v_job.created_at and c.updated_at <= v_cutoff;
      elsif v_job.domain = 'rooms' then
        delete from public.facility_beds b where b.room_id = v_row.target_id;
        delete from public.facility_rooms r
        where r.id = v_row.target_id and r.organization_id = v_org
          and r.created_at >= v_job.created_at and r.updated_at <= v_cutoff;
      elsif v_job.domain = 'residents' then
        delete from public.residents r
        where r.id = v_row.target_id and r.organization_id = v_org
          and r.created_at >= v_job.created_at and r.updated_at <= v_cutoff
          and r.status = 'active';
      elsif v_job.domain = 'resident_contacts' then
        delete from public.resident_contacts c
        where c.id = v_row.target_id and c.organization_id = v_org
          and c.created_at >= v_job.created_at and c.updated_at <= v_cutoff;
      end if;

      if found then
        update public.data_import_rows
        set status = 'reverted', reverted_at = now(), updated_at = now()
        where id = v_row.import_row_id;
        v_reverted := v_reverted + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    exception when foreign_key_violation then
      v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.data_import_jobs
  set status = case when v_blocked = 0 then 'rolled_back' else 'applied' end,
      reverted_rows = v_reverted,
      rolled_back_at = case when v_blocked = 0 then now() else null end,
      last_error = case
        when v_blocked > 0 then concat(v_blocked, ' row(s) changed or gained dependents and were not removed.')
        else null
      end,
      updated_at = now()
  where id = p_job_id;

  insert into public.data_import_events (
    organization_id, job_id, event_type, actor_profile_id, details
  ) values (
    v_org, p_job_id, 'rollback_attempted', auth.uid(),
    jsonb_build_object('domain', v_job.domain, 'reverted', v_reverted, 'blocked', v_blocked)
  );

  return jsonb_build_object(
    'jobId', p_job_id,
    'reverted', v_reverted,
    'blocked', v_blocked,
    'status', case when v_blocked = 0 then 'rolled_back' else 'partially_blocked' end
  );
end;
$$;

revoke all on function public.rollback_data_import_job(uuid) from public, anon;
grant execute on function public.rollback_data_import_job(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Credential renewal OCR claim
-- ---------------------------------------------------------------------------
create or replace function public.claim_credential_renewal_submissions(p_limit integer default 10)
returns table (
  id uuid,
  credential_document_id uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted renewal worker may claim submissions'
      using errcode = '42501';
  end if;
  return query
  with claimed as (
    update public.credential_renewal_submissions s
    set status = 'scanning', updated_at = now()
    where s.id in (
      select s2.id from public.credential_renewal_submissions s2
      where s2.status = 'uploaded'
      order by s2.created_at
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked
    )
    returning s.id, s.credential_document_id, s.organization_id
  )
  select claimed.id, claimed.credential_document_id, claimed.organization_id from claimed;
end;
$$;

revoke all on function public.claim_credential_renewal_submissions(integer) from public, anon, authenticated;
grant execute on function public.claim_credential_renewal_submissions(integer) to service_role;

-- Queue age summary for SLA UI
create or replace function public.get_credential_renewal_queue_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if not (
    public.is_platform_admin()
    or (
      v_org is not null
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  ) then
    raise exception 'Not authorized to view renewal queue summary' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'needsReview', count(*) filter (where status = 'needs_review'),
      'uploaded', count(*) filter (where status in ('uploaded', 'scanning')),
      'overdue24h', count(*) filter (
        where status in ('uploaded', 'scanning', 'needs_review')
          and created_at < now() - interval '24 hours'
      ),
      'overdue72h', count(*) filter (
        where status in ('uploaded', 'scanning', 'needs_review')
          and created_at < now() - interval '72 hours'
      ),
      'generatedAt', now()
    )
    from public.credential_renewal_submissions s
    where public.is_platform_admin() or s.organization_id = v_org
  );
end;
$$;

revoke all on function public.get_credential_renewal_queue_summary() from public, anon;
grant execute on function public.get_credential_renewal_queue_summary() to authenticated;

-- Cron registration for process-credential-renewals is optional and environment-specific.
-- Production schedules it via Deploy migrations / ops when edge base URL + cron secret are set.
-- Platform admins can kick the worker with a JWT POST to process-credential-renewals.

-- ---------------------------------------------------------------------------
-- 3. SCORM / learning package authoring control plane
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-packages',
  'learning-packages',
  false,
  104857600,
  array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
)
on conflict (id) do nothing;

create or replace function public.register_learning_package(
  p_course_version_id uuid,
  p_standard_type text,
  p_storage_path text,
  p_content_sha256 text,
  p_compressed_bytes integer,
  p_entry_point text default 'index.html',
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_course_org uuid;
  v_id uuid;
begin
  if p_standard_type not in ('scorm_1_2', 'scorm_2004_4th', 'xapi', 'lti_1_3') then
    raise exception 'Unsupported standard_type' using errcode = '22023';
  end if;
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'content_sha256 must be 64-char hex' using errcode = '22023';
  end if;
  if p_compressed_bytes is null or p_compressed_bytes < 1 or p_compressed_bytes > 104857600 then
    raise exception 'compressed_bytes out of range' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_storage_path, ''))) < 3 then
    raise exception 'storage_path is required' using errcode = '22023';
  end if;

  select c.organization_id into v_course_org
  from public.course_versions v
  join public.courses c on c.id = v.course_id
  where v.id = p_course_version_id;
  if not found then
    raise exception 'Course version not found' using errcode = 'P0002';
  end if;

  v_org := coalesce(p_organization_id, v_course_org, public.current_org_id());
  if not (
    public.is_platform_admin()
    or (
      v_org is not null
      and v_org = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'trainer')
    )
  ) then
    raise exception 'Not authorized to register learning packages' using errcode = '42501';
  end if;

  insert into public.learning_packages (
    organization_id, course_version_id, standard_type, storage_bucket, storage_path,
    content_sha256, compressed_bytes, entry_point, validation_status, manifest,
    created_by
  ) values (
    v_org, p_course_version_id, p_standard_type, 'learning-packages', btrim(p_storage_path),
    p_content_sha256, p_compressed_bytes, nullif(btrim(p_entry_point), ''),
    'pending', '{}'::jsonb, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org, auth.uid(), 'learning_packages', v_id::text, 'package_registered',
    jsonb_build_object(
      'course_version_id', p_course_version_id,
      'standard_type', p_standard_type,
      'storage_path', p_storage_path,
      'content_sha256', p_content_sha256
    )
  );

  return v_id;
end;
$$;

create or replace function public.accept_learning_package(
  p_package_id uuid,
  p_entry_point text default null,
  p_reason text default 'Accepted by content admin after structural review'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg public.learning_packages%rowtype;
begin
  select * into v_pkg from public.learning_packages where id = p_package_id for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (
      v_pkg.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager', 'trainer')
    )
  ) then
    raise exception 'Not authorized to accept learning packages' using errcode = '42501';
  end if;
  if v_pkg.validation_status not in ('pending', 'validating', 'rejected') then
    raise exception 'Package is not in an acceptible state' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Acceptance reason required' using errcode = '22023';
  end if;

  update public.learning_packages set
    validation_status = 'accepted',
    validated_at = now(),
    immutable_at = now(),
    entry_point = coalesce(nullif(btrim(p_entry_point), ''), entry_point, 'index.html'),
    scanner_name = coalesce(scanner_name, 'manual_authoring_v1'),
    scanner_version = coalesce(scanner_version, '1'),
    validation_results = coalesce(validation_results, '{}'::jsonb) || jsonb_build_object(
      'accepted_by', auth.uid(),
      'accepted_at', now(),
      'reason', btrim(p_reason)
    )
  where id = p_package_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_pkg.organization_id, auth.uid(), 'learning_packages', p_package_id::text, 'package_accepted',
    jsonb_build_object('reason', btrim(p_reason))
  );
  return true;
end;
$$;

create or replace function public.quarantine_learning_package(
  p_package_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg public.learning_packages%rowtype;
begin
  select * into v_pkg from public.learning_packages where id = p_package_id for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (
      v_pkg.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  ) then
    raise exception 'Not authorized to quarantine learning packages' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Quarantine reason required' using errcode = '22023';
  end if;
  update public.learning_packages set
    validation_status = 'quarantined',
    validation_results = coalesce(validation_results, '{}'::jsonb) || jsonb_build_object(
      'quarantined_by', auth.uid(),
      'quarantined_at', now(),
      'reason', btrim(p_reason)
    )
  where id = p_package_id;
  return true;
end;
$$;

create or replace function public.list_learning_packages_admin(p_course_version_id uuid default null)
returns setof public.learning_packages
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'trainer')
  ) then
    raise exception 'Not authorized to list learning packages' using errcode = '42501';
  end if;
  return query
  select p.*
  from public.learning_packages p
  where (public.is_platform_admin() or p.organization_id = public.current_org_id() or p.organization_id is null)
    and (p_course_version_id is null or p.course_version_id = p_course_version_id)
  order by p.created_at desc
  limit 200;
end;
$$;

revoke all on function public.register_learning_package(uuid, text, text, text, integer, text, uuid) from public, anon;
revoke all on function public.accept_learning_package(uuid, text, text) from public, anon;
revoke all on function public.quarantine_learning_package(uuid, text) from public, anon;
revoke all on function public.list_learning_packages_admin(uuid) from public, anon;
grant execute on function public.register_learning_package(uuid, text, text, text, integer, text, uuid) to authenticated;
grant execute on function public.accept_learning_package(uuid, text, text) to authenticated;
grant execute on function public.quarantine_learning_package(uuid, text) to authenticated;
grant execute on function public.list_learning_packages_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Survey evidence packet selection ledger
-- ---------------------------------------------------------------------------
create table if not exists public.survey_evidence_packet_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  survey_day_session_id uuid,
  binder_export_job_id uuid references public.binder_export_jobs(id) on delete set null,
  source_type text not null check (source_type in (
    'binder_export', 'evidence_artifact', 'incident', 'work_item', 'policy', 'note'
  )),
  source_id uuid,
  label text not null check (length(btrim(label)) between 1 and 200),
  notes text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists survey_evidence_packet_items_org_idx
  on public.survey_evidence_packet_items(organization_id, created_at desc);

create unique index if not exists survey_evidence_packet_items_dedupe_idx
  on public.survey_evidence_packet_items (
    organization_id,
    source_type,
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(survey_day_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.survey_evidence_packet_items enable row level security;

create policy survey_evidence_packet_items_select on public.survey_evidence_packet_items
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);

create or replace function public.add_survey_evidence_packet_item(
  p_source_type text,
  p_label text,
  p_source_id uuid default null,
  p_facility_id uuid default null,
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null,
  p_notes text default null,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized to build survey evidence packets' using errcode = '42501';
  end if;
  if p_source_type not in ('binder_export', 'evidence_artifact', 'incident', 'work_item', 'policy', 'note') then
    raise exception 'Invalid source_type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_label, ''))) < 1 then
    raise exception 'Label is required' using errcode = '22023';
  end if;

  insert into public.survey_evidence_packet_items (
    organization_id, facility_id, survey_day_session_id, binder_export_job_id,
    source_type, source_id, label, notes, sort_order, created_by
  ) values (
    coalesce(v_org, (select organization_id from public.binder_export_jobs where id = p_binder_export_job_id)),
    p_facility_id, p_survey_day_session_id, p_binder_export_job_id,
    p_source_type, p_source_id, btrim(p_label), nullif(btrim(p_notes), ''),
    coalesce(p_sort_order, 0), auth.uid()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select i.id into v_id from public.survey_evidence_packet_items i
    where i.organization_id = coalesce(v_org, i.organization_id)
      and i.source_type = p_source_type
      and i.source_id is not distinct from p_source_id
      and i.survey_day_session_id is not distinct from p_survey_day_session_id
    limit 1;
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_survey_evidence_packet_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.survey_evidence_packet_items where id = p_item_id;
  if not found then return false; end if;
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public.current_role() in ('org_admin', 'facility_manager', 'auditor'))
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.survey_evidence_packet_items where id = p_item_id;
  return true;
end;
$$;

create or replace function public.list_survey_evidence_packet_items(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns setof public.survey_evidence_packet_items
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select i.*
  from public.survey_evidence_packet_items i
  where (public.is_platform_admin() or i.organization_id = public.current_org_id())
    and (p_survey_day_session_id is null or i.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or i.binder_export_job_id = p_binder_export_job_id)
  order by i.sort_order, i.created_at
  limit 500;
end;
$$;

create or replace function public.assemble_survey_evidence_packet_manifest(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_items jsonb;
  v_manifest jsonb;
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'sourceType', i.source_type,
      'sourceId', i.source_id,
      'label', i.label,
      'notes', i.notes,
      'sortOrder', i.sort_order,
      'binderExportJobId', i.binder_export_job_id
    ) order by i.sort_order, i.created_at
  ), '[]'::jsonb)
  into v_items
  from public.survey_evidence_packet_items i
  where (public.is_platform_admin() or i.organization_id = v_org)
    and (p_survey_day_session_id is null or i.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or i.binder_export_job_id = p_binder_export_job_id);

  v_manifest := jsonb_build_object(
    'assembledAt', now(),
    'assembledBy', auth.uid(),
    'organizationId', v_org,
    'surveyDaySessionId', p_survey_day_session_id,
    'binderExportJobId', p_binder_export_job_id,
    'itemCount', jsonb_array_length(v_items),
    'items', v_items,
    'accessControlNote', 'Packet is selection metadata + existing binder/evidence artifacts; guest grants remain explicit via evidence room.',
    'immutable', true
  );

  if p_survey_day_session_id is not null then
    begin
      perform public.record_survey_day_packet_assembled(p_survey_day_session_id);
    exception when others then
      null;
    end;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org, auth.uid(), 'survey_evidence_packet', coalesce(p_survey_day_session_id, p_binder_export_job_id, gen_random_uuid())::text,
    'packet_assembled', v_manifest
  );

  return v_manifest;
end;
$$;

revoke all on function public.add_survey_evidence_packet_item(text, text, uuid, uuid, uuid, uuid, text, integer) from public, anon;
revoke all on function public.remove_survey_evidence_packet_item(uuid) from public, anon;
revoke all on function public.list_survey_evidence_packet_items(uuid, uuid) from public, anon;
revoke all on function public.assemble_survey_evidence_packet_manifest(uuid, uuid) from public, anon;
grant execute on function public.add_survey_evidence_packet_item(text, text, uuid, uuid, uuid, uuid, text, integer) to authenticated;
grant execute on function public.remove_survey_evidence_packet_item(uuid) to authenticated;
grant execute on function public.list_survey_evidence_packet_items(uuid, uuid) to authenticated;
grant execute on function public.assemble_survey_evidence_packet_manifest(uuid, uuid) to authenticated;

grant select on public.survey_evidence_packet_items to authenticated;
