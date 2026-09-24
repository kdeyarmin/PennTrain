-- Train owns its training evidence; operational Workforce tables stay separately licensed.
create table public.training_facility_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  effective_from date not null,
  year_basis text not null check (year_basis in ('anniversary','fixed')),
  year_start text not null default '01-01' check (year_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  administrator_year_basis text not null check (administrator_year_basis in ('anniversary','fixed')),
  administrator_year_start text not null default '01-01',
  policy_reference text not null check (length(btrim(policy_reference)) between 5 and 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(facility_id,effective_from)
);
create table public.training_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  direct_care boolean not null default false,
  administrator boolean not null default false,
  specialty_unit text not null default 'none' check (specialty_unit in ('none','pch_dementia','alr_dementia','alr_inrbi')),
  duties text not null check(length(btrim(duties)) between 3 and 2000),
  first_work_date date not null,
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now()
);
create table public.training_work_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_reference text not null check(length(btrim(source_reference)) between 3 and 1000),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at>starts_at and ends_at<=starts_at+interval '24 hours'),
  unique(employee_id,starts_at)
);
create table public.training_evidence_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id),
  title text not null check(length(btrim(title)) between 3 and 300),
  completed_on date not null,
  minutes integer not null check(minutes between 1 and 1440),
  delivery text not null check(delivery in ('online','classroom','hybrid','ojt','observed_practice','external')),
  provider text not null check(length(btrim(provider)) between 2 and 500),
  source_reference text not null check(length(btrim(source_reference)) between 3 and 2000),
  provider_qualification text not null default '',
  topics text[] not null default '{}',
  allocations jsonb not null default '{}' check(jsonb_typeof(allocations)='object'),
  evidence_document_id uuid references public.training_documents(id),
  course_assignment_id uuid references public.course_assignments(id),
  legacy_record_id uuid references public.employee_training_records(id),
  valid_until date,
  status text not null default 'pending' check(status in ('pending','verified','rejected','void')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(employee_id,source_reference),
  unique(course_assignment_id),
  unique(legacy_record_id),
  check(valid_until is null or valid_until>=completed_on)
);
create table public.training_annual_schedule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id),
  title text not null check(length(btrim(title)) between 3 and 300),
  duties_snapshot text not null check(length(btrim(duties_snapshot)) between 3 and 2000),
  scheduled_at timestamptz not null,
  duration_minutes integer not null check(duration_minutes between 1 and 1440),
  location text not null check(length(btrim(location)) between 3 and 1000),
  requirement_keys text[] not null default '{}',
  completed_event_id uuid references public.training_evidence_events(id),
  canceled_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create function app_private.can_read_train_scope(p_org uuid,p_facility uuid,p_employee uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.has_product_module('modules.train') and (
    public.is_platform_admin() or (p_org=public.current_org_id() and (
      (public.current_role() in ('org_admin','facility_manager','trainer','auditor') and public.is_assigned_to_facility(p_facility))
      or (p_employee is not null and public.owns_employee(p_employee)))));
$$;
revoke all on function app_private.can_read_train_scope(uuid,uuid,uuid) from public,anon;
grant execute on function app_private.can_read_train_scope(uuid,uuid,uuid) to authenticated,service_role;

alter table public.training_facility_policies enable row level security;
alter table public.training_staff_profiles enable row level security;
alter table public.training_work_shifts enable row level security;
alter table public.training_evidence_events enable row level security;
alter table public.training_annual_schedule enable row level security;
create policy training_facility_policies_read on public.training_facility_policies for select to authenticated
  using (app_private.can_read_train_scope(organization_id,facility_id));
create policy training_staff_profiles_read on public.training_staff_profiles for select to authenticated
  using (app_private.can_read_train_scope(organization_id,facility_id,employee_id));
create policy training_work_shifts_read on public.training_work_shifts for select to authenticated
  using (app_private.can_read_train_scope(organization_id,facility_id,employee_id));
create policy training_evidence_events_read on public.training_evidence_events for select to authenticated
  using (app_private.can_read_train_scope(organization_id,facility_id,employee_id));
create policy training_annual_schedule_read on public.training_annual_schedule for select to authenticated
  using (app_private.can_read_train_scope(organization_id,facility_id,employee_id));

do $$ declare t text; begin
  foreach t in array array['training_facility_policies','training_staff_profiles','training_work_shifts','training_evidence_events','training_annual_schedule'] loop
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create index %I on public.%I(organization_id,facility_id)',t||'_scope_idx',t);
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',t);
    insert into app_private.product_module_resources(resource_schema,resource_name,module_key) values('public',t,'modules.train');
    execute format('create policy product_module_entitlement on public.%I as restrictive for all to authenticated using ((select app_private.has_product_module(''modules.train''))) with check ((select app_private.has_product_module(''modules.train'')))',t);
  end loop;
end $$;

create function public.save_training_workspace_item(p_kind text,p_facility_id uuid,p_employee_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_id uuid; v_emp public.employees; v_role text:=public.current_role();
  v_event public.training_evidence_events; v_total numeric; v_start timestamptz; v_end timestamptz; v_topic text;
begin
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if v_org is null or not coalesce(app_private.can_read_train_scope(v_org,p_facility_id,p_employee_id),false)
    or not coalesce(v_role in ('platform_admin','org_admin','facility_manager','trainer'),false) then
    raise exception 'Training manager access required for this facility' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then
    raise exception 'Invalid training data' using errcode='22023'; end if;
  if p_kind<>'policy' then
    select * into v_emp from public.employees where id=p_employee_id and organization_id=v_org and facility_id=p_facility_id for update;
    if not found then raise exception 'Student is outside the selected facility' using errcode='42501'; end if;
  end if;
  if p_kind='policy' then
    if v_role='trainer' then raise exception 'Administrator required to set training policy' using errcode='42501'; end if;
    -- Validate actual month/day combinations, including February 29.
    if to_char(to_date('2000-'||(p_data->>'year_start'),'YYYY-MM-DD'),'MM-DD') is distinct from p_data->>'year_start'
      or to_char(to_date('2000-'||(p_data->>'administrator_year_start'),'YYYY-MM-DD'),'MM-DD') is distinct from p_data->>'administrator_year_start' then
      raise exception 'Use a valid month and day for each training year' using errcode='22023'; end if;
    insert into public.training_facility_policies(organization_id,facility_id,effective_from,year_basis,year_start,administrator_year_basis,administrator_year_start,policy_reference,created_by)
      values(v_org,p_facility_id,(p_data->>'effective_from')::date,p_data->>'year_basis',p_data->>'year_start',
        p_data->>'administrator_year_basis',p_data->>'administrator_year_start',p_data->>'policy_reference',auth.uid()) returning id into v_id;
  elsif p_kind='profile' then
    insert into public.training_staff_profiles(employee_id,organization_id,facility_id,direct_care,administrator,specialty_unit,duties,first_work_date,confirmed_by)
      values(p_employee_id,v_org,p_facility_id,coalesce((p_data->>'direct_care')::boolean,false),coalesce((p_data->>'administrator')::boolean,false),
        p_data->>'specialty_unit',p_data->>'duties',(p_data->>'first_work_date')::date,auth.uid())
      on conflict(employee_id) do update set facility_id=excluded.facility_id,direct_care=excluded.direct_care,administrator=excluded.administrator,
        specialty_unit=excluded.specialty_unit,duties=excluded.duties,first_work_date=excluded.first_work_date,confirmed_by=auth.uid(),confirmed_at=now();
    v_id:=p_employee_id;
  elsif p_kind='shift' then
    v_start:=(p_data->>'starts_at')::timestamptz; v_end:=(p_data->>'ends_at')::timestamptz;
    if exists(select 1 from public.training_work_shifts where employee_id=p_employee_id and starts_at<v_end and ends_at>v_start) then
      raise exception 'Scheduled shifts must not overlap' using errcode='22023'; end if;
    insert into public.training_work_shifts(organization_id,facility_id,employee_id,starts_at,ends_at,source_reference,recorded_by)
      values(v_org,p_facility_id,p_employee_id,v_start,v_end,p_data->>'source_reference',auth.uid()) returning id into v_id;
  elsif p_kind='event' then
    if (p_data->>'completed_on')::date>(now() at time zone 'America/New_York')::date then
      raise exception 'Training cannot be completed in the future' using errcode='22023'; end if;
    if exists(select 1 from jsonb_each_text(coalesce(p_data->'allocations','{}')) a where a.key not in ('base','administrator','initial','dementia_initial','dementia_annual','special_initial','special_annual')
      or a.value !~ '^\d+$') then raise exception 'Invalid credit allocation' using errcode='22023'; end if;
    select coalesce(sum(value::numeric),0) into v_total from jsonb_each_text(coalesce(p_data->'allocations','{}'));
    if v_total>(p_data->>'minutes')::integer then raise exception 'Allocated minutes cannot exceed the single training event duration' using errcode='22023'; end if;
    for v_topic in select jsonb_array_elements_text(coalesce(p_data->'topics','[]')) loop
      if v_topic not in ('fire','emergency','rights','abuse','incidents','falls','med_self_admin','resident_needs','dementia','infection','personal_care','safe_management','mental_health',
        'new_population','person_centered','communication','nutrition','job_demonstration','supervised_practice','dhs_direct_care','first_aid','cpr','airway','medication_authorization','diabetes','administrator_initial') then
        raise exception 'Unknown training topic' using errcode='22023'; end if;
    end loop;
    if nullif(p_data->>'evidence_document_id','') is not null and not exists(select 1 from public.training_documents
      where id=(p_data->>'evidence_document_id')::uuid and organization_id=v_org and facility_id=p_facility_id) then
      raise exception 'Evidence document is outside this facility' using errcode='42501'; end if;
    if nullif(p_data->>'course_assignment_id','') is not null and not exists(select 1 from public.course_assignments
      where id=(p_data->>'course_assignment_id')::uuid and employee_id=p_employee_id and status='completed') then
      raise exception 'A completed assignment for this student is required' using errcode='22023'; end if;
    if nullif(p_data->>'legacy_record_id','') is not null and not exists(select 1 from public.employee_training_records
      where id=(p_data->>'legacy_record_id')::uuid and employee_id=p_employee_id and organization_id=v_org) then
      raise exception 'Training record is outside this student' using errcode='42501'; end if;
    insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,provider_qualification,topics,allocations,
      evidence_document_id,course_assignment_id,legacy_record_id,valid_until,created_by)
    values(v_org,p_facility_id,p_employee_id,p_data->>'title',(p_data->>'completed_on')::date,(p_data->>'minutes')::integer,p_data->>'delivery',p_data->>'provider',p_data->>'source_reference',
      coalesce(p_data->>'provider_qualification',''),array(select jsonb_array_elements_text(coalesce(p_data->'topics','[]'))),coalesce(p_data->'allocations','{}'),
      nullif(p_data->>'evidence_document_id','')::uuid,nullif(p_data->>'course_assignment_id','')::uuid,nullif(p_data->>'legacy_record_id','')::uuid,
      nullif(p_data->>'valid_until','')::date,auth.uid()) returning id into v_id;
  elsif p_kind='review' then
    select * into v_event from public.training_evidence_events where id=(p_data->>'id')::uuid and employee_id=p_employee_id and facility_id=p_facility_id for update;
    if not found then raise exception 'Evidence not found' using errcode='42501'; end if;
    if p_data->>'status' not in ('verified','rejected','void') or length(btrim(coalesce(p_data->>'review_note','')))<10 then
      raise exception 'Select a review decision and record its basis' using errcode='22023'; end if;
    if v_event.status<>'pending' and p_data->>'status'<>'void' then raise exception 'Reviewed evidence is immutable; void and record a correction' using errcode='22023'; end if;
    if p_data->>'status'='verified' and (v_event.topics && array['fire','dhs_direct_care','first_aid','cpr','airway','medication_authorization','diabetes','administrator_initial']
      or coalesce((v_event.allocations->>'administrator')::integer,0)>0) and length(btrim(v_event.provider_qualification))<10 then
      raise exception 'Verify the qualified instructor or approval reference before crediting this training' using errcode='22023'; end if;
    if p_data->>'status'='verified' and v_event.topics && array['job_demonstration','supervised_practice'] and v_event.delivery not in ('observed_practice','ojt','hybrid') then
      raise exception 'Practical skills require observed practice evidence' using errcode='22023'; end if;
    update public.training_evidence_events set status=p_data->>'status',review_note=p_data->>'review_note',reviewed_by=auth.uid(),reviewed_at=now() where id=v_event.id returning id into v_id;
  elsif p_kind='plan' then
    insert into public.training_annual_schedule(organization_id,facility_id,employee_id,title,duties_snapshot,scheduled_at,duration_minutes,location,requirement_keys,created_by)
      values(v_org,p_facility_id,p_employee_id,p_data->>'title',p_data->>'duties_snapshot',(p_data->>'scheduled_at')::timestamptz,
        (p_data->>'duration_minutes')::integer,p_data->>'location',array(select jsonb_array_elements_text(coalesce(p_data->'requirement_keys','[]'))),auth.uid()) returning id into v_id;
  elsif p_kind='plan_complete' then
    if not exists(select 1 from public.training_evidence_events where id=(p_data->>'event_id')::uuid and employee_id=p_employee_id and status='verified') then
      raise exception 'Verified evidence for this student is required' using errcode='22023'; end if;
    update public.training_annual_schedule set completed_event_id=(p_data->>'event_id')::uuid
      where id=(p_data->>'id')::uuid and employee_id=p_employee_id and facility_id=p_facility_id and completed_event_id is null and canceled_at is null returning id into v_id;
    if v_id is null then raise exception 'Open plan entry not found' using errcode='22023'; end if;
  else raise exception 'Unsupported training operation' using errcode='22023'; end if;
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function public.save_training_workspace_item(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_training_workspace_item(text,uuid,uuid,jsonb) to authenticated;

create function public.get_training_workspace(p_facility_id uuid,p_employee_id uuid default null,p_limit integer default 500,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,500),1),500); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not app_private.has_product_module('modules.train') or public.current_role() not in ('platform_admin','org_admin','facility_manager','trainer','auditor') then
    raise exception 'Training workspace access required' using errcode='42501'; end if;
  if not exists(select 1 from public.facilities where id=p_facility_id) then raise exception 'Facility is outside your access' using errcode='42501'; end if;
  return jsonb_build_object(
    'policies',coalesce((select jsonb_agg(to_jsonb(t) order by effective_from desc) from public.training_facility_policies t where facility_id=p_facility_id),'[]'),
    'profiles',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.training_staff_profiles where facility_id=p_facility_id and (p_employee_id is null or employee_id=p_employee_id) order by employee_id limit v_limit offset v_offset)t),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.training_evidence_events where facility_id=p_facility_id and (p_employee_id is null or employee_id=p_employee_id) order by id limit v_limit offset v_offset)t),'[]'),
    'shifts',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.training_work_shifts where facility_id=p_facility_id and (p_employee_id is null or employee_id=p_employee_id) order by id limit v_limit offset v_offset)t),'[]'),
    'plans',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.training_annual_schedule where facility_id=p_facility_id and (p_employee_id is null or employee_id=p_employee_id) order by id limit v_limit offset v_offset)t),'[]'),
    'generated_at',now(),'limit',v_limit,'offset',v_offset);
end;
$$;
revoke all on function public.get_training_workspace(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.get_training_workspace(uuid,uuid,integer,integer) to authenticated;
