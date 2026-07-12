-- Two configurable defaults for the OAPSA provisional-employment countdown (PA regs don't gate
-- personal care homes with their own day-count; 55 Pa Code Sec 2600.51 cross-references OAPSA/
-- 6 Pa Code Sec 15.146, which is corroborated by the near-identical sibling provisions at 55 Pa
-- Code Sec 52.20 and 28 Pa Code Sec 611.54: 30 days if the applicant has been a PA resident the
-- preceding 2 years, 90 days if not (since an out-of-state history requires the slower FBI/
-- federal channel). Stored per-org and editable, not hardcoded, since these are cross-referenced
-- defaults rather than a single directly-on-point citation -- an org's own regulatory counsel may
-- confirm a different figure for their specific facility type.
alter table public.organization_settings
  add column oapsa_provisional_days_resident integer not null default 30,
  add column oapsa_provisional_days_nonresident integer not null default 90;

create table public.employee_background_check_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null unique references public.employees(id) on delete cascade,

  -- Drives the FBI/Act 73 auto-flag below: PA residents of 2+ years only need the state-level
  -- (PATCH/Act 34) check; anyone else needs the federal FBI fingerprint-based check too, since
  -- Act 34 alone can't surface out-of-state criminal history.
  pa_resident_two_years boolean,

  provisional_start_date date,
  -- Snapshotted at the time this profile is created/updated (from the org defaults above), not
  -- recomputed live -- so a later change to org policy doesn't retroactively shift an
  -- already-running countdown.
  provisional_max_days integer,

  -- The applicant's own sworn/affirmed written statement of non-disqualification, required
  -- during the provisional period.
  non_disqualification_statement_signed boolean not null default false,
  non_disqualification_statement_signed_at timestamptz,

  -- Documented, regular/random direct supervision during the provisional period (required by the
  -- regs above) -- a single confirmation checkbox + note, not a full supervision log, matching
  -- the roadmap's "supervision attestation" (singular).
  supervision_attestation_confirmed boolean not null default false,
  supervision_attestation_confirmed_by uuid references public.profiles(id) on delete set null,
  supervision_attestation_confirmed_at timestamptz,
  supervision_attestation_notes text,

  suitability_determination text not null default 'pending'
    check (suitability_determination in ('pending','suitable','suitable_with_conditions','not_suitable')),
  suitability_conditions text,
  suitability_determined_by uuid references public.profiles(id) on delete set null,
  suitability_determined_at timestamptz,
  suitability_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employee_background_check_profiles_org_idx on public.employee_background_check_profiles(organization_id);
create index employee_background_check_profiles_facility_idx on public.employee_background_check_profiles(facility_id);

create trigger set_updated_at before update on public.employee_background_check_profiles
  for each row execute function public.set_updated_at();

create trigger stamp_scope before insert on public.employee_background_check_profiles
  for each row execute function public.stamp_scope_from_employee();

create trigger audit_log after insert or update or delete on public.employee_background_check_profiles
  for each row execute function public.audit_log_trigger();

-- Auto-provisions the FBI/Act 73 requirement the same way Tier 2.3's requirement-auto-assignment
-- engine provisions training-type requirements: a 'missing' employee_credentials shell so the
-- gap shows up as a real, trackable compliance item instead of silently not existing until
-- someone happens to notice.
create or replace function public.derive_fbi_requirement_from_residency()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.pa_resident_two_years is false and not exists (
    select 1 from public.employee_credentials
    where employee_id = new.employee_id and credential_type = 'act73_fbi_fingerprint'
  ) then
    insert into public.employee_credentials (organization_id, facility_id, employee_id, credential_type, status)
    values (new.organization_id, new.facility_id, new.employee_id, 'act73_fbi_fingerprint', 'missing');
  end if;
  return new;
end;
$$;

create trigger derive_fbi_requirement after insert or update of pa_resident_two_years
  on public.employee_background_check_profiles
  for each row execute function public.derive_fbi_requirement_from_residency();

revoke all on function public.derive_fbi_requirement_from_residency() from public, anon, authenticated;
