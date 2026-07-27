-- Exception-based documentation and unscheduled-service capture (program plan Phase 4b/4c).
--
-- WHY THE STATUS ENUM IS LEFT ALONE. `resident_service_task_instances.status` drives scheduling,
-- alerting, and every completion metric already in the product. The seven documentation responses
-- are a different axis: "completed with more assistance" is still a completed task, and folding it
-- into the status would understate delivery and overstate missed care everywhere at once. The
-- response is stored alongside the status, and exception analysis reads the response.
--
-- WHY UNSCHEDULED SERVICES GET THEIR OWN TABLE. They have no requirement, no schedule, and no due
-- window -- the three things `resident_service_task_instances` is built around. Recording them as
-- instances would mean inventing a fake requirement per event and permanently distorting the
-- completion denominator.

-- ---------------------------------------------------------------------------
-- 1. Structured exception documentation on task instances
-- ---------------------------------------------------------------------------

alter table public.resident_service_task_instances
  add column completion_response text
    check (completion_response is null or completion_response in (
      'completed_as_planned', 'completed_with_more_assistance', 'partially_completed',
      'resident_refused', 'resident_unavailable', 'not_completed', 'concern_observed'
    )),
  add column exception_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(exception_details) = 'object'),
  -- Denormalized from exception_details so the conflict detector and the change detector can filter
  -- on it without unpacking jsonb across a facility's whole task history.
  add column documented_assistance_level text
    check (documented_assistance_level is null or documented_assistance_level in (
      'supervision', 'one_person', 'two_person', 'mechanical_lift'
    )),
  add column change_of_condition_id uuid references public.resident_change_events(id) on delete set null;

comment on column public.resident_service_task_instances.completion_response is
  'The documentation response staff chose. Separate axis from status: care that happened stays completed even when it carried an exception.';
comment on column public.resident_service_task_instances.documented_assistance_level is
  'Denormalized from exception_details for indexed filtering; shares the care header transfer vocabulary so the two can be compared.';

create index resident_service_task_exception_idx
  on public.resident_service_task_instances(resident_id, completion_response, performed_at desc)
  where completion_response is not null and completion_response <> 'completed_as_planned';

create index resident_service_task_assistance_idx
  on public.resident_service_task_instances(facility_id, documented_assistance_level, performed_at desc)
  where documented_assistance_level is not null;

create or replace function public.record_service_task_response(
  p_task_id uuid,
  p_response text,
  p_exception_details jsonb default '{}'::jsonb,
  p_second_employee_id uuid default null
)
returns public.resident_service_task_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.resident_service_task_instances%rowtype;
  v_requirement public.resident_service_requirements%rowtype;
  v_employee public.employees%rowtype;
  v_is_manager boolean;
  v_status text;
  v_level text;
  v_details jsonb := coalesce(p_exception_details, '{}'::jsonb);
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id for update;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  if v_task.status <> 'scheduled' then
    raise exception 'Only scheduled service tasks can be recorded' using errcode = '55000';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'Exception details must be an object' using errcode = '22023';
  end if;

  select * into v_requirement from public.resident_service_requirements where id = v_task.requirement_id;

  -- Same authorization shape as record_resident_service_task: a manager at the facility, or the
  -- employee the task belongs to.
  select * into v_employee from public.employees e where e.profile_id = auth.uid() and e.status = 'active';
  v_is_manager := public.is_platform_admin()
    or (
      public.current_org_id() = v_task.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_task.facility_id))
    );
  if not v_is_manager and (
    v_employee.id is null
    or v_employee.facility_id <> v_task.facility_id
    or (v_task.assigned_employee_id is not null and v_task.assigned_employee_id <> v_employee.id)
  ) then
    raise exception 'Service task is outside caller scope' using errcode = '42501';
  end if;

  -- The plan decides which responses this service accepts. Offering a response the plan does not
  -- allow -- a resident refusal on a manager review, say -- would record something that cannot have
  -- happened.
  if v_requirement.id is not null
    and not (p_response = any(v_requirement.acceptable_completion_responses)) then
    raise exception 'Response % is not accepted for this service', p_response using errcode = '22023';
  end if;

  v_status := case p_response
    when 'resident_refused' then 'resident_refused'
    when 'resident_unavailable' then 'resident_unavailable'
    when 'not_completed' then 'not_completed'
    else 'completed'
  end;

  v_level := nullif(btrim(coalesce(v_details->>'assistance_level', '')), '');
  if p_response <> 'completed_with_more_assistance' then
    v_level := null;
  elsif v_level is null then
    raise exception 'Recording extra assistance requires the level that was needed' using errcode = '22023';
  end if;

  update public.resident_service_task_instances set
    status = v_status,
    completion_response = p_response,
    exception_details = v_details,
    documented_assistance_level = v_level,
    performed_at = now(),
    recorded_by_profile_id = auth.uid(),
    completed_by_employee_id = coalesce(v_employee.id, completed_by_employee_id),
    second_employee_id = coalesce(p_second_employee_id, second_employee_id),
    supervisor_notified = coalesce((v_details->>'supervisor_notified')::boolean, false),
    supervisor_notified_at = case
      when coalesce((v_details->>'supervisor_notified')::boolean, false) then now()
      else supervisor_notified_at end,
    note = nullif(btrim(coalesce(v_details->>'note', '')), ''),
    updated_at = now()
  where id = v_task.id
  returning * into v_task;

  return v_task;
end $$;

revoke all on function public.record_service_task_response(uuid, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_service_task_response(uuid, text, jsonb, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Unscheduled services
-- ---------------------------------------------------------------------------
--
-- Care that was provided but not scheduled. PointClickCare's service-delivery strength is capturing
-- exactly this, and CareBase had no home for it at all: the whole utilization picture was limited to
-- what somebody had already planned.

create table public.resident_unscheduled_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  service_kind text not null check (service_kind in (
    'unscheduled_toileting', 'extra_transfer_assistance', 'additional_redirection',
    'increased_supervision', 'extra_meal_assistance', 'additional_hygiene',
    'behavioral_intervention', 'unplanned_safety_check'
  )),
  occurred_at timestamptz not null default now(),
  -- Minutes are optional on purpose: forcing a number staff have to guess produces confident
  -- fiction, and the count of events is the signal that actually drives review.
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 480),
  requires_two_staff boolean not null default false,
  note text,
  recorded_by_profile_id uuid references public.profiles(id) on delete set null,
  recorded_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  check (occurred_at <= now() + interval '1 hour')
);

create index resident_unscheduled_services_resident_idx
  on public.resident_unscheduled_services(resident_id, occurred_at desc);
create index resident_unscheduled_services_scope_idx
  on public.resident_unscheduled_services(organization_id, facility_id, service_kind, occurred_at desc);

alter table public.resident_unscheduled_services enable row level security;
revoke all on table public.resident_unscheduled_services from public, anon, authenticated, service_role;
grant all on table public.resident_unscheduled_services to service_role;
grant select on table public.resident_unscheduled_services to authenticated;

-- Employees have no direct RLS reach to residents, so reads follow the same care-delivery
-- visibility the service task queue uses rather than the admission-management path.
create policy resident_unscheduled_services_select on public.resident_unscheduled_services
  for select to authenticated
  using (
    app_private.admission_row_visible(organization_id, facility_id)
    or exists (
      select 1 from public.employees e
      where e.profile_id = auth.uid() and e.status = 'active' and e.facility_id = resident_unscheduled_services.facility_id
    )
  );

create trigger audit_resident_unscheduled_services
  after insert or update or delete on public.resident_unscheduled_services
  for each row execute function public.audit_log_trigger();

create or replace function public.record_unscheduled_service(
  p_resident_id uuid,
  p_service_kind text,
  p_occurred_at timestamptz default null,
  p_duration_minutes integer default null,
  p_requires_two_staff boolean default false,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_employee public.employees%rowtype;
  v_is_manager boolean;
  v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;

  select * into v_employee from public.employees e where e.profile_id = auth.uid() and e.status = 'active';
  v_is_manager := public.is_platform_admin()
    or (
      public.current_org_id() = v_resident.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_resident.facility_id))
    );
  -- The people who deliver unscheduled care are the ones who must be able to record it. An aide can
  -- record for a resident at the facility they are actively assigned to, and nowhere else.
  if not v_is_manager and (v_employee.id is null or v_employee.facility_id <> v_resident.facility_id) then
    raise exception 'Resident is outside caller scope' using errcode = '42501';
  end if;

  insert into public.resident_unscheduled_services(
    organization_id, facility_id, resident_id, service_kind, occurred_at,
    duration_minutes, requires_two_staff, note, recorded_by_profile_id, recorded_by_employee_id
  )
  values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_service_kind,
    coalesce(p_occurred_at, now()), p_duration_minutes, coalesce(p_requires_two_staff, false),
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_employee.id
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_unscheduled_service(uuid, text, timestamptz, integer, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_unscheduled_service(uuid, text, timestamptz, integer, boolean, text)
  to authenticated, service_role;

-- Utilization read model. Returns counts by kind over a window plus the documented-assistance
-- exceptions in the same period, so the care-level review can finally rest on what staff actually
-- did rather than on what somebody planned.
create or replace function public.get_resident_service_utilization(
  p_resident_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  v_since := now() - (v_days || ' days')::interval;
  return jsonb_build_object(
    'residentId', p_resident_id,
    'windowDays', v_days,
    'since', v_since,
    'unscheduled', coalesce((
      select jsonb_object_agg(service_kind, kind_count)
      from (
        select service_kind, count(*) as kind_count
        from public.resident_unscheduled_services u
        where u.resident_id = p_resident_id and u.occurred_at >= v_since
        group by service_kind
      ) kinds
    ), '{}'::jsonb),
    'unscheduledTotal', (
      select count(*) from public.resident_unscheduled_services u
      where u.resident_id = p_resident_id and u.occurred_at >= v_since
    ),
    'exceptions', coalesce((
      select jsonb_object_agg(completion_response, response_count)
      from (
        select completion_response, count(*) as response_count
        from public.resident_service_task_instances t
        where t.resident_id = p_resident_id
          and t.completion_response is not null
          and t.completion_response <> 'completed_as_planned'
          and coalesce(t.performed_at, t.scheduled_start) >= v_since
        group by completion_response
      ) responses
    ), '{}'::jsonb),
    'documentedAssistance', coalesce((
      select jsonb_object_agg(documented_assistance_level, level_count)
      from (
        select documented_assistance_level, count(*) as level_count
        from public.resident_service_task_instances t
        where t.resident_id = p_resident_id
          and t.documented_assistance_level is not null
          and coalesce(t.performed_at, t.scheduled_start) >= v_since
        group by documented_assistance_level
      ) levels
    ), '{}'::jsonb)
  );
end $$;

revoke all on function public.get_resident_service_utilization(uuid, integer) from public, anon;
grant execute on function public.get_resident_service_utilization(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Surface the delivery contract on the task queue
-- ---------------------------------------------------------------------------
--
-- The queue returned special_instructions, requires_two_staff, and documentation_mode but nothing
-- about the contract added in Phase 3c. Without task_kind and acceptable_completion_responses the
-- floor surface cannot offer the right responses, and without refusal_handling an aide who records
-- a refusal is not shown what the plan says to do next -- which is the one moment that instruction
-- exists for. completion_response is returned so an already-documented task shows what was recorded
-- rather than just a status.
--
-- Additive: the same signature and body plus five output columns. Existing callers select by name.

drop function if exists public.get_resident_service_task_queue(timestamptz, timestamptz, uuid, text);

create or replace function public.get_resident_service_task_queue(
  p_from timestamptz default date_trunc('day', now()),
  p_through timestamptz default date_trunc('day', now()) + interval '1 day',
  p_facility_id uuid default null,
  p_status text default null
)
returns table (
  id uuid,
  organization_id uuid,
  facility_id uuid,
  facility_name text,
  resident_id uuid,
  resident_name text,
  resident_room text,
  requirement_id uuid,
  source_assessment_form_id uuid,
  source_plan_version integer,
  service_name text,
  special_instructions text,
  responsible_role text,
  unit_name text,
  requires_two_staff boolean,
  documentation_mode text,
  task_kind text,
  acceptable_completion_responses text[],
  refusal_handling text,
  required_qualification_key text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  assigned_employee_id uuid,
  assigned_employee_name text,
  status text,
  completion_response text,
  note text,
  supervisor_notified boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if auth.uid() is null or p_through <= p_from or p_through > p_from + interval '45 days' then
    raise exception 'Invalid service queue request' using errcode = '22023';
  end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  return query
  select
    t.id, t.organization_id, t.facility_id, f.name,
    t.resident_id, r.first_name || ' ' || r.last_name, r.room,
    t.requirement_id, t.source_assessment_form_id, t.source_plan_version,
    t.service_name, req.special_instructions, t.responsible_role, u.name,
    req.requires_two_staff, req.documentation_mode,
    req.task_kind, req.acceptable_completion_responses, req.refusal_handling,
    req.required_qualification_key,
    t.scheduled_start, t.scheduled_end, t.assigned_employee_id,
    case when ae.id is null then null else ae.first_name || ' ' || ae.last_name end,
    t.status, t.completion_response, t.note, t.supervisor_notified
  from public.resident_service_task_instances t
  join public.resident_service_requirements req on req.id = t.requirement_id
  join public.residents r on r.id = t.resident_id
  join public.facilities f on f.id = t.facility_id
  left join public.facility_units u on u.id = t.unit_id
  left join public.employees ae on ae.id = t.assigned_employee_id
  where t.scheduled_start >= p_from
    and t.scheduled_start < p_through
    and (p_facility_id is null or t.facility_id = p_facility_id)
    and (p_status is null or t.status = p_status)
    and (
      public.is_platform_admin()
      or (
        t.organization_id = public.current_org_id()
        and (
          v_role in ('org_admin', 'auditor')
          or (v_role = 'facility_manager' and public.is_assigned_to_facility(t.facility_id))
          or (
            v_role = 'employee'
            and v_employee.facility_id = t.facility_id
            and (t.assigned_employee_id is null or t.assigned_employee_id = v_employee.id)
          )
        )
      )
    )
  order by t.scheduled_start, r.last_name, r.first_name, t.service_name;
end;
$$;

revoke all on function public.get_resident_service_task_queue(timestamptz, timestamptz, uuid, text)
  from public, anon;
grant execute on function public.get_resident_service_task_queue(timestamptz, timestamptz, uuid, text)
  to authenticated, service_role;
