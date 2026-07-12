-- The training_types base catalog (DIRECT-ANNUAL, DEMENTIA, ORIENT, FIRE-SAFETY, MED-INIT,
-- MED-RENEW, TRAINER-CERT, ADMIN-ANNUAL, ABUSE-REPORT, INFECTION, RESIDENT-RIGHTS) exists on
-- this project's live database but is not created by any committed migration -- it was seeded
-- ad hoc outside the migration system at some point. Without this backfill, a fresh database
-- built from migrations alone (a new Supabase project, a preview branch, disaster recovery)
-- ends up with an empty/broken training-type catalog: no PCH 12-hour annual type, no
-- medication-administration type, no orientation, no fire safety -- exactly the rows
-- 20260704234451_seed_required_inservice_courses.sql's UPDATE ... where code = 'DIRECT-ANNUAL'/
-- 'DEMENTIA' clauses silently no-op against on a fresh database. Each insert is guarded by
-- WHERE NOT EXISTS (there is no unique constraint on training_types.code) and carries the
-- already-updated final shape, so this is idempotent regardless of whether 20260704234451
-- found real rows to update or not.

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'DIRECT-ANNUAL', 'Direct Care Staff Annual Training', 'Direct Care Staff Training',
  'Annual required training hours for direct care staff', 'PCH',
  365, 90, false, true, 0, 12.00, false,
  '55 Pa. Code Section 2600.65 -- 12 hours/year for direct care staff (up to 6 hours may be supervised on-the-job training). Configurable default; verify against current regulations.'
where not exists (select 1 from public.training_types where code = 'DIRECT-ANNUAL' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'DEMENTIA', 'Assisted Living Dementia-Specific Training (Annual)', 'Dementia Care',
  'Annual dementia-specific training hours for assisted living direct care staff. A separate 4-hour dementia-specific orientation is also required within 30 days of hire, tracked as a one-time onboarding item.', 'ALR',
  365, 90, false, true, 0, 2.00, false,
  '55 Pa. Code Section 2800.69 -- 4 hours within 30 days of hire, then 2 hours/year thereafter. Configurable default; verify against current regulations.'
where not exists (select 1 from public.training_types where code = 'DEMENTIA' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'ORIENT', 'New Employee Orientation', 'Personal Care Home Orientation',
  'Required orientation for all new hires', 'BOTH',
  null, 30, false, true, 0, 3.00, false, 'Editable onboarding requirement.'
where not exists (select 1 from public.training_types where code = 'ORIENT' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'FIRE-SAFETY', 'Fire Safety and Emergency Preparedness', 'Fire Safety',
  'Annual fire safety and evacuation training', 'BOTH',
  365, 60, false, true, 0, 1.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'FIRE-SAFETY' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'INFECTION', 'Infection Control', 'Infection Control',
  'Annual infection control and prevention training', 'BOTH',
  365, 60, false, true, 0, 1.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'INFECTION' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'ABUSE-REPORT', 'Abuse, Neglect, and Exploitation Reporting', 'Abuse, Neglect, and Exploitation',
  'Mandatory abuse/neglect recognition and reporting training', 'BOTH',
  365, 60, false, true, 0, 1.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'ABUSE-REPORT' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'RESIDENT-RIGHTS', 'Resident Rights and Dignity', 'Resident Rights',
  'Annual training on resident rights and dignity', 'BOTH',
  365, 60, false, true, 0, 1.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'RESIDENT-RIGHTS' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, warning_days_default, document_required, is_system_default,
  sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'ADMIN-ANNUAL', 'Administrator Annual Training', 'Administrator Training',
  'Annual continuing education for facility administrators', 'BOTH',
  365, 90, true, true, 0, 24.00, false,
  'Configurable PA PCH/Chapter 2600-style sample; verify current law.'
where not exists (select 1 from public.training_types where code = 'ADMIN-ANNUAL' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  applies_to_trainers, renewal_interval_days, warning_days_default, document_required,
  is_system_default, sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'TRAINER-CERT', 'Designated Trainer Certification', 'Staff Competency',
  'Certification for staff who train/observe other employees', 'BOTH',
  true, 730, 90, true, true, 0, 0.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'TRAINER-CERT' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  applies_to_administers_meds, applies_to_trainers, renewal_interval_days, warning_days_default,
  document_required, is_system_default, sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'MED-INIT', 'Medication Administration Initial Certification', 'Medication Administration Tracking',
  'Initial certification for staff who administer medications', 'BOTH',
  true, false, null, 90, true, true, 0, 0.00, false,
  'Configurable PA PCH/Chapter 2600-style sample; verify current law.'
where not exists (select 1 from public.training_types where code = 'MED-INIT' and organization_id is null);

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  applies_to_administers_meds, applies_to_trainers, renewal_interval_days, warning_days_default,
  document_required, is_system_default, sort_order, required_hours, admin_approval_required, citation_note
)
select null, 'MED-RENEW', 'Medication Administration Annual Renewal', 'Medication Administration Tracking',
  'Annual renewal for medication administration certification', 'BOTH',
  true, false, 365, 60, true, true, 0, 0.00, false, 'Configurable sample, not legal advice.'
where not exists (select 1 from public.training_types where code = 'MED-RENEW' and organization_id is null);
