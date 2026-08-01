-- Remaining 37 anon-callable SECURITY DEFINER functions from the security advisory, triaged
-- individually (source, grants, and pg_trigger/frontend call sites all checked -- not a blanket
-- revoke). Roughly 20 were left untouched: they take a guest/portal `p_token` (validated inside
-- via app_private.find_active_resident_portal_grant, which fails closed on a missing/expired
-- token) or are genuinely public reference lookups (verify_certificate, verify_training_passport,
-- list_regulatory_updates) -- anon access there is the intended design, matching the dedicated
-- guest-portal edge functions/hooks that call them.
--
-- The remaining 17 fall into two groups fixed here, following the existing
-- revoke-from-public-and-anon-explicitly pattern (20260705141550, 20260705174457, etc.):

-- Group 1: pure trigger functions (confirmed via pg_trigger -- each fires on exactly one table's
-- trigger and is never called directly from application code). Like audit_log_trigger() and
-- handle_new_user() before them, they should never be directly RPC-callable by anyone.
revoke all on function public.notify_support_ticket_message() from public, anon, authenticated;
revoke all on function public.notify_support_ticket_status_change() from public, anon, authenticated;
revoke all on function public.protect_background_check_profile_scope() from public, anon, authenticated;
revoke all on function public.protect_incident_creation_state() from public, anon, authenticated;
revoke all on function public.protect_incident_notification_completion() from public, anon, authenticated;
revoke all on function public.stamp_scope_from_credential() from public, anon, authenticated;
revoke all on function public.stamp_support_ticket_message() from public, anon, authenticated;
revoke all on function public.touch_support_ticket_on_message() from public, anon, authenticated;
revoke all on function public.validate_incident_staff_employee_scope() from public, anon, authenticated;

-- Group 2: RPCs meant only for authenticated platform admins or ticket owners. Each already
-- checks is_platform_admin() / created_by = auth.uid() internally, so anon is rejected today --
-- but the anon grant is still needless surface area, and admin_emergency_update_course_block in
-- particular (an emergency content-override RPC) should never be reachable by an unauthenticated
-- caller regardless of what the internal check currently does.
revoke all on function public.admin_emergency_update_course_block(uuid, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.admin_emergency_update_course_block(uuid, text, text, jsonb, text, uuid) to authenticated;

-- Only ever called internally by publish_course_version(); no direct frontend RPC call exists.
revoke all on function public.assert_course_version_publish_ready(uuid) from public, anon, authenticated;

revoke all on function public.get_course_version_publish_issues(uuid) from public, anon;
grant execute on function public.get_course_version_publish_issues(uuid) to authenticated;

revoke all on function public.publish_course_version(uuid) from public, anon;
grant execute on function public.publish_course_version(uuid) to authenticated;

revoke all on function public.save_enterprise_analytics_snapshot(uuid, uuid, date, date) from public, anon;
grant execute on function public.save_enterprise_analytics_snapshot(uuid, uuid, date, date) to authenticated;

revoke all on function public.close_own_support_ticket(uuid) from public, anon;
grant execute on function public.close_own_support_ticket(uuid) to authenticated;

revoke all on function public.reopen_own_support_ticket(uuid) from public, anon;
grant execute on function public.reopen_own_support_ticket(uuid) to authenticated;

-- get_organization_billing_usage(uuid) gets both a grant fix AND a logic fix: its authorization
-- guard was `if auth.uid() is not null and not is_platform_admin() and org <> current_org_id()`,
-- so an anon caller (auth.uid() is null) skipped the whole check and could read billing usage
-- counts for any organization_id it chose to pass -- a real cross-tenant leak, not just excess
-- grant hygiene, caught by actually reading the body rather than trusting the advisory summary.
-- Rewritten to fail closed when there is no session at all, matching the
-- null_safe_authorization_guards_sweep precedent elsewhere in this codebase. Authenticated-caller
-- behavior (platform admin, or org member reading their own org) is unchanged.
revoke all on function public.get_organization_billing_usage(uuid) from public, anon;
grant execute on function public.get_organization_billing_usage(uuid) to authenticated;

create or replace function public.get_organization_billing_usage(p_organization_id uuid DEFAULT NULL::uuid)
 returns table(active_learners bigint, active_users bigint, active_residents bigint, facilities bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_org_id uuid := coalesce(p_organization_id, public.current_org_id());
begin
  if v_org_id is null then
    raise exception 'organization_id is required' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_platform_admin()
     and v_org_id <> public.current_org_id() then
    raise exception 'Cannot inspect another organization billing usage'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.employees e
      where e.organization_id = v_org_id
        and e.status = 'active'
        and not e.is_synthetic) as active_learners,
    (select count(*) from public.profiles p
      where p.organization_id = v_org_id
        and p.is_active) as active_users,
    (select count(*) from public.residents r
      where r.organization_id = v_org_id
        and r.status = 'active'
        and not r.is_synthetic) as active_residents,
    (select count(*) from public.facilities f
      where f.organization_id = v_org_id
        and f.is_active
        and not f.is_sandbox) as facilities;
end;
$function$;
