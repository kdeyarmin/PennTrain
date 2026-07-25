begin;
select plan(12);

-- The delivery contract is what turns a plan intervention into something an aide can actually
-- perform and close. These assertions pin the invariants that make that true.

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resident_service_requirements'
      and column_name = 'task_kind' and is_nullable = 'NO'
  ),
  'service requirements carry a task kind'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'resident_service_requirements'
      and column_name = 'acceptable_completion_responses' and is_nullable = 'NO'
  ),
  'service requirements carry acceptable completion responses'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_service_requirements'::regclass
      and conname = 'resident_service_requirements_responses_not_empty'
  ),
  'a service with no acceptable responses is rejected'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.resident_service_requirements'::regclass
      and conname = 'resident_service_requirements_responses_known'
  ),
  'an unrecognized completion response is rejected'
);

-- Per-kind response defaults ------------------------------------------------
select is(
  app_private.default_completion_responses('scheduled_care'),
  array['completed_as_planned','completed_with_more_assistance','partially_completed',
        'resident_refused','resident_unavailable','not_completed','concern_observed']::text[],
  'hands-on care offers all seven responses'
);
select ok(
  not ('resident_refused' = any(app_private.default_completion_responses('manager_review'))),
  'a manager review cannot be refused by a resident'
);
select ok(
  not ('resident_refused' = any(app_private.default_completion_responses('documentation_requirement'))),
  'a documentation requirement cannot be refused by a resident'
);
select ok(
  'concern_observed' = any(app_private.default_completion_responses('observation')),
  'an observation task can record a concern'
);
select ok(
  not ('resident_refused' = any(app_private.default_completion_responses('observation'))),
  'an observation task does not offer a resident refusal'
);
select is(
  app_private.default_completion_responses('something_unrecognized'),
  app_private.default_completion_responses('scheduled_care'),
  'an unrecognized kind falls back to the full response set rather than an empty one'
);

-- Qualification key shape ---------------------------------------------------
select throws_ok(
  $$insert into public.resident_service_requirements(
      organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
      source_section, source_key, service_code, service_name, special_instructions, frequency,
      responsible_role, effective_from, required_qualification_key)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1,
      's', 'k', 'c', 'n', 'i', 'daily', 'employee', current_date, 'Not A Valid Key')$$,
  null,
  'a malformed qualification key is rejected'
);

select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and p.proname = 'activate_support_plan') = 1,
  'plan activation remains the single writer of service requirements'
);

select * from finish();
rollback;
