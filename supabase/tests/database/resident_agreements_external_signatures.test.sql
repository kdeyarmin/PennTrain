begin;
select plan(50);

select has_table('public', 'resident_agreements', 'resident agreements are first-class records');
select has_table('public', 'resident_agreement_versions', 'agreement versions are retained');
select has_table('public', 'resident_agreement_signatures', 'resident signatures have a dedicated evidence record');
select has_table('public', 'resident_agreement_guest_grants', 'external signing grants are resident-specific');
select has_table('public', 'resident_agreement_history', 'agreement amendments and responses retain history');
select has_table('public', 'resident_agreement_guest_access_events', 'external signing access is auditable');
select ok(has_table_privilege('authenticated', 'public.resident_agreements', 'SELECT'), 'authenticated users can read scoped agreements');
select ok(not has_table_privilege('authenticated', 'public.resident_agreements', 'INSERT'), 'browser users cannot bypass agreement publishing commands');
select ok(not has_table_privilege('authenticated', 'public.resident_agreement_signatures', 'UPDATE'), 'browser users cannot rewrite signature evidence');
select ok(not has_table_privilege('anon', 'public.resident_agreement_guest_grants', 'SELECT'), 'external guests never receive direct table access');

insert into public.organizations(id, name, slug, subscription_status) values
  ('62000000-0000-4000-8000-000000000001', 'Agreement Org', 'agreement-org', 'active'),
  ('62000000-0000-4000-8000-000000000002', 'Other Agreement Org', 'other-agreement-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000001', 'Agreement Facility', 'PCH'),
  ('62000000-0000-4000-8000-000000000012', '62000000-0000-4000-8000-000000000002', 'Other Agreement Facility', 'ALR');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'agreement-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'agreement-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'other-agreement-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('62000000-0000-4000-8000-000000000101', '62000000-0000-4000-8000-000000000001', 'agreement-admin@test.local', 'Agreement', 'Admin', 'org_admin', true),
  ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000001', 'agreement-auditor@test.local', 'Agreement', 'Auditor', 'auditor', true),
  ('62000000-0000-4000-8000-000000000103', '62000000-0000-4000-8000-000000000002', 'other-agreement-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('62000000-0000-4000-8000-000000000201', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000011', 'Avery', 'Resident', current_date, 'reserved'),
  ('62000000-0000-4000-8000-000000000202', '62000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000012', 'Other', 'Resident', current_date, 'active');
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_bucket, storage_path,
  file_name, file_type, document_label
) values
  ('62000000-0000-4000-8000-000000000301', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000201', 'resident-documents', 'agreements/contract-v1.pdf', 'contract-v1.pdf', 'application/pdf', 'Resident-home contract v1'),
  ('62000000-0000-4000-8000-000000000302', '62000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000012', '62000000-0000-4000-8000-000000000202', 'resident-documents', 'agreements/other.pdf', 'other.pdf', 'application/pdf', 'Other resident document');
insert into public.move_in_templates(id, organization_id, name, version, definition) values
  ('62000000-0000-4000-8000-000000000401', '62000000-0000-4000-8000-000000000001', 'Agreement Move-in', 1, '{}'::jsonb);
insert into public.move_in_workspaces(
  id, organization_id, facility_id, resident_id, template_id, target_move_in_date
) values (
  '62000000-0000-4000-8000-000000000402', '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000201',
  '62000000-0000-4000-8000-000000000401', current_date + 3
);
insert into public.move_in_tasks(
  id, organization_id, facility_id, workspace_id, task_key, title, requires_signature, requires_approval
) values (
  '62000000-0000-4000-8000-000000000403', '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000402',
  'resident_agreement', 'Resident agreement and signatures', true, true
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table agreement_ids(key text primary key, id uuid, value text) on commit drop;
grant all on agreement_ids to authenticated, anon, service_role;

select pg_temp.act_as('62000000-0000-4000-8000-000000000101');
insert into agreement_ids(key, id, value)
select 'agreement', (result->>'agreementId')::uuid, result->>'contentSha256'
from (select public.publish_resident_agreement_version(
  '62000000-0000-4000-8000-000000000201', 'resident_home_contract',
  'Resident-home contract', '2026.1',
  'These are the complete canonical resident-home contract terms for version 2026.1.',
  now(), array['resident','designated_person'], null,
  '62000000-0000-4000-8000-000000000301', null
) result) published;
insert into agreement_ids(key, id)
select 'version1', current_version_id from public.resident_agreements
where id = (select id from agreement_ids where key = 'agreement');
select is((select version_number from public.resident_agreement_versions where id = (select id from agreement_ids where key = 'version1')), 1, 'first publish creates version one');
select matches((select value from agreement_ids where key = 'agreement'), '^[0-9a-f]{64}$', 'published version is bound to a SHA-256 digest');
select is((select required_signer_roles from public.resident_agreement_versions where id = (select id from agreement_ids where key = 'version1')), array['resident','designated_person']::text[], 'version retains required signer roles');
select throws_ok($$
  select public.publish_resident_agreement_version(
    '62000000-0000-4000-8000-000000000201', 'fee_schedule', 'Wrong document', '1',
    'Fee schedule content that is long enough to publish.', now(), array['resident'], null,
    '62000000-0000-4000-8000-000000000302', null
  )
$$, '23514', null, 'cross-resident agreement document is rejected');

insert into agreement_ids(key, id) values ('resident_signature', public.record_resident_agreement_outcome(
  (select id from agreement_ids where key = 'version1'), 'signed', 'Avery Resident', 'resident',
  'Self', null, 'staff_session', 'I reviewed and electronically sign this exact agreement version.',
  null, 'Morgan Witness', 'Staff witness', 'staff-console/1', null, null
));
select is((select status from public.resident_agreements where id = (select id from agreement_ids where key = 'agreement')), 'partially_executed', 'one of two required signatures creates partial execution');
select is((select authentication_method from public.resident_agreement_signatures where id = (select id from agreement_ids where key = 'resident_signature')), 'staff_session', 'internal authentication method is retained');
select ok((select device_hash is not null from public.resident_agreement_signatures where id = (select id from agreement_ids where key = 'resident_signature')), 'device evidence is hashed');
select ok(not exists(select 1 from public.resident_agreement_signatures where device_hash = 'staff-console/1'), 'raw device evidence is never stored');

insert into agreement_ids(key, id, value)
select 'guest', (result->>'grantId')::uuid, result->>'token'
from (select public.issue_resident_agreement_guest_grant(
  '62000000-0000-4000-8000-000000000201', 'Taylor Designated Person',
  array[(select id from agreement_ids where key = 'version1')], now() + interval '2 days'
) result) issued;
select ok(length((select value from agreement_ids where key = 'guest')) = 64, 'external grant returns a one-time high-entropy token');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select throws_ok($$
  select public.get_resident_agreement_guest_workspace((select value from agreement_ids where key = 'guest'))
$$, '42501', null, 'agreement content is hidden until terms are accepted');
select lives_ok($$
  select public.accept_resident_agreement_guest_terms(
    (select value from agreement_ids where key = 'guest'), 'Mozilla/Agreement-Test'
  )
$$, 'external signer accepts versioned terms');
select is(jsonb_array_length(public.get_resident_agreement_guest_workspace((select value from agreement_ids where key = 'guest'))->'agreements'), 1, 'external signer sees only explicitly scoped agreement versions');
select is(public.get_resident_agreement_guest_workspace((select value from agreement_ids where key = 'guest')) #>> '{agreements,0,versionLabel}', '2026.1', 'external portal identifies the exact agreement version');
insert into agreement_ids(key, id) values ('designated_signature', public.respond_to_resident_agreement_guest(
  (select value from agreement_ids where key = 'guest'),
  (select id from agreement_ids where key = 'version1'), 'signed', 'Taylor Representative',
  'power_of_attorney', 'Daughter', 'Durable financial power of attorney',
  'I reviewed and electronically sign the exact agreement version shown above.',
  null, null, null, 'Mozilla/Agreement-Test', null
));
select throws_ok($$
  select public.respond_to_resident_agreement_guest(
    (select value from agreement_ids where key = 'guest'),
    (select id from agreement_ids where key = 'version1'), 'signed', 'Taylor Representative',
    'power_of_attorney', 'Daughter', 'POA', 'Duplicate response is not allowed.',
    null, null, null, 'Mozilla/Agreement-Test', null
  )
$$, '42501', null, 'one external grant cannot respond twice to the same version');

select pg_temp.act_as('62000000-0000-4000-8000-000000000101');
select is((select status from public.resident_agreements where id = (select id from agreement_ids where key = 'agreement')), 'executed', 'required resident and representative signatures execute the agreement');
select is((select contract_status from public.residents where id = '62000000-0000-4000-8000-000000000201'), 'executed', 'executed resident-home contract updates the administrative master');
select is((select state from public.move_in_tasks where id = '62000000-0000-4000-8000-000000000403'), 'submitted', 'executed agreement feeds move-in readiness');
select is((select signature_evidence->>'agreementVersionId' from public.move_in_tasks where id = '62000000-0000-4000-8000-000000000403'), (select id::text from agreement_ids where key = 'version1'), 'move-in evidence references the exact agreement version');
select lives_ok($$
  select public.mark_resident_agreement_copy_delivered(
    (select id from agreement_ids where key = 'designated_signature'), now(), 'email'
  )
$$, 'copy delivery is recorded after execution');
select is((select copy_delivery_method from public.resident_agreement_signatures where id = (select id from agreement_ids where key = 'designated_signature')), 'email', 'signature record includes copy-delivery method');
select throws_ok($$
  select public.mark_resident_agreement_copy_delivered(
    (select id from agreement_ids where key = 'designated_signature'), now(), 'mail'
  )
$$, '22023', null, 'copy delivery evidence cannot be overwritten');

insert into agreement_ids(key, id)
select 'version2', (result->>'versionId')::uuid
from (select public.publish_resident_agreement_version(
  '62000000-0000-4000-8000-000000000201', 'resident_home_contract',
  'Resident-home contract', '2026.2',
  'These amended canonical terms add the revised service fee schedule effective next month.',
  now() + interval '30 days', array['resident','designated_person'],
  (select id from agreement_ids where key = 'agreement'),
  '62000000-0000-4000-8000-000000000301', 'Annual fee schedule and service terms updated'
) result) amended;
select is((select status from public.resident_agreement_versions where id = (select id from agreement_ids where key = 'version1')), 'superseded', 'amendment supersedes but preserves the prior version');
select is((select version_number from public.resident_agreement_versions where id = (select id from agreement_ids where key = 'version2')), 2, 'amendment increments version number');
select is((select status from public.resident_agreements where id = (select id from agreement_ids where key = 'agreement')), 'pending_signature', 'amendment requires fresh signatures');
select is((select count(*)::integer from public.resident_agreement_signatures where agreement_version_id = (select id from agreement_ids where key = 'version1')), 2, 'prior-version signature evidence remains intact');
select is((select contract_status from public.residents where id = '62000000-0000-4000-8000-000000000201'), 'amended', 'administrative contract status exposes the pending amendment');
select is(jsonb_array_length(public.get_resident_administrative_packet('62000000-0000-4000-8000-000000000201')->'agreements'), 1, 'administrative packet reuses current agreement status and evidence');

insert into agreement_ids(key, id)
select 'rights', (result->>'versionId')::uuid
from (select public.publish_resident_agreement_version(
  '62000000-0000-4000-8000-000000000201', 'resident_rights',
  'Resident rights acknowledgement', '2026',
  'The resident rights statement was presented in an accessible format and reviewed.',
  now(), array['resident'], null, null, null
) result) rights;
select lives_ok($$
  select public.record_resident_agreement_outcome(
    (select id from agreement_ids where key = 'rights'), 'unable_to_sign', 'Avery Resident',
    'resident', 'Self', null, 'staff_session', 'Rights were presented and reviewed with the resident.',
    'Resident was physically unable to provide a signature', 'Morgan Witness', 'Staff witness',
    null, null, null
  )
$$, 'inability to sign retains reason and witness evidence');
select is((select status from public.resident_agreements where current_version_id = (select id from agreement_ids where key = 'rights')), 'unable_to_sign', 'inability outcome remains distinct from execution');
select is((select witness_name from public.resident_agreement_signatures where agreement_version_id = (select id from agreement_ids where key = 'rights')), 'Morgan Witness', 'witness identity is retained');

select lives_ok($$
  select public.revoke_resident_agreement_guest_grant(
    (select id from agreement_ids where key = 'guest'), 'Replacement signing link requested'
  )
$$, 'manager revokes an external signing link with reason');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select throws_ok($$
  select public.get_resident_agreement_guest_workspace((select value from agreement_ids where key = 'guest'))
$$, '42501', null, 'revoked external link no longer exposes agreement content');

select pg_temp.act_as('62000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_agreements where resident_id = '62000000-0000-4000-8000-000000000201'), 2, 'auditor can inspect scoped agreement evidence');
select throws_ok($$
  select public.publish_resident_agreement_version(
    '62000000-0000-4000-8000-000000000201', 'consent_form', 'Consent', '1',
    'A valid consent form body for authorization.', now(), array['resident'], null, null, null
  )
$$, '42501', null, 'auditor cannot publish resident agreements');

select pg_temp.act_as('62000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.resident_agreements where resident_id = '62000000-0000-4000-8000-000000000201'), 0, 'tenant RLS hides another organization agreements');
select is((select count(*)::integer from public.resident_agreement_signatures where resident_id = '62000000-0000-4000-8000-000000000201'), 0, 'tenant RLS hides another organization signatures');
select throws_ok($$
  select public.get_resident_administrative_packet('62000000-0000-4000-8000-000000000201')
$$, '42501', null, 'agreement-enhanced administrative packet preserves tenant scope');

reset role;
select throws_ok($$
  update public.resident_agreement_versions set content_text = 'Rewritten terms'
  where id = (select id from agreement_ids where key = 'version1')
$$, '55000', null, 'published agreement content is immutable');
select throws_ok($$
  update public.resident_agreement_signatures set signer_name = 'Rewritten Signer'
  where id = (select id from agreement_ids where key = 'resident_signature')
$$, '55000', null, 'signature identity evidence is immutable');
select throws_ok($$
  delete from public.resident_agreement_history
  where resident_id = '62000000-0000-4000-8000-000000000201'
$$, '55000', null, 'agreement history is append-only');

select * from finish();
rollback;
