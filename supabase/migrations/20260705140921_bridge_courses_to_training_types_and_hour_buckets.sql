-- §2600.65/§2800.65/§6400.52 annual-hours engine, phase 1 (schema): bridges the LMS course
-- catalog to the training-type compliance catalog, and extends employee_training_hour_buckets
-- (created but never populated by anything) to hold three concurrent buckets per employee-year
-- instead of one, per ROADMAP.md Tier 2.2.

-- 1. courses <-> training_types bridge. Nullable: most courses (optional/elective content) have
-- no compliance mapping at all; only courses that satisfy a specific annual-hours requirement
-- get one, so complete_course_assignment() (next migration) knows whether/how to write a
-- matching employee_training_records row.
alter table public.courses
  add column training_type_id uuid references public.training_types(id);

-- Wire up the 8 system-catalog courses seeded by 20260704234451_seed_required_inservice_courses.sql
-- to the training-type row each one actually satisfies.
update public.courses c set training_type_id = tt.id
from public.training_types tt
where c.organization_id is null and tt.organization_id is null and (
  (c.title = 'Personal Care Home Direct Care Staff Annual In-Service' and tt.code = 'DIRECT-ANNUAL') or
  (c.title = 'Personal Care Home Dementia Care Unit Training' and tt.code = 'PCH-DEMENTIA-UNIT') or
  (c.title = 'Assisted Living Direct Care Staff Annual In-Service' and tt.code = 'ALR-DIRECT-ANNUAL') or
  (c.title = 'Assisted Living Dementia-Specific Training' and tt.code = 'DEMENTIA') or
  (c.title = 'Group Home Direct Service Worker Annual Training' and tt.code = 'GH-DIRECT-ANNUAL') or
  (c.title = 'Nursing Home Nurse Aide Annual In-Service' and tt.code = 'NH-AIDE-ANNUAL') or
  (c.title = 'Home Health Aide Annual In-Service' and tt.code = 'HHA-AIDE-ANNUAL') or
  (c.title = 'Hospice Aide Annual In-Service' and tt.code = 'HOS-AIDE-ANNUAL')
);

-- 2. Which of the three concurrent annual-hour buckets (general_annual, alr_dementia,
-- sdcu_dementia) a training_type's completed hours roll up into. NULL (the default, for
-- everything else -- fire safety, infection control, orientation, med certs, admin CE, etc.)
-- means "tracked as its own standalone compliance item, same as today, not hour-aggregated."
-- Only the facility-type-wide annual requirement and the two additive dementia supplements are
-- named in the roadmap as needing aggregate hour tracking.
alter table public.training_types
  add column hour_bucket text check (hour_bucket in ('general_annual','alr_dementia','sdcu_dementia'));

update public.training_types set hour_bucket = 'general_annual'
where organization_id is null
  and code in ('DIRECT-ANNUAL','ALR-DIRECT-ANNUAL','GH-DIRECT-ANNUAL','NH-AIDE-ANNUAL','HHA-AIDE-ANNUAL','HOS-AIDE-ANNUAL');

update public.training_types set hour_bucket = 'alr_dementia'
where organization_id is null and code = 'DEMENTIA';

update public.training_types set hour_bucket = 'sdcu_dementia'
where organization_id is null and code = 'PCH-DEMENTIA-UNIT';

-- 3. A completion_method value for supervised on-the-job training didn't exist -- without it,
-- the "up to 6 hours may be OJT" cap cited on DIRECT-ANNUAL/ALR-DIRECT-ANNUAL/GH-DIRECT-ANNUAL
-- has nothing to detect.
alter table public.employee_training_records drop constraint employee_training_records_completion_method_check;
alter table public.employee_training_records add constraint employee_training_records_completion_method_check
  check (completion_method in ('in_person','online','hybrid','manual_entry','on_the_job'));

-- 4. employee_training_hour_buckets: one row per (employee, year) today -> one row per
-- (employee, year, bucket) so the three buckets can carry independent required/completed/status
-- values, with dementia-bucket hours never bleeding into the general bucket's total.
alter table public.employee_training_hour_buckets
  add column bucket_type text not null default 'general_annual'
    check (bucket_type in ('general_annual','alr_dementia','sdcu_dementia')),
  add column ojt_hours numeric(6,2) not null default 0;
comment on column public.employee_training_hour_buckets.ojt_hours is
  'Raw (uncapped) on-the-job-training hours logged toward this bucket this year, for transparency. completed_hours already applies the bucket''s OJT cap (6h for general_annual, 0 for the dementia supplements) -- this column shows how much of it was OJT-sourced.';

alter table public.employee_training_hour_buckets drop constraint employee_training_hour_buckets_employee_id_training_year_key;
alter table public.employee_training_hour_buckets add constraint employee_training_hour_buckets_employee_year_bucket_key
  unique (employee_id, training_year, bucket_type);
