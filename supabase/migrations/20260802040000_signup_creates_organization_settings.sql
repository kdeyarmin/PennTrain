-- Self-service signup creates organization_settings (2026-08-02)
--
-- record_organization_signup (20260725000000_org_baa_gated_ai.sql) only ever inserted
-- the organizations row. organization_settings.email_notifications_enabled and
-- .sms_notifications_enabled both default to false, and
-- enqueue_preferred_notification_delivery() treats a missing settings row the same way
-- (coalesce(..., false)), so a fresh self-service signup received no email or SMS at
-- all -- independent of, and in addition to, the pilot-cohort gate removed by
-- 20260802030000_remove_pilot_program.sql. Caught in review: flipping the release
-- flags to global doesn't make a real signup "just work" while this second gate exists.
--
-- SMS still requires per-recipient consent (profiles.sms_opt_in /
-- .sms_consent_at / .phone) on top of this org-level switch, so enabling
-- sms_notifications_enabled here does not by itself send anyone unsolicited SMS.

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

  insert into public.organization_settings (
    organization_id, email_notifications_enabled, sms_notifications_enabled
  ) values (v_id, true, true);

  return v_id;
end;
$$;
revoke all on function public.record_organization_signup(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_organization_signup(text, text, timestamptz, text)
  to service_role;
