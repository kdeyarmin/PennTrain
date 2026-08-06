begin;
select plan(8);

-- Clinical disclosure consent on organization export and portal document share.

insert into public.organizations(id, name, slug, subscription_status) values
  ('cd000000-0000-4000-8000-000000000001', 'Consent Disclosure Org', 'consent-disclosure-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000001', 'Consent Facility', 'PCH');
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status, clinical_data_consent
) values
  ('cd000000-0000-4000-8000-000000000201', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'Granted', 'Resident', public.pa_today() - 10, 'active', 'granted'),
  ('cd000000-0000-4000-8000-000000000202', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'Revoked', 'Resident', public.pa_today() - 10, 'active', 'revoked');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'cd000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'consent-admin@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('cd000000-0000-4000-8000-000000000101', 'cd000000-0000-4000-8000-000000000001',
        'consent-admin@test.local', 'C', 'Admin', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.clinical_observations(
  id, organization_id, facility_id, resident_id, observation_type, value_numeric, unit, observed_at
) values
  ('cd000000-0000-4000-8000-000000000301', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000201',
   'heart_rate', 70, '/min', now()),
  ('cd000000-0000-4000-8000-000000000302', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000202',
   'heart_rate', 80, '/min', now());

insert into public.resident_portal_grants(
  id, organization_id, facility_id, resident_id, token_sha256, designated_person_name,
  relationship_label, permissions, terms_version, accepted_terms_at, expires_at, created_at
) values
  ('cd000000-0000-4000-8000-000000000401', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000202',
   encode(extensions.digest(convert_to('REVOKED-CONSENT-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Family Guest', 'daughter', array['schedule','documents','messages']::text[], 'v1',
   now() - interval '1 day', now() + interval '7 days', now() - interval '2 days'),
  ('cd000000-0000-4000-8000-000000000402', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000201',
   encode(extensions.digest(convert_to('GRANTED-CONSENT-TOKEN', 'utf8'), 'sha256'), 'hex'),
   'Family Guest', 'son', array['schedule','documents','messages']::text[], 'v1',
   now() - interval '1 day', now() + interval '7 days', now() - interval '2 days');

insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, file_name, file_type, storage_bucket, storage_path
) values
  ('cd000000-0000-4000-8000-000000000501', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000201',
   'care-plan.pdf', 'application/pdf', 'resident-documents', 'demo/care-plan.pdf'),
  ('cd000000-0000-4000-8000-000000000502', 'cd000000-0000-4000-8000-000000000001',
   'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000202',
   'restricted.pdf', 'application/pdf', 'resident-documents', 'demo/restricted.pdf');

insert into public.resident_service_calendar_events(
  id, organization_id, facility_id, resident_id, event_type, title, starts_at, ends_at, status,
  preparation_instructions
) values (
  'cd000000-0000-4000-8000-000000000601', 'cd000000-0000-4000-8000-000000000001',
  'cd000000-0000-4000-8000-000000000011', 'cd000000-0000-4000-8000-000000000202',
  'medical_appointment', 'Lab visit', now() + interval '3 days', now() + interval '3 days 1 hour',
  'scheduled', 'Bring fasting labs and MAR'
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

select has_function('public', 'set_resident_clinical_data_consent',
  'staff can set clinical disclosure consent through a dedicated RPC');

-- Export omits revoked residents' clinical rows.
select pg_temp.act_as('cd000000-0000-4000-8000-000000000000', 'service_role');
select is(
  (select count(*)::integer from public.export_organization_table(
    'cd000000-0000-4000-8000-000000000001', 'clinical_observations', 0, 100)),
  1,
  'organization export includes clinical observations only for granted consent'
);
select ok(
  exists (
    select 1 from public.export_organization_table(
      'cd000000-0000-4000-8000-000000000001', 'clinical_observations', 0, 100) row
    where row->>'resident_id' = 'cd000000-0000-4000-8000-000000000201'
  )
  and not exists (
    select 1 from public.export_organization_table(
      'cd000000-0000-4000-8000-000000000001', 'clinical_observations', 0, 100) row
    where row->>'resident_id' = 'cd000000-0000-4000-8000-000000000202'
  ),
  'the exported clinical observation belongs to the granted resident only'
);

-- Portal snapshot strips documents and prep instructions without granted consent.
set local role anon;
select is(
  public.get_resident_portal_snapshot('REVOKED-CONSENT-TOKEN', null) ->> 'clinicalDisclosureAllowed',
  'false',
  'portal snapshot reports clinical disclosure is not allowed when consent is revoked'
);
select is(
  jsonb_array_length(public.get_resident_portal_snapshot('REVOKED-CONSENT-TOKEN', null) -> 'documents'),
  0,
  'portal documents are empty when clinical disclosure consent is not granted'
);
select ok(
  (public.get_resident_portal_snapshot('REVOKED-CONSENT-TOKEN', null) -> 'schedule' -> 0
    ->> 'preparationInstructions') is null,
  'schedule preparation instructions are withheld without granted disclosure consent'
);

-- Share is refused for revoked consent; allowed for granted.
select pg_temp.act_as('cd000000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.share_resident_portal_document(
    'cd000000-0000-4000-8000-000000000401',
    'cd000000-0000-4000-8000-000000000502',
    'Restricted packet', true)$$,
  '42501', null,
  'managers cannot share portal documents when clinical disclosure consent is not granted'
);
select lives_ok(
  $$select public.share_resident_portal_document(
    'cd000000-0000-4000-8000-000000000402',
    'cd000000-0000-4000-8000-000000000501',
    'Care plan packet', true)$$,
  'managers can share portal documents when clinical disclosure consent is granted'
);

select * from finish();
rollback;
