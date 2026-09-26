begin;
select plan(14);

-- 20260925120000: the five seeded feed entries were attributed to "PA Department of Human Services"
-- with invented 2026 effective dates and several statements the Department's text does not make.
-- They now cite the Department's Regulatory Compliance Guides, and four Department documents the
-- feed never covered are seeded as drafts for a platform admin to publish.

select is(
  (select count(*)::integer from public.regulatory_updates
    where slug in ('pch-annual-training-hours-2600-65', 'alf-annual-training-hours-2800-65',
                   'medication-administration-training-refresh',
                   'resident-assessment-support-plan-timelines', 'fire-safety-drills-documentation')
      and status = 'published'
      and category = 'guidance'
      and effective_date is null
      and source_name like 'PA DHS Regulatory Compliance Guide%'
      and source_uri like 'https://www.pa.gov/%'),
  5,
  'the five seeded entries stay published, as guidance with no effective date, sourced to a DHS compliance guide');

select is(
  (select count(*)::integer from public.regulatory_updates
    where source_name = 'PA Department of Human Services'
       or effective_date >= date '2026-01-01'),
  0,
  'no entry is attributed to DHS generically or claims a 2026 effective date');

select ok(
  (select body like '%§ 2600.65(e)%' and body like '%(§ 2600.65(e)(2))%' and body not like '%(f)-(g))%'
     from public.regulatory_updates where slug = 'pch-annual-training-hours-2600-65'),
  'the PCH 12 hours and 6 on-the-job hours cite 2600.65(e) and (e)(2), not the topic lists');

select ok(
  (select body not like '%must separately maintain current first-aid and CPR%'
      and body like '%one staff person trained in first aid%for every 50 residents%'
     from public.regulatory_updates where slug = 'pch-annual-training-hours-2600-65'),
  'the PCH entry states 2600.63(a) (one certified person per 50 residents), not an every-staff CPR rule');

select ok(
  (select body like '%up to 6 hours of medication administration training%'
      and body like '%up to 4 hours of CPR%'
      and body like '%§ 2800.69 is in addition to the 16 hours%'
     from public.regulatory_updates where slug = 'alf-annual-training-hours-2800-65'),
  'the ALF entry carries the RCG caps (6 medication, 4 CPR) and keeps 2800.69 outside the 16 hours');

select ok(
  (select body not like '%retraining and a fresh observation are expected%'
      and body like '%annual practicum%'
      and body like '%do not have to be repeated every two years%'
      and body like '%reported immediately to the resident, the resident''s designated person and the prescriber%'
     from public.regulatory_updates where slug = 'medication-administration-training-refresh'),
  'the medication entry states the annual practicum and 188(b), and drops the invented retraining rule');

select ok(
  (select body like '%at least once a month%'
      and body like '%the exit route used%'
      and body like '%number of staff persons participating%'
      and body like '%whether the fire alarm or smoke detector was operative%'
      and body not like '%shift, evacuation time%'
     from public.regulatory_updates where slug = 'fire-safety-drills-documentation'),
  'the fire-drill entry says monthly and lists the 132(c) record elements');

select ok(
  (select body like '%within 15 days of admission (§ 2600.225(a))%'
      and body like '%within 30 days after admission and reviewed quarterly%'
      and body not like '%A hospitalization, a fall with injury%'
     from public.regulatory_updates where slug = 'resident-assessment-support-plan-timelines'),
  'the assessment entry gives the chapter deadlines and the RCG significant-change test');

select is(
  (select count(*)::integer from public.regulatory_updates
    where slug in ('dhs-clarification-chemical-restraints-2025',
                   'dhs-guidance-bedside-mobility-devices-2023',
                   'dhs-guidance-voice-controlled-devices-2022',
                   'care-facility-carbon-monoxide-alarms-act-2016')
      and status = 'draft'
      and published_at is null
      and source_uri like 'https://www.pa.gov/%'),
  4,
  'the four Department documents are seeded as unpublished drafts with DHS source links');

select is(
  (select effective_date from public.regulatory_updates
    where slug = 'care-facility-carbon-monoxide-alarms-act-2016'),
  date '2016-09-23',
  'the carbon monoxide act carries its real effective date');

select is(
  (select count(*)::integer from public.regulatory_updates
    where concat_ws(' ', title, summary, body, source_name) ~* '(assisted living residence|\mALR\M)'),
  0,
  'no feed text calls the facility type "Assisted Living Residence" or "ALR"');

select ok(
  (select bool_and(char_length(summary) <= 600 and char_length(title) <= 200)
     from public.regulatory_updates),
  'every entry fits the title and summary limits');

create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

select pg_temp.act_as_anon();

select is(
  (select count(*)::integer from public.list_regulatory_updates(null, null, 200) u
    where u.slug in ('dhs-clarification-chemical-restraints-2025',
                     'dhs-guidance-bedside-mobility-devices-2023',
                     'dhs-guidance-voice-controlled-devices-2022',
                     'care-facility-carbon-monoxide-alarms-act-2016')),
  0,
  'the public feed does not show the drafts');

select is(
  (select count(*)::integer from public.list_regulatory_updates(null, 'ALR', 200) u
    where u.slug = 'alf-annual-training-hours-2800-65' and u.source_name like 'PA DHS%'),
  1,
  'the corrected ALF entry is still on the public feed');

reset role;

select * from finish();
rollback;
