begin;
select plan(13);

-- A support plan approved with a future effective date is promoted by a pg_cron job. Where pg_cron
-- is absent the promotion silently never happens, the resident's service tasks keep generating from
-- the OLD plan, and -- before this migration -- nobody could see it and nobody could fix it.
--
-- The assertions that matter are the refusals: activating early must stay impossible, because
-- future-dating is a clinical decision and a repair button must not become an override.

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('fe000000-0000-4000-8000-000000000001', 'Stall Org', 'stall-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('fe000000-0000-4000-8000-000000000011', 'fe000000-0000-4000-8000-000000000001', 'Stall Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fe000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fe-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fe000000-0000-4000-8000-000000000101', 'fe000000-0000-4000-8000-000000000001', 'fe-admin@test.local', 'Sal', 'Stall', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('fe000000-0000-4000-8000-000000000201', 'fe000000-0000-4000-8000-000000000001',
        'fe000000-0000-4000-8000-000000000011', 'Stan', 'Stall', current_date, 'active');

-- v1 active, v2 approved and overdue: the exact shape a missed promotion leaves behind.
-- approved_by and approved_at are not decoration: the table refuses to let a plan claim approval
-- without an approver, a timestamp, and a start date.
insert into public.resident_support_plans(
  id, organization_id, facility_id, resident_id, version_number, state, effective_date,
  approved_by, approved_at, participation_date, needs, goals, services, interventions
) values
  ('fe000000-0000-4000-8000-000000000301', 'fe000000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000011', 'fe000000-0000-4000-8000-000000000201', 1, 'active',
   current_date - 30, 'fe000000-0000-4000-8000-000000000101', now() - interval '31 days', current_date - 40, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('fe000000-0000-4000-8000-000000000302', 'fe000000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000011', 'fe000000-0000-4000-8000-000000000201', 2, 'approved',
   current_date - 2, 'fe000000-0000-4000-8000-000000000101', now() - interval '3 days', current_date - 40, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  -- Approved but NOT yet due. This one must stay untouched by everything below.
  ('fe000000-0000-4000-8000-000000000303', 'fe000000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000011', 'fe000000-0000-4000-8000-000000000201', 3, 'approved',
   current_date + 7, 'fe000000-0000-4000-8000-000000000101', now(), current_date - 40, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated',
    'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- The condition is visible ------------------------------------------------------------------------
select pg_temp.act_as('fe000000-0000-4000-8000-000000000101');

-- The header still reports the plan IN FORCE as the old active one -- that part is correct, and is
-- precisely why the stalled plan needed its own block rather than a change to this one.
select is(
  (public.get_resident_care_header('fe000000-0000-4000-8000-000000000201') -> 'supportPlan' ->> 'versionNumber'),
  '1',
  'the plan in force is still version 1 -- the promotion did not happen'
);
select is(
  (public.get_resident_care_header('fe000000-0000-4000-8000-000000000201') -> 'pendingActivation' ->> 'versionNumber'),
  '2',
  'the stalled version 2 is reported through pendingActivation'
);
-- The not-yet-due v3 must not be reported as stalled; it is simply scheduled.
select is(
  (public.get_resident_care_header('fe000000-0000-4000-8000-000000000201') -> 'pendingActivation' ->> 'effectiveDate'),
  (current_date - 2)::text,
  'the reported date is the overdue one, not the plan legitimately scheduled for next week'
);
reset role;

-- Early activation is refused --------------------------------------------------------------------
select pg_temp.act_as('fe000000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.activate_due_support_plan('fe000000-0000-4000-8000-000000000303')$$,
  '22023',
  'This plan is not due to take effect yet',
  'a plan whose effective date has not arrived cannot be activated early'
);
reset role;
select is(
  (select state from public.resident_support_plans where id = 'fe000000-0000-4000-8000-000000000303'),
  'approved',
  'and it is left approved -- future-dating survives contact with the repair path'
);

-- A draft cannot be pushed straight to active either.
insert into public.resident_support_plans(
  id, organization_id, facility_id, resident_id, version_number, state,
  needs, goals, services, interventions
) values (
  'fe000000-0000-4000-8000-000000000304', 'fe000000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000011', 'fe000000-0000-4000-8000-000000000201', 4, 'draft',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
);
select pg_temp.act_as('fe000000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.activate_due_support_plan('fe000000-0000-4000-8000-000000000304')$$,
  '55000',
  'Only an approved support plan can be activated',
  'a draft cannot be activated -- the approval attestation is not skippable'
);
reset role;

-- The repair works ---------------------------------------------------------------------------------
select pg_temp.act_as('fe000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.activate_due_support_plan('fe000000-0000-4000-8000-000000000302')$$,
  'a care manager activates the overdue plan'
);
reset role;

select is(
  (select state from public.resident_support_plans where id = 'fe000000-0000-4000-8000-000000000302'),
  'active',
  'the overdue plan is now in force'
);
-- Superseding the prior version is half of what activation means; without it the resident would
-- briefly have two active plans.
select is(
  (select state from public.resident_support_plans where id = 'fe000000-0000-4000-8000-000000000301'),
  'superseded',
  'and the version it replaces is superseded'
);
select is(
  (public.get_resident_care_header('fe000000-0000-4000-8000-000000000201') -> 'pendingActivation'),
  'null'::jsonb,
  'the resident page no longer reports a stalled activation'
);

-- Recorded as manual on purpose: a run of these is the evidence that the scheduled job is broken.
select is(
  (select count(*)::int from public.audit_logs
   where entity_id = 'fe000000-0000-4000-8000-000000000302'
     and action = 'support_plan.activated_manually'),
  1,
  'the manual activation is audited distinctly from a scheduled one'
);

-- Idempotent: the scheduled job may win the race between the page rendering and the click.
select pg_temp.act_as('fe000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.activate_due_support_plan('fe000000-0000-4000-8000-000000000302')$$,
  'activating an already-active plan is a no-op rather than an error'
);
reset role;

-- Authorization is not merely hidden from -----------------------------------------------------------
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fe000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'fe-aide@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fe000000-0000-4000-8000-000000000102', 'fe000000-0000-4000-8000-000000000001', 'fe-aide@test.local', 'Ada', 'Aide', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('fe000000-0000-4000-8000-000000000102');
select throws_ok(
  $$select public.activate_due_support_plan('fe000000-0000-4000-8000-000000000303')$$,
  42501,
  null,
  'a care worker calling the RPC directly is refused -- activating a care plan is a manager act'
);
reset role;

select * from finish();
rollback;
