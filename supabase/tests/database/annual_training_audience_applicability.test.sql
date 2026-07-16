-- pgTAP regression coverage for employer-confirmed annual-training audiences.
-- Run with: supabase test db supabase/tests/database/annual_training_audience_applicability.test.sql

begin;
select plan(33);

select has_column(
  'public',
  'training_types',
  'audience_verification_required',
  'training types can require an explicit employer audience decision'
);

select has_column(
  'public',
  'employee_training_records',
  'audience_decision_at',
  'audience decisions have a server-controlled chronology across recurring evidence rows'
);

select results_eq(
  $$
    select count(*)::integer
    from public.training_types
    where organization_id is null
      and code in (
        'DIRECT-ANNUAL', 'ALR-DIRECT-ANNUAL',
        'GH-DIRECT-ANNUAL', 'GH-OTHER-ANNUAL',
        'NH-AIDE-ANNUAL', 'HHA-AIDE-ANNUAL', 'HOS-AIDE-ANNUAL',
        'ADMIN-ANNUAL',
        'DEMENTIA', 'PCH-DEMENTIA-UNIT',
        'ALR-DEMENTIA-SCU-ANNUAL', 'ALR-INRBI-SCU-ANNUAL'
      )
      and audience_verification_required
  $$,
  array[12],
  'all role- and unit-sensitive system annual types require audience verification'
);

select results_eq(
  $$
    select required_hours, hour_bucket
    from public.training_types
    where organization_id is null and code = 'GH-OTHER-ANNUAL'
  $$,
  $$ values (12.00::numeric, 'general_annual'::text) $$,
  'the Chapter 6400 other-staff type owns a 12-hour general annual bucket'
);

select ok(
  (
    select required_roles_text like '%Direct service workers%program specialists%'
    from public.training_types
    where organization_id is null and code = 'GH-DIRECT-ANNUAL'
  ),
  'the Chapter 6400 direct audience includes workers, direct supervisors, and program specialists'
);

select ok(
  (
    select lower(required_roles_text) like '%building owner%fewer than 30 days%volunteers%interns%'
    from public.training_types
    where organization_id is null and code = 'GH-OTHER-ANNUAL'
  ),
  'the Chapter 6400 other audience records all listed groups and both regulatory exceptions'
);

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-00000000aa01', 'Audience Applicability Test', 'audience-applicability-test');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('00000000-0000-0000-0000-00000000aa11', '00000000-0000-0000-0000-00000000aa01', 'Audience GH', 'GH'),
  ('00000000-0000-0000-0000-00000000aa12', '00000000-0000-0000-0000-00000000aa01', 'Audience NH', 'NH'),
  ('00000000-0000-0000-0000-00000000aa13', '00000000-0000-0000-0000-00000000aa01', 'Audience PCH', 'PCH'),
  ('00000000-0000-0000-0000-00000000aa14', '00000000-0000-0000-0000-00000000aa01', 'Audience ALR', 'ALR');

insert into public.employees (
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values
  ('00000000-0000-0000-0000-00000000aa21', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa11', 'Gina', 'Direct', 'Direct Service Worker', 'active'),
  ('00000000-0000-0000-0000-00000000aa22', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa11', 'Omar', 'Other', 'Fiscal Staff', 'active'),
  ('00000000-0000-0000-0000-00000000aa23', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa11', 'Uma', 'Unconfirmed', 'Unclassified', 'active'),
  ('00000000-0000-0000-0000-00000000aa24', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa12', 'Nia', 'Aide', 'Nurse Aide', 'active'),
  ('00000000-0000-0000-0000-00000000aa25', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa12', 'Noah', 'Clinical', 'Non-Aide Employee', 'active'),
  ('00000000-0000-0000-0000-00000000aa26', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa13', 'Pat', 'PCH', 'Unclassified', 'active'),
  ('00000000-0000-0000-0000-00000000aa27', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa14', 'Alex', 'ALR', 'Unclassified', 'active');

select results_eq(
  $$
    select tt.code, r.status
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '00000000-0000-0000-0000-00000000aa21'
      and tt.code in ('GH-DIRECT-ANNUAL', 'GH-OTHER-ANNUAL')
    order by tt.code
  $$,
  $$
    values
      ('GH-DIRECT-ANNUAL'::text, 'pending_review'::text),
      ('GH-OTHER-ANNUAL'::text, 'pending_review'::text)
  $$,
  'a new group-home employee receives unconfirmed rather than asserted annual audiences'
);

select results_eq(
  $$
    select count(*)::integer
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id in (
      '00000000-0000-0000-0000-00000000aa24',
      '00000000-0000-0000-0000-00000000aa25'
    )
      and tt.code = 'NH-AIDE-ANNUAL'
      and r.status = 'pending_review'
  $$,
  array[2],
  'facility type does not assert that either nursing-home employee is a nurse aide'
);

select results_eq(
  $$
    select tt.code, r.status
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '00000000-0000-0000-0000-00000000aa26'
      and tt.code = 'DIRECT-ANNUAL'
  $$,
  $$ values ('DIRECT-ANNUAL'::text, 'pending_review'::text) $$,
  'PCH facility membership alone does not assert the direct-care annual requirement'
);

select results_eq(
  $$
    select tt.code, r.status
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '00000000-0000-0000-0000-00000000aa27'
      and tt.code in ('ALR-DIRECT-ANNUAL', 'DEMENTIA')
    order by tt.code
  $$,
  $$
    values
      ('ALR-DIRECT-ANNUAL'::text, 'pending_review'::text),
      ('DEMENTIA'::text, 'pending_review'::text)
  $$,
  'ALR general and dementia audiences await separate employer decisions'
);

select results_eq(
  $$
    select count(*)::integer
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id in (
      '00000000-0000-0000-0000-00000000aa21',
      '00000000-0000-0000-0000-00000000aa22',
      '00000000-0000-0000-0000-00000000aa23',
      '00000000-0000-0000-0000-00000000aa24',
      '00000000-0000-0000-0000-00000000aa25',
      '00000000-0000-0000-0000-00000000aa26',
      '00000000-0000-0000-0000-00000000aa27'
    )
      and tt.organization_id is null
      and tt.code = 'ADMIN-ANNUAL'
      and r.status = 'pending_review'
  $$,
  array[7],
  'administrator continuing education is never asserted from facility membership alone'
);

-- Confirm only the exact audience selected for each representative employee. A deliberately
-- completed not_applicable direct record for the other-staff employee proves that evidence on an
-- excluded type neither changes the decision nor leaks hours into the selected 12-hour bucket.
update public.employee_training_records r
set status = 'missing', completion_date = current_date, hours = 24, completion_method = 'manual_entry'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa21'
  and tt.code = 'GH-DIRECT-ANNUAL';

update public.employee_training_records r
set status = 'missing', completion_date = current_date, hours = 6, completion_method = 'manual_entry'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa22'
  and tt.code = 'GH-OTHER-ANNUAL';

update public.employee_training_records r
set status = 'not_applicable', completion_date = current_date, hours = 24, completion_method = 'manual_entry'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa22'
  and tt.code = 'GH-DIRECT-ANNUAL';

update public.employee_training_records r
set status = 'missing'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa24'
  and tt.code = 'NH-AIDE-ANNUAL';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select results_eq(
  $$
    select required_hours, completed_hours, status
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa21'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (24.00::numeric, 24.00::numeric, 'compliant'::text) $$,
  'a confirmed Chapter 6400 direct audience receives the 24-hour bucket and its evidence'
);

select results_eq(
  $$
    select required_hours, completed_hours
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa22'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (12.00::numeric, 6.00::numeric) $$,
  'a confirmed other-staff audience receives 12 hours and only its exact type contributes hours'
);

select results_eq(
  $$
    select count(*)::integer
    from public.employee_training_hour_buckets
    where employee_id in (
      '00000000-0000-0000-0000-00000000aa21',
      '00000000-0000-0000-0000-00000000aa22'
    )
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  array[2],
  'each confirmed group-home employee has exactly one general annual bucket'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa23'
      and training_year = extract(year from current_date)::integer
  $$,
  'an unconfirmed group-home employee has no annual-hour denominator'
);

select results_eq(
  $$
    select r.status
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '00000000-0000-0000-0000-00000000aa22'
      and tt.code = 'GH-DIRECT-ANNUAL'
  $$,
  array['not_applicable'::text],
  'recalculation preserves an explicit not-applicable audience decision'
);

select results_eq(
  $$
    select r.status, r.completion_date
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id = '00000000-0000-0000-0000-00000000aa21'
      and tt.code = 'GH-DIRECT-ANNUAL'
  $$,
  $$ values ('compliant'::text, current_date) $$,
  'recalculation preserves and renews completed evidence for a confirmed audience'
);

select results_eq(
  $$
    select required_hours, completed_hours
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa24'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (12.00::numeric, 0.00::numeric) $$,
  'an explicitly confirmed nurse aide receives the clinical 12-hour bucket'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa25'
      and training_year = extract(year from current_date)::integer
  $$,
  'an unconfirmed nursing-home employee is not treated as a nurse aide'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa26'
      and training_year = extract(year from current_date)::integer
  $$,
  'an unconfirmed PCH employee has no direct-care annual bucket'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa27'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'an unconfirmed ALR employee has no direct-care annual bucket'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa27'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'alr_dementia'
  $$,
  'the ALR dementia bucket also waits for its own audience confirmation'
);

-- Organization-specific training may add evidence, but cannot replace a confirmed regulatory
-- baseline or create a weaker fallback while the system audience is still unconfirmed.
insert into public.training_types (
  id, organization_id, code, name, category, applies_to_facility_type,
  renewal_interval_days, required_hours, hour_bucket, state
) values (
  '00000000-0000-0000-0000-00000000aa31',
  '00000000-0000-0000-0000-00000000aa01',
  'ORG-GH-GENERAL', 'Organization GH supplemental annual training', 'Organization Training',
  'GH', 365, 1, 'general_annual', 'PA'
);

update public.employee_training_records r
set completion_date = current_date,
    hours = case
      when r.employee_id = '00000000-0000-0000-0000-00000000aa21' then 3
      else 2
    end,
    completion_method = 'manual_entry'
where r.training_type_id = '00000000-0000-0000-0000-00000000aa31'
  and r.employee_id in (
    '00000000-0000-0000-0000-00000000aa21',
    '00000000-0000-0000-0000-00000000aa22'
  );

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select results_eq(
  $$
    select required_hours, completed_hours
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa21'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (24.00::numeric, 27.00::numeric) $$,
  'custom hours supplement but do not replace the confirmed 24-hour system baseline'
);

select results_eq(
  $$
    select required_hours, completed_hours
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa22'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (12.00::numeric, 8.00::numeric) $$,
  'custom hours supplement but do not replace the confirmed 12-hour system baseline'
);

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa23'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'a custom one-hour type cannot bypass an unconfirmed mandatory system audience'
);

-- A later employer reversal must remove a previously materialized denominator.
update public.employee_training_records r
set status = 'missing'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa23'
  and tt.code = 'GH-DIRECT-ANNUAL';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select isnt_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa23'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'confirming one exact audience materializes its bucket'
);

update public.employee_training_records r
set status = 'pending_review'
from public.training_types tt
where tt.id = r.training_type_id
  and r.employee_id = '00000000-0000-0000-0000-00000000aa23'
  and tt.code = 'GH-DIRECT-ANNUAL';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa23'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'returning the only applicable audience to pending review removes the stale bucket'
);

select results_eq(
  $$
    select count(*)::integer
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    where r.employee_id in (
      '00000000-0000-0000-0000-00000000aa21',
      '00000000-0000-0000-0000-00000000aa22',
      '00000000-0000-0000-0000-00000000aa23'
    )
      and tt.code in ('GH-DIRECT-ANNUAL', 'GH-OTHER-ANNUAL')
  $$,
  array[6],
  'employer decisions reuse the two auto-instantiated audience shells without duplicating records'
);

-- Adversarial recurring history: the newest server-stamped decision controls applicability, while
-- older earned evidence remains immutable data and can count again if the employer reconfirms.
insert into public.employees (
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values (
  '00000000-0000-0000-0000-00000000aa28',
  '00000000-0000-0000-0000-00000000aa01',
  '00000000-0000-0000-0000-00000000aa11',
  'Rita', 'Recurring', 'Direct Service Worker', 'active'
);

insert into public.employee_training_records (
  id, organization_id, facility_id, employee_id, training_type_id,
  completion_date, status, hours, completion_method
)
select
  '00000000-0000-0000-0000-00000000aa41',
  '00000000-0000-0000-0000-00000000aa01',
  '00000000-0000-0000-0000-00000000aa11',
  '00000000-0000-0000-0000-00000000aa28',
  tt.id, current_date, 'compliant', 5, 'manual_entry'
from public.training_types tt
where tt.organization_id is null and tt.code = 'GH-DIRECT-ANNUAL';

insert into public.employee_training_records (
  id, organization_id, facility_id, employee_id, training_type_id, status,
  audience_decision_at
)
select
  '00000000-0000-0000-0000-00000000aa42',
  '00000000-0000-0000-0000-00000000aa01',
  '00000000-0000-0000-0000-00000000aa11',
  '00000000-0000-0000-0000-00000000aa28',
  tt.id, 'pending_review', '2000-01-01 00:00:00+00'::timestamptz
from public.training_types tt
where tt.organization_id is null and tt.code = 'GH-DIRECT-ANNUAL';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa28'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'a current pending decision is not defeated by an older active record of the exact type'
);

select results_eq(
  $$
    select count(*)::integer
    from public.employee_training_records
    where id = '00000000-0000-0000-0000-00000000aa41'
      and completion_date = current_date
      and hours = 5
  $$,
  array[1],
  'the pending decision preserves older earned evidence instead of deleting it'
);

update public.employee_training_records
set status = 'missing'
where id = '00000000-0000-0000-0000-00000000aa42';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select results_eq(
  $$
    select required_hours, completed_hours
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa28'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  $$ values (24.00::numeric, 5.00::numeric) $$,
  'reconfirming the exact audience reuses preserved current-year evidence'
);

update public.employee_training_records
set status = 'not_applicable'
where id = '00000000-0000-0000-0000-00000000aa42';

select public.recalculate_compliance_core('00000000-0000-0000-0000-00000000aa01');

select is_empty(
  $$
    select 1
    from public.employee_training_hour_buckets
    where employee_id = '00000000-0000-0000-0000-00000000aa28'
      and training_year = extract(year from current_date)::integer
      and bucket_type = 'general_annual'
  $$,
  'a current not-applicable decision removes the bucket despite older active history'
);

select results_eq(
  $$
    select public.current_training_audience_status(
      '00000000-0000-0000-0000-00000000aa28',
      (select id from public.training_types where organization_id is null and code = 'GH-DIRECT-ANNUAL')
    )
  $$,
  array['not_applicable'::text],
  'the canonical exact-type audience helper returns the latest server-stamped decision'
);

select * from finish();
rollback;
