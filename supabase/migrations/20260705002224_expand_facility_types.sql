-- Expands facility_type support beyond the original PCH/ALR (personal care home / assisted
-- living residence) to the other four settings CareMetric CareBase's marketing site and course
-- catalog already cover: nursing homes, home health agencies, hospice agencies, and group homes.
-- Without this, facilities.facility_type's CHECK constraint made it impossible to create a
-- facility of any of those four types at all, even though courses/training content already
-- existed for them.

alter table public.facilities drop constraint facilities_facility_type_check;
alter table public.facilities add constraint facilities_facility_type_check
  check (facility_type in ('PCH','ALR','NH','HHA','HOS','GH'));

alter table public.training_types drop constraint training_types_applies_to_facility_type_check;
alter table public.training_types add constraint training_types_applies_to_facility_type_check
  check (applies_to_facility_type in ('PCH','ALR','NH','HHA','HOS','GH','BOTH'));

-- Training-type catalog entries for the four newly-supported settings, mirroring the PCH/ALR
-- entries added by 20260704234451_seed_required_inservice_courses.sql (same hours/citations
-- researched for the courses in that migration).
insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, required_hours, citation_note, is_system_default, sort_order
) values
  (null, 'GH-DIRECT-ANNUAL', 'Group Home Direct Service Worker Annual Training', 'Direct Care Staff Training',
   'Yearly training hours for direct service workers and their direct supervisors in a group home.', 'GH',
   365, 24.00,
   '55 Pa. Code Section 6400.52 -- 24 hours/year for direct service workers and their direct supervisors. Configurable default; verify against current regulations.',
   true, 7),
  (null, 'GH-OTHER-ANNUAL', 'Group Home Other Staff Annual Training', 'Direct Care Staff Training',
   'Yearly training hours for group home staff other than direct service workers/supervisors (dietary, housekeeping, maintenance, administrative).', 'GH',
   365, 12.00,
   '55 Pa. Code Section 6400.52 -- 12 hours/year for dietary, housekeeping, maintenance, and administrative staff. Configurable default; verify against current regulations.',
   true, 8),
  (null, 'NH-AIDE-ANNUAL', 'Nursing Home Nurse Aide Annual In-Service', 'Direct Care Staff Training',
   'Yearly in-service hours for nurse aides in a skilled nursing facility.', 'NH',
   365, 12.00,
   '42 CFR 483.95 (federal OBRA) -- 12 hours/year for nurse aides, including dementia management and abuse prevention. Configurable default; verify against current regulations.',
   true, 9),
  (null, 'HHA-AIDE-ANNUAL', 'Home Health Aide Annual In-Service', 'Direct Care Staff Training',
   'Yearly in-service hours for home health aides.', 'HHA',
   365, 12.00,
   '42 CFR 484.80 -- 12 hours/year for home health aides, RN-supervised. Configurable default; verify against current regulations.',
   true, 10),
  (null, 'HOS-AIDE-ANNUAL', 'Hospice Aide Annual In-Service', 'Direct Care Staff Training',
   'Yearly in-service hours for hospice aides.', 'HOS',
   365, 12.00,
   '42 CFR 418.76 -- 12 hours/year for hospice aides, RN-supervised. Configurable default; verify against current regulations.',
   true, 11);
