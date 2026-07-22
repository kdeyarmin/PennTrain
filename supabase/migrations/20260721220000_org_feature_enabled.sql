-- Client-callable, caller-scoped read of an app_feature_flags entitlement (via
-- evaluate_feature_access) so the UI can gate a pilot feature the same way the backend commands do,
-- instead of rendering controls that only fail with 42501 for a non-entitled org. Mirrors
-- feature_release_active(), the equivalent thin wrapper for the separate release-flag system.
-- Only exposes the caller's own organization's entitlement (current_org_id()); it takes no org id.
create or replace function public.org_feature_enabled(p_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (public.evaluate_feature_access(public.current_org_id(), p_feature_key) ->> 'allowed')::boolean,
    false
  );
$function$;
revoke all on function public.org_feature_enabled(text) from public, anon;
grant execute on function public.org_feature_enabled(text) to authenticated, service_role;
