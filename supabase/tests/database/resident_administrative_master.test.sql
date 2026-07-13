begin;
select plan(37);

select has_table('public', 'resident_contacts', 'structured resident contacts exist');
select has_table('public', 'resident_property_items', 'resident property inventory exists');
select has_table('public', 'resident_legal_records', 'legal and acknowledgement records exist');
select has_table('public', 'resident_administrative_history', 'administrative changes retain history');
select has_column('public', 'residents', 'preferred_name', 'preferred name is structured');
select has_column('public', 'residents', 'mobility_summary', 'mobility summary is structured');
select has_column('public', 'residents', 'contract_status', 'contract status is structured');
select ok(has_table_privilege('authenticated', 'public.resident_contacts', 'SELECT'), 'browser role can read scoped contacts');
select ok(not has_table_privilege('authenticated', 'public.resident_contacts', 'INSERT'), 'browser role cannot bypass contact command');
select ok(not has_table_privilege('authenticated', 'public.resident_property_items', 'UPDATE'), 'browser role cannot silently rewrite property inventory');

insert into public.organizations(id, name, slug, subscription_status) values
  ('61000000-0000-4000-8000-000000000001', 'Resident Master Org', 'resident-master-org', 'active'),
  ('61000000-0000-4000-8000-000000000002', 'Other Resident Org', 'other-resident-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000001', 'Resident Master Facility', 'PCH'),
  ('61000000-0000-4000-8000-000000000012', '61000000-0000-4000-8000-000000000002', 'Other Facility', 'ALR');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'master-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'master-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'other-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('61000000-0000-4000-8000-000000000101', '61000000-0000-4000-8000-000000000001', 'master-admin@test.local', 'Master', 'Admin', 'org_admin', true),
  ('61000000-0000-4000-8000-000000000102', '61000000-0000-4000-8000-000000000001', 'master-auditor@test.local', 'Master', 'Auditor', 'auditor', true),
  ('61000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-000000000002', 'other-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date) values
  ('61000000-0000-4000-8000-000000000201', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011', 'Jordan', 'Resident', current_date - 20),
  ('61000000-0000-4000-8000-000000000202', '61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000012', 'Other', 'Resident', current_date - 10);
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_bucket, storage_path,
  file_name, file_type, document_label
) values
  ('61000000-0000-4000-8000-000000000301', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000201', 'resident-documents', 'master/rights.pdf', 'rights.pdf', 'application/pdf', 'Resident rights'),
  ('61000000-0000-4000-8000-000000000302', '61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000012', '61000000-0000-4000-8000-000000000202', 'resident-documents', 'other/other.pdf', 'other.pdf', 'application/pdf', 'Other document');
insert into public.resident_census_events(
  organization_id, facility_id, resident_id, event_type, resulting_status, reason
) values
  ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000201', 'admitted', 'active', 'Admission completed'),
  ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000201', 'hospital_leave', 'hospital_leave', 'Hospital evaluation'),
  ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000201', 'returned', 'active', 'Returned to facility');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table master_ids(key text primary key, id uuid) on commit drop;
grant all on master_ids to authenticated, service_role;

select pg_temp.act_as('61000000-0000-4000-8000-000000000101');
select lives_ok($$
  select public.save_resident_administrative_master(
    '61000000-0000-4000-8000-000000000201',
    '{"preferred_name":"Jordy","date_of_birth":"1945-03-04","prior_address_line1":"10 Main St","prior_address_city":"York","prior_address_state":"pa","prior_address_postal_code":"17401","insurance_payer_name":"Example Health","insurance_member_id":"MEM-100","dietary_requirements":"Low sodium","food_allergies":["Peanuts","Shellfish"],"mobility_summary":"Uses rolling walker","supervision_requirements":"Standby assistance outdoors","communication_preferences":"Speak clearly and provide written reminders","preferred_language":"English","religious_cultural_preferences":"Sunday services","advance_directive_status":"on_file","resident_rights_acknowledged_at":"2026-07-01T12:00:00Z","resident_rights_document_id":"61000000-0000-4000-8000-000000000301","contract_status":"executed","contract_effective_date":"2026-07-01","contract_document_id":"61000000-0000-4000-8000-000000000301"}'::jsonb,
    '[{"contact_type":"designated_person","name":"Taylor Resident","relationship":"Daughter","legal_authority":"Designated person","phone":"555-0100","email":"taylor@example.test","is_primary":true,"receives_notifications":true,"sort_order":0},{"contact_type":"guardian","name":"Morgan Guardian","legal_authority":"Court-appointed guardian","phone":"555-0101","is_primary":true,"sort_order":1},{"contact_type":"primary_care_provider","name":"Dr. Primary","phone":"555-0102","is_primary":true,"sort_order":2},{"contact_type":"pharmacy","name":"Community Pharmacy","phone":"555-0103","email":"rx@example.test","is_primary":true,"sort_order":3}]'::jsonb
  )
$$, 'manager saves the administrative master record atomically');
select is((select preferred_name from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'Jordy', 'preferred name is reusable resident data');
select is((select prior_address_state from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'PA', 'prior address state is normalized');
select is((select array_length(food_allergies, 1) from public.residents where id = '61000000-0000-4000-8000-000000000201'), 2, 'food allergies are structured');
select is((select count(*)::integer from public.resident_contacts where resident_id = '61000000-0000-4000-8000-000000000201' and active), 4, 'all official contact roles are retained');
select is((select designated_person_name from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'Taylor Resident', 'designated person synchronizes to existing downstream field');
select is((select primary_physician_name from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'Dr. Primary', 'primary provider synchronizes to state-form field');
select is((select pharmacy_name from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'Community Pharmacy', 'pharmacy populates the resident master row');
select is((select count(*)::integer from public.resident_administrative_history where resident_id = '61000000-0000-4000-8000-000000000201'), 1, 'master save creates attributable history');

insert into master_ids values('property', public.upsert_resident_property_item(
  '61000000-0000-4000-8000-000000000201', 'Gold watch', 1, null,
  'Engraved wristwatch', 'Good', current_date, null, null, now(),
  '61000000-0000-4000-8000-000000000301', 'Resident reviewed inventory', true
));
select is((select condition_at_receipt from public.resident_property_items where id = (select id from master_ids where key = 'property')), 'Good', 'property condition is retained');
select ok((select resident_acknowledged_at is not null from public.resident_property_items where id = (select id from master_ids where key = 'property')), 'property acknowledgement is attributable');

insert into master_ids values('legal', public.upsert_resident_legal_record(
  '61000000-0000-4000-8000-000000000201', 'court_order', 'Guardianship order', 'active',
  null, 'York County Court', 'Guardian appointed for administrative decisions', current_date - 30,
  null, now(), '61000000-0000-4000-8000-000000000301'
));
select is((select authority_name from public.resident_legal_records where id = (select id from master_ids where key = 'legal')), 'York County Court', 'court authority is structured');
select is((select count(*)::integer from public.resident_administrative_history where resident_id = '61000000-0000-4000-8000-000000000201'), 3, 'property and legal changes append administrative history');
select is(public.get_resident_administrative_packet('61000000-0000-4000-8000-000000000201') #>> '{resident,preferredName}', 'Jordy', 'shared packet exposes the preferred name to downstream modules');
select is(jsonb_array_length(public.get_resident_administrative_packet('61000000-0000-4000-8000-000000000201')->'contacts'), 4, 'shared packet reuses official contacts without re-entry');
select throws_ok($$
  select public.upsert_resident_legal_record(
    '61000000-0000-4000-8000-000000000201', 'advance_directive', 'Wrong document', 'active',
    null, null, null, null, null, null, '61000000-0000-4000-8000-000000000302'
  )
$$, '23514', null, 'cross-resident document linkage is rejected');

select is((select count(*)::integer from public.resident_census_events where resident_id = '61000000-0000-4000-8000-000000000201'), 3, 'admission, leave, and return history remains the lifecycle source');

select pg_temp.act_as('61000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_contacts where resident_id = '61000000-0000-4000-8000-000000000201' and active), 4, 'auditor can inspect scoped resident contacts');
select throws_ok($$
  select public.save_resident_administrative_master('61000000-0000-4000-8000-000000000201', '{}'::jsonb, '[]'::jsonb)
$$, '42501', null, 'auditor cannot mutate the resident master');

select pg_temp.act_as('61000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.resident_contacts where resident_id = '61000000-0000-4000-8000-000000000201'), 0, 'tenant RLS hides another organization contacts');
select is((select count(*)::integer from public.resident_legal_records where resident_id = '61000000-0000-4000-8000-000000000201'), 0, 'tenant RLS hides another organization legal records');
select throws_ok($$
  select public.get_resident_administrative_packet('61000000-0000-4000-8000-000000000201')
$$, '42501', null, 'shared packet enforces tenant scope');
select throws_ok($$
  select public.save_resident_administrative_master('61000000-0000-4000-8000-000000000201', '{}'::jsonb, '[]'::jsonb)
$$, '42501', null, 'other organization cannot mutate the resident master');

reset role;
select throws_ok($$
  update public.resident_administrative_history set summary = 'rewritten'
  where resident_id = '61000000-0000-4000-8000-000000000201'
$$, '55000', null, 'administrative history is immutable');
select throws_ok($$
  update public.resident_contacts set resident_id = '61000000-0000-4000-8000-000000000202'
  where resident_id = '61000000-0000-4000-8000-000000000201'
$$, '23514', null, 'contact resident scope is immutable');
select is((select count(*)::integer from public.resident_property_items where resident_id = '61000000-0000-4000-8000-000000000201'), 1, 'property inventory remains present after tenant checks');
select is((select contract_status from public.residents where id = '61000000-0000-4000-8000-000000000201'), 'executed', 'contract status remains available to downstream packets');

select * from finish();
rollback;
