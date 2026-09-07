-- pgTAP coverage for the 2026-09-06 P3 long-tail pass (BACKLOG J74).
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(6);

insert into public.organizations(id, name, slug, subscription_status) values
  ('7a000000-0000-4000-8000-000000000001', 'P3 Org', 'p3-longtail-org', 'trial');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000001', 'P3 Facility', 'PCH');

-- Two residents on the same facility: one who granted clinical disclosure, one who did not.
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, clinical_data_consent) values
  ('7a000000-0000-4000-8000-000000000021', '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011', 'Grant', 'Given', '2026-01-05', 'granted'),
  ('7a000000-0000-4000-8000-000000000022', '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011', 'With', 'Held', '2026-01-05', 'revoked');

insert into public.clinical_observations(
  id, organization_id, facility_id, resident_id, observation_type, value_numeric, unit, observed_at
) values
  ('7a000000-0000-4000-8000-000000000031', '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000021', 'weight', 150, 'lb', '2026-02-01T12:00:00Z'),
  ('7a000000-0000-4000-8000-000000000032', '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000022', 'weight', 160, 'lb', '2026-02-01T12:00:00Z');

------------------------------------------------------------------------------------------------
-- The export's consent predicate lives in one place
------------------------------------------------------------------------------------------------
select isnt(
  btrim(app_private.export_consent_predicate('clinical_observations')), '',
  'a clinical table with a resident_id carries a consent predicate'
);
select is(
  btrim(app_private.export_consent_predicate('employees')), '',
  'a table the consent rule does not reach carries no predicate'
);
select isnt(
  btrim(app_private.export_consent_predicate('clinical_observation_amendments')), '',
  'a child table that reaches a resident through its parent carries one too'
);

------------------------------------------------------------------------------------------------
-- The archive can now say what it left out
------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::int
   from public.export_organization_table(
     '7a000000-0000-4000-8000-000000000001', 'clinical_observations', 0, 100, null)),
  1,
  'the export still withholds the observation of the resident who revoked consent'
);

select results_eq(
  $$ select table_name, rows_in_archive, rows_withheld
     from public.export_organization_consent_withholding('7a000000-0000-4000-8000-000000000001') $$,
  $$ values ('clinical_observations'::text, 1::bigint, 1::bigint) $$,
  'and the archive can declare the row it withheld, per table, without naming the resident'
);

-- The counter is the export worker's, not a tenant's: which of your residents withheld consent is
-- itself the sensitive fact, and this function reads across every tenant table to answer.
select set_config('request.jwt.claims', '{"sub":"7a000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.export_organization_consent_withholding('7a000000-0000-4000-8000-000000000001') $$,
  '42501',
  'Only the trusted export worker may read export rows',
  'a browser role cannot read the withholding counts'
);

select finish();
rollback;
