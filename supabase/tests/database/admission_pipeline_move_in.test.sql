begin;
select plan(44);

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
    public.pa_today() + 7, 'Taylor Lee', 'Designated person', '555-0102',
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
    'approved', 'approved', 'approved', public.pa_today() + 7,
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

-- A reserved resident has not moved in, and the census RPC now says so as a graph rather than as a
-- list of destinations. The direct route was already blocked in the UI; this covers the two-step
-- one, which is what actually reached `active`: sent "temporarily out" the resident is no longer
-- reserved, so the next call sees an ordinary out-of-facility resident and admits them -- with the
-- bed still held for the prospect and complete_move_in_admission's readiness checks never run.
select throws_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'temporarily_out', null, 'Family took them out for the afternoon') $$,
  '22023',
  null,
  'a reserved resident cannot be sent temporarily out -- the first step of the route around the block'
);
select throws_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'active', null, 'Admitting from the resident record') $$,
  '22023',
  null,
  'nor admitted from here, which is complete_move_in_admission''s job'
);
select is(
  (select status from public.residents where id = (select id from admission_ids where key = 'resident')),
  'reserved',
  'and both refusals left the census state alone'
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
insert into admission_ids(key, id)
select 'guest_task', id from public.move_in_tasks
where workspace_id = (select id from admission_ids where key = 'workspace')
  and task_key = 'guest_signing';
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
    (select id from admission_ids where key = 'guest_task'),
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

-- The three SAME-STATUS edges, which the first version of the graph refused and which are two of
-- this function's own operations (BACKLOG J93). A graph that reads "terminal" as "no outgoing
-- edges" and "active ->" as "some OTHER status" turns a room transfer and the bed-release repair
-- into 22023s, and neither has another route in the product. These run before the cancellation
-- block below because they need the resident admitted and holding a bed.
-- Still acting as the facility manager set at the top of this section, which is the role that
-- created the first room; no privileged write is needed to add inventory.
insert into admission_ids(key, id)
values (
  'room2',
  public.create_room_with_beds(
    '58000000-0000-4000-8000-000000000011', 'Main Building',
    'First Floor', '102', 'private', 1, 'none', 20
  )
);
insert into admission_ids(key, id)
select 'bed2', id from public.facility_beds where room_id = (select id from admission_ids where key = 'room2');

select lives_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'active',
       (select id from admission_ids where key = 'bed2'),
       'Moved to 102 at the family''s request') $$,
  'an active resident can be transferred to another bed -- same status, different bed'
);
-- Identified by the beds it moved between, not by "the newest event". Every row written in this
-- test shares one `effective_at`, because now() is fixed for the transaction, so ordering by it
-- falls through to a random uuid tie-break and picks an arbitrary row -- which is how the first
-- version of this assertion passed once and failed on the next run. Same lesson as the paging fix
-- in this round: an ordering without a meaningful tie-break is not an ordering.
select is(
  (select event_type from public.resident_census_events
   where resident_id = (select id from admission_ids where key = 'resident')
     and prior_bed_id = (select id from admission_ids where key = 'bed')
     and resulting_bed_id = (select id from admission_ids where key = 'bed2')),
  'room_transfer',
  'the same-status bed move is recorded as a room transfer, not as its target status'
);
select is(
  (select status from public.facility_beds where id = (select id from admission_ids where key = 'bed')),
  'available',
  'the room transfer releases the bed the resident came from'
);
select is(
  (select status from public.facility_beds where id = (select id from admission_ids where key = 'bed2')),
  'occupied',
  'the room transfer occupies the bed the resident moved to'
);

-- A self-edge that moves nothing is refused, and it is the GRAPH that refuses it now: the arm
-- requires a bed that is actually different, so the old no-op guard is a second line rather than
-- the argument (BACKLOG J94).
select throws_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'active',
       (select id from admission_ids where key = 'bed2'),
       'Recording the same thing again') $$,
  '22023',
  null,
  'a self-edge that moves nothing is still refused'
);

-- The counterexample the first version of this graph missed. A resident who is out normally keeps
-- their bed_id, so a same-status call with NO bed slips past `p_bed_id is not distinct from
-- v.bed_id` -- null is distinct from a uuid -- and used to change nothing while still writing a
-- resident_census_events row. That table is append-only evidence; inventing a movement in it is
-- worse than refusing a real one.
select set_config('app.privileged_write', 'on', true);
update public.residents
set status = 'temporarily_out', bed_id = (select id from admission_ids where key = 'bed2')
where id = (select id from admission_ids where key = 'resident');
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'temporarily_out', null, 'Recording that they are still out') $$,
  '22023',
  null,
  'a same-status call with no bed is refused rather than writing an empty census event'
);
select is(
  (select count(*)::integer from public.resident_census_events
   where resident_id = (select id from admission_ids where key = 'resident')
     and prior_status = 'temporarily_out' and resulting_status = 'temporarily_out'),
  0,
  'and no census event was written for it'
);
select set_config('app.privileged_write', 'on', true);
update public.residents set status = 'active'
where id = (select id from admission_ids where key = 'resident');
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('58000000-0000-4000-8000-000000000101');

-- The bed-release repair. A resident closed by the old bare-discharge path is `discharged` and
-- still holds an occupied bed; AdmissionOperations.tsx offers "recording the same status again"
-- as the way to release it and write the census event that was missed. Staged here the way that
-- data actually looks, because no current code path can produce it.
select set_config('app.privileged_write', 'on', true);
update public.residents
set status = 'discharged', discharge_date = public.pa_today() - 40
where id = (select id from admission_ids where key = 'resident');
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'discharged', null, 'Releasing a bed the discharge left occupied') $$,
  'a discharged resident who still holds a bed can have it released by re-recording the status'
);
select is(
  (select status from public.facility_beds where id = (select id from admission_ids where key = 'bed2')),
  'available',
  'the repair releases the bed the closed record was still holding'
);
select is(
  (select bed_id from public.residents where id = (select id from admission_ids where key = 'resident')),
  null,
  'and clears the resident''s own bed reference, which is what left the two out of step'
);
-- The repair is a bed operation, not a re-discharge. Taking the repair date as the discharge date
-- would rewrite the face sheet, the census history and every report keyed on it for a resident who
-- left when they left -- and this repair happens whenever somebody notices the stuck bed, which is
-- days or months later by construction (BACKLOG J94).
select is(
  (select discharge_date from public.residents where id = (select id from admission_ids where key = 'resident')),
  public.pa_today() - 40,
  'and keeps the discharge date the record already carried rather than restamping today'
);
-- With the bed released there is nothing left to repair, so a second call is refused instead of
-- writing another census event against a closed record.
select throws_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'discharged', null, 'Releasing a bed that is already released') $$,
  '22023',
  null,
  'a terminal self-edge with no bed left to release is refused'
);
reset role;

-- Cancelling is the one move a pre-admission resident may make, so the graph is not mistaken for
-- "a reserved resident is frozen". Last, because it releases the bed the assertions above read.
select set_config('app.privileged_write', 'on', true);
update public.residents set status = 'reserved'
where id = (select id from admission_ids where key = 'resident');
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('58000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.transition_resident_census(
       (select id from admission_ids where key = 'resident'),
       'discharged', null, 'Family chose another facility') $$,
  'cancelling a reservation still works, which is the point of a graph rather than a freeze'
);
reset role;

select * from finish();
rollback;
