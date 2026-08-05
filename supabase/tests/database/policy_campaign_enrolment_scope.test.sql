begin;
select plan(9);

-- BACKLOG.md G33. `materialize_policy_campaign_targets` is SECURITY DEFINER, so none of
-- `policy_attestations_insert` is evaluated on the rows it writes -- it has to restate that
-- policy's rules itself, and it restated only the first of three.
--
-- The property under test is a comparison, not a behaviour in isolation: an authenticated caller
-- must not be able to create, through this function, an attestation row that the same caller
-- would be refused if they inserted it directly. `is_assigned_to_facility` is true for every
-- facility for org_admin and auditor, so the role where that comparison has teeth is
-- facility_manager, and the campaign shape that exposes it is the ordinary one --
-- `target_facility_ids => null` means "every facility in the organization", and
-- `policy_attestation_campaigns_write` is org-scoped, so a facility_manager can author it.
--
-- The cron/service path has no JWT and must be untouched by any of this: it is the mechanism that
-- keeps declarative membership true as the roster moves, and narrowing it would reintroduce the
-- half-populated campaign G25 closed.

insert into public.organizations (id, name, slug)
values ('a3000000-0000-4000-8000-000000000001', 'Enrolment Scope Org', 'enrolment-scope-org');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('a3000000-0000-4000-8000-000000000011', 'a3000000-0000-4000-8000-000000000001', 'Assigned PCH', 'PCH'),
  ('a3000000-0000-4000-8000-000000000012', 'a3000000-0000-4000-8000-000000000001', 'Unassigned PCH', 'PCH');

-- modules.compliance defaults OFF (20260724130000), and the materializer refuses an authenticated
-- caller without it. Granted explicitly so a refusal below can only be the scope rule.
insert into public.organization_entitlement_grants (
  organization_id, feature_key, decision, entitlement_value, reason
) values (
  'a3000000-0000-4000-8000-000000000001', 'modules.compliance', 'grant', 'true'::jsonb,
  'enrolment scope fixture'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated',
  'authenticated', fixture.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('a3000000-0000-4000-8000-000000000101'::uuid, 'scope-manager@test.local'),
  ('a3000000-0000-4000-8000-000000000102'::uuid, 'scope-admin@test.local')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active)
values
  ('a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000001',
   'scope-manager@test.local', 'Scope', 'Manager', 'facility_manager', true),
  ('a3000000-0000-4000-8000-000000000102', 'a3000000-0000-4000-8000-000000000001',
   'scope-admin@test.local', 'Scope', 'Admin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- The manager runs one of the organization's two facilities.
insert into public.facility_assignments (profile_id, facility_id)
values ('a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000011');

insert into public.employees (
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  ('a3000000-0000-4000-8000-000000000201', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'Ann', 'Assigned', 'Direct Care Aide', 'active', public.pa_today() - 90, 'regular', false, false, false),
  ('a3000000-0000-4000-8000-000000000202', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000012', 'Uma', 'Unassigned', 'Direct Care Aide', 'active', public.pa_today() - 90, 'regular', false, false, false);

insert into public.policy_documents (id, organization_id, title)
values ('a3000000-0000-4000-8000-000000000301', 'a3000000-0000-4000-8000-000000000001', 'Resident Rights');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values (
  'a3000000-0000-4000-8000-000000000311', 'a3000000-0000-4000-8000-000000000301',
  'a3000000-0000-4000-8000-000000000001', 1, 'scope/v1.pdf',
  'resident-rights.pdf', 'application/pdf', repeat('a', 64), 'published', now()
);

-- No target_facility_ids: every facility in the organization.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  due_date, targeting_mode, target_job_title_pattern
) values (
  'a3000000-0000-4000-8000-000000000401', 'a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000301', 'a3000000-0000-4000-8000-000000000311',
  'Resident rights -- every aide in the organization', public.pa_today() + 30,
  'declarative', '%Direct Care Aide%'
);

-- The same rule, scoped to the facility the manager actually runs.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  due_date, targeting_mode, target_facility_ids, target_job_title_pattern
) values (
  'a3000000-0000-4000-8000-000000000402', 'a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000301', 'a3000000-0000-4000-8000-000000000311',
  'Resident rights -- the assigned facility', public.pa_today() + 30,
  'declarative', array['a3000000-0000-4000-8000-000000000011']::uuid[], '%Direct Care Aide%'
);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', 'authenticated',
      'aal', p_aal,
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end
$$;

-- The cron/service context: superuser, and no JWT at all. auth.uid()/auth.jwt() are both
-- nullif('')-guarded, so an empty claims string is the same "no caller" they see from pg_cron.
create or replace function pg_temp.act_as_cron() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

------------------------------------------------------------------------------------------------
-- Shape
------------------------------------------------------------------------------------------------
select has_function(
  'app_private', 'policy_campaign_matched_employees', array['uuid'],
  'the target set is a named function, so the scope check and the insert cannot disagree'
);

select ok(
  not has_function_privilege(
    'authenticated', 'app_private.policy_campaign_matched_employees(uuid)', 'EXECUTE'),
  'and it is reachable only through the definer routines that own the rule'
);

------------------------------------------------------------------------------------------------
-- The rule policy_attestations_insert states, restated where RLS cannot reach
------------------------------------------------------------------------------------------------
select pg_temp.act_as('a3000000-0000-4000-8000-000000000101');

select throws_ok(
  $$ select public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000401') $$,
  '42501',
  null,
  'a facility manager cannot enrol employees at a facility they are not assigned to'
);

select is(
  public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000402'),
  1,
  'the same manager enrols the aide at the facility they do run'
);

select pg_temp.act_as_cron();

select is(
  (select count(*)::integer from public.policy_attestations
   where campaign_id = 'a3000000-0000-4000-8000-000000000401'),
  0,
  'the refused call wrote nothing -- not a partial enrolment of the permitted half'
);

-- A lapsed privileged session is the other rule the definer skipped. 'policy_document_admin' is
-- in the program-wide baseline, so aal1 fails this for an org_admin in any organization.
select pg_temp.act_as('a3000000-0000-4000-8000-000000000102', 'aal1');

select throws_ok(
  $$ select public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000401') $$,
  '42501',
  null,
  'and an administrator without a fresh AAL2 session cannot enrol one either'
);

------------------------------------------------------------------------------------------------
-- What must NOT change
------------------------------------------------------------------------------------------------
select pg_temp.act_as('a3000000-0000-4000-8000-000000000102');

select is(
  public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000401'),
  2,
  'an org admin still enrols the whole organization -- is_assigned_to_facility is true for them'
);

select pg_temp.act_as_cron();

-- A third campaign with the same organization-wide predicate, so the sweep is measured on a
-- campaign nobody has enrolled rather than on the org_admin's leftovers.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  due_date, targeting_mode, target_job_title_pattern
) values (
  'a3000000-0000-4000-8000-000000000403', 'a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000301', 'a3000000-0000-4000-8000-000000000311',
  'Resident rights -- swept', public.pa_today() + 30, 'declarative', '%Direct Care Aide%'
);

select is(
  public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000403'),
  2,
  'the daily sweep, which carries no JWT, still reaches every matched facility'
);

select is(
  public.materialize_policy_campaign_targets('a3000000-0000-4000-8000-000000000403'),
  0,
  'and is still idempotent on a second run'
);

select * from finish();
rollback;
