begin;
select plan(17);

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

select throws_ok($$insert into public.work_items(
  organization_id, facility_id, source_type, source_id, deduplication_key, title, priority, due_at
) values (
  'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000011',
  'not_a_real_source_type', 'a4000000-0000-4000-8000-000000000301', 'bogus:1',
  'Work with a made-up source type', 'normal', now()
)$$,
  '23514',
  null,
  'a source type outside the taxonomy is refused');

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

select is(
  (select source_type from public.work_items w
   join public.resident_compliance_items i on i.id = w.source_id
   where i.resident_id = 'a4000000-0000-4000-8000-000000000301'),
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
   where i.resident_id = 'a4000000-0000-4000-8000-000000000301'),
  1,
  'and creates no duplicate on the second run'
);

select * from finish();
rollback;
