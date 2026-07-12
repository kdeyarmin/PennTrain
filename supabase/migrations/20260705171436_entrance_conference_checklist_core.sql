-- Mock entrance-conference checklist: a configurable list of readiness questions modeled on
-- general PA DHS entrance-conference practice for personal care homes/assisted living
-- residences (census, staff files, training, background checks, life safety, incident
-- follow-through, etc.) -- NOT a verbatim reproduction of the current DHS Entrance Conference
-- Guide, which operators should keep on hand and compare against. organization_id null rows are
-- system defaults every org starts with; org_admin can add org-specific items to match their own
-- copy of the guide.
create table public.entrance_conference_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  category text not null,
  prompt text not null,
  data_source text not null check (data_source in (
    'roster', 'training', 'credentials', 'background_checks', 'inspections', 'incidents', 'policies', 'administrator', 'general'
  )),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entrance_conference_items enable row level security;
create policy entrance_conference_items_select on public.entrance_conference_items for select to authenticated using (
  public.is_platform_admin() or organization_id is null or organization_id = (select public.current_org_id())
);
create policy entrance_conference_items_insert on public.entrance_conference_items for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy entrance_conference_items_update on public.entrance_conference_items for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy entrance_conference_items_delete on public.entrance_conference_items for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
revoke all on public.entrance_conference_items from public, anon;
grant select, insert, update, delete on public.entrance_conference_items to authenticated;

insert into public.entrance_conference_items (category, prompt, data_source, sort_order) values
  ('Facility & Census', 'Current facility roster and resident census available for surveyor review', 'roster', 10),
  ('Facility & Census', 'Facility license and any conditional/provisional status documentation on hand', 'general', 20),
  ('Staff Files', 'Personnel files organized and available for every active direct-care employee', 'roster', 30),
  ('Staff Training', 'All direct-care staff current on required annual training hours', 'training', 40),
  ('Staff Training', 'New-hire orientation completed and documented for all staff hired this year', 'training', 50),
  ('Staff Training', 'Administrator qualification and continuing-education hours current', 'administrator', 60),
  ('Dementia Care', 'Dementia-specific training current for all staff on a secured/memory-care unit', 'training', 70),
  ('Medication Administration', 'Medication administration certification current for all staff who pass meds', 'training', 80),
  ('Medication Administration', 'Medication administration practicum/competency test on file for the current cycle', 'training', 90),
  ('Background Checks', 'Criminal history (Act 34) clearances on file and current for all staff', 'background_checks', 100),
  ('Background Checks', 'FBI fingerprint clearances on file where required by residency status', 'background_checks', 110),
  ('Background Checks', 'Federal/state exclusion list screening completed and documented', 'background_checks', 120),
  ('Health Screening', 'TB screening / health clearance documentation current for all staff', 'credentials', 130),
  ('Fire Safety', 'Fire drills conducted and logged at the required frequency, including a sleeping-hours drill', 'inspections', 140),
  ('Fire Safety', 'Fire extinguishers, alarm systems, and smoke detectors inspected on schedule', 'inspections', 150),
  ('Emergency Preparedness', 'Emergency preparedness plan reviewed within the required interval', 'inspections', 160),
  ('Emergency Preparedness', '3-day emergency supply check current', 'inspections', 170),
  ('Resident Rights', 'Resident rights policy posted and attestation on file for staff', 'policies', 180),
  ('Incident Reporting', 'All reportable incidents from the past 12 months have a closed-out final report', 'incidents', 190),
  ('Incident Reporting', 'Any open corrective actions from a prior inspection have evidence of completion', 'incidents', 200);
