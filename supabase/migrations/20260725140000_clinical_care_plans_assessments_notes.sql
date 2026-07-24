-- Native clinical domain 2: care plans, clinical assessments, and progress notes.
--
-- Lane B (staff are the source), following the M1 vitals / structured change-of-condition
-- model: SELECT-only table grants, all writes through SECURITY DEFINER RPCs gated by
-- app_private.assert_clinical_contributor, and append-only amendment history. Progress notes
-- and assessments are sign-and-lock: once signed/finalized, the record is only changed through
-- an amendment that preserves the prior content in an append-only version row. These tables
-- complement (do not replace) resident_support_plans and resident_assessment_forms, and bridge
-- to them by id.

create table public.clinical_care_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 200),
  category text not null default 'general' check (length(btrim(category)) between 1 and 60),
  status text not null default 'draft' check (status in ('draft', 'active', 'on_hold', 'completed', 'revoked')),
  support_plan_id uuid references public.resident_support_plans(id) on delete set null,
  fhir_care_plan_id text,
  period_start date,
  period_end date,
  authored_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, facility_id),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index clinical_care_plans_resident_idx on public.clinical_care_plans(resident_id, status);

create table public.clinical_care_plan_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  care_plan_id uuid not null,
  description text not null check (length(btrim(description)) between 2 and 500),
  target_measure text,
  status text not null default 'active' check (status in ('proposed', 'active', 'achieved', 'on_hold', 'cancelled')),
  addresses_condition_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (care_plan_id, organization_id, facility_id)
    references public.clinical_care_plans(id, organization_id, facility_id) on delete cascade
);
create index clinical_care_plan_goals_plan_idx on public.clinical_care_plan_goals(care_plan_id, status);

create table public.clinical_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  assessment_type text not null check (assessment_type in (
    'braden', 'morse_fall', 'pain', 'mmse', 'nutrition', 'adl', 'mood', 'custom'
  )),
  custom_label text,
  instrument_loinc text check (instrument_loinc is null or instrument_loinc ~ '^[0-9]{1,6}-[0-9]$'),
  score numeric,
  risk_band text,
  responses jsonb not null default '{}',
  assessed_at timestamptz not null,
  assessed_by_profile_id uuid references public.profiles(id) on delete set null,
  assessed_by_name text,
  status text not null default 'draft' check (status in ('draft', 'final', 'amended')),
  resident_assessment_form_id uuid references public.resident_assessment_forms(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, facility_id),
  check (assessment_type <> 'custom' or nullif(btrim(coalesce(custom_label, '')), '') is not null)
);
create index clinical_assessments_resident_idx
  on public.clinical_assessments(resident_id, assessment_type, assessed_at desc);

create table public.clinical_progress_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  note_type text not null default 'general' check (note_type in (
    'nursing', 'soap', 'shift', 'care_conference', 'general'
  )),
  authored_at timestamptz not null,
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_name text,
  body text not null check (length(btrim(body)) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft', 'signed', 'amended', 'entered_in_error')),
  signed_at timestamptz,
  signed_by_profile_id uuid references public.profiles(id) on delete set null,
  care_plan_id uuid references public.clinical_care_plans(id) on delete set null,
  change_event_id uuid references public.resident_change_events(id) on delete set null,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, facility_id),
  check ((status = 'signed') = (signed_at is not null) or status in ('amended', 'entered_in_error'))
);
create index clinical_progress_notes_resident_idx
  on public.clinical_progress_notes(resident_id, authored_at desc);

create table public.clinical_progress_note_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  note_id uuid not null,
  version_type text not null check (version_type in ('signature', 'amendment', 'entered_in_error')),
  reason text,
  prior_body text,
  prior_status text,
  amended_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (note_id, organization_id, facility_id)
    references public.clinical_progress_notes(id, organization_id, facility_id) on delete restrict
);
create index clinical_progress_note_versions_note_idx
  on public.clinical_progress_note_versions(note_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['clinical_care_plans', 'clinical_care_plan_goals', 'clinical_assessments', 'clinical_progress_notes'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()', t);
  end loop;
end $$;
create trigger prevent_clinical_progress_note_version_mutation
  before update or delete on public.clinical_progress_note_versions
  for each row execute function app_private.prevent_clinical_evidence_mutation();

-- Care plans --------------------------------------------------------------------------
create or replace function public.save_clinical_care_plan(
  p_resident_id uuid, p_title text, p_category text, p_status text,
  p_support_plan_id uuid default null, p_period_start date default null,
  p_period_end date default null, p_care_plan_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res public.residents%rowtype; v_plan public.clinical_care_plans%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v_res.organization_id, v_res.facility_id, false);
  if p_status not in ('draft', 'active', 'on_hold', 'completed', 'revoked')
    or length(btrim(coalesce(p_title, ''))) < 2 then
    raise exception 'Invalid care plan' using errcode = '22023';
  end if;
  if p_care_plan_id is null then
    insert into public.clinical_care_plans(
      organization_id, facility_id, resident_id, title, category, status,
      support_plan_id, period_start, period_end, authored_by_profile_id
    ) values (
      v_res.organization_id, v_res.facility_id, v_res.id, btrim(p_title),
      coalesce(nullif(btrim(p_category), ''), 'general'), p_status,
      p_support_plan_id, p_period_start, p_period_end, auth.uid()
    ) returning id into v_id;
  else
    -- Authorize against the plan's OWN facility and require it to belong to this resident, so a
    -- facility-scoped caller cannot edit another facility's plan by passing a cross-facility id.
    select * into v_plan from public.clinical_care_plans where id = p_care_plan_id;
    if v_plan.id is null then raise exception 'Care plan not found' using errcode = 'P0002'; end if;
    perform app_private.assert_clinical_contributor(v_plan.organization_id, v_plan.facility_id, false);
    if v_plan.resident_id <> p_resident_id then
      raise exception 'Care plan does not belong to this resident' using errcode = '42501';
    end if;
    update public.clinical_care_plans set
      title = btrim(p_title), category = coalesce(nullif(btrim(p_category), ''), 'general'),
      status = p_status, support_plan_id = p_support_plan_id,
      period_start = p_period_start, period_end = p_period_end, updated_at = now()
    where id = v_plan.id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_care_plan_goal(
  p_care_plan_id uuid, p_description text, p_target_measure text default null,
  p_status text default 'active', p_addresses_condition_ref text default null, p_goal_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_plan public.clinical_care_plans%rowtype; v_id uuid;
begin
  select * into v_plan from public.clinical_care_plans where id = p_care_plan_id;
  if v_plan.id is null then raise exception 'Care plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v_plan.organization_id, v_plan.facility_id, false);
  if p_status not in ('proposed', 'active', 'achieved', 'on_hold', 'cancelled')
    or length(btrim(coalesce(p_description, ''))) < 2 then
    raise exception 'Invalid care plan goal' using errcode = '22023';
  end if;
  if p_goal_id is null then
    insert into public.clinical_care_plan_goals(
      organization_id, facility_id, care_plan_id, description, target_measure, status, addresses_condition_ref
    ) values (
      v_plan.organization_id, v_plan.facility_id, v_plan.id, btrim(p_description),
      nullif(btrim(p_target_measure), ''), p_status, nullif(btrim(p_addresses_condition_ref), '')
    ) returning id into v_id;
  else
    update public.clinical_care_plan_goals set
      description = btrim(p_description), target_measure = nullif(btrim(p_target_measure), ''),
      status = p_status, addresses_condition_ref = nullif(btrim(p_addresses_condition_ref), ''), updated_at = now()
    where id = p_goal_id and care_plan_id = v_plan.id
    returning id into v_id;
    if v_id is null then raise exception 'Care plan goal not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- Assessments -------------------------------------------------------------------------
create or replace function public.record_clinical_assessment(
  p_resident_id uuid, p_assessment_type text, p_assessed_at timestamptz,
  p_score numeric default null, p_risk_band text default null, p_responses jsonb default '{}',
  p_custom_label text default null, p_instrument_loinc text default null,
  p_resident_assessment_form_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v_res.organization_id, v_res.facility_id, false);
  if p_assessment_type not in ('braden', 'morse_fall', 'pain', 'mmse', 'nutrition', 'adl', 'mood', 'custom')
    or p_assessed_at is null or p_assessed_at > now() + interval '1 hour'
    or (p_assessment_type = 'custom' and nullif(btrim(coalesce(p_custom_label, '')), '') is null) then
    raise exception 'Invalid clinical assessment' using errcode = '22023';
  end if;
  insert into public.clinical_assessments(
    organization_id, facility_id, resident_id, assessment_type, custom_label, instrument_loinc,
    score, risk_band, responses, assessed_at, assessed_by_profile_id, assessed_by_name,
    resident_assessment_form_id
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_assessment_type, nullif(btrim(p_custom_label), ''),
    nullif(btrim(p_instrument_loinc), ''), p_score, nullif(btrim(p_risk_band), ''),
    coalesce(p_responses, '{}'::jsonb), p_assessed_at, auth.uid(),
    (select pr.first_name || ' ' || pr.last_name from public.profiles pr where pr.id = auth.uid()),
    p_resident_assessment_form_id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finalize_clinical_assessment(p_assessment_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.clinical_assessments%rowtype;
begin
  select * into v from public.clinical_assessments where id = p_assessment_id for update;
  if v.id is null then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v.organization_id, v.facility_id, false);
  if v.status <> 'draft' then raise exception 'Only a draft assessment can be finalized' using errcode = '55000'; end if;
  update public.clinical_assessments set status = 'final', finalized_at = now(), updated_at = now()
  where id = v.id;
  return true;
end;
$$;

-- Progress notes (sign-and-lock) ------------------------------------------------------
create or replace function public.save_clinical_progress_note(
  p_resident_id uuid, p_note_type text, p_body text, p_authored_at timestamptz,
  p_care_plan_id uuid default null, p_change_event_id uuid default null, p_note_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res public.residents%rowtype; v_existing public.clinical_progress_notes%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v_res.organization_id, v_res.facility_id, false);
  if p_note_type not in ('nursing', 'soap', 'shift', 'care_conference', 'general')
    or length(btrim(coalesce(p_body, ''))) < 1 or p_authored_at is null then
    raise exception 'Invalid progress note' using errcode = '22023';
  end if;
  if p_note_id is null then
    insert into public.clinical_progress_notes(
      organization_id, facility_id, resident_id, note_type, authored_at, author_profile_id,
      author_name, body, care_plan_id, change_event_id
    ) values (
      v_res.organization_id, v_res.facility_id, v_res.id, p_note_type, p_authored_at, auth.uid(),
      (select pr.first_name || ' ' || pr.last_name from public.profiles pr where pr.id = auth.uid()),
      btrim(p_body), p_care_plan_id, p_change_event_id
    ) returning id into v_id;
  else
    select * into v_existing from public.clinical_progress_notes where id = p_note_id for update;
    if v_existing.id is null then raise exception 'Progress note not found' using errcode = 'P0002'; end if;
    -- Authorize against the note's OWN facility and require it to belong to this resident, so a
    -- facility-scoped caller cannot edit another facility's draft note by passing a cross-facility id.
    perform app_private.assert_clinical_contributor(v_existing.organization_id, v_existing.facility_id, false);
    if v_existing.resident_id <> p_resident_id then
      raise exception 'Progress note does not belong to this resident' using errcode = '42501';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'A signed note can only be changed through an amendment' using errcode = '55000';
    end if;
    update public.clinical_progress_notes set
      note_type = p_note_type, body = btrim(p_body), authored_at = p_authored_at,
      care_plan_id = p_care_plan_id, change_event_id = p_change_event_id, updated_at = now()
    where id = v_existing.id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.sign_clinical_progress_note(p_note_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.clinical_progress_notes%rowtype;
begin
  select * into v from public.clinical_progress_notes where id = p_note_id for update;
  if v.id is null then raise exception 'Progress note not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v.organization_id, v.facility_id, false);
  if v.status <> 'draft' then raise exception 'Only a draft note can be signed' using errcode = '55000'; end if;
  update public.clinical_progress_notes set
    status = 'signed', signed_at = now(), signed_by_profile_id = auth.uid(), updated_at = now()
  where id = v.id;
  insert into public.clinical_progress_note_versions(
    organization_id, facility_id, note_id, version_type, reason, prior_status, amended_by_profile_id
  ) values (v.organization_id, v.facility_id, v.id, 'signature', 'Note signed', 'draft', auth.uid());
  return true;
end;
$$;

create or replace function public.amend_clinical_progress_note(
  p_note_id uuid, p_reason text, p_new_body text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.clinical_progress_notes%rowtype;
begin
  select * into v from public.clinical_progress_notes where id = p_note_id for update;
  if v.id is null then raise exception 'Progress note not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v.organization_id, v.facility_id, false);
  if v.status not in ('signed', 'amended') then
    raise exception 'Only a signed note can be amended' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(btrim(coalesce(p_new_body, ''))) < 1 then
    raise exception 'Invalid note amendment' using errcode = '22023';
  end if;
  insert into public.clinical_progress_note_versions(
    organization_id, facility_id, note_id, version_type, reason, prior_body, prior_status, amended_by_profile_id
  ) values (v.organization_id, v.facility_id, v.id, 'amendment', btrim(p_reason), v.body, v.status, auth.uid());
  update public.clinical_progress_notes set body = btrim(p_new_body), status = 'amended', updated_at = now()
  where id = v.id;
  return true;
end;
$$;

create or replace function public.retract_clinical_progress_note(p_note_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.clinical_progress_notes%rowtype;
begin
  select * into v from public.clinical_progress_notes where id = p_note_id for update;
  if v.id is null then raise exception 'Progress note not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_contributor(v.organization_id, v.facility_id, true);
  if v.status = 'entered_in_error' then raise exception 'Note is already retracted' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A retraction reason is required' using errcode = '22023'; end if;
  insert into public.clinical_progress_note_versions(
    organization_id, facility_id, note_id, version_type, reason, prior_body, prior_status, amended_by_profile_id
  ) values (v.organization_id, v.facility_id, v.id, 'entered_in_error', btrim(p_reason), v.body, v.status, auth.uid());
  update public.clinical_progress_notes set status = 'entered_in_error', error_reason = btrim(p_reason), updated_at = now()
  where id = v.id;
  return true;
end;
$$;

-- Commercial module gating.
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'clinical_care_plans', 'modules.carebase'),
  ('public', 'clinical_care_plan_goals', 'modules.carebase'),
  ('public', 'clinical_assessments', 'modules.carebase'),
  ('public', 'clinical_progress_notes', 'modules.carebase'),
  ('public', 'clinical_progress_note_versions', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name from app_private.product_module_resources
    where resource_name in ('clinical_care_plans', 'clinical_care_plan_goals', 'clinical_assessments',
      'clinical_progress_notes', 'clinical_progress_note_versions')
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I', v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, 'modules.carebase', 'modules.carebase'
    );
  end loop;
end $$;

alter table public.clinical_care_plans enable row level security;
alter table public.clinical_care_plan_goals enable row level security;
alter table public.clinical_assessments enable row level security;
alter table public.clinical_progress_notes enable row level security;
alter table public.clinical_progress_note_versions enable row level security;

create policy clinical_care_plans_select on public.clinical_care_plans
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy clinical_care_plan_goals_select on public.clinical_care_plan_goals
for select to authenticated using (
  exists (select 1 from public.clinical_care_plans p where p.id = care_plan_id
    and app_private.clinical_record_visible(p.organization_id, p.facility_id)));
create policy clinical_assessments_select on public.clinical_assessments
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy clinical_progress_notes_select on public.clinical_progress_notes
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy clinical_progress_note_versions_select on public.clinical_progress_note_versions
for select to authenticated using (
  exists (select 1 from public.clinical_progress_notes n where n.id = note_id
    and app_private.clinical_record_visible(n.organization_id, n.facility_id)));

do $$
declare t text;
begin
  foreach t in array array['clinical_care_plans', 'clinical_care_plan_goals', 'clinical_assessments',
    'clinical_progress_notes', 'clinical_progress_note_versions'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

revoke all on function public.save_clinical_care_plan(uuid, text, text, text, uuid, date, date, uuid),
  public.save_care_plan_goal(uuid, text, text, text, text, uuid),
  public.record_clinical_assessment(uuid, text, timestamptz, numeric, text, jsonb, text, text, uuid),
  public.finalize_clinical_assessment(uuid),
  public.save_clinical_progress_note(uuid, text, text, timestamptz, uuid, uuid, uuid),
  public.sign_clinical_progress_note(uuid),
  public.amend_clinical_progress_note(uuid, text, text),
  public.retract_clinical_progress_note(uuid, text)
  from public, anon, service_role;
grant execute on function public.save_clinical_care_plan(uuid, text, text, text, uuid, date, date, uuid),
  public.save_care_plan_goal(uuid, text, text, text, text, uuid),
  public.record_clinical_assessment(uuid, text, timestamptz, numeric, text, jsonb, text, text, uuid),
  public.finalize_clinical_assessment(uuid),
  public.save_clinical_progress_note(uuid, text, text, timestamptz, uuid, uuid, uuid),
  public.sign_clinical_progress_note(uuid),
  public.amend_clinical_progress_note(uuid, text, text),
  public.retract_clinical_progress_note(uuid, text)
  to authenticated;
