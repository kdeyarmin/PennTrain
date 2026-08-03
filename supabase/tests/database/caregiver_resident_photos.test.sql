begin;
select plan(14);

-- The caregiver photo branch (20260803120000) widens what an `employee` may read for the first time
-- since the clinical lane opened. The assertions that matter here are the ones proving how narrow it
-- is: a photo, yes; anything else about the same resident, no; another facility's photo, no.

select has_function('app_private', 'resident_photo_document_visible', 'photo document predicate exists');
select has_function('app_private', 'resident_photo_object_visible', 'photo storage-object predicate exists');
select has_function('public', 'get_clinical_chart_resident_photos', 'caregiver photo path RPC exists');
select ok(
  not has_function_privilege('anon', 'public.get_clinical_chart_resident_photos()', 'EXECUTE'),
  'anonymous callers cannot enumerate resident photos'
);

-- Fixtures ------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('d3000000-0000-4000-8000-000000000001', 'Photo Org A', 'photo-org-a', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000001', 'Photo A1', 'PCH'),
  ('d3000000-0000-4000-8000-000000000012', 'd3000000-0000-4000-8000-000000000001', 'Photo A2', 'ALR');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'p-a1-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'p-a2-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d3000000-0000-4000-8000-000000000101', 'd3000000-0000-4000-8000-000000000001', 'p-a1-emp@test.local', 'Ann', 'Aide', 'employee', true),
  ('d3000000-0000-4000-8000-000000000102', 'd3000000-0000-4000-8000-000000000001', 'p-a2-emp@test.local', 'Al', 'Aide', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
) values
  ('d3000000-0000-4000-8000-000000000111', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000101', 'Ann', 'Aide', 'p-a1-emp@test.local', 'Direct Care Staff', public.pa_today(), 'active'),
  ('d3000000-0000-4000-8000-000000000112', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000012', 'd3000000-0000-4000-8000-000000000102', 'Al', 'Aide', 'p-a2-emp@test.local', 'Direct Care Staff', public.pa_today(), 'active');

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('d3000000-0000-4000-8000-000000000301', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000011', 'Rosa', 'Alvarez', public.pa_today() - 30, 'active'),
  ('d3000000-0000-4000-8000-000000000302', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000012', 'Tess', 'Okafor', public.pa_today() - 10, 'active');

-- Rosa (facility A1) has a photo AND a contract; Tess (facility A2) has a photo.
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_bucket, storage_path, file_name, file_type
) values
  ('d3000000-0000-4000-8000-000000000401', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000301', 'resident-documents', 'd3000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000011/rosa-photo.jpg', 'rosa-photo.jpg', 'image/jpeg'),
  ('d3000000-0000-4000-8000-000000000402', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000301', 'resident-documents', 'd3000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000011/rosa-contract.pdf', 'rosa-contract.pdf', 'application/pdf'),
  ('d3000000-0000-4000-8000-000000000403', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000012', 'd3000000-0000-4000-8000-000000000302', 'resident-documents', 'd3000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000012/tess-photo.jpg', 'tess-photo.jpg', 'image/jpeg');

select set_config('app.privileged_write', 'on', true);
update public.residents set photo_document_id = 'd3000000-0000-4000-8000-000000000401'
  where id = 'd3000000-0000-4000-8000-000000000301';
update public.residents set photo_document_id = 'd3000000-0000-4000-8000-000000000403'
  where id = 'd3000000-0000-4000-8000-000000000302';
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- The whole point: a photo, and nothing else -------------------------------------------
select pg_temp.act_as('d3000000-0000-4000-8000-000000000101');

select is(
  (select count(*)::integer from public.resident_documents
   where id = 'd3000000-0000-4000-8000-000000000401'),
  1,
  'an assigned employee can read the photo document row for a resident at their facility'
);
select is(
  (select count(*)::integer from public.resident_documents
   where id = 'd3000000-0000-4000-8000-000000000402'),
  0,
  'the SAME resident''s contract stays invisible -- the branch is per-document, not per-resident'
);
select is(
  (select count(*)::integer from public.resident_documents
   where id = 'd3000000-0000-4000-8000-000000000403'),
  0,
  'a photo at another facility stays invisible'
);
select is(
  (select count(*)::integer from public.resident_documents),
  1,
  'the employee''s entire view of resident_documents is that one photo'
);

-- The predicates themselves --------------------------------------------------------------
-- `authenticated` holds no USAGE on app_private, so these are asserted with the role reset -- the
-- same way clinical_observations.test.sql reads app_private.clinical_access_log. request.jwt.claims
-- is a GUC and survives the role change, so current_role()/auth.uid() inside the predicate still
-- resolve to the facility-A1 employee set above; only the schema permission differs.
reset role;
select ok(
  app_private.resident_photo_document_visible('d3000000-0000-4000-8000-000000000401'),
  'the document predicate accepts this facility''s photo'
);
select ok(
  not app_private.resident_photo_document_visible('d3000000-0000-4000-8000-000000000402'),
  'the document predicate rejects a document that is not anyone''s designated photo'
);
select ok(
  app_private.resident_photo_object_visible(
    'd3000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000011/rosa-photo.jpg'),
  'the storage predicate accepts the object backing this facility''s photo'
);
select ok(
  not app_private.resident_photo_object_visible(
    'd3000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000012/tess-photo.jpg'),
  'the storage predicate rejects another facility''s photo object'
);

-- The path RPC follows the same scope ----------------------------------------------------
select pg_temp.act_as('d3000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_photos()),
  1,
  'the photo RPC returns only residents the caller may see clinically'
);

select pg_temp.act_as('d3000000-0000-4000-8000-000000000102');
select is(
  (select resident_id from public.get_clinical_chart_resident_photos()),
  'd3000000-0000-4000-8000-000000000302'::uuid,
  'the second facility''s employee gets their own resident''s photo, not the first''s'
);

select * from finish();
rollback;
