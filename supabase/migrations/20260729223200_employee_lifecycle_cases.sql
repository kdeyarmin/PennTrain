-- Guided employee transfer, leave, return, termination, rehire, and access cases.
--
-- The workforce lifecycle engine already previews and atomically applies dependent schedule, class,
-- course, access, and facility changes. The missing product layer was a durable case that preserves
-- the requested reason/date/target, the dependency preview a manager reviewed, and the event produced
-- when the transition was applied.

create table public.employee_lifecycle_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_facility_id uuid not null references public.facilities(id) on delete restrict,
  target_facility_id uuid references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  transition text not null check (transition in (
    'rehire','transfer','leave','return','terminate','suspend_access','restore_access'
  )),
  status text not null default 'draft' check (status in ('draft','ready','blocked','applied','canceled')),
  effective_on date not null,
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  preview jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  previewed_at timestamptz,
  lifecycle_event_id uuid references public.employment_lifecycle_events(id) on delete restrict,
  requested_by uuid references public.profiles(id) on delete set null,
  applied_by uuid references public.profiles(id) on delete set null,
  applied_at timestamptz,
  canceled_by uuid references public.profiles(id) on delete set null,
  canceled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((transition = 'transfer') = (target_facility_id is not null)),
  check ((status = 'applied') = (lifecycle_event_id is not null and applied_at is not null)),
  check ((status = 'canceled') = (canceled_at is not null and nullif(btrim(cancellation_reason), '') is not null))
);
create index employee_lifecycle_cases_employee_idx
  on public.employee_lifecycle_cases(employee_id, created_at desc);
create index employee_lifecycle_cases_org_status_idx
  on public.employee_lifecycle_cases(organization_id, status, effective_on);

alter table public.employee_lifecycle_cases enable row level security;
create policy employee_lifecycle_cases_select on public.employee_lifecycle_cases
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_admin','auditor')
      or (public.current_role() = 'facility_manager'
        and (
          public.is_assigned_to_facility(source_facility_id)
          or (target_facility_id is not null and public.is_assigned_to_facility(target_facility_id))
        ))
    )
  )
);
revoke all on public.employee_lifecycle_cases from public, anon, authenticated;
grant select on public.employee_lifecycle_cases to authenticated;
grant all on public.employee_lifecycle_cases to service_role;

create trigger employee_lifecycle_cases_updated_at before update on public.employee_lifecycle_cases
for each row execute function public.set_updated_at();
create trigger employee_lifecycle_cases_audit after insert or update or delete on public.employee_lifecycle_cases
for each row execute function public.audit_log_trigger();

create or replace function public.create_employee_lifecycle_case(
  p_employee_id uuid,
  p_transition text,
  p_effective_on date,
  p_target_facility_id uuid default null,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_preview jsonb;
  v_case_id uuid;
  v_status text;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if p_transition not in ('rehire','transfer','leave','return','terminate','suspend_access','restore_access') then
    raise exception 'Unsupported lifecycle transition' using errcode = '22023';
  end if;
  if p_transition = 'transfer' and p_target_facility_id is null then
    raise exception 'A target facility is required for transfer' using errcode = '22023';
  end if;
  if p_transition <> 'transfer' and p_target_facility_id is not null then
    raise exception 'A target facility is valid only for transfer' using errcode = '22023';
  end if;
  if p_effective_on is null or p_effective_on > public.pa_today() then
    raise exception 'Effective date is required and cannot be in the future' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  -- This existing function performs the authoritative permission and transition-state checks and
  -- returns the exact downstream schedule/course/class/access consequences for human review.
  v_preview := public.preview_employee_lifecycle_transition(
    p_employee_id,
    p_transition,
    p_effective_on,
    p_target_facility_id,
    p_reason
  );
  v_status := case when coalesce((v_preview ->> 'allowed')::boolean, false) then 'ready' else 'blocked' end;

  insert into public.employee_lifecycle_cases(
    organization_id, source_facility_id, target_facility_id, employee_id, transition,
    status, effective_on, reason, preview, previewed_at, requested_by
  ) values (
    v_employee.organization_id,
    v_employee.facility_id,
    p_target_facility_id,
    p_employee_id,
    p_transition,
    v_status,
    p_effective_on,
    btrim(p_reason),
    v_preview,
    now(),
    auth.uid()
  ) returning id into v_case_id;
  return v_case_id;
end;
$$;

create or replace function public.refresh_employee_lifecycle_case(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.employee_lifecycle_cases%rowtype;
  v_preview jsonb;
begin
  select * into v_case from public.employee_lifecycle_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'Lifecycle case not found' using errcode = 'P0002'; end if;
  if v_case.status in ('applied','canceled') then raise exception 'Closed lifecycle cases cannot be refreshed' using errcode = '22023'; end if;

  v_preview := public.preview_employee_lifecycle_transition(
    v_case.employee_id,
    v_case.transition,
    v_case.effective_on,
    v_case.target_facility_id,
    v_case.reason
  );
  update public.employee_lifecycle_cases
  set preview = v_preview,
      previewed_at = now(),
      status = case when coalesce((v_preview ->> 'allowed')::boolean, false) then 'ready' else 'blocked' end,
      updated_at = now()
  where id = p_case_id;
  return v_preview;
end;
$$;

create or replace function public.apply_employee_lifecycle_case(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.employee_lifecycle_cases%rowtype;
  v_preview jsonb;
  v_event_id uuid;
begin
  select * into v_case from public.employee_lifecycle_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'Lifecycle case not found' using errcode = 'P0002'; end if;
  if v_case.status <> 'ready' then raise exception 'Only a ready lifecycle case may be applied' using errcode = '22023'; end if;

  -- Re-preview while holding the case lock so the decision never applies against stale dependencies.
  v_preview := public.preview_employee_lifecycle_transition(
    v_case.employee_id,
    v_case.transition,
    v_case.effective_on,
    v_case.target_facility_id,
    v_case.reason
  );
  if not coalesce((v_preview ->> 'allowed')::boolean, false) then
    update public.employee_lifecycle_cases
    set status = 'blocked', preview = v_preview, previewed_at = now(), updated_at = now()
    where id = p_case_id;
    raise exception 'Lifecycle conditions changed; review the refreshed preview' using errcode = '40001';
  end if;

  v_event_id := public.apply_employee_lifecycle_transition(
    v_case.employee_id,
    v_case.transition,
    v_case.effective_on,
    v_case.target_facility_id,
    v_case.reason
  );
  update public.employee_lifecycle_cases
  set status = 'applied',
      preview = v_preview,
      previewed_at = now(),
      lifecycle_event_id = v_event_id,
      applied_by = auth.uid(),
      applied_at = now(),
      updated_at = now()
  where id = p_case_id;

  return jsonb_build_object(
    'caseId', p_case_id,
    'status', 'applied',
    'lifecycleEventId', v_event_id,
    'transition', v_case.transition,
    'preview', v_preview
  );
end;
$$;

create or replace function public.cancel_employee_lifecycle_case(p_case_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.employee_lifecycle_cases%rowtype;
begin
  select * into v_case from public.employee_lifecycle_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'Lifecycle case not found' using errcode = 'P0002'; end if;
  if v_case.status in ('applied','canceled') then raise exception 'Lifecycle case is already closed' using errcode = '22023'; end if;
  -- Reuse the authoritative preview solely as the permission check for this employee/facility scope.
  perform public.preview_employee_lifecycle_transition(
    v_case.employee_id, v_case.transition, v_case.effective_on,
    v_case.target_facility_id, v_case.reason
  );
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Cancellation reason is required' using errcode = '22023'; end if;
  update public.employee_lifecycle_cases
  set status = 'canceled', canceled_by = auth.uid(), canceled_at = now(),
      cancellation_reason = btrim(p_reason), updated_at = now()
  where id = p_case_id;
  return true;
end;
$$;

revoke all on function public.create_employee_lifecycle_case(uuid,text,date,uuid,text) from public, anon;
revoke all on function public.refresh_employee_lifecycle_case(uuid) from public, anon;
revoke all on function public.apply_employee_lifecycle_case(uuid) from public, anon;
revoke all on function public.cancel_employee_lifecycle_case(uuid,text) from public, anon;
grant execute on function public.create_employee_lifecycle_case(uuid,text,date,uuid,text) to authenticated, service_role;
grant execute on function public.refresh_employee_lifecycle_case(uuid) to authenticated, service_role;
grant execute on function public.apply_employee_lifecycle_case(uuid) to authenticated, service_role;
grant execute on function public.cancel_employee_lifecycle_case(uuid,text) to authenticated, service_role;
