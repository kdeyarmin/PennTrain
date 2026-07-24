-- Native clinical domain 1: vitals & clinical observations.
--
-- The first native EHR slice. Frontline staff (employees) capture LOINC-ready structured
-- observations directly in-app; managers and org admins can too. This reuses the
-- structured change-of-condition access model exactly: SELECT-only table grants, all
-- writes through SECURITY DEFINER RPCs gated by app_private.assert_clinical_contributor,
-- append-only amendment/correction history, and the shared clinical read-visibility helper
-- (the only path by which an employee -- who has no direct RLS reach to residents -- can
-- read a resident's clinical data). Corrections follow FHIR entered-in-error semantics
-- rather than destructive edits.

create table public.clinical_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  observation_type text not null check (observation_type in (
    'blood_pressure', 'heart_rate', 'respiratory_rate', 'temperature', 'spo2',
    'weight', 'height', 'bmi', 'blood_glucose', 'pain_score', 'o2_flow', 'custom'
  )),
  custom_label text,
  loinc_code text check (loinc_code is null or loinc_code ~ '^[0-9]{1,6}-[0-9]$'),
  value_numeric numeric,
  value_secondary numeric,                          -- e.g. diastolic for blood_pressure
  value_text text,
  unit text,                                        -- UCUM: mm[Hg], /min, Cel, %, kg, cm, mg/dL
  observed_at timestamptz not null,
  recorded_by_profile_id uuid references public.profiles(id) on delete set null,
  recorded_by_name text,
  abnormal_flag text not null default 'unknown' check (abnormal_flag in (
    'unknown', 'normal', 'low', 'high', 'critical_low', 'critical_high'
  )),
  note text,
  source text not null default 'native' check (source in ('native', 'device', 'fhir')),
  fhir_observation_id text,                         -- set when reconciled from the FHIR lane
  entered_in_error boolean not null default false,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, facility_id),
  check (value_numeric is not null or value_text is not null),
  check (observation_type <> 'custom' or nullif(btrim(coalesce(custom_label, '')), '') is not null),
  check (not entered_in_error or nullif(btrim(coalesce(error_reason, '')), '') is not null)
);
create index clinical_observations_resident_idx
  on public.clinical_observations(resident_id, observation_type, observed_at desc);
create index clinical_observations_facility_idx
  on public.clinical_observations(facility_id, observed_at desc);
create index clinical_observations_abnormal_idx
  on public.clinical_observations(facility_id, observed_at desc)
  where abnormal_flag in ('high', 'low', 'critical_high', 'critical_low') and not entered_in_error;

-- Append-only correction / amendment trail (FHIR entered-in-error + provenance).
create table public.clinical_observation_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  observation_id uuid not null,
  amendment_type text not null check (amendment_type in ('correction', 'entered_in_error', 'note')),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  prior_value jsonb not null default '{}',
  amended_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (observation_id, organization_id, facility_id)
    references public.clinical_observations(id, organization_id, facility_id) on delete restrict
);
create index clinical_observation_amendments_obs_idx
  on public.clinical_observation_amendments(observation_id, created_at desc);

create trigger set_updated_at before update on public.clinical_observations
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.clinical_observations
  for each row execute function public.audit_log_trigger();
create trigger prevent_clinical_observation_amendment_mutation
  before update or delete on public.clinical_observation_amendments
  for each row execute function app_private.prevent_clinical_evidence_mutation();

-- Default clinical abnormality bands (adult ranges). Facilities can layer per-resident
-- thresholds in a later phase; these give an immediately useful flag at capture time.
create or replace function app_private.classify_observation_abnormality(
  p_type text,
  p_value numeric,
  p_secondary numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then 'unknown'
    else case p_type
      when 'heart_rate' then case
        when p_value < 40 then 'critical_low' when p_value < 50 then 'low'
        when p_value > 130 then 'critical_high' when p_value > 100 then 'high' else 'normal' end
      when 'respiratory_rate' then case
        when p_value < 8 then 'critical_low' when p_value < 12 then 'low'
        when p_value > 28 then 'critical_high' when p_value > 20 then 'high' else 'normal' end
      when 'spo2' then case
        when p_value < 88 then 'critical_low' when p_value < 92 then 'low' else 'normal' end
      when 'temperature' then case  -- Celsius
        when p_value < 35 then 'critical_low' when p_value < 36 then 'low'
        when p_value >= 39.4 then 'critical_high' when p_value >= 38 then 'high' else 'normal' end
      when 'blood_glucose' then case  -- mg/dL
        when p_value < 54 then 'critical_low' when p_value < 70 then 'low'
        when p_value > 300 then 'critical_high' when p_value > 180 then 'high' else 'normal' end
      when 'blood_pressure' then case  -- systolic primary, diastolic secondary
        when p_value >= 180 or coalesce(p_secondary, 0) >= 120 then 'critical_high'
        when p_value >= 140 or coalesce(p_secondary, 0) >= 90 then 'high'
        when p_value < 90 or coalesce(p_secondary, 999) < 60 then 'low' else 'normal' end
      when 'pain_score' then case
        when p_value < 0 or p_value > 10 then 'unknown'
        when p_value >= 7 then 'high' else 'normal' end
      else 'unknown'
    end
  end
$$;
revoke all on function app_private.classify_observation_abnormality(text, numeric, numeric)
  from public, anon, authenticated, service_role;

-- Capture a native observation. Employees may chart at their assigned facility; managers
-- and org admins anywhere in scope. abnormal_flag is derived server-side.
create or replace function public.record_clinical_observation(
  p_resident_id uuid,
  p_observation_type text,
  p_observed_at timestamptz,
  p_value_numeric numeric default null,
  p_value_secondary numeric default null,
  p_value_text text default null,
  p_unit text default null,
  p_custom_label text default null,
  p_loinc_code text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.residents%rowtype;
  v_flag text;
  v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v_res.organization_id, v_res.facility_id, false);
  if p_observation_type not in (
    'blood_pressure', 'heart_rate', 'respiratory_rate', 'temperature', 'spo2',
    'weight', 'height', 'bmi', 'blood_glucose', 'pain_score', 'o2_flow', 'custom'
  ) then raise exception 'Invalid observation type' using errcode = '22023'; end if;
  if p_value_numeric is null and nullif(btrim(coalesce(p_value_text, '')), '') is null then
    raise exception 'Observation requires a numeric or text value' using errcode = '22023';
  end if;
  if p_observation_type = 'custom' and nullif(btrim(coalesce(p_custom_label, '')), '') is null then
    raise exception 'Custom observations require a label' using errcode = '22023';
  end if;
  if p_loinc_code is not null and nullif(btrim(p_loinc_code), '') !~ '^[0-9]{1,6}-[0-9]$' then
    raise exception 'Invalid LOINC code' using errcode = '22023';
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '1 hour' then
    raise exception 'Observation time is invalid' using errcode = '22023';
  end if;
  v_flag := app_private.classify_observation_abnormality(
    p_observation_type, p_value_numeric, p_value_secondary
  );
  insert into public.clinical_observations (
    organization_id, facility_id, resident_id, observation_type, custom_label, loinc_code,
    value_numeric, value_secondary, value_text, unit, observed_at,
    recorded_by_profile_id, recorded_by_name, abnormal_flag, note, source
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_observation_type,
    nullif(btrim(p_custom_label), ''), nullif(btrim(p_loinc_code), ''),
    p_value_numeric, p_value_secondary, nullif(btrim(p_value_text), ''), nullif(btrim(p_unit), ''),
    p_observed_at, auth.uid(),
    (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = auth.uid()),
    v_flag, nullif(btrim(p_note), ''), 'native'
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Correct, retract (entered-in-error), or annotate an observation. Never destructive: the
-- prior value is preserved in an append-only amendment row.
create or replace function public.amend_clinical_observation(
  p_observation_id uuid,
  p_amendment_type text,
  p_reason text,
  p_value_numeric numeric default null,
  p_value_secondary numeric default null,
  p_value_text text default null,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.clinical_observations%rowtype;
  v_flag text;
begin
  select * into v from public.clinical_observations where id = p_observation_id for update;
  if not found then raise exception 'Observation not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v.organization_id, v.facility_id, false);
  if p_amendment_type not in ('correction', 'entered_in_error', 'note')
    or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Invalid observation amendment' using errcode = '22023';
  end if;
  if v.entered_in_error then
    raise exception 'Observation is already retracted' using errcode = '55000';
  end if;
  insert into public.clinical_observation_amendments (
    organization_id, facility_id, observation_id, amendment_type, reason, prior_value, amended_by_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, p_amendment_type, btrim(p_reason),
    jsonb_build_object(
      'valueNumeric', v.value_numeric, 'valueSecondary', v.value_secondary,
      'valueText', v.value_text, 'abnormalFlag', v.abnormal_flag, 'note', v.note
    ),
    auth.uid()
  );
  if p_amendment_type = 'entered_in_error' then
    update public.clinical_observations
    set entered_in_error = true, error_reason = btrim(p_reason), updated_at = now()
    where id = v.id;
  elsif p_amendment_type = 'correction' then
    v_flag := app_private.classify_observation_abnormality(
      v.observation_type,
      coalesce(p_value_numeric, v.value_numeric),
      coalesce(p_value_secondary, v.value_secondary)
    );
    update public.clinical_observations set
      value_numeric = coalesce(p_value_numeric, value_numeric),
      value_secondary = coalesce(p_value_secondary, value_secondary),
      value_text = coalesce(nullif(btrim(p_value_text), ''), value_text),
      abnormal_flag = v_flag, updated_at = now()
    where id = v.id;
  else
    update public.clinical_observations
    set note = nullif(btrim(p_note), ''), updated_at = now()
    where id = v.id;
  end if;
  return true;
end;
$$;

-- Read a resident's observations. SECURITY DEFINER so the visibility helper (not base
-- residents RLS) governs access, and every read is written to the clinical access log.
create or replace function public.get_resident_clinical_observations(
  p_resident_id uuid,
  p_observation_type text default null,
  p_include_retracted boolean default false,
  p_limit integer default 200
)
returns setof public.clinical_observations
language plpgsql
security definer
set search_path = ''
as $$
declare v_res public.residents%rowtype;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not app_private.clinical_record_visible(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  perform public.log_clinical_access(p_resident_id, 'view_domain', 'vitals_observations', null, null);
  return query
  select o.* from public.clinical_observations o
  where o.resident_id = p_resident_id
    and (p_observation_type is null or o.observation_type = p_observation_type)
    and (p_include_retracted or not o.entered_in_error)
  order by o.observed_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- Commercial module gating: classify the new clinical tables as CareBase and apply the
-- restrictive product-module entitlement policy (mirrors modular_product_entitlements).
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'clinical_observations', 'modules.carebase'),
  ('public', 'clinical_observation_amendments', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name from app_private.product_module_resources
    where resource_name in ('clinical_observations', 'clinical_observation_amendments')
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I',
      v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, 'modules.carebase', 'modules.carebase'
    );
  end loop;
end
$$;

alter table public.clinical_observations enable row level security;
alter table public.clinical_observation_amendments enable row level security;

create policy clinical_observations_select on public.clinical_observations
for select to authenticated
using (app_private.clinical_record_visible(organization_id, facility_id));

create policy clinical_observation_amendments_select on public.clinical_observation_amendments
for select to authenticated
using (
  exists (
    select 1 from public.clinical_observations o
    where o.id = observation_id
      and app_private.clinical_record_visible(o.organization_id, o.facility_id)
  )
);

do $$
declare t text;
begin
  foreach t in array array['clinical_observations', 'clinical_observation_amendments'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

revoke all on function public.record_clinical_observation(
  uuid, text, timestamptz, numeric, numeric, text, text, text, text, text
), public.amend_clinical_observation(
  uuid, text, text, numeric, numeric, text, text
), public.get_resident_clinical_observations(uuid, text, boolean, integer)
  from public, anon, service_role;
grant execute on function public.record_clinical_observation(
  uuid, text, timestamptz, numeric, numeric, text, text, text, text, text
), public.amend_clinical_observation(
  uuid, text, text, numeric, numeric, text, text
), public.get_resident_clinical_observations(uuid, text, boolean, integer)
  to authenticated;
