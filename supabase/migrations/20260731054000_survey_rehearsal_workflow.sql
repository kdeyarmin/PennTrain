-- Survey rehearsal with random sampling.
--
-- Completes the Wave 3 "survey rehearsal/random sampling" gap: a durable system of record
-- for mock surveys that draws a random sample of live compliance artifacts, records item
-- findings, and produces a completion report managers can print before a real survey.

create table public.survey_rehearsals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name text not null check (length(btrim(name)) between 3 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'sampled', 'in_progress', 'completed', 'canceled')),
  sample_method text not null default 'random'
    check (sample_method in ('random', 'high_risk', 'manual')),
  sample_size integer not null default 10 check (sample_size between 1 and 200),
  scheduled_for date,
  started_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  notes text,
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'canceled') = (canceled_at is not null))
);

create index survey_rehearsals_org_status_idx
  on public.survey_rehearsals(organization_id, status, created_at desc);
create index survey_rehearsals_facility_idx
  on public.survey_rehearsals(facility_id, created_at desc);

create table public.survey_rehearsal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  rehearsal_id uuid not null references public.survey_rehearsals(id) on delete cascade,
  domain text not null check (domain in (
    'employee_credential', 'training_record', 'incident', 'policy_attestation',
    'resident_compliance', 'inspection_item', 'work_item'
  )),
  source_id uuid,
  source_label text not null check (length(btrim(source_label)) between 1 and 500),
  risk_tier text not null default 'standard'
    check (risk_tier in ('standard', 'elevated', 'critical')),
  result text not null default 'pending'
    check (result in ('pending', 'pass', 'attention', 'not_applicable')),
  finding text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((result = 'pending') = (reviewed_at is null))
);

create index survey_rehearsal_items_rehearsal_idx
  on public.survey_rehearsal_items(rehearsal_id, result, domain);

alter table public.survey_rehearsals enable row level security;
alter table public.survey_rehearsal_items enable row level security;
revoke all on public.survey_rehearsals from public, anon, authenticated;
revoke all on public.survey_rehearsal_items from public, anon, authenticated;
grant select on public.survey_rehearsals to authenticated;
grant select on public.survey_rehearsal_items to authenticated;
grant all on public.survey_rehearsals to service_role;
grant all on public.survey_rehearsal_items to service_role;

create policy survey_rehearsals_select on public.survey_rehearsals
for select to authenticated using (
  app_private.admission_row_visible(organization_id, facility_id)
);
create policy survey_rehearsal_items_select on public.survey_rehearsal_items
for select to authenticated using (
  app_private.admission_row_visible(organization_id, facility_id)
);

create trigger survey_rehearsals_updated_at before update on public.survey_rehearsals
for each row execute function public.set_updated_at();
create trigger survey_rehearsal_items_updated_at before update on public.survey_rehearsal_items
for each row execute function public.set_updated_at();
create trigger survey_rehearsals_audit after insert or update or delete on public.survey_rehearsals
for each row execute function public.audit_log_trigger();
create trigger survey_rehearsal_items_audit after insert or update or delete on public.survey_rehearsal_items
for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
) values
  (
    'survey_rehearsals',
    'row_trigger',
    true,
    'Survey rehearsal scope, sample method, and completion report are regulated survey-readiness evidence (20260731054000)'
  ),
  (
    'survey_rehearsal_items',
    'row_trigger',
    true,
    'Sampled artifact findings from mock surveys are regulated survey-readiness evidence (20260731054000)'
  )
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create or replace function public.create_survey_rehearsal(
  p_facility_id uuid,
  p_name text,
  p_sample_size integer default 10,
  p_sample_method text default 'random',
  p_scheduled_for date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac public.facilities%rowtype;
  v_id uuid;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if v_fac.id is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if length(btrim(coalesce(p_name, ''))) < 3 then
    raise exception 'Rehearsal name is required' using errcode = '22023';
  end if;
  if p_sample_size is null or p_sample_size < 1 or p_sample_size > 200 then
    raise exception 'Sample size must be between 1 and 200' using errcode = '22023';
  end if;
  if p_sample_method not in ('random', 'high_risk', 'manual') then
    raise exception 'Unsupported sample method' using errcode = '22023';
  end if;

  insert into public.survey_rehearsals(
    organization_id, facility_id, name, sample_size, sample_method,
    scheduled_for, notes, created_by
  ) values (
    v_fac.organization_id,
    v_fac.id,
    btrim(p_name),
    p_sample_size,
    p_sample_method,
    p_scheduled_for,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.sample_survey_rehearsal(p_rehearsal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.survey_rehearsals%rowtype;
  v_inserted integer := 0;
begin
  select * into v from public.survey_rehearsals where id = p_rehearsal_id for update;
  if v.id is null then raise exception 'Survey rehearsal not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status not in ('draft', 'sampled') then
    raise exception 'Only draft or sampled rehearsals can be (re)sampled' using errcode = '22023';
  end if;

  delete from public.survey_rehearsal_items where rehearsal_id = v.id;

  -- Random sample across current live compliance surfaces. Each domain contributes a share,
  -- then a final trim keeps the configured size.
  with pool as (
    (
      select 'employee_credential'::text as domain, c.id as source_id,
             concat(e.last_name, ', ', e.first_name, ': ', coalesce(c.credential_label, c.credential_type)) as source_label,
             case when c.status in ('expired', 'missing') then 'critical'
                  when c.status = 'due_soon' then 'elevated' else 'standard' end as risk_tier
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id
      where c.facility_id = v.facility_id and e.status = 'active'
      order by case when v.sample_method = 'high_risk'
        then case when c.status in ('expired', 'missing') then 0 when c.status = 'due_soon' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'training_record', t.id,
             concat(e.last_name, ', ', e.first_name, ': training ', coalesce(t.status, 'unknown')),
             case when t.status in ('expired', 'missing') then 'critical'
                  when t.status = 'due_soon' then 'elevated' else 'standard' end
      from public.employee_training_records t
      join public.employees e on e.id = t.employee_id
      where t.facility_id = v.facility_id and e.status = 'active'
      order by case when v.sample_method = 'high_risk'
        then case when t.status in ('expired', 'missing') then 0 when t.status = 'due_soon' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'incident', i.id,
             concat('Incident ', coalesce(i.incident_type, 'event'), ' · ', to_char(i.occurred_at, 'YYYY-MM-DD')),
             case when i.closed_at is null then 'elevated' else 'standard' end
      from public.incidents i
      where i.facility_id = v.facility_id
      order by case when v.sample_method = 'high_risk'
        then case when i.closed_at is null then 0 else 1 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'work_item', w.id,
             concat('Work: ', left(w.title, 120)),
             case when w.priority in ('urgent', 'high') then 'elevated' else 'standard' end
      from public.work_items w
      where w.facility_id = v.facility_id
        and w.state not in ('closed', 'canceled')
      order by case when v.sample_method = 'high_risk'
        then case when w.priority = 'urgent' then 0 when w.priority = 'high' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
  ),
  chosen as (
    select * from pool
    order by case when v.sample_method = 'high_risk'
      then case risk_tier when 'critical' then 0 when 'elevated' then 1 else 2 end
      else 0 end,
      random()
    limit v.sample_size
  )
  insert into public.survey_rehearsal_items(
    organization_id, facility_id, rehearsal_id, domain, source_id, source_label, risk_tier
  )
  select v.organization_id, v.facility_id, v.id, domain, source_id, source_label, risk_tier
  from chosen;
  get diagnostics v_inserted = row_count;

  update public.survey_rehearsals
  set status = 'sampled',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = v.id;

  return jsonb_build_object(
    'rehearsalId', v.id,
    'status', 'sampled',
    'itemCount', v_inserted,
    'sampleMethod', v.sample_method,
    'sampleSize', v.sample_size
  );
end;
$$;

create or replace function public.record_survey_rehearsal_item_result(
  p_item_id uuid,
  p_result text,
  p_finding text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.survey_rehearsal_items%rowtype;
  v_rehearsal public.survey_rehearsals%rowtype;
begin
  select * into v from public.survey_rehearsal_items where id = p_item_id for update;
  if v.id is null then raise exception 'Rehearsal item not found' using errcode = 'P0002'; end if;
  select * into v_rehearsal from public.survey_rehearsals where id = v.rehearsal_id for update;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v_rehearsal.status in ('completed', 'canceled') then
    raise exception 'Closed rehearsals cannot be updated' using errcode = '22023';
  end if;
  if p_result not in ('pending', 'pass', 'attention', 'not_applicable') then
    raise exception 'Unsupported rehearsal result' using errcode = '22023';
  end if;

  update public.survey_rehearsal_items
  set result = p_result,
      finding = nullif(btrim(coalesce(p_finding, '')), ''),
      reviewed_by = case when p_result = 'pending' then null else auth.uid() end,
      reviewed_at = case when p_result = 'pending' then null else now() end,
      updated_at = now()
  where id = v.id;

  if v_rehearsal.status = 'sampled' and p_result <> 'pending' then
    update public.survey_rehearsals
    set status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = v_rehearsal.id;
  end if;
  return true;
end;
$$;

create or replace function public.complete_survey_rehearsal(p_rehearsal_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.survey_rehearsals%rowtype;
  v_total integer := 0;
  v_pass integer := 0;
  v_attention integer := 0;
  v_pending integer := 0;
  v_report jsonb;
begin
  select * into v from public.survey_rehearsals where id = p_rehearsal_id for update;
  if v.id is null then raise exception 'Survey rehearsal not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status not in ('sampled', 'in_progress') then
    raise exception 'Only sampled or in-progress rehearsals can be completed' using errcode = '22023';
  end if;

  select count(*)::integer,
         count(*) filter (where result = 'pass')::integer,
         count(*) filter (where result = 'attention')::integer,
         count(*) filter (where result = 'pending')::integer
  into v_total, v_pass, v_attention, v_pending
  from public.survey_rehearsal_items
  where rehearsal_id = v.id;

  if v_total = 0 then
    raise exception 'Sample items before completing the rehearsal' using errcode = '22023';
  end if;
  if v_pending > 0 then
    raise exception 'Resolve every sample item before completing the rehearsal' using errcode = '22023';
  end if;

  v_report := jsonb_build_object(
    'completedAt', now(),
    'completedBy', auth.uid(),
    'totalItems', v_total,
    'passCount', v_pass,
    'attentionCount', v_attention,
    'passRate', case when v_total = 0 then 0 else round((v_pass::numeric / v_total) * 100, 1) end,
    'sampleMethod', v.sample_method,
    'sampleSize', v.sample_size,
    'notes', nullif(btrim(coalesce(p_notes, v.notes, '')), '')
  );

  update public.survey_rehearsals
  set status = 'completed',
      completed_at = now(),
      completed_by = auth.uid(),
      notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
      report = v_report,
      updated_at = now()
  where id = v.id;

  return v_report;
end;
$$;

create or replace function public.cancel_survey_rehearsal(p_rehearsal_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.survey_rehearsals%rowtype;
begin
  select * into v from public.survey_rehearsals where id = p_rehearsal_id for update;
  if v.id is null then raise exception 'Survey rehearsal not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status in ('completed', 'canceled') then
    raise exception 'Rehearsal is already closed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Cancellation reason is required' using errcode = '22023';
  end if;
  update public.survey_rehearsals
  set status = 'canceled',
      canceled_at = now(),
      notes = concat_ws(E'\n', notes, 'Canceled: ' || btrim(p_reason)),
      updated_at = now()
  where id = v.id;
  return true;
end;
$$;

revoke all on function public.create_survey_rehearsal(uuid, text, integer, text, date, text)
  from public, anon;
revoke all on function public.sample_survey_rehearsal(uuid) from public, anon;
revoke all on function public.record_survey_rehearsal_item_result(uuid, text, text) from public, anon;
revoke all on function public.complete_survey_rehearsal(uuid, text) from public, anon;
revoke all on function public.cancel_survey_rehearsal(uuid, text) from public, anon;
grant execute on function public.create_survey_rehearsal(uuid, text, integer, text, date, text)
  to authenticated, service_role;
grant execute on function public.sample_survey_rehearsal(uuid) to authenticated, service_role;
grant execute on function public.record_survey_rehearsal_item_result(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.complete_survey_rehearsal(uuid, text) to authenticated, service_role;
grant execute on function public.cancel_survey_rehearsal(uuid, text) to authenticated, service_role;
