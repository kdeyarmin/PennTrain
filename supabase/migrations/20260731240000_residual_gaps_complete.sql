-- Residual gaps complete (2026-07-31)
-- 1) Assessments import rollback
-- 2) Survey evidence packet zip exports + guest grants
-- 3) Credential renewal OCR cron schedule
-- 4) Audit classifications

-- ---------------------------------------------------------------------------
-- 1. Assessments domain on rollback_data_import_job
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
    'training_records', 'credentials', 'rooms', 'residents', 'resident_contacts', 'assessments'
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
    when 'assessments' then 'resident_assessment_forms'
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
      elsif v_job.domain = 'assessments' then
        -- Only roll back draft import shells that still carry the import provenance marker.
        delete from public.resident_assessment_forms f
        where f.id = v_row.target_id and f.organization_id = v_org
          and f.status = 'draft'
          and f.content ? 'csv_import'
          and f.created_at >= v_job.created_at and f.updated_at <= v_cutoff;
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
-- 2. Survey evidence packet zip exports + guest grants
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-evidence-packets',
  'survey-evidence-packets',
  false,
  209715200,
  array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
)
on conflict (id) do nothing;

drop policy if exists "survey-evidence-packets read" on storage.objects;
create policy "survey-evidence-packets read" on storage.objects
for select to authenticated using (
  bucket_id = 'survey-evidence-packets'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
    )
  )
);

drop policy if exists "survey-evidence-packets insert" on storage.objects;
create policy "survey-evidence-packets insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'survey-evidence-packets'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  )
);

create table if not exists public.survey_evidence_packet_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  survey_day_session_id uuid,
  binder_export_job_id uuid references public.binder_export_jobs(id) on delete set null,
  storage_bucket text not null default 'survey-evidence-packets',
  storage_path text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  item_count integer not null default 0,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('building', 'ready', 'failed', 'revoked')),
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists survey_evidence_packet_exports_org_idx
  on public.survey_evidence_packet_exports(organization_id, created_at desc);

alter table public.survey_evidence_packet_exports enable row level security;

drop policy if exists survey_evidence_packet_exports_select on public.survey_evidence_packet_exports;
create policy survey_evidence_packet_exports_select on public.survey_evidence_packet_exports
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);

create table if not exists public.survey_packet_guest_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  packet_export_id uuid not null references public.survey_evidence_packet_exports(id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  guest_label text not null check (length(btrim(guest_label)) between 1 and 120),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revocation_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_downloaded_at timestamptz,
  download_count integer not null default 0,
  check (expires_at > created_at)
);

create index if not exists survey_packet_guest_grants_export_idx
  on public.survey_packet_guest_grants(packet_export_id, created_at desc);

alter table public.survey_packet_guest_grants enable row level security;

drop policy if exists survey_packet_guest_grants_select on public.survey_packet_guest_grants;
create policy survey_packet_guest_grants_select on public.survey_packet_guest_grants
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);

create or replace function public.record_survey_evidence_packet_export(
  p_facility_id uuid,
  p_survey_day_session_id uuid,
  p_binder_export_job_id uuid,
  p_storage_path text,
  p_content_sha256 text,
  p_byte_size bigint,
  p_item_count integer,
  p_manifest jsonb
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
    or public.current_role() in ('org_admin', 'facility_manager')
  ) then
    raise exception 'Not authorized to package survey evidence' using errcode = '42501';
  end if;
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content hash' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 then
    raise exception 'Invalid package size' using errcode = '22023';
  end if;

  insert into public.survey_evidence_packet_exports (
    organization_id, facility_id, survey_day_session_id, binder_export_job_id,
    storage_path, content_sha256, byte_size, item_count, manifest, status, created_by
  ) values (
    coalesce(v_org, (select organization_id from public.binder_export_jobs where id = p_binder_export_job_id)),
    p_facility_id, p_survey_day_session_id, p_binder_export_job_id,
    btrim(p_storage_path), lower(p_content_sha256), p_byte_size, coalesce(p_item_count, 0),
    coalesce(p_manifest, '{}'::jsonb), 'ready', auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    coalesce(v_org, (select organization_id from public.survey_evidence_packet_exports where id = v_id)),
    auth.uid(), 'survey_evidence_packet_export', v_id::text, 'packet_packaged',
    jsonb_build_object(
      'byteSize', p_byte_size,
      'itemCount', p_item_count,
      'contentSha256', p_content_sha256,
      'storagePath', p_storage_path
    )
  );

  return v_id;
end;
$$;

create or replace function public.list_survey_evidence_packet_exports(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns setof public.survey_evidence_packet_exports
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
  select e.*
  from public.survey_evidence_packet_exports e
  where (public.is_platform_admin() or e.organization_id = public.current_org_id())
    and (p_survey_day_session_id is null or e.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or e.binder_export_job_id = p_binder_export_job_id)
  order by e.created_at desc
  limit 50;
end;
$$;

create or replace function public.issue_survey_packet_guest_grant(
  p_packet_export_id uuid,
  p_guest_label text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.survey_evidence_packet_exports%rowtype;
  v_raw text;
  v_id uuid;
begin
  select * into v_export from public.survey_evidence_packet_exports where id = p_packet_export_id;
  if not found or v_export.status <> 'ready' then
    raise exception 'Packet export not found or not ready' using errcode = 'P0002';
  end if;
  if not (
    public.is_platform_admin()
    or (
      v_export.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  ) then
    raise exception 'Not authorized to issue packet guest grants' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_guest_label, ''))) < 1 then
    raise exception 'Guest label is required' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception 'Guest grant expiration must be within 90 days' using errcode = '22023';
  end if;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.survey_packet_guest_grants (
    organization_id, facility_id, packet_export_id, token_sha256, guest_label, expires_at, created_by
  ) values (
    v_export.organization_id, v_export.facility_id, v_export.id,
    encode(extensions.digest(convert_to(v_raw, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_expires_at, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_export.organization_id, auth.uid(), 'survey_packet_guest_grant', v_id::text, 'grant_issued',
    jsonb_build_object('packetExportId', p_packet_export_id, 'guestLabel', btrim(p_guest_label), 'expiresAt', p_expires_at)
  );

  return jsonb_build_object(
    'grantId', v_id,
    'token', v_raw,
    'expiresAt', p_expires_at,
    'packetExportId', p_packet_export_id
  );
end;
$$;

create or replace function public.revoke_survey_packet_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.survey_packet_guest_grants%rowtype;
begin
  select * into v_grant from public.survey_packet_guest_grants where id = p_grant_id for update;
  if not found then return false; end if;
  if not (
    public.is_platform_admin()
    or (
      v_grant.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Revocation reason required' using errcode = '22023';
  end if;
  update public.survey_packet_guest_grants
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = btrim(p_reason)
  where id = p_grant_id and revoked_at is null;
  return true;
end;
$$;

-- Service-role only: resolve guest token to package metadata for the download edge function.
create or replace function public.resolve_survey_packet_guest_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_grant public.survey_packet_guest_grants%rowtype;
  v_export public.survey_evidence_packet_exports%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the packet guest download worker may resolve tokens'
      using errcode = '42501';
  end if;
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_token');
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select * into v_grant from public.survey_packet_guest_grants where token_sha256 = v_hash;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_token');
  end if;
  if v_grant.revoked_at is not null then
    return jsonb_build_object('allowed', false, 'reason', 'revoked');
  end if;
  if v_grant.expires_at <= now() then
    return jsonb_build_object('allowed', false, 'reason', 'expired');
  end if;
  select * into v_export from public.survey_evidence_packet_exports where id = v_grant.packet_export_id;
  if not found or v_export.status <> 'ready' then
    return jsonb_build_object('allowed', false, 'reason', 'package_unavailable');
  end if;

  update public.survey_packet_guest_grants
  set last_downloaded_at = now(), download_count = download_count + 1
  where id = v_grant.id;

  return jsonb_build_object(
    'allowed', true,
    'grantId', v_grant.id,
    'guestLabel', v_grant.guest_label,
    'organizationId', v_grant.organization_id,
    'facilityId', v_grant.facility_id,
    'packetExportId', v_export.id,
    'storageBucket', v_export.storage_bucket,
    'storagePath', v_export.storage_path,
    'contentSha256', v_export.content_sha256,
    'byteSize', v_export.byte_size
  );
end;
$$;

revoke all on function public.record_survey_evidence_packet_export(uuid, uuid, uuid, text, text, bigint, integer, jsonb) from public, anon;
revoke all on function public.list_survey_evidence_packet_exports(uuid, uuid) from public, anon;
revoke all on function public.issue_survey_packet_guest_grant(uuid, text, timestamptz) from public, anon;
revoke all on function public.revoke_survey_packet_guest_grant(uuid, text) from public, anon;
revoke all on function public.resolve_survey_packet_guest_token(text) from public, anon, authenticated;
grant execute on function public.record_survey_evidence_packet_export(uuid, uuid, uuid, text, text, bigint, integer, jsonb) to authenticated;
grant execute on function public.list_survey_evidence_packet_exports(uuid, uuid) to authenticated;
grant execute on function public.issue_survey_packet_guest_grant(uuid, text, timestamptz) to authenticated;
grant execute on function public.revoke_survey_packet_guest_grant(uuid, text) to authenticated;
grant execute on function public.resolve_survey_packet_guest_token(text) to service_role;
grant select on public.survey_evidence_packet_exports, public.survey_packet_guest_grants to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Credential renewal OCR cron (every 10 minutes)
-- ---------------------------------------------------------------------------
select cron.unschedule('process-credential-renewals')
where exists (select 1 from cron.job where jobname = 'process-credential-renewals');

select cron.schedule(
  'process-credential-renewals',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/process-credential-renewals',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')
       ),
       body := '{}'::jsonb
     ); $$
);

-- ---------------------------------------------------------------------------
-- 4. Audit classification
-- ---------------------------------------------------------------------------
insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
) values
  (
    'survey_evidence_packet_exports',
    'row_trigger',
    true,
    'Immutable survey packet package metadata (checksum, storage, session/binder links) is survey evidence (20260731240000)'
  ),
  (
    'survey_packet_guest_grants',
    'row_trigger',
    true,
    'Surveyor guest grant tokens and download activity for survey packets are access-control evidence (20260731240000)'
  )
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create trigger survey_evidence_packet_exports_audit
after insert or update or delete on public.survey_evidence_packet_exports
for each row execute function public.audit_log_trigger();

create trigger survey_packet_guest_grants_audit
after insert or update or delete on public.survey_packet_guest_grants
for each row execute function public.audit_log_trigger();

-- Watch the credential renewal OCR cron so /admin/system-jobs and the watchdog see it.
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values (
  'process-credential-renewals',
  'Credential renewal OCR',
  'Claims uploaded credential renewal packages and records advisory OCR extraction for human review (never auto-approves).',
  'sql_cron',
  'process-credential-renewals',
  interval '10 minutes',
  interval '45 minutes',
  false,
  'automatic',
  '/app/employees'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  updated_at = now();
