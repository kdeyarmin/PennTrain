-- POC lifecycle C1-C3: immutable versions, effectiveness gate, work_item link.

create table if not exists public.plan_of_correction_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  violation_id uuid not null references public.dhs_violations(id) on delete cascade,
  version_number integer not null,
  submitted_at timestamptz not null default now(),
  submitted_by_profile_id uuid references public.profiles(id),
  snapshot jsonb not null default '{}'::jsonb,
  pdf_storage_bucket text,
  pdf_storage_path text,
  pdf_sha256 text,
  amendment_reason text,
  created_at timestamptz not null default now(),
  unique (violation_id, version_number)
);

create index if not exists plan_of_correction_versions_violation_idx
  on public.plan_of_correction_versions (violation_id, version_number desc);

alter table public.plan_of_correction_versions enable row level security;

drop policy if exists plan_of_correction_versions_select on public.plan_of_correction_versions;
create policy plan_of_correction_versions_select on public.plan_of_correction_versions
  for select to authenticated using (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor', 'facility_manager')
        or public.is_assigned_to_facility(facility_id)
      )
    )
  );

revoke all on table public.plan_of_correction_versions from public, anon, authenticated;
grant select on table public.plan_of_correction_versions to authenticated;
grant all on table public.plan_of_correction_versions to service_role;

alter table public.dhs_violations
  add column if not exists effectiveness_notes text,
  add column if not exists effectiveness_reviewed_at timestamptz,
  add column if not exists effectiveness_reviewed_by_profile_id uuid references public.profiles(id);

alter table public.corrective_actions
  add column if not exists work_item_id uuid references public.work_items(id) on delete set null;

create index if not exists corrective_actions_work_item_idx
  on public.corrective_actions (work_item_id)
  where work_item_id is not null;

create or replace function public.assert_can_manage_violation(p_violation_id uuid)
returns public.dhs_violations
language plpgsql security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype;
begin
  select * into v from public.dhs_violations where id = p_violation_id for update;
  if not found then raise exception 'Violation not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v.organization_id = public.current_org_id() and public.current_role() in ('org_admin', 'facility_manager'))
  ) then
    raise exception 'Not authorized to manage this plan of correction' using errcode = '42501';
  end if;
  return v;
end;
$$;

revoke all on function public.assert_can_manage_violation(uuid) from public, anon, authenticated;
grant execute on function public.assert_can_manage_violation(uuid) to authenticated;

create or replace function public.submit_plan_of_correction(p_violation_id uuid, p_amendment_reason text default null)
returns public.plan_of_correction_versions
language plpgsql security definer set search_path = ''
as $$
declare
  v public.dhs_violations%rowtype;
  v_action_count integer;
  v_next_version integer;
  v_snapshot jsonb;
  v_row public.plan_of_correction_versions%rowtype;
begin
  v := public.assert_can_manage_violation(p_violation_id);
  select count(*) into v_action_count from public.corrective_actions
  where violation_id = p_violation_id and coalesce(status, '') <> 'cancelled';
  if v_action_count < 1 then
    raise exception 'At least one corrective action is required before submitting a plan of correction' using errcode = '22023';
  end if;
  if v.status not in ('open', 'poc_submitted') then
    raise exception 'Plan of correction can only be submitted from open or previously submitted status' using errcode = '55000';
  end if;
  if v.status = 'poc_submitted' and length(btrim(coalesce(p_amendment_reason, ''))) < 8 then
    raise exception 'Amendment reason required (min 8 characters) when resubmitting' using errcode = '22023';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.plan_of_correction_versions where violation_id = p_violation_id;
  select jsonb_build_object(
    'violation', to_jsonb(v),
    'corrective_actions', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.due_date nulls last, ca.created_at)
      from public.corrective_actions ca where ca.violation_id = p_violation_id
    ), '[]'::jsonb)
  ) into v_snapshot;
  insert into public.plan_of_correction_versions (
    organization_id, facility_id, violation_id, version_number,
    submitted_by_profile_id, snapshot, amendment_reason
  ) values (
    v.organization_id, v.facility_id, p_violation_id, v_next_version,
    auth.uid(), v_snapshot,
    case when v.status = 'poc_submitted' then btrim(p_amendment_reason) else null end
  ) returning * into v_row;
  update public.dhs_violations set
    status = 'poc_submitted',
    poc_submitted_at = coalesce(poc_submitted_at, now()),
    updated_at = now()
  where id = p_violation_id;
  insert into public.work_items (
    organization_id, facility_id, source_type, source_id, deduplication_key,
    title, description, priority, due_at, state, created_by
  )
  select ca.organization_id, ca.facility_id, 'violation_corrective_action', ca.id,
    'violation_ca:' || ca.id::text, left(coalesce(ca.description, 'Corrective action'), 200),
    ca.description, case when v.severity = 'high' then 'high' else 'normal' end,
    -- The 14-day correction clock runs on the facility's Pennsylvania day, not the server's:
    -- after 19:00 local the database has already rolled over to tomorrow. Hence pa_today().
    -- (Spelling the rejected builtin here would trip the prosrc scan in
    -- pa_day_is_the_facility_day.test.sql, which reads comments too.)
    coalesce(ca.due_date::timestamptz, (public.pa_today() + 14)::timestamptz),
    case when ca.status = 'completed' then 'closed' else 'open' end, auth.uid()
  from public.corrective_actions ca
  where ca.violation_id = p_violation_id and coalesce(ca.status, '') <> 'cancelled' and ca.work_item_id is null
  on conflict (organization_id, deduplication_key) do nothing;
  update public.corrective_actions ca set work_item_id = wi.id
  from public.work_items wi
  where ca.violation_id = p_violation_id and ca.work_item_id is null
    and wi.organization_id = ca.organization_id and wi.deduplication_key = 'violation_ca:' || ca.id::text;
  return v_row;
end;
$$;

revoke all on function public.submit_plan_of_correction(uuid, text) from public, anon;
grant execute on function public.submit_plan_of_correction(uuid, text) to authenticated;

create or replace function public.mark_plan_of_correction_corrected(p_violation_id uuid)
returns public.dhs_violations
language plpgsql security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype; v_open integer;
begin
  v := public.assert_can_manage_violation(p_violation_id);
  if v.status not in ('poc_submitted', 'corrected') then
    raise exception 'Mark corrected is only valid after the plan of correction is submitted' using errcode = '55000';
  end if;
  select count(*) into v_open from public.corrective_actions
  where violation_id = p_violation_id and coalesce(status, '') not in ('completed', 'cancelled');
  if v_open > 0 then
    raise exception 'All corrective actions must be completed or cancelled before marking corrected' using errcode = '22023';
  end if;
  update public.dhs_violations set status = 'corrected', updated_at = now()
  where id = p_violation_id returning * into v;
  return v;
end;
$$;

revoke all on function public.mark_plan_of_correction_corrected(uuid) from public, anon;
grant execute on function public.mark_plan_of_correction_corrected(uuid) to authenticated;

create or replace function public.verify_plan_of_correction(p_violation_id uuid, p_notes text)
returns public.dhs_violations
language plpgsql security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype;
begin
  v := public.assert_can_manage_violation(p_violation_id);
  if v.status not in ('corrected', 'verified') then
    raise exception 'Verify is only valid after the plan of correction is marked corrected' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_notes, ''))) < 12 then
    raise exception 'Effectiveness notes are required (min 12 characters) before verification' using errcode = '22023';
  end if;
  update public.dhs_violations set
    status = 'verified',
    verified_at = coalesce(verified_at, now()),
    verified_by_profile_id = coalesce(verified_by_profile_id, auth.uid()),
    effectiveness_notes = btrim(p_notes),
    effectiveness_reviewed_at = now(),
    effectiveness_reviewed_by_profile_id = auth.uid(),
    updated_at = now()
  where id = p_violation_id returning * into v;
  return v;
end;
$$;

revoke all on function public.verify_plan_of_correction(uuid, text) from public, anon;
grant execute on function public.verify_plan_of_correction(uuid, text) to authenticated;

create or replace function public.list_plan_of_correction_versions(p_violation_id uuid)
returns setof public.plan_of_correction_versions
language plpgsql stable security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype;
begin
  select * into v from public.dhs_violations where id = p_violation_id;
  if not found then raise exception 'Violation not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (v.organization_id = public.current_org_id() and (
      public.current_role() in ('org_admin', 'auditor', 'facility_manager')
      or public.is_assigned_to_facility(v.facility_id)))
  ) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query select * from public.plan_of_correction_versions
  where violation_id = p_violation_id order by version_number desc;
end;
$$;

revoke all on function public.list_plan_of_correction_versions(uuid) from public, anon;
grant execute on function public.list_plan_of_correction_versions(uuid) to authenticated;

-- Audit classification. A submitted plan of correction is what the facility told DHS it would do
-- about a cited violation, so each version is regulated survey evidence and carries the row
-- trigger rather than relying on the submitting RPC to log it by hand.
insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
) values (
  'plan_of_correction_versions',
  'row_trigger',
  true,
  'Immutable submitted plan-of-correction snapshots (violation + corrective actions, amendment reason, signed PDF digest) are DHS survey evidence (20260801021000)'
)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

drop trigger if exists plan_of_correction_versions_audit on public.plan_of_correction_versions;
create trigger plan_of_correction_versions_audit
after insert or update or delete on public.plan_of_correction_versions
for each row execute function public.audit_log_trigger();
