-- Priority 17: scheduled historical reports and trend delivery.
--
-- Phase 5 established versioned report definitions and immutable snapshots, but
-- intentionally left the trusted scheduler/worker and end-user write surface
-- unimplemented. This completes that contract with tenant/facility-scoped
-- schedules, authorized recipients, durable run and delivery history, retry,
-- reconciliation, retention metadata, prior-period comparisons, and evidence-room
-- publication. Snapshot facts and delivery attempts are append-only.

alter table public.report_schedules
  add column facility_id uuid references public.facilities(id) on delete restrict,
  add column report_kind text,
  add column frequency text,
  add column date_range_mode text not null default 'rolling',
  add column lookback_days integer not null default 30,
  add column fixed_date_from date,
  add column fixed_date_to date,
  add column fixed_as_of_date date,
  add column delivery_methods text[] not null default array['in_app']::text[],
  add column publish_to_evidence_room boolean not null default false,
  add column updated_at timestamptz not null default now(),
  add constraint report_schedules_kind_check check (report_kind is null or report_kind in (
    'employee_expirations','resident_forms_due','open_incidents','complaints',
    'overdue_corrective_actions','missed_resident_services','work_orders',
    'fire_drill_compliance','qapi_metrics','occupancy_referral_conversion'
  )),
  add constraint report_schedules_frequency_check check (frequency is null or frequency in (
    'daily','weekly','monthly','quarterly','annual'
  )),
  add constraint report_schedules_range_mode_check check (date_range_mode in ('rolling','fixed')),
  add constraint report_schedules_lookback_check check (lookback_days between 1 and 3660),
  add constraint report_schedules_fixed_range_check check (
    date_range_mode <> 'fixed' or (fixed_date_from is not null and fixed_date_to is not null and fixed_date_to >= fixed_date_from)
  ),
  add constraint report_schedules_delivery_methods_check check (
    cardinality(delivery_methods) > 0
    and delivery_methods <@ array['in_app','email_link','evidence_room']::text[]
  );

create trigger set_updated_at before update on public.report_schedules
for each row execute function public.set_updated_at();

alter table public.report_snapshots
  add column schedule_id uuid references public.report_schedules(id) on delete restrict,
  add column period_start date,
  add column period_end date,
  add column previous_snapshot_id uuid references public.report_snapshots(id) on delete restrict,
  add column trend_comparison jsonb not null default '{}'::jsonb,
  add column retention_expires_at timestamptz;

create table public.report_schedule_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete restrict,
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  delivery_methods text[] not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (schedule_id, profile_id),
  check (cardinality(delivery_methods) > 0),
  check (delivery_methods <@ array['in_app','email_link']::text[])
);
create index report_schedule_recipients_schedule_idx
  on public.report_schedule_recipients(schedule_id, profile_id);

create table public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete restrict,
  schedule_id uuid not null references public.report_schedules(id) on delete restrict,
  report_version_id uuid not null references public.saved_report_versions(id) on delete restrict,
  trigger_type text not null check (trigger_type in ('scheduled','manual','retry')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed')),
  scheduled_for timestamptz not null,
  as_of_date date not null,
  period_start date not null,
  period_end date not null,
  snapshot_id uuid references public.report_snapshots(id) on delete restrict,
  retry_of_run_id uuid references public.report_schedule_runs(id) on delete restrict,
  attempt_number integer not null default 1 check (attempt_number between 1 and 10),
  requested_by uuid references public.profiles(id),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index report_schedule_runs_schedule_idx
  on public.report_schedule_runs(schedule_id, created_at desc);
create index report_schedule_runs_status_idx
  on public.report_schedule_runs(status, scheduled_for);

create table public.report_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete restrict,
  run_id uuid not null references public.report_schedule_runs(id) on delete restrict,
  snapshot_id uuid not null references public.report_snapshots(id) on delete restrict,
  recipient_profile_id uuid references public.profiles(id) on delete restrict,
  delivery_method text not null check (delivery_method in ('in_app','email_link','evidence_room')),
  attempt_number integer not null default 1 check (attempt_number between 1 and 10),
  retry_of_attempt_id uuid references public.report_delivery_attempts(id) on delete restrict,
  status text not null check (status in ('delivered','queued','published','failed','skipped')),
  notification_id uuid references public.notifications(id) on delete restrict,
  notification_delivery_id uuid references public.notification_deliveries(id) on delete restrict,
  evidence_collection_id uuid references public.evidence_collections(id) on delete restrict,
  error_code text,
  error_message text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (delivery_method = 'evidence_room' and recipient_profile_id is null)
    or (delivery_method <> 'evidence_room' and recipient_profile_id is not null)
  )
);
create index report_delivery_attempts_run_idx
  on public.report_delivery_attempts(run_id, created_at);
create index report_delivery_attempts_retry_idx
  on public.report_delivery_attempts(status, created_at desc);

create table public.report_snapshot_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  snapshot_id uuid not null references public.report_snapshots(id) on delete restrict,
  evidence_collection_id uuid not null references public.evidence_collections(id) on delete restrict,
  published_by uuid references public.profiles(id),
  published_at timestamptz not null default now(),
  unique (snapshot_id, evidence_collection_id)
);
create index report_snapshot_publications_collection_idx
  on public.report_snapshot_publications(evidence_collection_id, published_at desc);

create trigger prevent_report_delivery_attempt_mutation
before update or delete on public.report_delivery_attempts
for each row execute function app_private.prevent_phase5_report_evidence_mutation();
create trigger prevent_report_snapshot_publication_mutation
before update or delete on public.report_snapshot_publications
for each row execute function app_private.prevent_phase5_report_evidence_mutation();

do $$
declare t text;
begin
  foreach t in array array[
    'report_schedule_recipients','report_schedule_runs','report_delivery_attempts',
    'report_snapshot_publications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

drop policy report_schedules_select on public.report_schedules;
create policy report_schedules_select on public.report_schedules for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or facility_id is not null and public.is_assigned_to_facility(facility_id)
  )
);
create policy report_schedule_recipients_select on public.report_schedule_recipients for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or facility_id is not null and public.is_assigned_to_facility(facility_id)
  )
);
create policy report_schedule_runs_select on public.report_schedule_runs for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or facility_id is not null and public.is_assigned_to_facility(facility_id)
  )
);
create policy report_delivery_attempts_select on public.report_delivery_attempts for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or facility_id is not null and public.is_assigned_to_facility(facility_id)
  )
);
create policy report_snapshot_publications_select on public.report_snapshot_publications for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or public.is_assigned_to_facility(facility_id)
  )
);

-- This helper is the shared authorization boundary for schedule mutations.
create or replace function app_private.assert_scheduled_report_manager(
  p_organization_id uuid,
  p_facility_id uuid default null
) returns public.profiles
language plpgsql stable security definer set search_path = '' as $function$
declare v_profile public.profiles%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or not v_profile.is_active
     or v_profile.organization_id <> p_organization_id
     or v_profile.role not in ('org_admin','facility_manager') then
    raise exception 'Managing scheduled reports is outside caller scope' using errcode = '42501';
  end if;
  if p_facility_id is null and v_profile.role <> 'org_admin' then
    raise exception 'Only organization administrators may schedule organization-wide reports' using errcode = '42501';
  end if;
  if p_facility_id is not null and v_profile.role = 'facility_manager'
     and not public.is_assigned_to_facility(p_facility_id) then
    raise exception 'Facility is outside caller scope' using errcode = '42501';
  end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f
    where f.id = p_facility_id and f.organization_id = p_organization_id
  ) then
    raise exception 'Facility is outside organization scope' using errcode = '22023';
  end if;
  return v_profile;
end;
$function$;
revoke all on function app_private.assert_scheduled_report_manager(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.report_domain_for_kind(p_kind text)
returns text language sql immutable set search_path = '' as $function$
select case
  when p_kind = 'employee_expirations' then 'qualification'
  when p_kind in ('open_incidents','complaints') then 'incident'
  when p_kind = 'overdue_corrective_actions' then 'remediation'
  when p_kind in ('missed_resident_services','work_orders','fire_drill_compliance') then 'delivery'
  when p_kind in ('qapi_metrics','occupancy_referral_conversion') then 'compliance'
  else 'compliance'
end;
$function$;

create or replace function app_private.next_report_run_at(
  p_frequency text,
  p_from timestamptz
) returns timestamptz language sql immutable set search_path = '' as $function$
select case p_frequency
  when 'daily' then p_from + interval '1 day'
  when 'weekly' then p_from + interval '7 days'
  when 'monthly' then p_from + interval '1 month'
  when 'quarterly' then p_from + interval '3 months'
  when 'annual' then p_from + interval '1 year'
  else null
end;
$function$;
revoke all on function app_private.report_domain_for_kind(text) from public,anon,authenticated;
revoke all on function app_private.next_report_run_at(text,timestamptz) from public,anon,authenticated;

create or replace function public.upsert_scheduled_report(
  p_schedule_id uuid,
  p_name text,
  p_report_kind text,
  p_facility_id uuid,
  p_frequency text,
  p_time_zone text,
  p_date_range_mode text,
  p_lookback_days integer,
  p_fixed_date_from date,
  p_fixed_date_to date,
  p_fixed_as_of_date date,
  p_delivery_methods text[],
  p_recipient_profile_ids uuid[],
  p_retention_days integer,
  p_enabled boolean default true,
  p_publish_to_evidence_room boolean default false
) returns public.report_schedules
language plpgsql security definer set search_path = '' as $function$
declare
  v_profile public.profiles%rowtype;
  v_schedule public.report_schedules%rowtype;
  v_definition public.saved_report_definitions%rowtype;
  v_version_number integer;
  v_version_id uuid;
  v_config jsonb;
  v_sha text;
  v_cron text;
  v_recipient uuid;
  v_methods text[];
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or v_profile.organization_id is null then
    raise exception 'Managing scheduled reports is outside caller scope' using errcode = '42501';
  end if;
  perform app_private.assert_scheduled_report_manager(v_profile.organization_id, p_facility_id);
  if length(btrim(coalesce(p_name,''))) not between 3 and 120 then
    raise exception 'A report name of 3-120 characters is required' using errcode = '22023';
  end if;
  if p_report_kind not in (
    'employee_expirations','resident_forms_due','open_incidents','complaints',
    'overdue_corrective_actions','missed_resident_services','work_orders',
    'fire_drill_compliance','qapi_metrics','occupancy_referral_conversion'
  ) or p_frequency not in ('daily','weekly','monthly','quarterly','annual')
     or p_date_range_mode not in ('rolling','fixed')
     or p_lookback_days not between 1 and 3660
     or p_retention_days not between 1 and 36500 then
    raise exception 'Scheduled report configuration is invalid' using errcode = '22023';
  end if;
  if p_date_range_mode = 'fixed' and (
    p_fixed_date_from is null or p_fixed_date_to is null or p_fixed_date_to < p_fixed_date_from
  ) then
    raise exception 'A valid fixed date range is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz
    where tz.name=coalesce(nullif(btrim(p_time_zone),''),'UTC')
  ) then
    raise exception 'A valid IANA time zone is required' using errcode = '22023';
  end if;
  v_methods := array(select distinct unnest(coalesce(p_delivery_methods,array[]::text[])) order by 1);
  if cardinality(v_methods) = 0
     or not v_methods <@ array['in_app','email_link','evidence_room']::text[] then
    raise exception 'At least one supported delivery method is required' using errcode = '22023';
  end if;
  if (p_publish_to_evidence_room or 'evidence_room' = any(v_methods)) and p_facility_id is null then
    raise exception 'Evidence-room delivery requires a facility-scoped report' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_recipient_profile_ids,array[]::uuid[])) r(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = r.id and p.organization_id = v_profile.organization_id and p.is_active
        and p.role in ('org_admin','facility_manager','auditor')
        and (p_facility_id is null or p.role in ('org_admin','auditor') or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id=p.id and fa.facility_id=p_facility_id
        ))
    )
  ) then
    raise exception 'Every recipient must be an authorized active reporting user in scope' using errcode = '22023';
  end if;
  if (v_methods && array['in_app','email_link']::text[])
     and cardinality(coalesce(p_recipient_profile_ids,array[]::uuid[])) = 0 then
    raise exception 'Recipient delivery requires at least one authorized recipient' using errcode = '22023';
  end if;

  v_config := jsonb_build_object(
    'reportKind',p_report_kind,'facilityId',p_facility_id,'frequency',p_frequency,
    'timeZone',coalesce(nullif(btrim(p_time_zone),''),'UTC'),
    'dateRangeMode',p_date_range_mode,'lookbackDays',p_lookback_days,
    'fixedDateFrom',p_fixed_date_from,'fixedDateTo',p_fixed_date_to,
    'fixedAsOfDate',p_fixed_as_of_date,'deliveryMethods',to_jsonb(v_methods),
    'retentionDays',p_retention_days,'publishToEvidenceRoom',p_publish_to_evidence_room
  );
  v_sha := encode(extensions.digest(convert_to(v_config::text,'utf8'),'sha256'),'hex');
  v_cron := case p_frequency
    when 'daily' then '0 8 * * *' when 'weekly' then '0 8 * * 1'
    when 'monthly' then '0 8 1 * *' when 'quarterly' then '0 8 1 */3 *'
    else '0 8 1 1 *' end;

  if p_schedule_id is not null then
    select s.* into v_schedule from public.report_schedules s where s.id = p_schedule_id for update;
    if v_schedule.id is null then raise exception 'Report schedule not found' using errcode = 'P0002'; end if;
    perform app_private.assert_scheduled_report_manager(v_schedule.organization_id,v_schedule.facility_id);
    select d.* into v_definition from public.saved_report_definitions d where d.id=v_schedule.report_definition_id for update;
    select coalesce(max(version_number),0)+1 into v_version_number from public.saved_report_versions where report_definition_id=v_definition.id;
    update public.saved_report_versions set state='superseded' where id=v_definition.current_version_id and state='published';
  else
    insert into public.saved_report_definitions(
      organization_id,name,report_type,owner_profile_id,retention_days,schedule_enabled
    ) values (
      v_profile.organization_id,btrim(p_name),app_private.report_domain_for_kind(p_report_kind),v_profile.id,p_retention_days,p_enabled
    ) returning * into v_definition;
    v_version_number := 1;
  end if;

  insert into public.saved_report_versions(
    report_definition_id,organization_id,version_number,filters,columns,sort_spec,time_zone,
    configuration_sha256,state,created_by,published_at
  ) values (
    v_definition.id,v_profile.organization_id,v_version_number,v_config,'[]','[]',
    coalesce(nullif(btrim(p_time_zone),''),'UTC'),v_sha,'published',v_profile.id,now()
  ) returning id into v_version_id;
  update public.saved_report_definitions set
    name=btrim(p_name),report_type=app_private.report_domain_for_kind(p_report_kind),
    current_version_id=v_version_id,retention_days=p_retention_days,
    schedule_enabled=p_enabled,updated_at=now()
  where id=v_definition.id returning * into v_definition;

  if v_schedule.id is null then
    insert into public.report_schedules(
      organization_id,facility_id,report_definition_id,report_version_id,report_kind,
      cron_expression,time_zone,frequency,date_range_mode,lookback_days,fixed_date_from,
      fixed_date_to,fixed_as_of_date,delivery_mode,delivery_methods,audience,retention_days,
      enabled,next_run_at,publish_to_evidence_room,created_by
    ) values (
      v_profile.organization_id,p_facility_id,v_definition.id,v_version_id,p_report_kind,
      v_cron,coalesce(nullif(btrim(p_time_zone),''),'UTC'),p_frequency,p_date_range_mode,
      p_lookback_days,p_fixed_date_from,p_fixed_date_to,p_fixed_as_of_date,
      v_methods[1],v_methods,jsonb_build_object('profileIds',coalesce(p_recipient_profile_ids,array[]::uuid[])),
      p_retention_days,p_enabled,case when p_enabled then app_private.next_report_run_at(p_frequency,now()) end,
      p_publish_to_evidence_room,v_profile.id
    ) returning * into v_schedule;
  else
    update public.report_schedules set
      facility_id=p_facility_id,report_version_id=v_version_id,report_kind=p_report_kind,
      cron_expression=v_cron,time_zone=coalesce(nullif(btrim(p_time_zone),''),'UTC'),
      frequency=p_frequency,date_range_mode=p_date_range_mode,lookback_days=p_lookback_days,
      fixed_date_from=p_fixed_date_from,fixed_date_to=p_fixed_date_to,fixed_as_of_date=p_fixed_as_of_date,
      delivery_mode=v_methods[1],delivery_methods=v_methods,
      audience=jsonb_build_object('profileIds',coalesce(p_recipient_profile_ids,array[]::uuid[])),
      retention_days=p_retention_days,enabled=p_enabled,
      next_run_at=case when p_enabled then coalesce(next_run_at,app_private.next_report_run_at(p_frequency,now())) end,
      publish_to_evidence_room=p_publish_to_evidence_room
    where id=v_schedule.id returning * into v_schedule;
    delete from public.report_schedule_recipients where schedule_id=v_schedule.id;
  end if;

  foreach v_recipient in array coalesce(p_recipient_profile_ids,array[]::uuid[]) loop
    if v_methods && array['in_app','email_link']::text[] then
      insert into public.report_schedule_recipients(
        organization_id,facility_id,schedule_id,profile_id,delivery_methods,created_by
      ) values (
        v_profile.organization_id,p_facility_id,v_schedule.id,v_recipient,
        array(select x from unnest(v_methods) x where x in ('in_app','email_link')),v_profile.id
      );
    end if;
  end loop;
  return v_schedule;
end;
$function$;
revoke all on function public.upsert_scheduled_report(uuid,text,text,uuid,text,text,text,integer,date,date,date,text[],uuid[],integer,boolean,boolean) from public,anon;
grant execute on function public.upsert_scheduled_report(uuid,text,text,uuid,text,text,text,integer,date,date,date,text[],uuid[],integer,boolean,boolean) to authenticated;

create or replace function public.set_report_schedule_enabled(p_schedule_id uuid,p_enabled boolean)
returns public.report_schedules language plpgsql security definer set search_path = '' as $function$
declare v_schedule public.report_schedules%rowtype;
begin
  select s.* into v_schedule from public.report_schedules s where s.id=p_schedule_id for update;
  if v_schedule.id is null then raise exception 'Report schedule not found' using errcode='P0002'; end if;
  perform app_private.assert_scheduled_report_manager(v_schedule.organization_id,v_schedule.facility_id);
  update public.report_schedules set enabled=p_enabled,
    next_run_at=case when p_enabled then coalesce(next_run_at,app_private.next_report_run_at(frequency,now())) else null end
  where id=p_schedule_id returning * into v_schedule;
  update public.saved_report_definitions set schedule_enabled=p_enabled,updated_at=now()
  where id=v_schedule.report_definition_id;
  return v_schedule;
end;
$function$;
revoke all on function public.set_report_schedule_enabled(uuid,boolean) from public,anon;
grant execute on function public.set_report_schedule_enabled(uuid,boolean) to authenticated;

-- Builds a deterministic, non-PHI manifest for one of the ten supported domains.
-- Row identity is retained for audit/reconciliation; names, narratives, and contact
-- details are deliberately excluded from snapshots and outbound delivery.
create or replace function app_private.build_scheduled_report_payload(
  p_kind text,p_organization_id uuid,p_facility_id uuid,
  p_period_start date,p_period_end date,p_as_of_date date
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_ids jsonb := '[]'::jsonb; v_total bigint := 0; v_secondary bigint := 0; v_watermark timestamptz; v_metrics jsonb;
begin
  if p_kind='employee_expirations' then
    select coalesce(jsonb_agg(e.id order by e.id),'[]'),count(*),max(e.updated_at)
      into v_ids,v_total,v_watermark from public.employee_credentials e
    where e.organization_id=p_organization_id and (p_facility_id is null or e.facility_id=p_facility_id)
      and e.expiration_date between p_as_of_date and p_period_end and e.status<>'not_applicable';
  elsif p_kind='resident_forms_due' then
    select coalesce(jsonb_agg(r.id order by r.id),'[]'),count(*),max(r.updated_at)
      into v_ids,v_total,v_watermark from public.resident_compliance_items r
    where r.organization_id=p_organization_id and (p_facility_id is null or r.facility_id=p_facility_id)
      and r.due_date between p_as_of_date and p_period_end and r.status in ('missing','due_soon','expired');
  elsif p_kind='open_incidents' then
    select coalesce(jsonb_agg(i.id order by i.id),'[]'),count(*),max(i.updated_at)
      into v_ids,v_total,v_watermark from public.incidents i
    where i.organization_id=p_organization_id and (p_facility_id is null or i.facility_id=p_facility_id)
      and i.status<>'closed' and i.occurred_at::date<=p_as_of_date and i.occurred_at::date>=p_period_start;
  elsif p_kind='complaints' then
    select coalesce(jsonb_agg(c.id order by c.id),'[]'),count(*),max(c.updated_at)
      into v_ids,v_total,v_watermark from public.complaints c
    where c.organization_id=p_organization_id and (p_facility_id is null or c.facility_id=p_facility_id)
      and c.status <> 'closed' and c.date_received::date between p_period_start and p_as_of_date;
  elsif p_kind='overdue_corrective_actions' then
    select coalesce(jsonb_agg(c.id order by c.id),'[]'),count(*),max(c.updated_at)
      into v_ids,v_total,v_watermark from public.corrective_actions c
    where c.organization_id=p_organization_id and (p_facility_id is null or c.facility_id=p_facility_id)
      and c.status not in ('completed','cancelled') and c.due_date<p_as_of_date;
  elsif p_kind='missed_resident_services' then
    select coalesce(jsonb_agg(s.id order by s.id),'[]'),count(*),max(s.updated_at)
      into v_ids,v_total,v_watermark from public.resident_service_task_instances s
    where s.organization_id=p_organization_id and (p_facility_id is null or s.facility_id=p_facility_id)
      and s.scheduled_start::date between p_period_start and p_period_end
      and (s.status in ('resident_refused','resident_unavailable','not_completed','completed_late')
        or (s.status='scheduled' and s.scheduled_end::date<p_as_of_date));
  elsif p_kind='work_orders' then
    select coalesce(jsonb_agg(w.id order by w.id),'[]'),count(*),max(w.updated_at),
      count(*) filter(where w.target_completion_at is not null and w.target_completion_at::date<p_as_of_date)
      into v_ids,v_total,v_watermark,v_secondary from public.work_orders w
    where w.organization_id=p_organization_id and (p_facility_id is null or w.facility_id=p_facility_id)
      and w.status not in ('verified','canceled') and w.created_at::date<=p_as_of_date;
  elsif p_kind='fire_drill_compliance' then
    select coalesce(jsonb_agg(i.id order by i.id),'[]'),count(*),max(i.updated_at),
      count(*) filter(where i.status in ('expired','missing'))
      into v_ids,v_total,v_watermark,v_secondary from public.inspection_items i
    where i.organization_id=p_organization_id and (p_facility_id is null or i.facility_id=p_facility_id)
      and i.item_type='fire_drill_program' and i.is_active;
  elsif p_kind='qapi_metrics' then
    select coalesce(jsonb_agg(q.id order by q.id),'[]'),count(*),max(q.recorded_at)
      into v_ids,v_total,v_watermark from public.qapi_measurements q
    where q.organization_id=p_organization_id and (p_facility_id is null or q.facility_id=p_facility_id)
      and q.period_end between p_period_start and p_period_end;
  elsif p_kind='occupancy_referral_conversion' then
    select coalesce(jsonb_agg(a.id order by a.id),'[]'),count(*),max(a.updated_at),
      count(*) filter(where a.stage='admitted') into v_ids,v_total,v_watermark,v_secondary
    from public.admission_prospects a
    where a.organization_id=p_organization_id and (p_facility_id is null or a.facility_id=p_facility_id)
      and a.inquiry_date between p_period_start and p_period_end;
    select jsonb_build_object(
      'total',v_total,'secondary',v_secondary,'referrals',v_total,'admitted',v_secondary,
      'conversionRate',case when v_total=0 then null else round((v_secondary::numeric/v_total::numeric)*100,2) end,
      'occupiedBeds',count(*) filter(where b.status='occupied'),'totalBeds',count(*),
      'occupancyRate',case when count(*)=0 then null else round((count(*) filter(where b.status='occupied')::numeric/count(*)::numeric)*100,2) end
    ) into v_metrics from public.facility_beds b
    where b.organization_id=p_organization_id and (p_facility_id is null or b.facility_id=p_facility_id);
  else
    raise exception 'Unsupported report kind' using errcode='22023';
  end if;
  v_metrics:=coalesce(v_metrics,jsonb_build_object('total',v_total,'secondary',v_secondary));
  return jsonb_build_object(
    'recordIds',v_ids,'rowCount',v_total,'secondaryCount',v_secondary,
    'metrics',v_metrics,'sourceWatermark',v_watermark,'generatedThrough',p_as_of_date
  );
end;
$function$;
revoke all on function app_private.build_scheduled_report_payload(text,uuid,uuid,date,date,date) from public,anon,authenticated;

create or replace function app_private.publish_snapshot_to_evidence_room(
  p_snapshot_id uuid,p_actor_id uuid,p_collection_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_snapshot public.report_snapshots%rowtype; v_definition public.saved_report_definitions%rowtype; v_collection_id uuid;
begin
  select s.* into v_snapshot from public.report_snapshots s where s.id=p_snapshot_id;
  if v_snapshot.id is null then raise exception 'Report snapshot not found' using errcode='P0002'; end if;
  if v_snapshot.facility_id is null then raise exception 'Organization-wide snapshots cannot be published to a facility evidence room' using errcode='22023'; end if;
  select d.* into v_definition from public.saved_report_definitions d where d.id=v_snapshot.report_definition_id;
  select p.evidence_collection_id into v_collection_id from public.report_snapshot_publications p where p.snapshot_id=v_snapshot.id limit 1;
  if v_collection_id is not null then return v_collection_id; end if;
  insert into public.evidence_collections(
    organization_id,facility_id,name,purpose,status,terms_version,created_by,published_at
  ) values (
    v_snapshot.organization_id,v_snapshot.facility_id,
    coalesce(nullif(btrim(p_collection_name),''),v_definition.name||' - '||to_char(v_snapshot.as_of,'YYYY-MM-DD')),
    'Immutable scheduled report snapshot '||v_snapshot.id::text,'published','scheduled-report-v1',p_actor_id,now()
  ) returning id into v_collection_id;
  insert into public.report_snapshot_publications(
    organization_id,facility_id,snapshot_id,evidence_collection_id,published_by
  ) values (v_snapshot.organization_id,v_snapshot.facility_id,v_snapshot.id,v_collection_id,p_actor_id);
  return v_collection_id;
end;
$function$;
revoke all on function app_private.publish_snapshot_to_evidence_room(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.publish_report_snapshot_to_evidence_room(
  p_snapshot_id uuid,p_collection_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_snapshot public.report_snapshots%rowtype;
begin
  select s.* into v_snapshot from public.report_snapshots s where s.id=p_snapshot_id;
  if v_snapshot.id is null then raise exception 'Report snapshot not found' using errcode='P0002'; end if;
  perform app_private.assert_scheduled_report_manager(v_snapshot.organization_id,v_snapshot.facility_id);
  return app_private.publish_snapshot_to_evidence_room(v_snapshot.id,auth.uid(),p_collection_name);
end;
$function$;
revoke all on function public.publish_report_snapshot_to_evidence_room(uuid,text) from public,anon;
grant execute on function public.publish_report_snapshot_to_evidence_room(uuid,text) to authenticated;

create or replace function app_private.execute_scheduled_report(
  p_schedule_id uuid,p_trigger_type text,p_scheduled_for timestamptz,
  p_as_of_date date,p_requested_by uuid,p_retry_of_run_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_schedule public.report_schedules%rowtype; v_run_id uuid; v_period_start date; v_period_end date;
  v_payload jsonb; v_previous public.report_snapshots%rowtype; v_snapshot_id uuid; v_body jsonb; v_sha text;
  v_reconciliation text; v_comparison jsonb; v_recipient public.report_schedule_recipients%rowtype;
  v_notification_id uuid; v_delivery_id uuid; v_collection_id uuid; v_attempt integer := 1;
begin
  select s.* into v_schedule from public.report_schedules s where s.id=p_schedule_id for update;
  if v_schedule.id is null or v_schedule.report_kind is null then raise exception 'Configured report schedule not found' using errcode='P0002'; end if;
  if p_trigger_type not in ('scheduled','manual','retry') then raise exception 'Invalid report trigger type' using errcode='22023'; end if;
  v_period_end := case when v_schedule.date_range_mode='fixed' then v_schedule.fixed_date_to else p_as_of_date end;
  v_period_start := case when v_schedule.date_range_mode='fixed' then v_schedule.fixed_date_from else v_period_end-v_schedule.lookback_days+1 end;
  if p_retry_of_run_id is not null then select coalesce(max(r.attempt_number),0)+1 into v_attempt from public.report_schedule_runs r where r.id=p_retry_of_run_id or r.retry_of_run_id=p_retry_of_run_id; end if;
  insert into public.report_schedule_runs(
    organization_id,facility_id,schedule_id,report_version_id,trigger_type,status,scheduled_for,
    as_of_date,period_start,period_end,retry_of_run_id,attempt_number,requested_by,started_at
  ) values (
    v_schedule.organization_id,v_schedule.facility_id,v_schedule.id,v_schedule.report_version_id,
    p_trigger_type,'running',p_scheduled_for,p_as_of_date,v_period_start,v_period_end,p_retry_of_run_id,
    v_attempt,p_requested_by,now()
  ) returning id into v_run_id;
  begin
    v_payload := app_private.build_scheduled_report_payload(
      v_schedule.report_kind,v_schedule.organization_id,v_schedule.facility_id,
      v_period_start,v_period_end,p_as_of_date
    );
    select s.* into v_previous from public.report_snapshots s
    where s.schedule_id=v_schedule.id and s.status='ready' and s.as_of::date<p_as_of_date
    order by s.as_of desc limit 1;
    v_comparison := jsonb_build_object(
      'currentTotal',(v_payload->>'rowCount')::bigint,
      'previousTotal',case when v_previous.id is null then null else (v_previous.material_totals->>'total')::bigint end,
      'absoluteChange',case when v_previous.id is null then null else (v_payload->>'rowCount')::bigint-(v_previous.material_totals->>'total')::bigint end,
      'percentChange',case when v_previous.id is null or (v_previous.material_totals->>'total')::numeric=0 then null
        else round((((v_payload->>'rowCount')::numeric-(v_previous.material_totals->>'total')::numeric)/(v_previous.material_totals->>'total')::numeric)*100,2) end
    );
    v_reconciliation := case when jsonb_array_length(v_payload->'recordIds')=(v_payload->>'rowCount')::integer then 'reconciled' else 'variance' end;
    v_body := jsonb_build_object(
      'scheduleId',v_schedule.id,'versionId',v_schedule.report_version_id,'kind',v_schedule.report_kind,
      'asOf',p_as_of_date,'periodStart',v_period_start,'periodEnd',v_period_end,
      'records',v_payload->'recordIds','totals',v_payload->'metrics','watermark',v_payload->'sourceWatermark',
      'comparison',v_comparison
    );
    v_sha := encode(extensions.digest(convert_to(v_body::text,'utf8'),'sha256'),'hex');
    insert into public.report_snapshots(
      organization_id,facility_id,report_definition_id,report_version_id,schedule_id,as_of,
      period_start,period_end,configuration,configuration_sha256,source_watermarks,included_record_ids,
      row_counts,material_totals,reconciliation_status,reconciliation_detail,snapshot_sha256,status,
      generated_by,previous_snapshot_id,trend_comparison,retention_expires_at
    ) values (
      v_schedule.organization_id,v_schedule.facility_id,v_schedule.report_definition_id,v_schedule.report_version_id,
      v_schedule.id,p_as_of_date::timestamptz,v_period_start,v_period_end,
      jsonb_build_object(
        'reportKind',v_schedule.report_kind,'facilityId',v_schedule.facility_id,
        'dateRangeMode',v_schedule.date_range_mode,'lookbackDays',v_schedule.lookback_days,
        'fixedDateFrom',v_schedule.fixed_date_from,'fixedDateTo',v_schedule.fixed_date_to,
        'timeZone',v_schedule.time_zone
      ),
      (select configuration_sha256 from public.saved_report_versions where id=v_schedule.report_version_id),
      jsonb_build_object('source',v_payload->'sourceWatermark'),jsonb_build_object('records',v_payload->'recordIds'),
      jsonb_build_object('records',(v_payload->>'rowCount')::bigint),
      v_payload->'metrics',
      v_reconciliation,jsonb_build_object('expected',(v_payload->>'rowCount')::bigint,'captured',jsonb_array_length(v_payload->'recordIds')),
      v_sha,'ready',p_requested_by,v_previous.id,v_comparison,now()+make_interval(days=>v_schedule.retention_days)
    ) on conflict(report_version_id,as_of,configuration_sha256) do nothing returning id into v_snapshot_id;
    if v_snapshot_id is null then
      select s.id into v_snapshot_id from public.report_snapshots s
      where s.report_version_id=v_schedule.report_version_id and s.as_of=p_as_of_date::timestamptz
        and s.configuration_sha256=(select configuration_sha256 from public.saved_report_versions where id=v_schedule.report_version_id);
    end if;

    for v_recipient in select * from public.report_schedule_recipients where schedule_id=v_schedule.id loop
      if 'in_app'=any(v_recipient.delivery_methods) or 'email_link'=any(v_recipient.delivery_methods) then
        insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
        values(v_schedule.organization_id,v_recipient.profile_id,'scheduled_report_ready',
          'Scheduled report ready',
          (select name from public.saved_report_definitions where id=v_schedule.report_definition_id)||' is ready as of '||p_as_of_date::text,
          '/app/reports/schedules') returning id into v_notification_id;
      end if;
      if 'in_app'=any(v_recipient.delivery_methods) then
        insert into public.report_delivery_attempts(
          organization_id,facility_id,run_id,snapshot_id,recipient_profile_id,delivery_method,status,
          notification_id,delivered_at
        ) values(v_schedule.organization_id,v_schedule.facility_id,v_run_id,v_snapshot_id,v_recipient.profile_id,
          'in_app','delivered',v_notification_id,now());
      end if;
      if 'email_link'=any(v_recipient.delivery_methods) then
        select d.id into v_delivery_id from public.notification_deliveries d where d.notification_id=v_notification_id and d.channel='email' order by d.created_at desc limit 1;
        if v_delivery_id is null then
          insert into public.notification_deliveries(organization_id,profile_id,notification_id,channel,delivery_type,recipient)
          select v_schedule.organization_id,p.id,v_notification_id,'email','digest',p.email from public.profiles p where p.id=v_recipient.profile_id and p.email is not null
          returning id into v_delivery_id;
        end if;
        insert into public.report_delivery_attempts(
          organization_id,facility_id,run_id,snapshot_id,recipient_profile_id,delivery_method,status,
          notification_id,notification_delivery_id,error_code,error_message
        ) values(v_schedule.organization_id,v_schedule.facility_id,v_run_id,v_snapshot_id,v_recipient.profile_id,
          'email_link',case when v_delivery_id is null then 'failed' else 'queued' end,v_notification_id,v_delivery_id,
          case when v_delivery_id is null then 'recipient_email_missing' end,
          case when v_delivery_id is null then 'Authorized recipient has no email address' end);
      end if;
    end loop;
    if v_schedule.publish_to_evidence_room or 'evidence_room'=any(v_schedule.delivery_methods) then
      v_collection_id := app_private.publish_snapshot_to_evidence_room(v_snapshot_id,p_requested_by,null);
      insert into public.report_delivery_attempts(
        organization_id,facility_id,run_id,snapshot_id,delivery_method,status,evidence_collection_id,delivered_at
      ) values(v_schedule.organization_id,v_schedule.facility_id,v_run_id,v_snapshot_id,'evidence_room','published',v_collection_id,now());
    end if;
    update public.report_schedule_runs set status=case when exists(
      select 1 from public.report_delivery_attempts a where a.run_id=v_run_id and a.status='failed'
    ) then 'partial' else 'succeeded' end,snapshot_id=v_snapshot_id,finished_at=now() where id=v_run_id;
    update public.report_schedules set last_run_at=now() where id=v_schedule.id;
  exception when others then
    update public.report_schedule_runs set status='failed',error_code=sqlstate,error_message=left(sqlerrm,1000),finished_at=now() where id=v_run_id;
  end;
  return v_run_id;
end;
$function$;
revoke all on function app_private.execute_scheduled_report(uuid,text,timestamptz,date,uuid,uuid) from public,anon,authenticated;

create or replace function public.run_scheduled_report_now(p_schedule_id uuid,p_as_of_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_schedule public.report_schedules%rowtype;
begin
  select s.* into v_schedule from public.report_schedules s where s.id=p_schedule_id;
  if v_schedule.id is null then raise exception 'Report schedule not found' using errcode='P0002'; end if;
  perform app_private.assert_scheduled_report_manager(v_schedule.organization_id,v_schedule.facility_id);
  return app_private.execute_scheduled_report(v_schedule.id,'manual',now(),coalesce(p_as_of_date,current_date),auth.uid(),null);
end;
$function$;
revoke all on function public.run_scheduled_report_now(uuid,date) from public,anon;
grant execute on function public.run_scheduled_report_now(uuid,date) to authenticated;

create or replace function public.retry_scheduled_report_run(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_run public.report_schedule_runs%rowtype; v_schedule public.report_schedules%rowtype;
begin
  select r.* into v_run from public.report_schedule_runs r where r.id=p_run_id;
  if v_run.id is null or v_run.status<>'failed' or v_run.attempt_number>=5 then
    raise exception 'Report run is not safely retryable' using errcode='P0002';
  end if;
  select s.* into v_schedule from public.report_schedules s where s.id=v_run.schedule_id;
  perform app_private.assert_scheduled_report_manager(v_run.organization_id,v_run.facility_id);
  return app_private.execute_scheduled_report(v_run.schedule_id,'retry',now(),v_run.as_of_date,auth.uid(),v_run.id);
end;
$function$;
revoke all on function public.retry_scheduled_report_run(uuid) from public,anon;
grant execute on function public.retry_scheduled_report_run(uuid) to authenticated;

create or replace function public.retry_report_delivery_attempt(p_attempt_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.report_delivery_attempts%rowtype; v_delivery public.notification_deliveries%rowtype; v_new_delivery_id uuid; v_new_attempt_id uuid; v_attempt_number integer;
begin
  select a.* into v_attempt from public.report_delivery_attempts a where a.id=p_attempt_id;
  if v_attempt.id is null or v_attempt.delivery_method<>'email_link' then
    raise exception 'Delivery attempt is not retryable' using errcode='P0002';
  end if;
  perform app_private.assert_scheduled_report_manager(v_attempt.organization_id,v_attempt.facility_id);
  if v_attempt.notification_delivery_id is not null then select d.* into v_delivery from public.notification_deliveries d where d.id=v_attempt.notification_delivery_id; end if;
  if v_attempt.status<>'failed' and coalesce(v_delivery.final_outcome,'')<>'failed' then
    raise exception 'Only failed email delivery can be retried' using errcode='22023';
  end if;
  select coalesce(max(a.attempt_number),0)+1 into v_attempt_number from public.report_delivery_attempts a
  where a.id=v_attempt.id or a.retry_of_attempt_id=v_attempt.id;
  if v_attempt_number>5 then raise exception 'Delivery retry budget is exhausted' using errcode='22023'; end if;
  insert into public.notification_deliveries(organization_id,profile_id,notification_id,channel,delivery_type,recipient)
  select v_attempt.organization_id,p.id,v_attempt.notification_id,'email','digest',p.email
  from public.profiles p where p.id=v_attempt.recipient_profile_id and p.email is not null
  returning id into v_new_delivery_id;
  if v_new_delivery_id is null then raise exception 'Recipient email is unavailable' using errcode='22023'; end if;
  insert into public.report_delivery_attempts(
    organization_id,facility_id,run_id,snapshot_id,recipient_profile_id,delivery_method,
    attempt_number,retry_of_attempt_id,status,notification_id,notification_delivery_id
  ) values(
    v_attempt.organization_id,v_attempt.facility_id,v_attempt.run_id,v_attempt.snapshot_id,
    v_attempt.recipient_profile_id,'email_link',v_attempt_number,v_attempt.id,'queued',
    v_attempt.notification_id,v_new_delivery_id
  ) returning id into v_new_attempt_id;
  return v_new_attempt_id;
end;
$function$;
revoke all on function public.retry_report_delivery_attempt(uuid) from public,anon;
grant execute on function public.retry_report_delivery_attempt(uuid) to authenticated;

create or replace function public.run_due_report_schedules(p_batch_size integer default 50)
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_schedule public.report_schedules%rowtype; v_count integer:=0;
begin
  if p_batch_size not between 1 and 100 then raise exception 'Batch size must be 1-100' using errcode='22023'; end if;
  for v_schedule in
    select s.* from public.report_schedules s
    where s.enabled and s.report_kind is not null and s.next_run_at<=now()
    order by s.next_run_at,s.id limit p_batch_size for update skip locked
  loop
    perform app_private.execute_scheduled_report(
      v_schedule.id,'scheduled',v_schedule.next_run_at,
      coalesce(v_schedule.fixed_as_of_date,(v_schedule.next_run_at at time zone v_schedule.time_zone)::date),
      null,null
    );
    update public.report_schedules set next_run_at=app_private.next_report_run_at(v_schedule.frequency,v_schedule.next_run_at) where id=v_schedule.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.run_due_report_schedules(integer) from public,anon,authenticated;
grant execute on function public.run_due_report_schedules(integer) to service_role;

-- Enable in-app report notifications and secure email-link delivery through the
-- existing provider outbox/dispatch worker.
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
  'course_assigned','quiz_graded','certificate_issued','training_due_soon','training_expired',
  'competency_recorded','missing_document','practicum_due_soon','practicum_expired','credential_expiring',
  'certificate_expiring','incident_reported','policy_attestation_assigned','policy_attestation_due_soon',
  'course_continuation_reminder','resident_compliance_due','support_ticket_update','workforce_lifecycle_changed','qualification_changed',
  'credential_renewal_changed','training_registration_changed','open_shift_claim_changed','shift_swap_changed',
  'course_assignment_due_soon','scheduled_report_ready'
));

insert into public.notification_templates(
  organization_id,template_key,channel,version,status,subject_template,body_template,allowed_variables,activated_at
) values (
  null,'scheduled_report_ready','email',1,'active','Your scheduled report is ready',
  'A scheduled report snapshot is ready. Sign in to CareMetric CareBase to review its immutable results and delivery history.',
  '{}'::text[],now()
) on conflict do nothing;

-- Database cron is intentionally coarse-grained: one bounded dispatcher claims due
-- tenant schedules instead of creating one pg_cron job per customer schedule.
do $do$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='run-scheduled-historical-reports';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'run-scheduled-historical-reports','*/15 * * * *',
    'select public.run_due_report_schedules(50)'
  );
end;
$do$;

revoke all on table public.report_schedules,public.report_snapshots from authenticated;
grant select on table public.report_schedules,public.report_snapshots to authenticated;
grant select on table public.report_schedule_recipients,public.report_schedule_runs,
  public.report_delivery_attempts,public.report_snapshot_publications to authenticated;
