-- Tier 3.5 (ROADMAP.md): Resident compliance-date registry -- RASP deadlines only, hard no-EHR
-- guardrail. Deliberately minimal: name, room, admission date, SDCU/hospice flags. No charting,
-- no eMAR, no care plans, no diagnosis/medication fields of any kind.
create table public.residents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  first_name text not null,
  last_name text not null,
  room text,
  admission_date date not null,
  discharge_date date,
  sdcu boolean not null default false,
  hospice boolean not null default false,
  status text not null default 'active' check (status in ('active', 'discharged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index residents_org_idx on public.residents(organization_id);
create index residents_facility_idx on public.residents(facility_id);

create trigger set_updated_at before update on public.residents
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.residents
  for each row execute function public.audit_log_trigger();

-- The deadline chain: preadmission screening, 15-day initial assessment, 30-day support plan,
-- annual reassessment, medical-evaluation cycle. renewal_interval_days is null for the three
-- one-time admission-window items and set for the two recurring ones -- completing a recurring
-- item schedules its next cycle as a NEW row (mirrors employee_training_records' own "successive
-- renewal cycles accumulate as separate rows" convention) rather than overwriting history.
create table public.resident_compliance_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  resident_id uuid not null references public.residents(id) on delete cascade,
  item_type text not null check (item_type in (
    'preadmission_screening', 'initial_assessment_15day', 'support_plan_30day',
    'annual_reassessment', 'medical_evaluation'
  )),
  due_date date,
  completed_date date,
  renewal_interval_days integer,
  warning_days integer not null default 30,
  status text not null default 'missing' check (status in ('missing', 'due_soon', 'expired', 'compliant', 'not_applicable')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_compliance_items_org_idx on public.resident_compliance_items(organization_id);
create index resident_compliance_items_resident_idx on public.resident_compliance_items(resident_id);

create trigger set_updated_at before update on public.resident_compliance_items
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.resident_compliance_items
  for each row execute function public.audit_log_trigger();

-- Completed DHS RASP/DME PDFs -- mirrors violation_documents exactly (own bucket, no employee
-- owner, same org_admin/auditor/assigned-facility_manager RLS shape).
create table public.resident_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  resident_id uuid not null references public.residents(id) on delete cascade,
  compliance_item_id uuid references public.resident_compliance_items(id) on delete set null,
  storage_bucket text not null default 'resident-documents',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  document_label text,
  uploaded_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index resident_documents_org_idx on public.resident_documents(organization_id);
create index resident_documents_resident_idx on public.resident_documents(resident_id);

create trigger audit_log after insert or update or delete on public.resident_documents
  for each row execute function public.audit_log_trigger();

create or replace function public.stamp_scope_from_resident()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.residents where id = new.resident_id;
  if v_org is null then
    raise exception 'resident % not found', new.resident_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;
create trigger stamp_scope before insert on public.resident_compliance_items
  for each row execute function public.stamp_scope_from_resident();
create trigger stamp_scope before insert on public.resident_documents
  for each row execute function public.stamp_scope_from_resident();

-- Instantiator: mirrors instantiate_missing_requirements()'s "derive from metadata on insert"
-- convention. Configurable default day-counts (documented in the ROADMAP.md posture already
-- established by training_types.citation_note) -- verify against current regulations.
create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record;
begin
  select id, organization_id, facility_id, admission_date into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  insert into public.resident_compliance_items
    (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days)
  values
    (v_res.organization_id, v_res.facility_id, v_res.id, 'preadmission_screening', v_res.admission_date, null, 7),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'initial_assessment_15day', v_res.admission_date + 15, null, 7),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'support_plan_30day', v_res.admission_date + 30, null, 14),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'annual_reassessment', v_res.admission_date + 365, 365, 30),
    (v_res.organization_id, v_res.facility_id, v_res.id, 'medical_evaluation', v_res.admission_date + 365, 365, 30);
end;
$$;
revoke all on function public.instantiate_resident_compliance_items(uuid) from public, anon, authenticated;

create or replace function public.trigger_instantiate_resident_compliance_on_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.instantiate_resident_compliance_items(new.id);
  return new;
end;
$$;
revoke all on function public.trigger_instantiate_resident_compliance_on_insert() from public, anon, authenticated;
create trigger instantiate_compliance_items after insert on public.residents
  for each row execute function public.trigger_instantiate_resident_compliance_on_insert();

-- Nightly status recompute -- mirrors recalculate_all_compliance()'s missing/due_soon/expired
-- formula. Once completed_date is set the row is a historical record and stays 'compliant'
-- forever (its own due_date is a fixed one-cycle deadline, not a moving renewal target, so
-- re-evaluating it against today's date after completion would incorrectly flag a
-- since-completed-late item as still expired).
create or replace function public.recalculate_resident_compliance_statuses()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.resident_compliance_items
  set status = case
    when status = 'not_applicable' then status
    when completed_date is not null then 'compliant'
    when due_date is null then 'missing'
    when due_date < current_date then 'expired'
    when due_date <= current_date + warning_days then 'due_soon'
    else 'missing'
  end
  where status <> 'not_applicable';
end;
$$;
revoke all on function public.recalculate_resident_compliance_statuses() from public, anon, authenticated;

select cron.schedule(
  'recalculate-resident-compliance-nightly',
  '30 6 * * *',
  $$ select public.recalculate_resident_compliance_statuses(); $$
);
