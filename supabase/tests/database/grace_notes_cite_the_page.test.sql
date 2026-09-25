-- pgTAP coverage for 20260925120600: the grace-period notes cite the RCG page and list the
-- Department printed, and the figures they justify are unchanged.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(4);

select is(
  (select count(*)::int from public.resident_compliance_rule_packs
   where notes ~ 'p\.5 Grace Periods' or notes ilike '%exclusion list names only%'
      or notes ilike '%carves out only%'),
  0,
  'no rule pack cites a p.5 Grace Periods table or a one-entry exclusion list; the list is on p.4 and names eight provisions'
);

select is(
  (select count(*)::int from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'ALR'
     and item_type = 'annual_reassessment'
     and notes like '%2800.224(a), the ALF%initial assessment%'
     and notes like '%carried over from Chapter 2600%'),
  2,
  'both ALF annual-reassessment packs name 2800.224(a) as the initial assessment and say where the guide''s 225(a) label came from'
);

select is(
  (select string_agg(facility_type || ':' || item_type || ':' || admission_track || ':' || grace_period_days,
                     ',' order by facility_type, item_type, admission_track)
   from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA'
     and ((facility_type = 'ALR' and item_type = 'annual_reassessment')
       or (facility_type = 'PCH' and item_type = 'annual_medical_evaluation'))),
  'ALR:annual_reassessment:expedited:15,ALR:annual_reassessment:standard:15,PCH:annual_medical_evaluation:standard:15',
  'the annual grace the notes justify is still 15 days'
);

select is(
  (select notes like '%RCG p.4 Grace Periods list%' and notes like '%only medical-evaluation entry is 2600.141(a)%'
   from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'PCH'
     and item_type = 'annual_medical_evaluation'),
  true,
  'the PCH annual medical evaluation cites p.4 and names 2600.141(a) as the list''s only medical-evaluation entry'
);

select * from finish();
rollback;
