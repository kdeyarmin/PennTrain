begin;
select plan(6);

-- 20260925120100: the medication-administration training types state DHS's Regulatory Compliance
-- Guide reading of 2600.190 / 2800.190 (annual practicum; the course and test need not be repeated
-- every two years) without changing any renewal interval, so no record's status moves.

select is(
  (select array_agg(renewal_interval_days order by code) from public.training_types
    where organization_id is null and code in ('MED-INIT', 'MED-RENEW', 'TRAINER-CERT')),
  array[730, 730, 730],
  'renewal intervals are unchanged; the two-year clock is an owner decision (REG22)');

select is(
  (select count(*)::integer from public.training_types
    where organization_id is null and code in ('MED-INIT', 'MED-RENEW', 'DIABETES-EDU')
      and citation_note like '%2600.190%' and citation_note like '%2800.190%'),
  3,
  'each medication note cites both chapters');

select is(
  (select count(*)::integer from public.training_types
    where organization_id is null and code in ('MED-INIT', 'MED-RENEW')
      and citation_note like '%does not have to be completed every two years%'),
  2,
  'MED-INIT and MED-RENEW quote the RCG on the annual practicum');

select ok(
  (select name !~* 'annual' and description !~* 'annual'
     from public.training_types where organization_id is null and code = 'MED-RENEW'),
  'MED-RENEW no longer calls a 730-day cycle "annual"');

select ok(
  (select citation_note like '%every three years%'
     from public.training_types where organization_id is null and code = 'TRAINER-CERT'),
  'TRAINER-CERT states the Train-the-Trainer three-year recertification');

select is(
  (select count(*)::integer from public.training_types
    where organization_id is null and code in ('MED-INIT', 'MED-RENEW', 'DIABETES-EDU', 'TRAINER-CERT')
      and concat_ws(' ', name, description, citation_note) ~* '(assisted living residence|\mALR\M)'),
  0,
  'no medication training-type text calls the facility type "Assisted Living Residence" or "ALR"');

select * from finish();
rollback;
