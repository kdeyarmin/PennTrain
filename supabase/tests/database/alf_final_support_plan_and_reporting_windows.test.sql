-- pgTAP coverage for 20260925110000 (the ALF final support plan, its quarterly review, and each
-- form's own look-back before admission) and 20260925110100 (reportable-incident windows read
-- against 55 Pa. Code 2600.16 / 2800.16 and 6 Pa. Code Chapter 15), and 20260925120200 (the
-- quarterly review's 5-day grace from the Chapter 2800 Regulatory Compliance Guide).
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(36);

-- ---------------------------------------------------------------------------------------
-- The rule packs say what Chapter 2800 says
-- ---------------------------------------------------------------------------------------
select is(
  (select offset_basis || ':' || offset_days from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'ALR'
     and item_type = 'initial_assessment_15day' and admission_track = 'standard'),
  'before_admission:0',
  'the ALF initial assessment is due by admission, not 30 days before it (2800.224(a)(2))'
);

select is(
  (select string_agg(admission_track || ':' || offset_basis || ':' || offset_days || ':' || citation_ref,
                     ',' order by admission_track)
   from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'ALR'
     and item_type = 'support_plan_30day'),
  'expedited:after_admission:30:2800.227,standard:after_admission:30:2800.227',
  'the ALF support plan is the final plan, 30 days after admission on both tracks (2800.227(a))'
);

select is(
  (select count(*)::int from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'ALR'
     and item_type = 'support_plan_quarterly_review'
     and renewal_interval_days = 90 and citation_ref = '2800.227'
     and is_active and not instantiate_at_admission),
  2,
  'both ALF tracks carry a 90-day quarterly review that is not created at admission (2800.227(c))'
);

select is(
  (select string_agg(admission_track || ':' || grace_period_days, ',' order by admission_track)
   from public.resident_compliance_rule_packs
   where organization_id is null and state = 'PA' and facility_type = 'ALR'
     and item_type = 'support_plan_quarterly_review'),
  'expedited:5,standard:5',
  'the quarterly review takes the RCG''s 5-day grace for items under a year; 2800.227(c) is not an exception'
);

select is(
  (select count(*)::int from public.resident_compliance_rule_packs
   where facility_type = 'PCH' and item_type = 'support_plan_quarterly_review'),
  0,
  'Chapter 2600 has no quarterly review, so PCH has no row'
);

select is(
  (select count(*)::int from public.dhs_citation_topics where citation_ref = '2800.227'),
  1,
  'exactly one citation topic for 2800.227, because the successor lookups take it as a scalar'
);

select is(
  array[
    public.resident_compliance_backdate_days('medical_evaluation', 'PCH'),
    public.resident_compliance_backdate_days('medical_evaluation', 'ALR'),
    public.resident_compliance_backdate_days('preadmission_screening', 'ALR'),
    public.resident_compliance_backdate_days('initial_assessment_15day', 'ALR'),
    public.resident_compliance_backdate_days('support_plan_30day', 'ALR'),
    public.resident_compliance_backdate_days('support_plan_30day', 'PCH'),
    public.resident_compliance_backdate_days('annual_reassessment', 'ALR')
  ],
  array[60, 60, 30, 30, 0, 180, 180],
  'each form may predate admission by its own regulatory look-back, and no further'
);

select ok(
  not has_function_privilege('authenticated', 'public.resident_compliance_backdate_days(text, text)', 'EXECUTE'),
  'the look-back table is internal to the completion RPC'
);

-- ---------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('a2270000-0000-4000-8000-000000000001', 'Plan Review Org', 'plan-review-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a2270000-0000-4000-8000-000000000011', 'a2270000-0000-4000-8000-000000000001', 'Review ALF', 'ALR'),
  ('a2270000-0000-4000-8000-000000000012', 'a2270000-0000-4000-8000-000000000001', 'Review PCH', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a2270000-0000-4000-8000-000000000101', 'authenticated',
   'authenticated', 'plan-review-admin@test.local', 'x', now(), '{}', '{}', now(), now(),
   '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a2270000-0000-4000-8000-000000000101', 'a2270000-0000-4000-8000-000000000001',
   'plan-review-admin@test.local', 'Pat', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- complete_resident_compliance_item() requires is_assigned_to_facility even for an org_admin.
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title) values
  ('a2270000-0000-4000-8000-000000000111', 'a2270000-0000-4000-8000-000000000001',
   'a2270000-0000-4000-8000-000000000011', 'a2270000-0000-4000-8000-000000000101',
   'Pat', 'Admin', 'Administrator');
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id)
select 'a2270000-0000-4000-8000-000000000001', 'a2270000-0000-4000-8000-000000000111', f.id
from public.facilities f where f.organization_id = 'a2270000-0000-4000-8000-000000000001'
on conflict do nothing;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- A state-form document linked to one item, which is all the completion RPC will accept.
create or replace function pg_temp.attach_form(p_doc_id uuid, p_resident_id uuid, p_item_type text)
returns void language sql as $$
  insert into public.resident_documents(
    id, organization_id, facility_id, resident_id, storage_bucket, storage_path, file_name,
    file_type, is_state_form, state_form_source_label, compliance_item_id, uploaded_by_profile_id
  )
  select p_doc_id, ci.organization_id, ci.facility_id, ci.resident_id, 'resident-documents',
         'review/' || p_doc_id || '.pdf', p_doc_id || '.pdf', 'application/pdf', true,
         'PA DHS state form', ci.id, 'a2270000-0000-4000-8000-000000000101'
  from public.resident_compliance_items ci
  where ci.resident_id = p_resident_id and ci.item_type = p_item_type and ci.completed_date is null
  order by ci.due_date
  limit 1;
$$;

insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('a2270000-0000-4000-8000-000000000201', 'a2270000-0000-4000-8000-000000000001',
   'a2270000-0000-4000-8000-000000000011', 'Alf', 'Resident', 'active', public.pa_today() - 40),
  ('a2270000-0000-4000-8000-000000000202', 'a2270000-0000-4000-8000-000000000001',
   'a2270000-0000-4000-8000-000000000012', 'Pch', 'Resident', 'active', public.pa_today() - 40);

-- ---------------------------------------------------------------------------------------
-- An ALF admission
-- ---------------------------------------------------------------------------------------
select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'initial_assessment_15day'),
  public.pa_today() - 40,
  'the initial assessment is due on the admission date -- it used to be due a month before it'
);

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_30day'),
  public.pa_today() - 10,
  'the support plan is due 30 days after admission, not a second copy of the initial deadline'
);

select is(
  (select ct.category from public.resident_compliance_items ci
   join public.dhs_citation_topics ct on ct.id = ci.citation_topic_id
   where ci.resident_id = 'a2270000-0000-4000-8000-000000000201' and ci.item_type = 'support_plan_30day'),
  'ALF Final Support Plan',
  'and it is filed under 2800.227, not the initial-assessment topic'
);

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_quarterly_review'),
  0,
  'no quarterly review exists before there is a final support plan to review'
);

-- ---------------------------------------------------------------------------------------
-- The final support plan cannot predate admission, and completing it starts the review
-- ---------------------------------------------------------------------------------------
select pg_temp.attach_form('a2270000-0000-4000-8000-000000000301', 'a2270000-0000-4000-8000-000000000201', 'support_plan_30day');

select pg_temp.act_as('a2270000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_30day'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000301', public.pa_today() - 41,
    jsonb_build_object('lpn_name','Test LPN','lpn_license','PN123','rn_supervisor_name','Test RN','rn_supervisor_license','RN123','reviewed_on',public.pa_today()-41))$$,
  '23514', null,
  'a final support plan dated the day before admission is refused -- 2800.227(a) is a post-admission plan'
);
select throws_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items where resident_id='a2270000-0000-4000-8000-000000000201'
      and item_type='support_plan_30day' and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000301',public.pa_today()-20)$$,
  '23514',null,'an ALF final plan cannot complete without documented LPN approval under RN supervision');
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_30day'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000301', public.pa_today() - 20,
    jsonb_build_object('lpn_name','Test LPN','lpn_license','PN123','rn_supervisor_name','Test RN','rn_supervisor_license','RN123','reviewed_on',public.pa_today()-20))$$,
  'dated twenty days after admission, it completes'
);
reset role;

select is((select final_plan_review->>'lpn_name' from public.resident_compliance_items
  where resident_id='a2270000-0000-4000-8000-000000000201' and item_type='support_plan_30day' and completed_date is not null),
  'Test LPN','the final plan retains structured approval evidence');

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_quarterly_review'),
  public.pa_today() + 70,
  'completing the plan starts the quarterly review, due 90 days after the date on the plan'
);

select is(
  (select ct.category from public.resident_compliance_items ci
   join public.dhs_citation_topics ct on ct.id = ci.citation_topic_id
   where ci.resident_id = 'a2270000-0000-4000-8000-000000000201' and ci.item_type = 'support_plan_quarterly_review'),
  'ALF Final Support Plan',
  'and the review is filed under 2800.227 with the plan it reviews'
);

select is(
  (select renewal_interval_days from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_quarterly_review'),
  90,
  'the review carries its own 90-day cycle'
);

-- ---------------------------------------------------------------------------------------
-- The review renews itself, and a revised plan does not stack a second one
-- ---------------------------------------------------------------------------------------
select pg_temp.attach_form('a2270000-0000-4000-8000-000000000302', 'a2270000-0000-4000-8000-000000000201', 'support_plan_quarterly_review');

select pg_temp.act_as('a2270000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_quarterly_review'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000302', public.pa_today())$$,
  'the quarterly review completes against its state form'
);
reset role;

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  1,
  'completing a review opens exactly one next review'
);
select is(
  (select due_date from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  public.pa_today() + 90,
  'due a quarter after the review that was done'
);
select is(
  (select grace_period_days from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  5,
  'the next review carries the pack''s 5-day grace'
);

-- A plan revised mid-quarter (2800.227(c) after a change in needs) while a review is running.
insert into public.resident_compliance_items(
  organization_id, facility_id, resident_id, item_type, due_date, warning_days, grace_period_days
) values (
  'a2270000-0000-4000-8000-000000000001', 'a2270000-0000-4000-8000-000000000011',
  'a2270000-0000-4000-8000-000000000201', 'support_plan_30day', public.pa_today() + 20, 14, 0
);
select pg_temp.attach_form('a2270000-0000-4000-8000-000000000303', 'a2270000-0000-4000-8000-000000000201', 'support_plan_30day');

select pg_temp.act_as('a2270000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'support_plan_30day'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000303', public.pa_today(),
    jsonb_build_object('lpn_name','Test LPN','lpn_license','PN123','rn_supervisor_name','Test RN','rn_supervisor_license','RN123','reviewed_on',public.pa_today()))$$,
  'a revised support plan completes'
);
reset role;

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000201'
     and item_type = 'support_plan_quarterly_review' and completed_date is null),
  1,
  'and the review already running is the only open one -- a revision does not stack a second'
);

-- The not-exists check in the RPC reads without a lock, so two completions at the same moment both
-- pass it. The index is what the second one's insert runs into.
select throws_ok(
  $$insert into public.resident_compliance_items(
      organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days,
      warning_days, grace_period_days
    ) values (
      'a2270000-0000-4000-8000-000000000001', 'a2270000-0000-4000-8000-000000000011',
      'a2270000-0000-4000-8000-000000000201', 'support_plan_quarterly_review', public.pa_today() + 45,
      90, 14, 5
    )$$,
  '23505', null,
  'a second open quarterly review for the same resident is refused by the database, not just by the RPC'
);

-- ---------------------------------------------------------------------------------------
-- The medical evaluation's 60 days (2600.141(a) / 2800.22(a)(1))
-- ---------------------------------------------------------------------------------------
select pg_temp.attach_form('a2270000-0000-4000-8000-000000000304', 'a2270000-0000-4000-8000-000000000201', 'medical_evaluation');

select pg_temp.act_as('a2270000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000304', public.pa_today() - 101)$$,
  '23514', null,
  'a medical evaluation dated 61 days before admission is refused -- the 180-day floor accepted it'
);
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000304', public.pa_today() - 100)$$,
  'and one dated exactly 60 days before admission completes'
);
reset role;

-- ---------------------------------------------------------------------------------------
-- A PCH support plan starts no quarterly review
-- ---------------------------------------------------------------------------------------
select pg_temp.attach_form('a2270000-0000-4000-8000-000000000305', 'a2270000-0000-4000-8000-000000000202', 'support_plan_30day');

select pg_temp.act_as('a2270000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.complete_resident_compliance_item(
    (select id from public.resident_compliance_items
     where resident_id = 'a2270000-0000-4000-8000-000000000202' and item_type = 'support_plan_30day'
       and completed_date is null order by due_date limit 1),
    'a2270000-0000-4000-8000-000000000305', public.pa_today() - 20)$$,
  'a PCH support plan completes'
);
reset role;

select is(
  (select count(*)::int from public.resident_compliance_items
   where resident_id = 'a2270000-0000-4000-8000-000000000202' and item_type = 'support_plan_quarterly_review'),
  0,
  'and no quarterly review follows it, because Chapter 2600 requires none'
);

-- ---------------------------------------------------------------------------------------
-- Reportable incidents (20260925110100)
-- ---------------------------------------------------------------------------------------
insert into public.incidents(
  id, organization_id, facility_id, incident_type, occurred_at, reported_at,
  narrative, severity, status, reportability_status
) values (
  'a2270000-0000-4000-8000-000000000401', 'a2270000-0000-4000-8000-000000000001',
  'a2270000-0000-4000-8000-000000000012', 'abuse_allegation',
  now() - interval '1 hour', now() - interval '10 minutes',
  'Resident reported being pushed by a visitor in the dayroom.', 'major', 'reported', 'reportable'
);

select is(
  (select due_at from public.incident_notifications
   where incident_id = 'a2270000-0000-4000-8000-000000000401' and notification_type = 'state_hotline'),
  (select reported_at + interval '24 hours' from public.incidents where id = 'a2270000-0000-4000-8000-000000000401'),
  'the Department is owed its report within 24 hours of knowledge (2600.16(c)), not two'
);

select is(
  (select due_at from public.incident_notifications
   where incident_id = 'a2270000-0000-4000-8000-000000000401' and notification_type = 'protective_services'),
  (select reported_at + interval '2 hours' from public.incidents where id = 'a2270000-0000-4000-8000-000000000401'),
  'and protective services is owed the immediate OAPSA report, which had no notification at all'
);

select is(
  (select citation from public.incident_notification_rules
   where incident_type = 'abuse_allegation' and notification_type = 'protective_services'),
  '6 Pa. Code 15.151(a)(1); 55 Pa. Code 2600.15(a) / 2800.15(a)',
  'the protective-services window cites the OAPSA section that imposes it'
);

select is(
  (select source_confidence from public.incident_notification_rules
   where incident_type = 'abuse_allegation' and notification_type = 'protective_services'),
  'unverified',
  'and is unverified: "immediately" is the regulation, two hours is the product''s ceiling for it'
);

select ok(
  (select bool_and(citation like '55 Pa. Code 2600.16(d) / 2800.16(d)%')
   from public.incident_notification_rules
   where notification_type = 'written_report' and incident_type not in ('abuse_allegation', 'assault')),
  'a written report outside OAPSA cites the final-report section and says 48 hours is an internal target'
);

select ok(
  (select bool_and(citation like '%internal target%')
   from public.incident_notification_rules
   where notification_type = 'written_report' and incident_type not in ('abuse_allegation', 'assault')),
  'with the target named as the product''s, not the regulation''s'
);

select * from finish();
rollback;
