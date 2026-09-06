-- pgTAP coverage for the automated-review findings on PR #494 (BACKLOG J84).
--
-- Two of them are authorization and determinism defects in SQL this pass wrote, and neither is
-- visible from the client: one is a SECURITY DEFINER function that skipped the facility half of
-- the policy it stands in for, the other an UPDATE ... FROM that matched two rule rows and took
-- whichever one it liked.
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(9);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('7c000000-0000-4000-8000-000000000001', 'Review Findings Org', 'review-findings-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000001', 'North Site', 'PCH'),
  ('7c000000-0000-4000-8000-000000000012', '7c000000-0000-4000-8000-000000000001', 'South Site', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '7c000000-0000-4000-8000-000000000101', 'authenticated',
  'authenticated', 'north-manager@test.local', 'x', now(), '{}', '{}', now(), now(),
  '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('7c000000-0000-4000-8000-000000000101', '7c000000-0000-4000-8000-000000000001',
   'north-manager@test.local', 'North', 'Manager', 'facility_manager', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- Assigned to North only. South is the site they have no part in.
insert into public.facility_assignments(profile_id, facility_id) values
  ('7c000000-0000-4000-8000-000000000101', '7c000000-0000-4000-8000-000000000011');

-- `training.sessions.manage` organization-wide, the way the product grants it: a scope membership
-- covering the organization plus the builtin facility-manager template. This is the premise of the
-- finding -- the permission really is org-wide for this role -- so the fixture has to reproduce it
-- or the refusals below would prove only that the permission was missing.
insert into public.enterprise_scope_memberships(id, profile_id, scope_type, organization_id, effective_from, source)
values ('7c000000-0000-4000-8000-000000000111', '7c000000-0000-4000-8000-000000000101',
        'organization', '7c000000-0000-4000-8000-000000000001', now() - interval '1 day', 'manual');
insert into public.enterprise_access_grants(id, membership_id, role_template_id, effective_from, source, reason)
select '7c000000-0000-4000-8000-000000000112', '7c000000-0000-4000-8000-000000000111', rt.id,
       now() - interval '1 day', 'manual', 'pgTAP fixture'
from public.role_templates rt where rt.code = 'builtin.facility_manager';

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values
  ('7c000000-0000-4000-8000-000000000021', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', null, 'North', 'Aide', 'Aide', 'active'),
  ('7c000000-0000-4000-8000-000000000022', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000012', null, 'South', 'Aide', 'Aide', 'active');

insert into public.courses(id, organization_id, title, status, estimated_duration_minutes, created_by) values
  ('7c000000-0000-4000-8000-000000000031', '7c000000-0000-4000-8000-000000000001',
   'Review Findings Course', 'draft', 30, '7c000000-0000-4000-8000-000000000101');
insert into public.course_versions(id, course_id, organization_id, version_number, title, status) values
  ('7c000000-0000-4000-8000-000000000032', '7c000000-0000-4000-8000-000000000031',
   '7c000000-0000-4000-8000-000000000001', 1, 'Review Findings Course', 'draft');
insert into public.course_blocks(id, course_version_id, organization_id, block_type, sort_order, title, body) values
  ('7c000000-0000-4000-8000-000000000033', '7c000000-0000-4000-8000-000000000032',
   '7c000000-0000-4000-8000-000000000001', 'text', 0, 'Lesson', '{"content":"Review findings lesson."}'::jsonb);

-- Assignments require a published course on its current version, and publishing runs a readiness
-- trigger reserved to platform admins. Same transaction-local bypass the other course fixtures use.
select set_config('app.privileged_write', 'on', true);
update public.course_versions set status = 'published', published_at = now()
where id = '7c000000-0000-4000-8000-000000000032';
update public.courses
set current_version_id = '7c000000-0000-4000-8000-000000000032', status = 'published'
where id = '7c000000-0000-4000-8000-000000000031';
select set_config('app.privileged_write', 'off', true);

insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by
) values
  ('7c000000-0000-4000-8000-000000000041', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000021',
   '7c000000-0000-4000-8000-000000000031', '7c000000-0000-4000-8000-000000000032',
   '7c000000-0000-4000-8000-000000000101'),
  ('7c000000-0000-4000-8000-000000000042', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000012', '7c000000-0000-4000-8000-000000000022',
   '7c000000-0000-4000-8000-000000000031', '7c000000-0000-4000-8000-000000000032',
   '7c000000-0000-4000-8000-000000000101');

create or replace function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id::text, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

------------------------------------------------------------------------------------------------
-- A facility-scoped role cannot reach another site's assignment through the RPC -- BACKLOG J84
------------------------------------------------------------------------------------------------
-- `course_assignments_update` requires `is_assigned_to_facility(facility_id)` of a
-- facility_manager or trainer. Both RPCs are SECURITY DEFINER, so that policy never runs, and both
-- checked only `assert_content_permission(organization_id, 'training.sessions.manage')` -- which
-- every facility_manager holds across the whole organization. The id was the only thing standing
-- between a manager at North and a learner at South.
select pg_temp.act_as('7c000000-0000-4000-8000-000000000101');

select lives_ok($$
  select public.grant_additional_quiz_attempt(
    '7c000000-0000-4000-8000-000000000041', 'The learner lost connectivity partway through the quiz.')
$$, 'a facility manager may grant another attempt at their own site');

select throws_ok($$
  select public.grant_additional_quiz_attempt(
    '7c000000-0000-4000-8000-000000000042', 'The learner lost connectivity partway through the quiz.')
$$, '42501', null, 'and may not, at a site they are not assigned to');

select throws_ok($$
  select public.cancel_course_assignment(
    '7c000000-0000-4000-8000-000000000042', 'Cancelling somebody else''s learner.')
$$, '42501', null, 'the same holds for cancelling an out-of-scope assignment');

------------------------------------------------------------------------------------------------
-- A read-only role the policy names nowhere cannot reach these RPCs either
------------------------------------------------------------------------------------------------
-- `course_assignments_update` admits org_admin, facility_manager and trainer -- not auditor. The
-- first version of this guard tested only `is_assigned_to_facility`, which is a READ predicate and
-- answers true for an auditor at every facility in their organization, so it restated half the
-- policy while its comment claimed it restated all of it. No builtin template grants an auditor
-- training.sessions.manage, so this fixture hands one the facility-manager template to reproduce
-- the case the guard is now written for: the permission present, the role still wrong.
reset role;
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '7c000000-0000-4000-8000-000000000102', 'authenticated',
  'authenticated', 'north-auditor@test.local', 'x', now(), '{}', '{}', now(), now(),
  '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('7c000000-0000-4000-8000-000000000102', '7c000000-0000-4000-8000-000000000001',
   'north-auditor@test.local', 'North', 'Auditor', 'auditor', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('7c000000-0000-4000-8000-000000000102', '7c000000-0000-4000-8000-000000000011');
-- Setting organization_id on the profile already minted a scope membership, so the grant hangs
-- off that one rather than a second membership the model refuses as a duplicate window.
insert into public.enterprise_access_grants(id, membership_id, role_template_id, effective_from, source, reason)
select '7c000000-0000-4000-8000-000000000122', m.id, rt.id,
       -- The grant has to sit inside its membership's window, and that membership was minted a
       -- moment ago rather than backdated like the manager's.
       m.effective_from, 'manual', 'pgTAP fixture'
from public.enterprise_scope_memberships m
cross join public.role_templates rt
where m.profile_id = '7c000000-0000-4000-8000-000000000102'
  and rt.code = 'builtin.facility_manager'
limit 1;

select pg_temp.act_as('7c000000-0000-4000-8000-000000000102');
select throws_ok($$
  select public.grant_additional_quiz_attempt(
    '7c000000-0000-4000-8000-000000000041', 'An auditor should not be granting attempts at all.')
$$, '42501', null, 'an auditor is refused even at a facility they are assigned to');
select throws_ok($$
  select public.cancel_course_assignment(
    '7c000000-0000-4000-8000-000000000041', 'An auditor should not be cancelling assignments.')
$$, '42501', null, 'and refused from cancelling one');

-- Read as the owner: `course_assignments_select` hides the South row from the facility manager,
-- which is the same scoping the RPC was bypassing, so checking the row from inside their session
-- would find nothing whether or not the write happened.
reset role;
select is(
  (select coalesce(additional_attempts_granted, 0) from public.course_assignments
   where id = '7c000000-0000-4000-8000-000000000042'),
  0,
  'the refused grant left the out-of-scope assignment untouched'
);

------------------------------------------------------------------------------------------------
-- Re-dating an admission uses the tenant's own rule, not whichever row the join reached first
------------------------------------------------------------------------------------------------
-- The platform ships `support_plan_30day` at admission + 30. This organization has replaced it
-- with + 45. `instantiate_resident_compliance_items` picks between them with
-- `distinct on (item_type) ... order by item_type, organization_id nulls last`;
-- `rederive_resident_compliance_due_dates` joined the rule table directly, matched BOTH rows, and
-- an UPDATE ... FROM with two matching source rows takes one of them arbitrarily.
insert into public.resident_compliance_rule_packs(
  organization_id, state, facility_type, item_type, admission_track,
  offset_basis, offset_days, is_active, instantiate_at_admission
) values (
  '7c000000-0000-4000-8000-000000000001', 'PA', 'PCH', 'support_plan_30day', 'standard',
  'after_admission', 45, true, true
);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('7c000000-0000-4000-8000-000000000051', '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000011', 'Rule', 'Precedence', date '2026-03-01', 'active');

-- No explicit instantiate call: inserting the resident already runs it.

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = '7c000000-0000-4000-8000-000000000051' and item_type = 'support_plan_30day'),
  date '2026-04-15',
  'instantiation uses the organization''s own offset, not the platform default'
);

update public.residents set admission_date = date '2026-03-10'
where id = '7c000000-0000-4000-8000-000000000051';

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = '7c000000-0000-4000-8000-000000000051' and item_type = 'support_plan_30day'),
  date '2026-04-24',
  're-derivation uses the same rule instantiation did -- admission + 45, not the platform + 30'
);

select is(
  (select count(*) from public.resident_compliance_items
   where resident_id = '7c000000-0000-4000-8000-000000000051' and item_type = 'support_plan_30day'),
  1::bigint,
  'and re-derivation still touches exactly one row for the item'
);

select * from finish();
rollback;
