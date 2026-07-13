begin;
select plan(28);

select has_table('public', 'admission_prospects', 'admission prospects are separate from active census');
select has_table('public', 'facility_beds', 'room and bed inventory exists');
select has_table('public', 'resident_census_events', 'resident census has temporal history');
select has_table('public', 'move_in_task_history', 'move-in task decisions are append-only');
select ok(
  not has_table_privilege('authenticated', 'public.facility_beds', 'UPDATE'),
  'browser roles cannot bypass bed commands'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('58000000-0000-4000-8000-000000000001', 'Admission Org', 'admission-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('58000000-0000-4000-8000-000000000011', '58000000-0000-4000-8000-000000000001', 'Admission Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'admission-manager@test.local', 'x', now(), '{}', '{}',
  now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values (
  '58000000-0000-4000-8000-000000000101', '58000000-0000-4000-8000-000000000001',
  'admission-manager@test.local', 'Admission', 'Manager', 'org_admin', true
)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  elsif p_role = 'anon' then set local role anon;
  else set local role authenticated;
  end if;
end
$$;
create temporary table admission_ids(key text primary key, id uuid, value text) on commit drop;
grant all on admission_ids to authenticated, anon, service_role;

select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
insert into admission_ids(key, id)
values (
  'source',
  public.create_referral_source(
    '58000000-0000-4000-8000-000000000001', 'Regional Hospital',
    'hospital', 'Case Manager', '555-0100', 'case@test.local'
  )
);
insert into admission_ids(key, id)
values (
  'prospect',
  public.create_admission_prospect(
    '58000000-0000-4000-8000-000000000011', 'Morgan', 'Lee', '1950-01-02',
    '555-0101', 'morgan@test.local', (select id from admission_ids where key = 'source'),
    current_date + 7, 'Taylor Lee', 'Designated person', '555-0102',
    'taylor@test.local', 'Interested in a private room'
  )
);
select is(
  (select stage from public.admission_prospects where id = (select id from admission_ids where key = 'prospect')),
  'prospect',
  'new inquiry begins as a prospect'
);
select lives_ok(
  $$select public.record_admission_activity(
    (select id from admission_ids where key = 'prospect'),
    'tour_completed', null, 'Interested', 'Tour completed with designated person'
  )$$,
  'tour outcome is retained in the activity timeline'
);
select lives_ok(
  $$select public.update_admission_prospect(
    (select id from admission_ids where key = 'prospect'),
    'approved', 'approved', 'approved', current_date + 7,
    'Clinical and financial review complete', null, 'Ready for room reservation'
  )$$,
  'approved pipeline stage requires both reviews'
);
insert into admission_ids(key, id)
values (
  'room',
  public.create_room_with_beds(
    '58000000-0000-4000-8000-000000000011', 'Main Building',
    'First Floor', '101', 'private', 1, 'none', 20
  )
);
insert into admission_ids(key, id)
select 'bed', id from public.facility_beds where room_id = (select id from admission_ids where key = 'room');
select is(
  (select status from public.facility_beds where id = (select id from admission_ids where key = 'bed')),
  'available',
  'new room inventory begins available'
);
select lives_ok(
  $$select public.reserve_bed_for_prospect(
    (select id from admission_ids where key = 'prospect'),
    (select id from admission_ids where key = 'bed')
  )$$,
  'approved prospect reserves an available bed'
);
select is(
  (select stage from public.admission_prospects where id = (select id from admission_ids where key = 'prospect')),
  'reserved',
  'bed reservation advances pipeline stage'
);
insert into admission_ids(key, id)
values (
  'workspace',
  public.start_move_in_workspace((select id from admission_ids where key = 'prospect'))
);
insert into admission_ids(key, id)
select 'resident', resident_id from public.admission_prospects where id = (select id from admission_ids where key = 'prospect');
select is(
  (select status from public.residents where id = (select id from admission_ids where key = 'resident')),
  'reserved',
  'workspace creates a provisional reserved census record'
);
select is(
  (select count(*)::integer from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace')),
  10,
  'standard workspace instantiates complete admission checklist'
);

reset role;
with document as (
  insert into public.resident_documents(
    organization_id, facility_id, resident_id, storage_bucket, storage_path,
    file_name, file_type, document_label
  ) values (
    '58000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000011',
    (select id from admission_ids where key = 'resident'), 'resident-documents',
    'admission/test.pdf', 'test.pdf', 'application/pdf', 'Admission evidence'
  ) returning id
)
insert into admission_ids(key, id) select 'document', id from document;

select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'required_documents'),
    'approved', (select id from admission_ids where key = 'document'), null,
    'Required documents reviewed'
  )$$,
  'required documents can be attached and approved'
);
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'resident_agreement'),
    'approved', null, '{"signerName":"Morgan Lee","signedAt":"2026-07-13T00:00:00Z"}',
    'Resident agreement reviewed'
  )$$,
  'resident agreement records signature evidence and approval'
);
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'financial_approval'),
    'approved', null, null, 'Financial review approved'
  );
  select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'clinical_approval'),
    'approved', null, null, 'Clinical review approved'
  )$$,
  'financial and clinical approvals complete'
);
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'room_readiness'),
    'approved', null, null, 'Room inspected and approved'
  );
  select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'transportation'),
    'completed', null, null, 'Transportation confirmed'
  );
  select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'emar_vendor_readiness'),
    'completed', null, null, 'Vendor readiness confirmed without MAR data'
  );
  select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'family_uploads'),
    'completed', (select id from admission_ids where key = 'document'), null, 'Family upload received'
  )$$,
  'room, transportation, vendor, and upload tasks complete'
);

insert into admission_ids(key, id, value)
select 'guest', (result->>'grantId')::uuid, result->>'token'
from (
  select public.issue_move_in_guest_grant(
    (select id from admission_ids where key = 'workspace'),
    'Designated person',
    array[(select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'guest_signing')],
    now() + interval '2 days',
    'v1'
  ) result
) issued;
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select lives_ok(
  $$select public.accept_move_in_guest_terms(
    (select value from admission_ids where key = 'guest'), repeat('a', 64)
  )$$,
  'guest accepts expiring link terms'
);
select is(
  (public.get_move_in_guest_workspace((select value from admission_ids where key = 'guest'))->'tasks'->0->>'title'),
  'Guest signing complete',
  'guest sees only explicitly scoped task'
);
select lives_ok(
  $$select public.sign_move_in_guest_task(
    (select value from admission_ids where key = 'guest'),
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'guest_signing'),
    'Taylor Lee', 'Designated person', 'I reviewed and electronically sign this admission item.'
  )$$,
  'guest signature is captured with relationship and attestation'
);

select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'guest_signing'),
    'completed', null, null, 'Guest signature verified'
  )$$,
  'manager verifies guest signature'
);
select lives_ok(
  $$select public.update_move_in_task(
    (select id from public.move_in_tasks where workspace_id = (select id from admission_ids where key = 'workspace') and task_key = 'ready_to_admit'),
    'approved', null, null, 'All admission blockers reviewed'
  )$$,
  'ready-to-admit decision completes final dependency gate'
);
select is(
  (select state from public.move_in_workspaces where id = (select id from admission_ids where key = 'workspace')),
  'ready',
  'workspace becomes ready only after all blockers clear'
);
select lives_ok(
  $$select public.complete_move_in_admission(
    (select id from admission_ids where key = 'workspace'),
    'Admission checklist complete and bed ready'
  )$$,
  'one-click admission atomically completes the workspace'
);
select is(
  (select status from public.residents where id = (select id from admission_ids where key = 'resident')),
  'active',
  'admitted resident enters active census'
);
select is(
  (select status from public.facility_beds where id = (select id from admission_ids where key = 'bed')),
  'occupied',
  'reserved bed becomes occupied'
);
select is(
  (select stage from public.admission_prospects where id = (select id from admission_ids where key = 'prospect')),
  'admitted',
  'prospect conversion is retained for referral reporting'
);
select ok(
  exists (
    select 1 from public.resident_census_events
    where resident_id = (select id from admission_ids where key = 'resident')
      and event_type = 'admitted'
  ),
  'admission is recorded in immutable census history'
);

select * from finish();
rollback;
