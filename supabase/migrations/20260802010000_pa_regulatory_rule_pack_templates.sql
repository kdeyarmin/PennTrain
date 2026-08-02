-- SG-2 counsel-cleared path: seed Pennsylvania personnel training rule pack templates.
-- Content stays close to literal 55 Pa. Code hour floors and applicability.
-- Installation still creates draft versions that must pass fixture / shadow / approve / activate.

insert into public.regulatory_rule_pack_templates (
  template_key, name, description, jurisdiction_code, authority_name, citation,
  source_uri, source_checksum_sha256, applicability, calculation_parameters,
  effective_from, golden_fixtures
) values (
  'pa.pch.2600.65.personnel',
  'Pennsylvania PCH Direct-Care Annual Training',
  '55 Pa. Code §2600.65 personnel training for personal care homes. Installation creates a draft that must pass fixture, independent approval, shadow, and activation gates. Counsel-cleared product path (SG-2 option 2).',
  'US-PA',
  'Pennsylvania Department of Human Services',
  '55 Pa. Code §2600.65',
  'https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html',
  encode(extensions.digest(convert_to('55 Pa. Code §2600.65 PCH annual staff training direct-care minimum 12 hours', 'utf8'), 'sha256'), 'hex'),
  '{"stateCodes":["PA"],"facilityTypes":["PCH"],"workerTypes":["regular","agency","substitute"]}'::jsonb,
  '{"annualBasis":"calendar_year","prorateFromHire":true,"generalAnnualHours":12,"maxOnTheJobTrainingHours":6,"orientationRequired":true,"sourceEffectiveDate":"2024-01-01","notes":"Hour floors from §2600.65(f)-(g). Curriculum module splits are product design, not regulator-issued allocations."}'::jsonb,
  date '2024-01-01',
  '[
    {"fixtureKey":"pa.pch.annual.direct_care.met","facilityType":"PCH","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":12},"expected":{"compliant":true,"requiredHours":12}},
    {"fixtureKey":"pa.pch.annual.direct_care.short","facilityType":"PCH","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":8},"expected":{"compliant":false,"requiredHours":12}},
    {"fixtureKey":"pa.pch.ojt.cap","facilityType":"PCH","profile":"direct_care","boundaryDate":"2026-12-31","input":{"onTheJobTrainingHours":6,"classroomHours":6},"expected":{"compliant":true,"requiredHours":12,"maxOnTheJobTrainingHours":6}}
  ]'::jsonb
)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  jurisdiction_code = excluded.jurisdiction_code,
  authority_name = excluded.authority_name,
  citation = excluded.citation,
  source_uri = excluded.source_uri,
  source_checksum_sha256 = excluded.source_checksum_sha256,
  applicability = excluded.applicability,
  calculation_parameters = excluded.calculation_parameters,
  effective_from = excluded.effective_from,
  golden_fixtures = excluded.golden_fixtures,
  updated_at = now();

insert into public.regulatory_rule_pack_templates (
  template_key, name, description, jurisdiction_code, authority_name, citation,
  source_uri, source_checksum_sha256, applicability, calculation_parameters,
  effective_from, golden_fixtures
) values (
  'pa.alf.2800.65.personnel',
  'Pennsylvania ALF/ALR Direct-Care Annual Training',
  '55 Pa. Code §2800.65 personnel training for assisted living residences. Installation creates a draft that must pass fixture, independent approval, shadow, and activation gates. Counsel-cleared product path (SG-2 option 2). Additional §2800.69 dementia hours are separate and do not count toward the 16-hour floor.',
  'US-PA',
  'Pennsylvania Department of Human Services',
  '55 Pa. Code §2800.65',
  'https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html',
  encode(extensions.digest(convert_to('55 Pa. Code §2800.65 ALR annual staff training direct-care minimum 16 hours', 'utf8'), 'sha256'), 'hex'),
  '{"stateCodes":["PA"],"facilityTypes":["ALR"],"workerTypes":["regular","agency","substitute"]}'::jsonb,
  '{"annualBasis":"calendar_year","prorateFromHire":true,"generalAnnualHours":16,"dementiaAdditionalHoursDoNotCountTowardGeneral":true,"orientationRequired":true,"sourceEffectiveDate":"2024-01-01","notes":"Hour floors from §2800.65(i)-(j). §2800.69 dementia hours are additional and excluded from the 16-hour floor. Curriculum module splits are product design."}'::jsonb,
  date '2024-01-01',
  '[
    {"fixtureKey":"pa.alf.annual.direct_care.met","facilityType":"ALR","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":16},"expected":{"compliant":true,"requiredHours":16}},
    {"fixtureKey":"pa.alf.annual.direct_care.short","facilityType":"ALR","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":12},"expected":{"compliant":false,"requiredHours":16}},
    {"fixtureKey":"pa.alf.dementia.not_counted","facilityType":"ALR","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":14,"dementiaAdditionalHours":2},"expected":{"compliant":false,"requiredHours":16,"dementiaAdditionalHoursDoNotCountTowardGeneral":true}}
  ]'::jsonb
)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  jurisdiction_code = excluded.jurisdiction_code,
  authority_name = excluded.authority_name,
  citation = excluded.citation,
  source_uri = excluded.source_uri,
  source_checksum_sha256 = excluded.source_checksum_sha256,
  applicability = excluded.applicability,
  calculation_parameters = excluded.calculation_parameters,
  effective_from = excluded.effective_from,
  golden_fixtures = excluded.golden_fixtures,
  updated_at = now();
