begin;
select plan(13);

select has_column('public', 'admission_prospects', 'pipeline_stage', 'the funnel column exists');
select has_function('public', 'advance_admission_pipeline_stage', array['uuid', 'text', 'text'],
  'the funnel RPC exists');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('d7000000-0000-4000-8000-000000000001', 'Pipeline Org', 'pipeline-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d7000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000001', 'Pipeline Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'd7000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'd7-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d7000000-0000-4000-8000-000000000101', 'd7000000-0000-4000-8000-000000000001', 'd7-admin@test.local', 'Dana', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- A prospect created the ordinary way starts at the top of the funnel.
insert into public.admission_prospects(
  id, organization_id, facility_id, first_name, last_name, stage
) values (
  'd7000000-0000-4000-8000-000000000501', 'd7000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000011', 'Parker', 'Prospect', 'prospect'
);
select is(
  (select pipeline_stage from public.admission_prospects where id = 'd7000000-0000-4000-8000-000000000501'),
  'new_inquiry',
  'a new prospect starts at new_inquiry'
);

-- The funnel moves independently of the decision lifecycle: booking a tour must not touch anything
-- that gates a bed.
create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

select pg_temp.act_as('d7000000-0000-4000-8000-000000000101');
select lives_ok($$select public.advance_admission_pipeline_stage(
  'd7000000-0000-4000-8000-000000000501', 'tour_scheduled', 'Family visiting Thursday')$$,
  'a manager advances the funnel');
reset role;

select is(
  (select stage from public.admission_prospects where id = 'd7000000-0000-4000-8000-000000000501'),
  'prospect',
  'and the decision lifecycle is untouched, so no bed gate moved'
);
select ok(
  (select tour_scheduled_at is not null from public.admission_prospects
   where id = 'd7000000-0000-4000-8000-000000000501'),
  'the tour timestamp is stamped from the stage change'
);

-- Backwards movement is allowed: tours get cancelled, and a funnel that refuses to record that gets
-- worked around in a spreadsheet.
select pg_temp.act_as('d7000000-0000-4000-8000-000000000101');
select lives_ok($$select public.advance_admission_pipeline_stage(
  'd7000000-0000-4000-8000-000000000501', 'qualified', 'Tour cancelled by the family')$$,
  'a prospect can move back down the funnel');

-- 'admitted' is not settable from the funnel: the move-in workflow creates the resident record, and
-- a board that could set it would produce an admitted prospect with nobody living anywhere.
select throws_ok($$select public.advance_admission_pipeline_stage(
  'd7000000-0000-4000-8000-000000000501', 'admitted', 'Trying to shortcut the move-in')$$,
  '22023',
  null,
  'the funnel cannot declare somebody admitted');

select throws_ok($$select public.advance_admission_pipeline_stage(
  'd7000000-0000-4000-8000-000000000501', 'not_a_stage', 'Nonsense')$$,
  '22023',
  null,
  'and it refuses an unknown stage');
reset role;

-- The decision lifecycle drags the funnel forward when it is behind, because a prospect who has
-- been approved has self-evidently been contacted.
update public.admission_prospects
set stage = 'approved', clinical_review_status = 'approved', financial_review_status = 'approved'
where id = 'd7000000-0000-4000-8000-000000000501';
select is(
  (select pipeline_stage from public.admission_prospects where id = 'd7000000-0000-4000-8000-000000000501'),
  'accepted',
  'approving a prospect drags the funnel forward to accepted'
);

-- But it never drags it BACKWARDS: a prospect further along keeps their progress.
update public.admission_prospects set pipeline_stage = 'move_in_scheduled'
where id = 'd7000000-0000-4000-8000-000000000501';
update public.admission_prospects set updated_at = now()
where id = 'd7000000-0000-4000-8000-000000000501';
select is(
  (select pipeline_stage from public.admission_prospects where id = 'd7000000-0000-4000-8000-000000000501'),
  'move_in_scheduled',
  'and a prospect further along than the decision state keeps their progress'
);

-- Loss is absolute in both directions: a declined prospect is out of the funnel.
update public.admission_prospects set stage = 'declined'
where id = 'd7000000-0000-4000-8000-000000000501';
select is(
  (select pipeline_stage from public.admission_prospects where id = 'd7000000-0000-4000-8000-000000000501'),
  'lost_declined',
  'declining a prospect takes them out of the funnel however far along they were'
);

-- Guard rails on the CRM figures.
select throws_ok($$insert into public.admission_prospects(
  organization_id, facility_id, first_name, last_name, probability_percent
) values (
  'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000011',
  'Bad', 'Probability', 150
)$$,
  '23514',
  null,
  'a probability outside 0-100 is refused');

select * from finish();
rollback;
