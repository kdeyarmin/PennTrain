begin;
select plan(23);

-- BACKLOG.md E4, recurrence. Annual policy re-attestation is the normal case, and the failure it
-- replaces is silent: an administrator forgets, and last year's fully-signed campaign still sits
-- there looking complete while nobody has attested this year. There is no error and no empty
-- state to notice.

------------------------------------------------------------------------------------------------
-- Shape and access boundary
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'spawn_due_policy_campaign_cycles', array['timestamptz'],
  'the recurrence worker exists'
);

select ok(
  not has_function_privilege('anon', 'public.spawn_due_policy_campaign_cycles(timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.spawn_due_policy_campaign_cycles(timestamptz)', 'EXECUTE'),
  'no end user spawns cycles across every tenant'
);

select is(
  (select schedule from cron.job where jobname = 'spawn-policy-campaign-cycles'),
  '30 10 * * *',
  'cycles are opened daily, ahead of the 11:00 targeting sweep'
);

select ok(
  not exists(select 1 from app_private.unwatched_cron_jobs()
             where job_name = 'spawn-policy-campaign-cycles'),
  'and the job is watched -- its silence is exactly the failure this replaces'
);

------------------------------------------------------------------------------------------------
-- Fixture: an annual campaign due in 20 days, inside the 30-day lead
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('e1000000-0000-4000-8000-000000000001', 'Recur Org', 'recur-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('e1000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000001', 'Recur PCH', 'PCH', false, null);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  ('e1000000-0000-4000-8000-000000000201', 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', 'R', 'Aide', 'Direct Care Aide', 'active', public.pa_today() - 500, 'regular', false, false, false);

insert into public.policy_documents (id, organization_id, title)
values ('e1000000-0000-4000-8000-000000000301', 'e1000000-0000-4000-8000-000000000001', 'Abuse Reporting');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values
  ('e1000000-0000-4000-8000-000000000311', 'e1000000-0000-4000-8000-000000000301',
   'e1000000-0000-4000-8000-000000000001', 1, 'recur/v1.pdf', 'v1.pdf', 'application/pdf',
   repeat('e', 64), 'published', now()),
  -- The revision the next cycle must be signed against.
  ('e1000000-0000-4000-8000-000000000312', 'e1000000-0000-4000-8000-000000000301',
   'e1000000-0000-4000-8000-000000000001', 2, 'recur/v2.pdf', 'v2.pdf', 'application/pdf',
   repeat('f', 64), 'published', now());

update public.policy_documents
set current_version_id = 'e1000000-0000-4000-8000-000000000312'
where id = 'e1000000-0000-4000-8000-000000000301';

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date,
  recurrence_months, next_occurrence_on,
  targeting_mode, target_job_title_pattern
) values (
  'e1000000-0000-4000-8000-000000000401', 'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000301', 'e1000000-0000-4000-8000-000000000311',
  'Annual abuse reporting review', public.pa_today() - 340,
  12, public.pa_today() + 20,
  'declarative', '%Direct Care Aide%'
);

insert into public.policy_campaign_questions (
  organization_id, campaign_id, display_order, prompt, choices, correct_choice_index
) values (
  'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000401', 1,
  'Who must a suspected abuse incident be reported to first?',
  '["The supervisor on duty","A family member","Nobody"]'::jsonb, 0
);

------------------------------------------------------------------------------------------------
-- The shape constraints
------------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.policy_attestation_campaigns (
       organization_id, policy_document_id, policy_document_version_id, name, recurrence_months
     ) values (
       'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000301',
       'e1000000-0000-4000-8000-000000000311', 'No next date', 12
     ) $$,
  '23514',
  null,
  'a recurring campaign must say when the next cycle is due, or the series never fires'
);

-- If a spawned cycle could itself recur, every cycle would start its own series and the count
-- would double each period.
select throws_ok(
  $$ insert into public.policy_attestation_campaigns (
       organization_id, policy_document_id, policy_document_version_id, name,
       recurrence_months, next_occurrence_on, recurrence_parent_id
     ) values (
       'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000301',
       'e1000000-0000-4000-8000-000000000311', 'Child that recurs',
       12, public.pa_today(), 'e1000000-0000-4000-8000-000000000401'
     ) $$,
  '23514',
  null,
  'and a spawned cycle cannot itself recur'
);

------------------------------------------------------------------------------------------------
-- Opening the next cycle
------------------------------------------------------------------------------------------------
select is(
  public.spawn_due_policy_campaign_cycles(),
  1,
  'the cycle due in 20 days is opened -- inside the 30-day lead'
);

select is(
  (select count(*)::int from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'),
  1,
  'as a child of the series, not a reset of it'
);

select is(
  (select policy_document_version_id from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'),
  'e1000000-0000-4000-8000-000000000312'::uuid,
  'pinned to the document''s CURRENT version -- re-signing the superseded text would attest to a '
  'document the facility no longer follows'
);

select is(
  (select due_date from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'),
  public.pa_today() + 20,
  'due on the occurrence date, opened 30 days ahead so staff have time to sign'
);

select ok(
  (select name from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401')
    like 'Annual abuse reporting review (%',
  'and named so an administrator can tell the cycles apart in the list'
);

-- Without carrying questions forward, an annual re-attestation silently degrades to
-- read-and-sign in its second year -- the check the first year required simply disappears.
select is(
  (select count(*)::int from public.policy_campaign_questions q
   join public.policy_attestation_campaigns c on c.id = q.campaign_id
   where c.recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'),
  1,
  'the knowledge check is carried forward as its own copy'
);

select is(
  (select count(*)::int from public.policy_attestations a
   join public.policy_attestation_campaigns c on c.id = a.campaign_id
   where c.recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'
     and a.employee_id = 'e1000000-0000-4000-8000-000000000201'),
  1,
  'and the targeting rule comes with it, so the new cycle is already enrolled'
);

------------------------------------------------------------------------------------------------
-- Idempotence and the schedule advancing
------------------------------------------------------------------------------------------------
select is(
  (select next_occurrence_on from public.policy_attestation_campaigns
   where id = 'e1000000-0000-4000-8000-000000000401'),
  (public.pa_today() + 20 + interval '12 months')::date,
  'the series advances by twelve months. Computed as an interval, not as 365 days -- a hardcoded '
  'day count would pass today and fail whenever the window happens to span a leap day'
);

select is(
  public.spawn_due_policy_campaign_cycles(),
  0,
  'a second run the same day opens nothing -- the date already moved'
);

select is(
  (select count(*)::int from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000401'),
  1,
  'and creates no duplicate cycle'
);

------------------------------------------------------------------------------------------------
-- Rows that must stay out of scope
------------------------------------------------------------------------------------------------
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  recurrence_months, next_occurrence_on
) values (
  'e1000000-0000-4000-8000-000000000402', 'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000301', 'e1000000-0000-4000-8000-000000000311',
  'Far-off series', 12, public.pa_today() + 200
);

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name
) values (
  'e1000000-0000-4000-8000-000000000403', 'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000301', 'e1000000-0000-4000-8000-000000000311',
  'One-off campaign'
);

select is(
  public.spawn_due_policy_campaign_cycles(),
  0,
  'a series whose next cycle is 200 days out is not opened early'
);

select is(
  (select count(*)::int from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000403'),
  0,
  'and a one-off campaign never spawns anything'
);

-- A year later, the far-off series comes due on its own.
select is(
  public.spawn_due_policy_campaign_cycles(now() + interval '180 days'),
  1,
  'the far-off series opens when its own lead window arrives'
);

select is(
  (select count(*)::int from public.policy_attestation_campaigns
   where recurrence_parent_id = 'e1000000-0000-4000-8000-000000000402'),
  1,
  'as exactly one cycle, not one per day since it became eligible'
);

------------------------------------------------------------------------------------------------
-- Authoring a series through the creation RPC
--
-- next_occurrence_on is derived rather than accepted: the campaign being created is cycle one, so
-- the next cycle is its own due date plus the interval. Letting a caller supply both invites them
-- to disagree, and a next date before the first due date would spawn cycle two immediately.
------------------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.create_policy_campaign_with_questions(
       'e1000000-0000-4000-8000-000000000001'::uuid,
       'e1000000-0000-4000-8000-000000000301'::uuid,
       'e1000000-0000-4000-8000-000000000312'::uuid,
       'Authored series', (public.pa_today() + 400)::date, '[]'::jsonb,
       'manual', null, null, null, null, 12
     ) $$,
  'a recurring campaign can be authored in one call'
);

select is(
  (select next_occurrence_on from public.policy_attestation_campaigns where name = 'Authored series'),
  (public.pa_today() + 400 + interval '12 months')::date,
  'and its next cycle is derived from its own due date, not asked for separately'
);

select throws_ok(
  $$ select public.create_policy_campaign_with_questions(
       'e1000000-0000-4000-8000-000000000001'::uuid,
       'e1000000-0000-4000-8000-000000000301'::uuid,
       'e1000000-0000-4000-8000-000000000312'::uuid,
       'No anchor', null, '[]'::jsonb, 'manual', null, null, null, null, 12
     ) $$,
  '22023',
  'A repeating campaign needs a due date to repeat from',
  'a repeat with no due date is refused by name, not by a constraint on a column the caller never set'
);

select * from finish();
rollback;
