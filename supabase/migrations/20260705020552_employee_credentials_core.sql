-- Staff credentials & clearances: PA Act 34 criminal-history clearance, Act 73 FBI fingerprint
-- clearance, Act 33/CPSL child-abuse clearance, RN/LPN licensure, nurse aide registry status,
-- TB/health screening, immunizations, and I-9 employment eligibility -- none of which lived
-- anywhere in the app before now (only training requirements did). Immunization/TB rows
-- legitimately recur (flu shot every year, TB test on whatever cadence facility policy sets),
-- so unlike employee_training_records/practicums this is deliberately NOT unique per
-- (employee_id, credential_type) -- the other credential types are conventionally
-- update-in-place on renewal, same as training records, with history living in audit_logs.

create table public.employee_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  credential_type text not null check (credential_type in (
    'act34_criminal_history','act73_fbi_fingerprint','act33_child_abuse',
    'rn_license','lpn_license','nurse_aide_registry','tb_screening',
    'immunization','i9_employment_eligibility','other')),
  credential_label text,
  issuing_authority text,
  credential_number text,
  issue_date date,
  expiration_date date,
  last_verified_date date,
  warning_days integer not null default 90,
  status text not null default 'missing' check (status in ('compliant','due_soon','expired','missing','not_applicable')),
  verification_method text,
  verified_by_profile_id uuid references public.profiles(id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_credentials_org_idx on public.employee_credentials(organization_id);
create index employee_credentials_facility_idx on public.employee_credentials(facility_id);
create index employee_credentials_employee_idx on public.employee_credentials(employee_id);

create trigger set_updated_at before update on public.employee_credentials
  for each row execute function public.set_updated_at();

create trigger stamp_scope before insert or update on public.employee_credentials
  for each row execute function public.stamp_scope_from_employee();

create trigger audit_log after insert or update or delete on public.employee_credentials
  for each row execute function public.audit_log_trigger();

create table public.employee_credential_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  credential_id uuid not null references public.employee_credentials(id) on delete cascade,
  storage_bucket text not null default 'credential-documents',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  document_label text,
  uploaded_by_profile_id uuid references public.profiles(id),
  retain_until date,
  created_at timestamptz not null default now()
);
create index employee_credential_documents_org_idx on public.employee_credential_documents(organization_id);
create index employee_credential_documents_facility_idx on public.employee_credential_documents(facility_id);
create index employee_credential_documents_employee_idx on public.employee_credential_documents(employee_id);
create index employee_credential_documents_credential_idx on public.employee_credential_documents(credential_id);

create or replace function public.stamp_scope_from_credential()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid; v_emp uuid;
begin
  select organization_id, facility_id, employee_id into v_org, v_fac, v_emp
  from public.employee_credentials where id = new.credential_id;
  if v_org is null then
    raise exception 'employee credential % not found', new.credential_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  new.employee_id := v_emp;
  return new;
end;
$function$;

create trigger stamp_scope before insert on public.employee_credential_documents
  for each row execute function public.stamp_scope_from_credential();

create trigger audit_log after insert or update or delete on public.employee_credential_documents
  for each row execute function public.audit_log_trigger();
