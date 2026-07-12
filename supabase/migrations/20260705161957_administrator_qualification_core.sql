-- The facility_manager role is this app's stand-in for 55 Pa Code's "administrator" concept --
-- one profile-scoped qualification record per person (not per-facility: the 100-hour course/CE
-- log/NHA license belongs to the person, not any one building they happen to run).
create table public.administrator_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,

  qualification_path text check (qualification_path in ('hundred_hour_course','nha_exemption')),

  hundred_hour_course_completed_date date,
  hundred_hour_course_provider text,
  hundred_hour_course_document_path text,
  competency_test_passed boolean not null default false,
  competency_test_date date,

  -- NHA (Nursing Home Administrator) licensees are exempt from the 100-hour course/competency
  -- test requirement -- their existing license substitutes.
  nha_license_number text,
  nha_license_state text,
  nha_license_expiration date,

  -- The written-notice-to-the-DHS-regional-office task -- a single current record (re-submitted
  -- and overwritten, e.g. on administrator change), not a repeating list; full history of prior
  -- submissions lives in audit_logs like every other table in this schema.
  regional_office_verification_submitted_date date,
  regional_office_verification_document_path text,
  regional_office_verification_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index administrator_profiles_org_idx on public.administrator_profiles(organization_id);

create trigger set_updated_at before update on public.administrator_profiles
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.administrator_profiles
  for each row execute function public.audit_log_trigger();

-- Per-entry CE log -- "rolling 24-hour annual" means summed over the trailing 12 months from
-- completed_date, computed on read (no stored period marker to keep in sync), not a fixed
-- calendar-year bucket.
create table public.administrator_ce_entries (
  id uuid primary key default gen_random_uuid(),
  administrator_profile_id uuid not null references public.administrator_profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hours numeric not null check (hours > 0),
  topic text not null,
  source text,
  completed_date date not null,
  provider text,
  document_path text,
  created_at timestamptz not null default now()
);

create index administrator_ce_entries_profile_idx on public.administrator_ce_entries(administrator_profile_id);
create index administrator_ce_entries_org_idx on public.administrator_ce_entries(organization_id);
create index administrator_ce_entries_completed_date_idx on public.administrator_ce_entries(completed_date);

create trigger audit_log after insert or update or delete on public.administrator_ce_entries
  for each row execute function public.audit_log_trigger();

create or replace function public.stamp_org_from_administrator_profile()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.administrator_profiles where id = new.administrator_profile_id;
  if v_org is null then
    raise exception 'administrator_profile % not found', new.administrator_profile_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  return new;
end;
$$;

create trigger stamp_scope before insert on public.administrator_ce_entries
  for each row execute function public.stamp_org_from_administrator_profile();
