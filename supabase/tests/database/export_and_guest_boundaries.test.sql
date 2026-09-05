-- pgTAP coverage for 20260905130000: boundaries that stopped one level short (I16).
--
-- The first case is the one that matters: an organization export that carried the identity of
-- everyone who filed a confidential report, requested by an administrator who may well be the
-- person a report is about. Run with: supabase test db.

begin;
select plan(11);

-- 1-4. The export catalogue.
select ok(
  not exists (
    select 1 from public.get_organization_export_catalog() t(name)
    where t.name = 'confidential_reporter_identities'
  ),
  'the export catalogue does not contain confidential_reporter_identities'
);
select ok(
  not exists (
    select 1 from public.get_organization_export_catalog() t(name)
    where t.name = 'confidential_incident_details'
  ),
  'nor confidential_incident_details'
);
select ok(
  not exists (
    select 1 from public.get_organization_export_catalog() t(name)
    where t.name like 'confidential%'
  ),
  'and nothing else named confidential_*, so a table added later is excluded by construction'
);
-- The catalogue still does its job: this is a deny-list, not a disabled function.
select ok(
  (select count(*) from public.get_organization_export_catalog()) > 100
    and exists (
      select 1 from public.get_organization_export_catalog() t(name) where t.name = 'employees'
    ),
  'the ordinary tenant tables are still exportable'
);

-- 5-7. The safety-report token. A facility UUID is not a secret -- it is in URLs throughout the
-- product -- so the legacy branch must resolve the facility without handing out the credential.
insert into public.organizations(id, name, slug) values
  ('e1000000-0000-4000-8000-000000000001', 'Boundary Org', 'boundary-org');
insert into public.facilities(id, organization_id, name, facility_type, safety_report_token) values
  ('e1000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000001',
   'Boundary Facility', 'PCH', 'poster-token-abcdefgh');

select is(
  (select public.resolve_safety_report_facility('e1000000-0000-4000-8000-000000000011')
     ->> 'facilityName'),
  'Boundary Facility',
  'a legacy QR code carrying the facility UUID still resolves, so old posters keep working'
);
select is(
  (select public.resolve_safety_report_facility('e1000000-0000-4000-8000-000000000011')
     ->> 'token'),
  null,
  'but it no longer hands back the current token -- otherwise rotating it protects nothing'
);
select is(
  (select public.resolve_safety_report_facility('poster-token-abcdefgh') ->> 'token'),
  'poster-token-abcdefgh',
  'a caller who already presented the token still gets it back'
);

-- 8-9. Certificate verification discloses what a verifier needs and no more.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verify_certificate'
  ) and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_certificate'
      and pg_get_function_result(p.oid) like '%final_exam_score%'
  ),
  'verify_certificate no longer returns the holder''s final exam score'
);
select ok(
  (select pg_get_function_result(p.oid) like '%credential_number%'
     and pg_get_function_result(p.oid) like '%organization_name%'
     and pg_get_function_result(p.oid) like '%is_valid%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verify_certificate'),
  'and still returns everything a surveyor or employer actually checks'
);

-- 10-11. A read-only role cannot start work.
select ok(
  (select prosrc not like '%auditor%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_binder_export'),
  'request_binder_export no longer admits auditor -- it enqueues a job that renders PHI'
);
select ok(
  (select prosrc not like '%auditor%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_confidential_intake_escalation'),
  'nor does request_confidential_intake_escalation -- escalating opens a work item and notifies'
);

select * from finish();
rollback;
