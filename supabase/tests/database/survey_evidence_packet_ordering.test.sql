begin;
select plan(3);

insert into public.organizations(id, name, slug, subscription_status) values
  ('5e000000-0000-4000-8000-000000000001', 'Packet Ordering Org', 'packet-ordering-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000001', 'Packet Ordering Facility', 'ALR');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values (
  '00000000-0000-0000-0000-000000000000',
  '5e000000-0000-4000-8000-000000000021',
  'authenticated',
  'authenticated',
  'packet-admin@test.local',
  'x',
  now(),
  '{}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  false,
  false
);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('5e000000-0000-4000-8000-000000000021', '5e000000-0000-4000-8000-000000000001', 'packet-admin@test.local', 'Packet', 'Admin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = true;
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;

select pg_temp.act_as('5e000000-0000-4000-8000-000000000021', 'service_role');
insert into public.survey_evidence_packet_items(
  id, organization_id, facility_id, survey_day_session_id, source_type, source_id, label, citation_ref, sort_order, created_at
) values
  ('5e000000-0000-4000-8000-000000000101', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'binder_export', '5e000000-0000-4000-8000-000000000201', 'Fire extinguisher records', '2800.64', 5, '2026-08-02T00:01:00Z'),
  ('5e000000-0000-4000-8000-000000000102', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'incident', '5e000000-0000-4000-8000-000000000202', 'Fire drill logs', '2800.64(a)', 50, '2026-08-02T00:02:00Z'),
  ('5e000000-0000-4000-8000-000000000103', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'work_item', '5e000000-0000-4000-8000-000000000203', 'Follow-up note', '2800.64(a)(2)', 0, '2026-08-02T00:03:00Z'),
  ('5e000000-0000-4000-8000-000000000104', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'policy', '5e000000-0000-4000-8000-000000000204', 'First document', '2800.101', 20, '2026-08-02T00:04:00Z'),
  ('5e000000-0000-4000-8000-000000000105', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'evidence_artifact', '5e000000-0000-4000-8000-000000000205', 'Second document', '2800.101', 10, '2026-08-02T00:05:00Z'),
  ('5e000000-0000-4000-8000-000000000106', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'note', null, 'General packet note', null, 0, '2026-08-02T00:06:00Z'),
  ('5e000000-0000-4000-8000-000000000107', '5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000011', '5e000000-0000-4000-8000-000000000031', 'note', null, '2800.64 Label-only fallback row', null, 99, '2026-08-02T00:07:00Z');

select pg_temp.act_as('5e000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select label from public.list_survey_evidence_packet_items('5e000000-0000-4000-8000-000000000031', null) $$,
  $$ values
    ('Fire extinguisher records'),
    ('2800.64 Label-only fallback row'),
    ('Fire drill logs'),
    ('Follow-up note'),
    ('Second document'),
    ('First document'),
    ('General packet note') $$,
  'packet item list orders by citation_ref (or label-parse fallback), then sort_order, then created_at'
);
select results_eq(
  $$ select value->>'label' from jsonb_array_elements(public.assemble_survey_evidence_packet_manifest('5e000000-0000-4000-8000-000000000031', null)->'items') $$,
  $$ values
    ('Fire extinguisher records'),
    ('2800.64 Label-only fallback row'),
    ('Fire drill logs'),
    ('Follow-up note'),
    ('Second document'),
    ('First document'),
    ('General packet note') $$,
  'assembled manifest preserves the same regulation-aware packet order'
);
select results_eq(
  $$ select value->>'citationRef' from jsonb_array_elements(public.assemble_survey_evidence_packet_manifest('5e000000-0000-4000-8000-000000000031', null)->'items') where value->>'label' = 'Fire extinguisher records' $$,
  $$ values ('2800.64') $$,
  'assembled manifest exposes first-class citationRef'
);

select * from finish();
rollback;
