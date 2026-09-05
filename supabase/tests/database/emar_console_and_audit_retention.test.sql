-- pgTAP coverage for 20260905290000 (I23 + the FHIR console's twin).
--
-- Two things on one migration. The eMAR integration console was the FHIR console's twin, and
-- 20260905260000 fixed only one of them: MedicationIntegration.tsx pulled every external order and
-- administration event in the facility and rendered drug names, directions and schedules across
-- every resident, on a page whose question is whether the feed is working. check:clinical-access-log
-- walked past it because these tables are gated on a permission rather than on
-- clinical_record_visible. And data_lifecycle_policies would have accepted one UPDATE turning
-- audit_logs into archive_then_delete. Run with: supabase test db.

begin;
select plan(16);

select has_function(
  'public', 'get_facility_medication_ingestion_activity', array['uuid'],
  'the console has an activity reader that carries no clinical content'
);
select has_function(
  'public', 'get_resident_external_medications', array['uuid', 'text'],
  'and a per-resident reader for the content, which is where a chart read belongs'
);
select ok(
  (select p.prosrc like '%log_clinical_access%' from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_resident_external_medications'),
  'the per-resident reader writes to the access log'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('18000000-0000-4000-8000-000000000001', 'eMAR Console Org', 'emar-console-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001',
   'eMAR Facility', 'PCH');
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values
  ('18000000-0000-4000-8000-000000000201', '18000000-0000-4000-8000-000000000001',
   '18000000-0000-4000-8000-000000000011', 'Medicated', 'Resident', public.pa_today() - 20, 'active'),
  ('18000000-0000-4000-8000-000000000202', '18000000-0000-4000-8000-000000000001',
   '18000000-0000-4000-8000-000000000011', 'Second', 'Resident', public.pa_today() - 20, 'active');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '18000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'emar-admin@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('18000000-0000-4000-8000-000000000101', '18000000-0000-4000-8000-000000000001',
        'emar-admin@test.local', 'E', 'Admin', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.organization_entitlement_grants(
  organization_id, feature_key, decision, entitlement_value, reason
) values
  ('18000000-0000-4000-8000-000000000001', 'modules.carebase', 'grant', 'true'::jsonb,
   'pgTAP fixture for the eMAR console');

insert into public.medication_integration_sources(
  id, organization_id, facility_id, name, vendor_name, external_facility_id, status
) values (
  '18000000-0000-4000-8000-000000000301', '18000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000011', 'Main eMAR', 'PharmVendor', 'EXT-9', 'active'
);
insert into public.external_medication_orders(
  organization_id, facility_id, source_id, resident_id, external_order_id, medication_display,
  directions, schedule_display, order_status, source_updated_at, raw_record_sha256
) values
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000011',
   '18000000-0000-4000-8000-000000000301', '18000000-0000-4000-8000-000000000201',
   'ORD-1', 'Lisinopril 10 MG tablet', 'One tablet by mouth every morning', 'Daily 08:00',
   'active', now() - interval '2 hours', repeat('a', 64)),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000011',
   '18000000-0000-4000-8000-000000000301', '18000000-0000-4000-8000-000000000202',
   'ORD-2', 'Acetaminophen 500 MG tablet', 'As needed for pain', 'PRN',
   'completed', now() - interval '8 hours', repeat('b', 64));
insert into public.external_medication_administration_events(
  organization_id, facility_id, source_id, resident_id, external_order_id, external_event_id,
  administration_status, occurred_at, source_note, raw_record_sha256
) values (
  '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000011',
  '18000000-0000-4000-8000-000000000301', '18000000-0000-4000-8000-000000000201',
  'ORD-1', 'EVT-1', 'refused', now() - interval '1 hour', 'Resident declined', repeat('c', 64)
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

create or replace function pg_temp.logged(p_resident uuid, p_domain text)
returns integer language sql security definer as $$
  select count(*)::integer from app_private.clinical_access_log l
  where l.resident_id = p_resident and l.clinical_domain = p_domain;
$$;

select pg_temp.act_as('18000000-0000-4000-8000-000000000101');

------------------------------------------------------------------------------------------------
-- Facility-wide: counts, not content
------------------------------------------------------------------------------------------------
select is(
  (public.get_facility_medication_ingestion_activity('18000000-0000-4000-8000-000000000011')
    ->>'orderTotal')::integer,
  2,
  'the activity reader counts every ingested order in the facility'
);
select is(
  (public.get_facility_medication_ingestion_activity('18000000-0000-4000-8000-000000000011')
    ->>'nonRoutineTotal')::integer,
  1,
  'and separates the non-routine administrations, which is what an operator chases'
);
select is(
  jsonb_array_length(
    public.get_facility_medication_ingestion_activity('18000000-0000-4000-8000-000000000011')
      ->'residents'),
  2,
  'broken down by resident, so a resident whose feed went quiet is visible'
);
select ok(
  (public.get_facility_medication_ingestion_activity('18000000-0000-4000-8000-000000000011')::text
    not like '%Lisinopril%')
  and (public.get_facility_medication_ingestion_activity('18000000-0000-4000-8000-000000000011')::text
    not like '%by mouth%'),
  'carrying no drug name and no directions -- the disclosure this replaced'
);
select is(
  pg_temp.logged('18000000-0000-4000-8000-000000000201', 'medications'), 0,
  'and writing no access-log row, because it disclosed no clinical record'
);

------------------------------------------------------------------------------------------------
-- One resident: content, and a log row
------------------------------------------------------------------------------------------------
select is(
  (public.get_resident_external_medications('18000000-0000-4000-8000-000000000201')
    ->'orders'->0->>'medication_display'),
  'Lisinopril 10 MG tablet',
  'the per-resident reader returns what the console renders'
);
select is(
  (public.get_resident_external_medications('18000000-0000-4000-8000-000000000201')
    ->'administrations'->0->>'administration_status'),
  'refused',
  'including the administration documentation'
);
select is(
  jsonb_array_length(
    public.get_resident_external_medications('18000000-0000-4000-8000-000000000201')->'orders'),
  1,
  'scoped to the one resident, not the facility'
);
select is(
  pg_temp.logged('18000000-0000-4000-8000-000000000201', 'medications'), 3,
  'and each call is recorded against the reader'
);

------------------------------------------------------------------------------------------------
-- The audit log a lifecycle policy could have deleted
------------------------------------------------------------------------------------------------
reset role;
select is(
  (select disposition from public.data_lifecycle_policies where source_table = 'audit_logs'),
  'archive_only',
  'the audit-log retention policy archives rather than deletes'
);
select throws_ok(
  $$ update public.data_lifecycle_policies set disposition = 'archive_then_delete'
     where source_table = 'audit_logs' $$,
  '23514', null,
  'and one UPDATE can no longer turn it into a deletion'
);
select throws_ok(
  $$ update public.data_lifecycle_policies set disposition = 'archive_then_delete'
     where source_table = 'report_snapshots' $$,
  '23514', null,
  'nor any other evidence class the allowlist does not name -- a new class is safe by default'
);
select lives_ok(
  $$ update public.data_lifecycle_policies set disposition = 'archive_then_delete'
     where source_table = 'product_events' $$,
  'while de-identified analytics may still be deleted, which is what the allowlist is for'
);

select * from finish();
rollback;
