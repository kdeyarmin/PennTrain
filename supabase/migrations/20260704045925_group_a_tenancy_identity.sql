-- Shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Packages (subscription package catalog, platform_admin managed)
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  learner_limit integer,
  facility_limit integer,
  price_monthly_cents integer,
  features jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.packages
  for each row execute function public.set_updated_at();

-- Organizations (tenants)
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text, city text, state text, zip text,
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial','active','past_due','canceled','suspended')),
  plan_name text,
  package_id uuid references public.packages(id),
  max_facilities integer,
  max_users integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_package_id_idx on public.organizations(package_id);
create trigger set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  default_warning_days jsonb,
  email_notifications_enabled boolean not null default false,
  sms_notifications_enabled boolean not null default false,
  branding_primary_color text,
  branding_accent_color text,
  branding_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- Facilities
create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  facility_type text not null check (facility_type in ('PCH','ALR')),
  license_number text,
  address text, city text, state text, zip text, phone text,
  administrator_name text, administrator_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index facilities_organization_id_idx on public.facilities(organization_id);
create trigger set_updated_at before update on public.facilities
  for each row execute function public.set_updated_at();

-- Profiles (replaces users table; id = auth.users.id)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  first_name text not null default '',
  last_name text not null default '',
  email text not null unique,
  phone text,
  role text not null default 'employee'
    check (role in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_organization_id_idx on public.profiles(organization_id);
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Facility assignments (replaces facility_user_assignments)
create table public.facility_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, facility_id)
);
create index facility_assignments_profile_id_idx on public.facility_assignments(profile_id);
create index facility_assignments_facility_id_idx on public.facility_assignments(facility_id);

-- Employees
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  profile_id uuid unique references public.profiles(id),
  employee_number text,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  hire_date date,
  termination_date date,
  job_title text not null,
  department text,
  status text not null default 'active' check (status in ('active','inactive','terminated','on_leave')),
  administers_medications boolean not null default false,
  trainer_status boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_organization_id_idx on public.employees(organization_id);
create index employees_facility_id_idx on public.employees(facility_id);
create trigger set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();
