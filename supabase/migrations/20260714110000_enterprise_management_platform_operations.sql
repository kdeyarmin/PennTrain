-- CareBase Enterprise Management and Platform Operations foundation.
-- Adds RLS-correct executive summaries, reproducible snapshots, integration/import
-- recovery metadata, and guided setup status without exposing provider secrets.

create table if not exists public.enterprise_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  as_of timestamptz not null default now(),
  generated_by uuid references public.profiles(id),
  metric_definitions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  source_reconciliation jsonb not null default '{}'::jsonb,
  checksum text not null,
  created_at timestamptz not null default now(),
  constraint enterprise_analytics_snapshots_period_ck check (period_end >= period_start)
);

create index if not exists enterprise_analytics_snapshots_scope_idx on public.enterprise_analytics_snapshots(organization_id, facility_id, period_end desc);
create unique index if not exists enterprise_analytics_snapshots_checksum_idx on public.enterprise_analytics_snapshots(organization_id, checksum);

create or replace function public.protect_enterprise_analytics_snapshot_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Enterprise analytics snapshots are immutable historical evidence' using errcode = '55000';
end;
$$;

drop trigger if exists protect_enterprise_analytics_snapshot_history on public.enterprise_analytics_snapshots;
create trigger protect_enterprise_analytics_snapshot_history
  before update or delete on public.enterprise_analytics_snapshots
  for each row execute function public.protect_enterprise_analytics_snapshot_history();

create table if not exists public.enterprise_integration_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  provider_key text not null,
  contract_key text not null,
  contract_version text not null,
  direction text not null check (direction in ('import','export','webhook_in','webhook_out','sftp_import','sftp_export')),
  object_type text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed','dead_letter','cancelled')),
  idempotency_key text not null,
  external_batch_id text,
  requested_by uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retry_limit integer not null default 5 check (retry_limit between 0 and 25),
  source_count integer not null default 0 check (source_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  mapped_count integer not null default 0 check (mapped_count >= 0),
  validation_error_count integer not null default 0 check (validation_error_count >= 0),
  mapping_error_count integer not null default 0 check (mapping_error_count >= 0),
  dead_letter_reason text,
  provider_status jsonb not null default '{}'::jsonb,
  reconciliation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_key, idempotency_key)
);

create index if not exists enterprise_integration_jobs_ops_idx on public.enterprise_integration_jobs(organization_id, status, last_attempt_at desc);
drop trigger if exists set_updated_at on public.enterprise_integration_jobs;
create trigger set_updated_at before update on public.enterprise_integration_jobs
  for each row execute function public.set_updated_at();

create table if not exists public.enterprise_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  import_type text not null check (import_type in ('facilities','employees','residents','assets','inventory','training','credentials','custom')),
  status text not null default 'preview' check (status in ('preview','validated','running','succeeded','partial','failed','cancelled')),
  template_version text not null,
  original_filename text,
  requested_by uuid references public.profiles(id),
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  unmapped_rows integer not null default 0 check (unmapped_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  applied_rows integer not null default 0 check (applied_rows >= 0),
  validation_summary jsonb not null default '{}'::jsonb,
  mapping_summary jsonb not null default '{}'::jsonb,
  reconciliation jsonb not null default '{}'::jsonb,
  error_report_document_id uuid,
  idempotency_key text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, import_type, idempotency_key)
);

create index if not exists enterprise_import_batches_ops_idx on public.enterprise_import_batches(organization_id, status, created_at desc);
drop trigger if exists set_updated_at on public.enterprise_import_batches;
create trigger set_updated_at before update on public.enterprise_import_batches
  for each row execute function public.set_updated_at();

alter table public.enterprise_analytics_snapshots enable row level security;
alter table public.enterprise_integration_jobs enable row level security;
alter table public.enterprise_import_batches enable row level security;

do $$ begin
  create policy enterprise_analytics_snapshots_select on public.enterprise_analytics_snapshots for select using (
    public.is_platform_admin() or (organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager','auditor') and (facility_id is null or public.is_assigned_to_facility(facility_id)))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy enterprise_integration_jobs_select on public.enterprise_integration_jobs for select using (
    public.is_platform_admin() or (organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and (facility_id is null or public.is_assigned_to_facility(facility_id)))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy enterprise_import_batches_select on public.enterprise_import_batches for select using (
    public.is_platform_admin() or (organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and (facility_id is null or public.is_assigned_to_facility(facility_id)))
  );
exception when duplicate_object then null; end $$;

grant select on public.enterprise_analytics_snapshots, public.enterprise_integration_jobs, public.enterprise_import_batches to authenticated;
revoke all on function public.protect_enterprise_analytics_snapshot_history() from public, anon, authenticated;

create or replace function public.get_enterprise_operations_control_plane(p_organization_id uuid default null, p_facility_id uuid default null, p_period_start date default (current_date - 30), p_period_end date default current_date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := coalesce(p_organization_id, public.current_org_id());
  v_role text := public.current_role();
  v_facilities integer := 0;
  v_metrics jsonb;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization scope is required' using errcode='42501';
  end if;
  if not public.is_platform_admin() and (v_org is distinct from public.current_org_id() or v_role not in ('org_admin','facility_manager','auditor')) then
    raise exception 'Not authorized for enterprise operations summary' using errcode='42501';
  end if;
  if p_facility_id is not null and not (public.is_platform_admin() or public.is_assigned_to_facility(p_facility_id)) then
    raise exception 'Not authorized for facility summary' using errcode='42501';
  end if;

  select count(*) into v_facilities from public.facilities f where (v_org is null or f.organization_id = v_org) and (p_facility_id is null or f.id = p_facility_id);

  v_metrics := jsonb_build_object(
    'census', jsonb_build_object('value', coalesce((select count(*) from public.residents r where (v_org is null or r.organization_id = v_org) and (p_facility_id is null or r.facility_id = p_facility_id) and coalesce(r.status,'active') = 'active'),0), 'denominator', null, 'dateBasis', 'current status', 'includedStatuses', jsonb_build_array('active'), 'source', '/app/residents'),
    'trainingCompliance', jsonb_build_object('value', coalesce((select count(*) from public.employee_training_records etr join public.employees e on e.id = etr.employee_id where (v_org is null or e.organization_id = v_org) and (p_facility_id is null or e.facility_id = p_facility_id) and etr.status = 'compliant'),0), 'denominator', greatest(coalesce((select count(*) from public.employee_training_records etr join public.employees e on e.id = etr.employee_id where (v_org is null or e.organization_id = v_org) and (p_facility_id is null or e.facility_id = p_facility_id)),0),1), 'dateBasis', 'training record due/completed date', 'source', '/app/training-matrix'),
    'openIncidents', jsonb_build_object('value', coalesce((select count(*) from public.incidents i where (v_org is null or i.organization_id = v_org) and (p_facility_id is null or i.facility_id = p_facility_id) and coalesce(i.status,'open') not in ('closed','resolved')),0), 'denominator', null, 'dateBasis', 'incident created date', 'excludedStatuses', jsonb_build_array('closed','resolved'), 'source', '/app/incidents'),
    'openComplaints', jsonb_build_object('value', coalesce((select count(*) from public.complaints c where (v_org is null or c.organization_id = v_org) and (p_facility_id is null or c.facility_id = p_facility_id) and coalesce(c.status,'open') not in ('closed','resolved')),0), 'denominator', null, 'dateBasis', 'complaint received/created date', 'source', '/app/complaints'),
    'maintenanceRisk', jsonb_build_object('value', coalesce((select count(*) from public.work_orders w where (v_org is null or w.organization_id = v_org) and (p_facility_id is null or w.facility_id = p_facility_id) and coalesce(w.status,'open') not in ('verified','canceled')),0), 'denominator', null, 'dateBasis', 'work order due/created date', 'source', '/app/maintenance'),
    'notificationFailures', jsonb_build_object('value', coalesce((select count(*) from public.notification_deliveries nd where (v_org is null or nd.organization_id = v_org) and coalesce(nd.status,'') = 'failed'),0), 'denominator', null, 'dateBasis', 'last delivery attempt', 'source', '/admin/notifications')
  );

  return jsonb_build_object(
    'organizationId', v_org,
    'facilityId', p_facility_id,
    'facilityScope', case when p_facility_id is null then 'organization' else 'facility' end,
    'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
    'dataFreshness', now(),
    'facilityCount', v_facilities,
    'metricDefinitions', jsonb_build_array(
      jsonb_build_object('key','census','numerator','Active residents','denominator','Not percentage based','dateBasis','Current resident status','source','residents'),
      jsonb_build_object('key','trainingCompliance','numerator','Completed training records','denominator','All scoped training records; denominator is never allowed below 1','dateBasis','Training due/completion dates','source','employee_training_records'),
      jsonb_build_object('key','openIncidents','numerator','Incidents not closed/resolved','denominator','Not percentage based','dateBasis','Incident created date','source','incidents'),
      jsonb_build_object('key','notificationFailures','numerator','Failed/dead-letter deliveries','denominator','Not percentage based','dateBasis','Last delivery attempt','source','notification_deliveries')
    ),
    'metrics', v_metrics,
    'recentSnapshots', coalesce((select jsonb_agg(to_jsonb(s) order by s.as_of desc) from (select id, facility_id, period_start, period_end, as_of, checksum from public.enterprise_analytics_snapshots where (v_org is null or organization_id = v_org) and (p_facility_id is null or facility_id = p_facility_id) order by as_of desc limit 10) s), '[]'::jsonb),
    'integrationRecovery', coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at desc) from (select id, provider_key, direction, object_type, status, attempt_count, retry_limit, last_attempt_at, last_success_at, source_count, accepted_count, rejected_count, validation_error_count, mapping_error_count, dead_letter_reason from public.enterprise_integration_jobs where (v_org is null or organization_id = v_org) and status in ('failed','partial','dead_letter','running') order by created_at desc limit 20) j), '[]'::jsonb),
    'importRecovery', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (select id, import_type, status, total_rows, valid_rows, duplicate_rows, unmapped_rows, failed_rows, applied_rows, created_at from public.enterprise_import_batches where (v_org is null or organization_id = v_org) and status in ('preview','validated','running','partial','failed') order by created_at desc limit 20) b), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_enterprise_analytics_snapshot(p_organization_id uuid default null, p_facility_id uuid default null, p_period_start date default (current_date - 30), p_period_end date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_org uuid := coalesce(p_organization_id, public.current_org_id());
  v_checksum text;
  v_id uuid;
  v_existing_id uuid;
begin
  if v_org is null then
    raise exception 'Organization scope is required to save a snapshot' using errcode = '42501';
  end if;
  if not public.is_platform_admin() and (v_org is distinct from public.current_org_id() or public.current_role() not in ('org_admin','facility_manager')) then
    raise exception 'Not authorized to save enterprise analytics snapshots' using errcode = '42501';
  end if;
  if p_facility_id is not null and not (public.is_platform_admin() or public.is_assigned_to_facility(p_facility_id)) then
    raise exception 'Not authorized to save this facility snapshot' using errcode = '42501';
  end if;

  v_summary := public.get_enterprise_operations_control_plane(v_org, p_facility_id, p_period_start, p_period_end);
  v_checksum := encode(extensions.digest(convert_to(v_summary::text, 'utf8'), 'sha256'), 'hex');

  select id into v_existing_id
  from public.enterprise_analytics_snapshots
  where organization_id = v_org and checksum = v_checksum;

  if v_existing_id is not null then
    return jsonb_build_object('snapshotId', v_existing_id, 'checksum', v_checksum, 'asOf', v_summary->>'dataFreshness', 'reused', true);
  end if;

  insert into public.enterprise_analytics_snapshots(organization_id, facility_id, period_start, period_end, generated_by, metric_definitions, metrics, source_reconciliation, checksum)
  values(v_org, p_facility_id, p_period_start, p_period_end, auth.uid(), v_summary->'metricDefinitions', v_summary->'metrics', jsonb_build_object('generatedFrom','get_enterprise_operations_control_plane','asOf',v_summary->>'dataFreshness'), v_checksum)
  returning id into v_id;

  insert into public.audit_logs(organization_id, facility_id, actor_profile_id, entity_type, entity_id, action, new_values, source, reason, metadata)
  values(v_org, p_facility_id, auth.uid(), 'enterprise_analytics_snapshots', v_id::text, 'enterprise_snapshot_saved', jsonb_build_object('checksum', v_checksum, 'periodStart', p_period_start, 'periodEnd', p_period_end), 'enterprise_operations_control_plane', 'Saved executive analytics snapshot', jsonb_build_object('snapshotId', v_id));

  return jsonb_build_object('snapshotId', v_id, 'checksum', v_checksum, 'asOf', v_summary->>'dataFreshness', 'reused', false);
end;
$$;

create or replace function public.get_guided_org_setup_status(p_organization_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_org uuid := coalesce(p_organization_id, public.current_org_id());
begin
  if not public.is_platform_admin() and (v_org is distinct from public.current_org_id() or public.current_role() not in ('org_admin','facility_manager')) then
    raise exception 'Not authorized for setup status' using errcode='42501';
  end if;
  return jsonb_build_object('organizationId', v_org, 'collectedAt', now(), 'items', jsonb_build_array(
    jsonb_build_object('key','organization_profile','label','Organization profile','complete', exists(select 1 from public.organizations o where o.id=v_org and length(coalesce(o.name,'')) > 0), 'why','Defines tenant identity for reports and support.'),
    jsonb_build_object('key','facility','label','First facility','complete', exists(select 1 from public.facilities f where f.organization_id=v_org), 'why','Facilities scope residents, staff, alerts, and reports.'),
    jsonb_build_object('key','users','label','Users invited','complete', exists(select 1 from public.profiles p where p.organization_id=v_org), 'why','Role-based access is required before operational workflows.'),
    jsonb_build_object('key','employees','label','Employee roster or import','complete', exists(select 1 from public.employees e where e.organization_id=v_org), 'why','Training, scheduling, and qualifications depend on employee records.'),
    jsonb_build_object('key','training','label','Training types','complete', exists(select 1 from public.training_types t where t.organization_id=v_org), 'why','Compliance dashboards need training requirements.'),
    jsonb_build_object('key','residents','label','First resident','complete', exists(select 1 from public.residents r where r.organization_id=v_org), 'why','Resident workflows stay staff-managed; no external portal is created.'),
    jsonb_build_object('key','policies','label','Policy upload','complete', exists(select 1 from public.policy_documents p where p.organization_id=v_org), 'why','Policy acknowledgement references exact versions.'),
    jsonb_build_object('key','reports','label','Report settings or saved report','complete', exists(select 1 from public.saved_report_definitions s where s.organization_id=v_org), 'why','Executives need reproducible saved views and scheduled reports.')
  ));
end;
$$;

revoke all on function public.get_enterprise_operations_control_plane(uuid, uuid, date, date), public.save_enterprise_analytics_snapshot(uuid, uuid, date, date), public.get_guided_org_setup_status(uuid) from public;
grant execute on function public.get_enterprise_operations_control_plane(uuid, uuid, date, date), public.save_enterprise_analytics_snapshot(uuid, uuid, date, date), public.get_guided_org_setup_status(uuid) to authenticated;
