-- pgTAP coverage for the defects Codex found reviewing PR #484, in the code that PR added.
--
-- Seven of its fourteen findings were database defects and all seven are here, because the thing
-- they have in common is that a clean replay and a green suite had already passed every one: none
-- of this code was ever called with a real row. That is the same gap `db lint` caught earlier on
-- this branch with `v_credit := <table-returning function>`, and the same answer -- assertions that
-- exercise the path rather than inspect it.
-- Run with: supabase test db.

begin;
select plan(20);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('2c000000-0000-4000-8000-000000000001', 'Review Org', 'review-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('2c000000-0000-4000-8000-000000000011', '2c000000-0000-4000-8000-000000000001',
   'Review Facility', 'PCH');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date)
values ('2c000000-0000-4000-8000-000000000021', '2c000000-0000-4000-8000-000000000001',
        '2c000000-0000-4000-8000-000000000011', 'Ada', 'Reviewer', current_date - 30);

------------------------------------------------------------------------------------------------
-- 1. The assessments import lane. The predicate named a domain the constraint does not allow, so
--    this RPC raised 22023 for every job that could ever exist -- and the whole point of the
--    migration it lives in was that imports are the first thing a facility does.
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'public.data_import_jobs'::regclass
     and pg_get_constraintdef(oid) like '%''assessments''%'
     and pg_get_constraintdef(oid) not like '%resident_assessments%'),
  1,
  'the domain vocabulary offers assessments and has never offered resident_assessments'
);

insert into public.data_import_jobs(
  id, organization_id, facility_id, domain, original_file_name, original_file_sha256
) values (
  '2c000000-0000-4000-8000-000000000031', '2c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000011', 'assessments', 'assessments.csv',
  repeat('a', 64)
);

select lives_ok(
  $$select public.import_apply_resident_assessment(
      '2c000000-0000-4000-8000-000000000031'::uuid,
      null::uuid,
      jsonb_build_object(
        'facility_id', '2c000000-0000-4000-8000-000000000011',
        'resident_id', '2c000000-0000-4000-8000-000000000021',
        'form_type', 'RASP', 'reason', 'annual', 'status', 'draft'
      ))$$,
  'an assessments job is accepted -- this raised 22023 for every row before the review'
);
select is(
  (select count(*)::int from public.resident_assessment_forms
   where resident_id = '2c000000-0000-4000-8000-000000000021'),
  1,
  'and the assessment is actually written, which is what "the import worked" means'
);

insert into public.data_import_jobs(
  id, organization_id, domain, original_file_name, original_file_sha256
) values (
  '2c000000-0000-4000-8000-000000000032', '2c000000-0000-4000-8000-000000000001',
  'residents', 'residents.csv', repeat('b', 64)
);
select throws_ok(
  $$select public.import_apply_resident_assessment(
      '2c000000-0000-4000-8000-000000000032'::uuid, null::uuid, '{}'::jsonb)$$,
  '22023',
  null,
  'and a job for a different domain is still refused -- the gate is narrower, not gone'
);

------------------------------------------------------------------------------------------------
-- 2. The work queue's audit trail, and the way back into it.
------------------------------------------------------------------------------------------------
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, narrative, status
) values (
  '2c000000-0000-4000-8000-000000000041', '2c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000011', 'significant_injury', now() - interval '2 hours',
  'Resident found on the floor beside the bed.', 'reported'
);

select is(
  (select count(*)::int from public.work_items
   where deduplication_key = '2c000000-0000-4000-8000-000000000041' or
         deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'),
  1,
  'the incident routed exactly one work item'
);

-- The work advanced before the incident was closed. This is the case the history row lied about.
update public.work_items set state = 'in_progress'
where deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041';

-- Closing has its own preconditions (20260905120000), and they are the point: an incident only
-- reaches 'closed' through a real investigation, which is exactly the state somebody later reopens.
update public.incidents
set status = 'closed',
    final_report_submitted_at = now(),
    administrator_approved_at = now()
where id = '2c000000-0000-4000-8000-000000000041';

select is(
  (select state from public.work_items
   where deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'),
  'closed',
  'closing the incident closes its work item'
);
select is(
  (select prior_state from public.work_item_history h
   join public.work_items w on w.id = h.work_item_id
   where w.deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'
     and h.event_type = 'closed'),
  'in_progress',
  'and the history records the state it actually came from, not a literal open'
);

update public.incidents set status = 'investigating'
where id = '2c000000-0000-4000-8000-000000000041';

select is(
  (select state from public.work_items
   where deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'),
  'open',
  'reopening the investigation returns its work to the queue -- it used to stay closed for ever'
);
select is(
  (select count(*)::int from public.work_item_history h
   join public.work_items w on w.id = h.work_item_id
   where w.deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'
     and h.event_type = 'reopened' and h.prior_state = 'closed'),
  1,
  'with a history entry saying so'
);
select is(
  (select closed_at is null and closure_reason is null from public.work_items
   where deduplication_key = 'incident:2c000000-0000-4000-8000-000000000041'),
  true,
  'and no residue of the closure it no longer has'
);

------------------------------------------------------------------------------------------------
-- 3. A fire-drill program that stops being one takes its derived child with it.
------------------------------------------------------------------------------------------------
insert into public.inspection_items(
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days
) values (
  '2c000000-0000-4000-8000-000000000051', '2c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program',
  'Monthly fire drill programme', 30
);
select is(
  (select count(*)::int from public.inspection_items
   where derived_from_inspection_item_id = '2c000000-0000-4000-8000-000000000051' and is_active),
  1,
  'a fire-drill programme derives its sleeping-hours child'
);

update public.inspection_items set item_type = 'other_procedural'
where id = '2c000000-0000-4000-8000-000000000051';

select is(
  (select count(*)::int from public.inspection_items
   where derived_from_inspection_item_id = '2c000000-0000-4000-8000-000000000051' and is_active),
  0,
  'and retyping the parent retires it -- it used to keep deriving deadlines from a non-programme'
);
select is(
  (select count(*)::int from public.inspection_items
   where derived_from_inspection_item_id = '2c000000-0000-4000-8000-000000000051'),
  1,
  'deactivated, not deleted: it holds the history of drills that really happened'
);

------------------------------------------------------------------------------------------------
-- 4. An invitation revoked by mistake can be sent again.
------------------------------------------------------------------------------------------------
insert into auth.users(id, instance_id, aud, role, email)
values ('2c000000-0000-4000-8000-000000000061', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'revoked-then-reinvited@example.test');

select lives_ok(
  $$select public.record_user_invitation_sent(
      '2c000000-0000-4000-8000-000000000061'::uuid, 'revoked-then-reinvited@example.test',
      'Rev', 'Oked', 'employee', '2c000000-0000-4000-8000-000000000001'::uuid,
      null::uuid, null::text, null::uuid)$$,
  'the first invitation is recorded'
);

update public.user_invitation_lifecycle
set status = 'revoked', revoked_at = now()
where invited_user_id = '2c000000-0000-4000-8000-000000000061';

-- GoTrue re-invites an UNCONFIRMED address by reusing the same user id (measured against the local
-- stack: POST /invite answers 200 with the original id), so the second send arrives carrying a user
-- id this table already holds. It used to raise 23505 here, which invite-user read as a receipt
-- failure and answered "Invite provisioning failed".
select lives_ok(
  $$select public.record_user_invitation_sent(
      '2c000000-0000-4000-8000-000000000061'::uuid, 'revoked-then-reinvited@example.test',
      'Rev', 'Oked', 'employee', '2c000000-0000-4000-8000-000000000001'::uuid,
      null::uuid, null::text, null::uuid)$$,
  'and a revoked one can simply be sent again'
);
select is(
  (select status from public.user_invitation_lifecycle
   where invited_user_id = '2c000000-0000-4000-8000-000000000061'),
  'sent',
  'the lifecycle row reopens rather than duplicating'
);
select is(
  (select send_count from public.user_invitation_lifecycle
   where invited_user_id = '2c000000-0000-4000-8000-000000000061'),
  2,
  'carrying forward how many times this person has been written to'
);
select is(
  (select revoked_at is null from public.user_invitation_lifecycle
   where invited_user_id = '2c000000-0000-4000-8000-000000000061'),
  true,
  'and no longer claiming to be revoked'
);

update public.user_invitation_lifecycle
set status = 'accepted', accepted_at = now(), revoked_at = null
where invited_user_id = '2c000000-0000-4000-8000-000000000061';

select throws_ok(
  $$select public.record_user_invitation_sent(
      '2c000000-0000-4000-8000-000000000061'::uuid, 'revoked-then-reinvited@example.test',
      'Rev', 'Oked', 'employee', '2c000000-0000-4000-8000-000000000001'::uuid,
      null::uuid, null::text, null::uuid)$$,
  '23505',
  null,
  'but an accepted invitation is not reopened -- that person already has an account'
);

------------------------------------------------------------------------------------------------
-- 5. The one timestamp the UTC sweep mislabelled on its way past.
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'reconcile_stalled_exclusion_refresh_runs'
     and p.prosrc like '%pa_local%' and p.prosrc not like '%SS UTC%'),
  1,
  'a value converted to Pennsylvania local time is no longer labelled UTC'
);

select * from finish();
rollback;
