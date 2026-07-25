begin;
select plan(21);

select has_table('public', 'work_item_source_types', 'the source taxonomy exists');
select has_function('public', 'register_outstanding_work_items', 'the coverage sweep exists');

-- The mapping is the whole mechanism, so it is asserted directly rather than only through its
-- effects. Each prefix below is written by a real creator; if one is renamed, this fails.
select is(app_private.work_item_source_type_for('rule_exception', 'support-plan-proposal:abc'),
  'support_plan', 'a support-plan proposal is classified as support plan work');
select is(app_private.work_item_source_type_for('rule_exception', 'service-exception:abc'),
  'service_delivery', 'a service exception is classified as service delivery work');
select is(app_private.work_item_source_type_for('rule_exception', 'hospital-return-follow-up:abc'),
  'hospital_return', 'a hospital return follow-up is classified as hospital return work');
select is(app_private.work_item_source_type_for('rule_exception', 'call-off:abc'),
  'staffing', 'an unfilled shift is classified as staffing work');

-- A creator that named a real type is authoritative and must never be reinterpreted.
select is(app_private.work_item_source_type_for('incident', 'confidential-intake:abc'),
  'incident', 'a named source type is left alone');
select is(app_private.work_item_source_type_for('qapi', 'qapi:abc:def'),
  'qapi', 'and so is qapi');

-- Anything genuinely unrecognized stays in the catch-all rather than being guessed at.
select is(app_private.work_item_source_type_for('rule_exception', 'something-nobody-mapped:abc'),
  'rule_exception', 'an unmapped dedup key stays in the catch-all');

-- The backfill must have emptied the catch-all of everything the mapping covers.
select is(
  (select count(*)::int from public.work_items
   where source_type = 'rule_exception'
     and (deduplication_key like 'support-plan-proposal:%'
          or deduplication_key like 'service-exception:%'
          or deduplication_key like 'appointment-follow-up:%'
          or deduplication_key like 'hospital-return-follow-up:%'
          or deduplication_key like 'facility-license:%'
          or deduplication_key like 'call-off:%'
          or deduplication_key like 'shift-log:%')),
  0,
  'no backfillable row was left in the catch-all'
);

-- Every source type present on a work item must exist in the taxonomy, or it is invisible to the
-- queue's filters.
select is(
  (select count(*)::int from public.work_items w
   where not exists (select 1 from public.work_item_source_types t where t.key = w.source_type)),
  0,
  'every work item carries a source type the taxonomy knows'
);

-- The taxonomy must be a superset of every type already in use, in BOTH registries. Seeding it from
-- only the creators I happened to read is exactly how this shipped broken the first time.
select is(
  (select count(*)::int from public.work_item_templates t
   where not exists (select 1 from public.work_item_source_types s where s.key = t.source_type)),
  0,
  'every work_item_templates source type exists in the taxonomy'
);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('a4000000-0000-4000-8000-000000000001', 'Work Org', 'work-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a4000000-0000-4000-8000-000000000011', 'a4000000-0000-4000-8000-000000000001', 'Work Facility', 'PCH');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('a4000000-0000-4000-8000-000000000301', 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011', 'Wren', 'Resident', current_date - 10, 'active');

-- The trigger classifies on the way in, so a creator that still passes the catch-all is fixed
-- without that creator being rewritten.
insert into public.work_items(
  organization_id, facility_id, source_type, source_id, deduplication_key, title, priority, due_at
) values (
  'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011',
  'rule_exception', 'a4000000-0000-4000-8000-000000000301',
  'hospital-return-follow-up:a4000000-0000-4000-8000-000000000301',
  'Complete hospital-return follow-up', 'high', now() + interval '1 day'
);
select is(
  (select source_type from public.work_items
   where deduplication_key = 'hospital-return-follow-up:a4000000-0000-4000-8000-000000000301'),
  'hospital_return',
  'the trigger reclassifies a catch-all insert from its deduplication key'
);

-- An unrecognized type is adopted rather than refused. Refusing would mean the work item is never
-- created -- somebody's compliance task silently not existing -- which is a far worse outcome than
-- an unlabelled row in a reference table. The adopted row says it needs review.
select lives_ok($$insert into public.work_items(
  organization_id, facility_id, source_type, source_id, deduplication_key, title, priority, due_at
) values (
  'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011',
  'a_source_type_nobody_registered', 'a4000000-0000-4000-8000-000000000301', 'bogus:1',
  'Work with an unregistered source type', 'normal', now()
)$$,
  'a work item with an unregistered source type is still created');
select is(
  (select sort_order from public.work_item_source_types where key = 'a_source_type_nobody_registered'),
  899,
  'and its source type is adopted into the taxonomy, flagged for review');

-- A reclassified row must still be counted by the readers that used to match it on the catch-all.
-- The unfilled-shift count returning zero because the backfill moved the rows is the exact failure
-- this asserts against: zero is the one wrong answer that looks like good news.
insert into public.work_items(
  organization_id, facility_id, source_type, source_id, deduplication_key, title, priority, due_at
) values (
  'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011',
  'rule_exception', 'a4000000-0000-4000-8000-000000000301',
  'call-off:a4000000-0000-4000-8000-000000000301',
  'Unfilled shift after call-off', 'high', now() + interval '30 minutes'
);
select is(
  (select source_type from public.work_items
   where deduplication_key = 'call-off:a4000000-0000-4000-8000-000000000301'),
  'staffing',
  'a call-off work item is reclassified as staffing work'
);
select is(
  (public.get_daily_operations_command_center('a4000000-0000-4000-8000-000000000011')
    -> 'dailyExecution' ->> 'unfilledShifts')::int,
  1,
  'and the unfilled-shift count still finds it after the reclassification'
);

-- The coverage sweep ------------------------------------------------------------------
insert into public.resident_compliance_items(
  organization_id, facility_id, resident_id, item_type, due_date, status
) values (
  'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011',
  'a4000000-0000-4000-8000-000000000301', 'initial_assessment_15day', current_date + 3, 'due_soon'
);

set local role service_role;
select is(
  (public.register_outstanding_work_items() ->> 'assessments')::int >= 1,
  true,
  'the sweep registers an outstanding resident compliance item'
);

-- Scoped to the one item this test inserted: a resident carries a whole set of compliance items,
-- so an unfiltered subquery here returns several rows and aborts the script rather than failing a
-- single assertion.
select is(
  (select w.source_type from public.work_items w
   join public.resident_compliance_items i on i.id = w.source_id
   where i.resident_id = 'a4000000-0000-4000-8000-000000000301'
     and i.item_type = 'initial_assessment_15day'
   limit 1),
  'assessment',
  'and files it under the assessment source type'
);

-- Idempotence matters more than it looks: the sweep runs hourly, and a second copy of somebody's
-- assessment in their queue is worse than no entry at all.
select lives_ok($$select public.register_outstanding_work_items()$$,
  'the sweep can run again');
select is(
  (select count(*)::int from public.work_items w
   join public.resident_compliance_items i on i.id = w.source_id
   where i.resident_id = 'a4000000-0000-4000-8000-000000000301'
     and i.item_type = 'initial_assessment_15day'),
  1,
  'and creates no duplicate on the second run'
);

select * from finish();
rollback;
