-- PT-019: per-organization BAA-gated AI.
--
-- The five Anthropic-calling edge functions (analyze-state-form, compliance-copilot,
-- generate-course-curriculum, generate-resident-assessment-summary,
-- regenerate-course-block) were gated only by platform-wide platform_settings switches.
-- BAA acceptance captured at signup landed on public.signup_attempts (email_hash only,
-- no organization linkage), so nothing durably bound a signed Business Associate
-- Agreement to the organization whose PHI those functions send to the AI provider.
--
-- This migration:
--   1. Adds organizations.baa_version / baa_accepted_at / ai_features_enabled.
--   2. Guards the BAA columns from client writes the same way
--      protect_subscription_fields guards billing-contract columns.
--   3. Adds the org gate: app_private.org_ai_allowed(uuid) (truth function) and
--      public.org_ai_allowed(uuid) (caller-scoped wrapper the edge functions call).
--   4. Adds public.record_organization_signup(...) so the self-service signup path
--      stamps the accepted BAA version onto the new organization atomically.
--   5. Adds public.set_organization_baa_acceptance(uuid, text) so a platform admin
--      (AAL2) can record/clear a BAA for existing organizations -- this is how the
--      orgs that predate this migration get AI re-enabled.
--
-- The platform-wide switches stay authoritative on top of this gate: both must pass.

-- ---------------------------------------------------------------------------------
-- 1) Organization columns.
-- ---------------------------------------------------------------------------------
alter table public.organizations
  add column baa_version text,
  add column baa_accepted_at timestamptz,
  add column ai_features_enabled boolean not null default true;

comment on column public.organizations.baa_version is
  'Version identifier of the Business Associate Agreement this organization accepted. '
  'NULL = no BAA on file, which fails the per-org AI gate for non-demo organizations. '
  'Written only by the signup path (record_organization_signup) and platform admins '
  '(set_organization_baa_acceptance); the protect_baa_fields trigger reverts any other write.';
comment on column public.organizations.baa_accepted_at is
  'When the BAA in baa_version was accepted (signup timestamp or platform-admin entry).';
comment on column public.organizations.ai_features_enabled is
  'Org-admin controlled opt-out switch for AI-assisted features. Defaults to true; the '
  'BAA requirement in org_ai_allowed() still applies on top of it.';

-- ---------------------------------------------------------------------------------
-- 2) Guard the BAA columns from client writes.
--
-- Mirrors protect_subscription_fields (20260704050042): a BEFORE UPDATE trigger that
-- silently reverts the protected columns for any session that is not an authenticated
-- platform_admin. organizations_update RLS already limits UPDATE to platform admins
-- and an org's own org_admins, so this trigger's job is to stop those org_admins (and
-- any non-admin service path) from self-attesting a BAA. ai_features_enabled is
-- deliberately NOT protected -- that column is the org-admin's own toggle.
--
-- Like the subscription-field guard, this also reverts service-role UPDATEs
-- (is_platform_admin() is false when auth.uid() is null). The two sanctioned writers
-- avoid the trigger by design: record_organization_signup INSERTs (the trigger is
-- UPDATE-only) and set_organization_baa_acceptance runs with the platform admin's
-- auth context, so is_platform_admin() passes inside it.
-- ---------------------------------------------------------------------------------
create or replace function public.protect_organization_baa_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    new.baa_version := old.baa_version;
    new.baa_accepted_at := old.baa_accepted_at;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_organization_baa_fields()
  from public, anon, authenticated;

create trigger protect_baa_fields before update on public.organizations
  for each row execute function public.protect_organization_baa_fields();

-- ---------------------------------------------------------------------------------
-- 3) The gate.
--
-- app_private.org_ai_allowed is the bare truth function used by SQL callers and
-- tests. Rule: the organization exists AND ai_features_enabled AND (it is a demo
-- org OR a BAA version is on file).
--
-- Demo organizations are exempt from the BAA requirement because they carry only
-- synthetic seed data (see 20260717163659_demo_playground_seed_and_reset.sql --
-- outbound email/SMS/push is already suppressed for them), so no real PHI can reach
-- the AI provider through a demo workspace.
-- ---------------------------------------------------------------------------------
create or replace function app_private.org_ai_allowed(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_org
      and o.ai_features_enabled
      and (coalesce(o.is_demo, false) or o.baa_version is not null)
  );
$$;
revoke all on function app_private.org_ai_allowed(uuid)
  from public, anon, authenticated;

-- Caller-scoped wrapper for the edge functions (app_private is not exposed through
-- PostgREST). The five AI functions authenticate a user JWT (caller-scoped client)
-- and some also hold a service-role client; both may call this. Scope rule mirrors
-- org_feature_enabled/current_org_id: a plain authenticated caller can only ask
-- about their own organization -- any other org id returns false (fail closed, no
-- existence leak). service_role and platform admins may ask about any org.
create or replace function public.org_ai_allowed(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org is null then false
    when coalesce((select auth.jwt()) ->> 'role', '') = 'service_role'
      or public.is_platform_admin()
      or p_org = public.current_org_id()
      then app_private.org_ai_allowed(p_org)
    else false
  end;
$$;
revoke all on function public.org_ai_allowed(uuid) from public, anon;
grant execute on function public.org_ai_allowed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 4) Signup stamping.
--
-- The self-service signup edge function (supabase/functions/signup-organization)
-- previously created the organization with a bare service-role INSERT, so the BAA
-- version the person accepted never left signup_attempts. It now calls this RPC,
-- which creates the organization and stamps the accepted BAA atomically. A unique
-- slug violation propagates as SQLSTATE 23505 so the caller's existing slug retry
-- loop keeps working unchanged.
-- ---------------------------------------------------------------------------------
create or replace function public.record_organization_signup(
  p_name text,
  p_slug text,
  p_trial_ends_at timestamptz,
  p_baa_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null
     or nullif(btrim(coalesce(p_slug, '')), '') is null then
    raise exception 'organization name and slug are required' using errcode = '22023';
  end if;
  -- Signup requires accepting the current BAA (the edge function validates the exact
  -- version string); a blank version here means a caller bug, not an optional field.
  if nullif(btrim(coalesce(p_baa_version, '')), '') is null then
    raise exception 'a BAA version is required to record an organization signup'
      using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, trial_ends_at, baa_version, baa_accepted_at)
  values (btrim(p_name), btrim(p_slug), p_trial_ends_at, btrim(p_baa_version), now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_organization_signup(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_organization_signup(text, text, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------------
-- 5) Platform-admin BAA entry for existing organizations.
--
-- Auth mirrors set_billing_account_override (20260711200648): a fresh-AAL2
-- platform_admin session. Passing a version records acceptance as of now();
-- passing NULL clears the record (and with it, AI access for a non-demo org).
-- The existing audit_log AFTER UPDATE trigger on organizations records the change;
-- app.audit_reason threads the human-readable reason into that audit row.
-- ---------------------------------------------------------------------------------
create or replace function public.set_organization_baa_acceptance(
  p_org uuid,
  p_baa_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may record BAA acceptance'
      using errcode = '42501';
  end if;
  if p_baa_version is not null and nullif(btrim(p_baa_version), '') is null then
    raise exception 'BAA version must be a non-empty string, or null to clear it'
      using errcode = '22023';
  end if;

  perform set_config(
    'app.audit_reason',
    case
      when p_baa_version is null then 'platform admin cleared the recorded BAA acceptance'
      else 'platform admin recorded BAA acceptance: ' || btrim(p_baa_version)
    end,
    true
  );

  update public.organizations
  set baa_version = case when p_baa_version is null then null else btrim(p_baa_version) end,
      baa_accepted_at = case when p_baa_version is null then null else now() end,
      updated_at = now()
  where id = p_org;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_organization_baa_acceptance(uuid, text)
  from public, anon;
grant execute on function public.set_organization_baa_acceptance(uuid, text)
  to authenticated;
