begin;
select plan(7);

-- A recurring MANUAL campaign used to open its next cycle with nobody on it, and the deadline
-- guarantee that makes such a cycle actionable.
--
-- The empty-cycle defect is silent by construction, which is why this asserts the POPULATED result
-- rather than the absence of an error: nothing raised, and a cycle with no participants is
-- indistinguishable from one an administrator has not finished setting up.
--
-- The due-date assertions below are CHARACTERIZATION, not a fix. materialize_policy_campaign_targets
-- does not name due_date in its INSERT and the column is nullable, which reads like every
-- declaratively enrolled attestation gets a NULL deadline -- but the BEFORE INSERT trigger from
-- 20260716221235 assigns it from the campaign unconditionally. Pinning that here keeps the real
-- guarantee attached to the overdue predicate that depends on it, so removing the trigger's
-- assignment fails a test instead of quietly disabling every overdue count.

------------------------------------------------------------------------------------------------
-- Fixture: one org, one facility, two active aides, an annual campaign due in 20 days
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('f2000000-0000-4000-8000-000000000001', 'Cycle Org', 'cycle-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('f2000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000001', 'Cycle PCH', 'PCH', false, null);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  ('f2000000-0000-4000-8000-000000000201', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000011', 'A', 'Aide', 'Direct Care Aide', 'active', public.pa_today() - 500, 'regular', false, false, false),
  ('f2000000-0000-4000-8000-000000000202', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000011', 'B', 'Aide', 'Direct Care Aide', 'active', public.pa_today() - 400, 'regular', false, false, false);

insert into public.policy_documents (id, organization_id, title)
values ('f2000000-0000-4000-8000-000000000301', 'f2000000-0000-4000-8000-000000000001', 'Elopement Response');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values
  ('f2000000-0000-4000-8000-000000000311', 'f2000000-0000-4000-8000-000000000301',
   'f2000000-0000-4000-8000-000000000001', 1, 'cycle/v1.pdf', 'v1.pdf', 'application/pdf',
   repeat('a', 64), 'published', now());

update public.policy_documents
set current_version_id = 'f2000000-0000-4000-8000-000000000311'
where id = 'f2000000-0000-4000-8000-000000000301';

------------------------------------------------------------------------------------------------
-- 1. Every enrolled attestation carries the campaign's due date (trigger-enforced)
------------------------------------------------------------------------------------------------
-- NULL loses every comparison the product makes against this column: the operations snapshot's
-- overdue count (`p.due_date < public.pa_today()`), the pending index, and the page's own overdue
-- badge. An attestation enrolled without a deadline could never be overdue anywhere, while the
-- campaign it belongs to displays one.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date,
  targeting_mode, target_job_title_pattern
) values (
  'f2000000-0000-4000-8000-000000000401', 'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000301', 'f2000000-0000-4000-8000-000000000311',
  'Declarative elopement review', public.pa_today() - 5,
  'declarative', '%Direct Care Aide%'
);

select is(
  public.materialize_policy_campaign_targets('f2000000-0000-4000-8000-000000000401'),
  2,
  'both active aides are enrolled by the declarative predicate'
);

select is(
  (select count(*)::integer from public.policy_attestations
   where campaign_id = 'f2000000-0000-4000-8000-000000000401' and due_date is null),
  0,
  'and not one of them carries a NULL due date'
);

select is(
  (select count(distinct due_date)::integer from public.policy_attestations
   where campaign_id = 'f2000000-0000-4000-8000-000000000401'),
  1,
  'they all carry the same date'
);

-- The point of the column: a past due date has to make the row overdue by the same predicate the
-- operations snapshot uses. This is the assertion a NULL would defeat.
select is(
  (select count(*)::integer from public.policy_attestations
   where campaign_id = 'f2000000-0000-4000-8000-000000000401'
     and status = 'pending' and due_date < public.pa_today()),
  2,
  'and the overdue predicate the operations snapshot runs actually matches them'
);

------------------------------------------------------------------------------------------------
-- 2. A recurring MANUAL campaign opens its next cycle with its roster, not empty
------------------------------------------------------------------------------------------------
-- materialize_policy_campaign_targets returns 0 untouched for a non-declarative campaign, so the
-- recurrence worker used to open a manual cycle with nobody on it, advance next_occurrence_on and
-- count itself as spawned. The annual re-attestation just did not happen.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date,
  recurrence_months, next_occurrence_on, targeting_mode
) values (
  'f2000000-0000-4000-8000-000000000402', 'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000301', 'f2000000-0000-4000-8000-000000000311',
  'Manual elopement review', public.pa_today() - 340,
  12, public.pa_today() + 20, 'manual'
);

-- Hand-assigned, which is what 'manual' means.
insert into public.policy_attestations (
  organization_id, facility_id, employee_id, campaign_id, policy_document_version_id, due_date
) values
  ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000011',
   'f2000000-0000-4000-8000-000000000201', 'f2000000-0000-4000-8000-000000000402',
   'f2000000-0000-4000-8000-000000000311', public.pa_today() - 340),
  ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000011',
   'f2000000-0000-4000-8000-000000000202', 'f2000000-0000-4000-8000-000000000402',
   'f2000000-0000-4000-8000-000000000311', public.pa_today() - 340);

select ok(
  public.spawn_due_policy_campaign_cycles(now()) >= 1,
  'the worker opens the manual campaign''s next cycle'
);

select is(
  (select count(*)::integer
   from public.policy_attestations a
   join public.policy_attestation_campaigns c on c.id = a.campaign_id
   where c.recurrence_parent_id = 'f2000000-0000-4000-8000-000000000402'),
  2,
  'and the new cycle carries the parent''s roster forward rather than opening empty'
);

select is(
  (select count(*)::integer
   from public.policy_attestations a
   join public.policy_attestation_campaigns c on c.id = a.campaign_id
   where c.recurrence_parent_id = 'f2000000-0000-4000-8000-000000000402'
     and a.due_date is distinct from c.due_date),
  0,
  'each carried row is stamped with the NEW cycle''s due date, not last year''s'
);

select * from finish();
rollback;
