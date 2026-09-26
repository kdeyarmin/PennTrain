-- pgTAP coverage for app_private.backfill_alf_support_plan_cycle(), the 20260925110000 backfill for
-- ALF residents admitted before the final support plan (2800.227(a)) and its quarterly review
-- (2800.227(c)) were tracked. Before that migration the ALF `support_plan_30day` row was the
-- 2800.224 preliminary plan, so a completed first-cycle row is shaped here the way it was then:
-- completed, and filed under 2800.224. Also covers the same migration's section 8: the review in
-- the QAPI late-assessment count and the work queue's support-plan source type.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(20);

insert into public.organizations(id, name, slug, subscription_status) values
  ('a2280000-0000-4000-8000-000000000001', 'Plan Backfill Org', 'plan-backfill-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a2280000-0000-4000-8000-000000000011', 'a2280000-0000-4000-8000-000000000001', 'Backfill ALF', 'ALR'),
  ('a2280000-0000-4000-8000-000000000012', 'a2280000-0000-4000-8000-000000000001', 'Backfill PCH', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a2280000-0000-4000-8000-000000000101', 'authenticated',
   'authenticated', 'plan-backfill-admin@test.local', 'x', now(), '{}', '{}', now(), now(),
   '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a2280000-0000-4000-8000-000000000101', 'a2280000-0000-4000-8000-000000000001',
   'plan-backfill-admin@test.local', 'Pat', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title) values
  ('a2280000-0000-4000-8000-000000000111', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'a2280000-0000-4000-8000-000000000101',
   'Pat', 'Admin', 'Administrator');
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id)
values ('a2280000-0000-4000-8000-000000000001', 'a2280000-0000-4000-8000-000000000111',
        'a2280000-0000-4000-8000-000000000011')
on conflict do nothing;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- The resident's first-cycle support plan as the old model left it once it was done: completed,
-- under the 2800.224 preliminary-plan topic.
create or replace function pg_temp.complete_as_preliminary(p_resident_id uuid, p_completed_on date)
returns void language sql as $$
  update public.resident_compliance_items
  set completed_date = p_completed_on,
      status = 'compliant',
      citation_topic_id = (select id from public.dhs_citation_topics where citation_ref = '2800.224')
  where resident_id = p_resident_id
    and item_type = 'support_plan_30day'
    and triggered_by_item_id is null;
$$;

-- A plan revised after the resident's annual reassessment, as complete_resident_compliance_item
-- creates it; completed when p_completed_on is given, open otherwise.
create or replace function pg_temp.add_revision(p_resident_id uuid, p_completed_on date)
returns void language sql as $$
  update public.resident_compliance_items
  set completed_date = public.pa_today() - 60, status = 'compliant'
  where resident_id = p_resident_id and item_type = 'annual_reassessment';
  insert into public.resident_compliance_items(
    organization_id, facility_id, resident_id, item_type, due_date, warning_days, grace_period_days,
    citation_topic_id, triggered_by_item_id, completed_date, status
  )
  select ci.organization_id, ci.facility_id, ci.resident_id, 'support_plan_30day',
         public.pa_today() - 30, 14, 0,
         (select id from public.dhs_citation_topics where citation_ref = '2800.227'), ci.id,
         p_completed_on, case when p_completed_on is null then 'missing' else 'compliant' end
  from public.resident_compliance_items ci
  where ci.resident_id = p_resident_id and ci.item_type = 'annual_reassessment';
$$;

insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  -- only the preliminary plan on file
  ('a2280000-0000-4000-8000-000000000201', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'Only', 'Preliminary', 'active', public.pa_today() - 200),
  -- preliminary plan, then a plan revised after the annual reassessment
  ('a2280000-0000-4000-8000-000000000202', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'Revised', 'Plan', 'active', public.pa_today() - 400),
  -- preliminary plan, and a revision still open
  ('a2280000-0000-4000-8000-000000000203', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'Open', 'Revision', 'active', public.pa_today() - 400),
  -- preliminary plan, discharged
  ('a2280000-0000-4000-8000-000000000204', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'Gone', 'Home', 'discharged', public.pa_today() - 200),
  -- a PCH resident with a completed support plan
  ('a2280000-0000-4000-8000-000000000205', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000012', 'Pch', 'Resident', 'active', public.pa_today() - 200),
  -- preliminary plan, in hospital with the bed held
  ('a2280000-0000-4000-8000-000000000206', 'a2280000-0000-4000-8000-000000000001',
   'a2280000-0000-4000-8000-000000000011', 'In', 'Hospital', 'hospital_leave', public.pa_today() - 200);

select pg_temp.complete_as_preliminary('a2280000-0000-4000-8000-000000000201', public.pa_today() - 210);
select pg_temp.complete_as_preliminary('a2280000-0000-4000-8000-000000000202', public.pa_today() - 410);
select pg_temp.add_revision('a2280000-0000-4000-8000-000000000202', public.pa_today() - 50);
select pg_temp.complete_as_preliminary('a2280000-0000-4000-8000-000000000203', public.pa_today() - 410);
select pg_temp.add_revision('a2280000-0000-4000-8000-000000000203', null);
select pg_temp.complete_as_preliminary('a2280000-0000-4000-8000-000000000204', public.pa_today() - 210);
update public.resident_compliance_items
set completed_date = public.pa_today() - 180, status = 'compliant'
where resident_id = 'a2280000-0000-4000-8000-000000000205' and item_type = 'support_plan_30day';
select pg_temp.complete_as_preliminary('a2280000-0000-4000-8000-000000000206', public.pa_today() - 210);

select app_private.backfill_alf_support_plan_cycle();
select public.recalculate_resident_compliance_statuses();

-- ---------------------------------------------------------------------------------------
-- Only the preliminary plan on file: the final plan is owed, and nothing is reviewed yet
-- ---------------------------------------------------------------------------------------
select is(
  (select string_agg(due_date::text || ':' || ct.citation_ref || ':' || (triggered_by_item_id is null)::text, ',')
   from public.resident_compliance_items ci
   join public.dhs_citation_topics ct on ct.id = ci.citation_topic_id
   where ci.resident_id = 'a2280000-0000-4000-8000-000000000201'
     and ci.item_type = 'support_plan_30day' and ci.completed_date is null),
  (public.pa_today() - 170)::text || ':2800.227:true',
  'a resident with only the preliminary plan gets one open final plan, due 30 days after admission, under 2800.227'
);

select is(
  (select status from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_30day' and completed_date is null),
  'expired',
  'and it reads overdue: no 2800.227(a) plan is recorded and the deadline has passed'
);

select is(
  (select ct.citation_ref from public.resident_compliance_items ci
   join public.dhs_citation_topics ct on ct.id = ci.citation_topic_id
   where ci.resident_id = 'a2280000-0000-4000-8000-000000000201'
     and ci.item_type = 'support_plan_30day' and ci.completed_date is not null),
  '2800.224',
  'the completed preliminary plan keeps the citation it was recorded under'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201' and item_type = 'support_plan_quarterly_review'),
  0,
  'and no quarterly review starts from a preliminary plan'
);

-- ---------------------------------------------------------------------------------------
-- A revised plan on file: that is the final plan, and it is what gets reviewed
-- ---------------------------------------------------------------------------------------
select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000202'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  public.pa_today() + 40,
  'a resident with a revised plan on file gets a quarterly review due 90 days after the revision'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000202'
     and item_type = 'support_plan_30day' and completed_date is null),
  0,
  'and no final plan, because the revised plan on file is one'
);

-- ---------------------------------------------------------------------------------------
-- The residents the backfill leaves alone
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000203'
     and (item_type = 'support_plan_quarterly_review'
          or (item_type = 'support_plan_30day' and triggered_by_item_id is null and completed_date is null))),
  0,
  'an open revision is left to produce the plan: no second open plan and no review before it is done'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000204' and completed_date is null
     and item_type in ('support_plan_30day', 'support_plan_quarterly_review')),
  0,
  'a discharged resident is owed nothing'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000205'
     and (item_type = 'support_plan_quarterly_review'
          or (item_type = 'support_plan_30day' and completed_date is null))),
  0,
  'a PCH resident is untouched: Chapter 2600 has one support plan and no quarterly review'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000206'
     and item_type = 'support_plan_30day' and completed_date is null),
  1,
  'a resident in hospital with the bed held still owes the final plan'
);

-- ---------------------------------------------------------------------------------------
-- Running it again changes nothing
-- ---------------------------------------------------------------------------------------
create temp table backfill_before as
select resident_id, item_type, count(*) as n
from public.resident_compliance_items
where organization_id = 'a2280000-0000-4000-8000-000000000001'
group by resident_id, item_type;

select app_private.backfill_alf_support_plan_cycle();

select is(
  (select count(*)::int from (
     select resident_id, item_type, count(*) as n
     from public.resident_compliance_items
     where organization_id = 'a2280000-0000-4000-8000-000000000001'
     group by resident_id, item_type
     except select * from backfill_before
   ) changed),
  0,
  'a second run adds nothing'
);

-- ---------------------------------------------------------------------------------------
-- Completing the backfilled final plan starts the review, and the backfill does not reopen it
-- ---------------------------------------------------------------------------------------
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_bucket, storage_path, file_name,
  file_type, is_state_form, state_form_source_label, compliance_item_id, uploaded_by_profile_id
)
select 'a2280000-0000-4000-8000-000000000301', ci.organization_id, ci.facility_id, ci.resident_id,
       'resident-documents', 'backfill/final-plan.pdf', 'final-plan.pdf', 'application/pdf', true,
       'PA DHS state form', ci.id, 'a2280000-0000-4000-8000-000000000101'
from public.resident_compliance_items ci
where ci.resident_id = 'a2280000-0000-4000-8000-000000000201'
  and ci.item_type = 'support_plan_30day' and ci.completed_date is null;

select pg_temp.act_as('a2280000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2280000-0000-4000-8000-000000000201'
       and item_type = 'support_plan_30day' and completed_date is null),
    'a2280000-0000-4000-8000-000000000301', public.pa_today() - 175,
    jsonb_build_object('lpn_name','Test LPN','lpn_license','PN123','rn_supervisor_name','Test RN','rn_supervisor_license','RN123','reviewed_on',public.pa_today()-175))$$,
  'the backfilled final plan completes against the plan on file, dated after admission'
);
reset role;

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  public.pa_today() - 85,
  'and completing it starts the quarterly review, due 90 days after the plan'
);

select app_private.backfill_alf_support_plan_cycle();

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_30day' and completed_date is null),
  0,
  'a completed final plan is evidence: the backfill does not ask for another'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  1,
  'and does not stack a second review on the one running'
);

-- ---------------------------------------------------------------------------------------
-- An overdue review is a late assessment in QAPI and a support plan in the work queue
-- ---------------------------------------------------------------------------------------
select public.recalculate_resident_compliance_statuses();

select is(
  (select status from public.resident_compliance_items
   where resident_id = 'a2280000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  'expired',
  'the review started from a plan dated 175 days ago is overdue'
);

create or replace function pg_temp.late_assessments()
returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.act_as('a2280000-0000-4000-8000-000000000101');
  v := (public.get_qapi_source_metrics('a2280000-0000-4000-8000-000000000011',
          public.pa_today() - 30, public.pa_today())->>'lateAssessments')::integer;
  reset role;
  return v;
end $$;

create temp table late_before as select pg_temp.late_assessments() as n;
update public.resident_compliance_items
set due_date = public.pa_today() + 30
where resident_id = 'a2280000-0000-4000-8000-000000000201'
  and item_type = 'support_plan_quarterly_review' and completed_date is null;
select public.recalculate_resident_compliance_statuses();

select is(
  pg_temp.late_assessments(),
  (select n - 1 from late_before),
  'QAPI counts the overdue quarterly review as a late assessment: bringing it current takes one off'
);

select public.register_outstanding_work_items();

select is(
  (select w.source_type from public.work_items w
   join public.resident_compliance_items ci on ci.id = w.source_id
   where ci.resident_id = 'a2280000-0000-4000-8000-000000000201'
     and ci.item_type = 'support_plan_quarterly_review' and ci.completed_date is null),
  'support_plan',
  'and the work queue files the review as a support plan, not an assessment'
);

-- ---------------------------------------------------------------------------------------
-- The function is the migration's, not the application's
-- ---------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'app_private.backfill_alf_support_plan_cycle()', 'EXECUTE'),
  'no signed-in user can run the backfill'
);

select ok(
  not has_function_privilege('service_role', 'app_private.backfill_alf_support_plan_cycle()', 'EXECUTE'),
  'and neither can the service role'
);

select * from finish();
rollback;
