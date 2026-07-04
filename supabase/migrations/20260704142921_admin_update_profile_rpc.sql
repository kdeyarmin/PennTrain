-- protect_profile_privileged_fields() only bypasses for is_platform_admin(), which resolves via
-- auth.uid() -- a service-role Postgres connection (used by the create-user/admin-update-user Edge
-- Functions) has no auth.uid(), so a direct UPDATE from that context would have role/organization_id/
-- is_active/email silently reverted to their OLD values, exactly the bug this project already caught
-- and fixed once for issue_certificate() in Group C. Applying the same fix: add the
-- app.privileged_write GUC escape hatch (set only by the trusted RPC below, txn-local via
-- set_config(..., true)) alongside the existing is_platform_admin() check.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not (public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on') then
    new.role := old.role;
    new.organization_id := old.organization_id;
    new.is_active := old.is_active;
    new.email := old.email;
  end if;
  return new;
end;
$$;

-- admin_update_profile(): the ONLY sanctioned way to change profiles.role/organization_id/is_active/
-- email/first_name/last_name outside of a real platform_admin session. This function has NO internal
-- authorization check of its own -- the calling Edge Function (admin-update-user) is responsible for
-- verifying the caller's role/org permissions in Deno *before* invoking it. Accordingly it is NOT
-- granted to anon/authenticated at all -- only to service_role, so it is reachable exclusively from a
-- trusted Edge Function holding the service-role key, never directly from a browser client.
create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_organization_id uuid default null,
  p_is_active boolean default null,
  p_email text default null
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.profiles;
begin
  perform set_config('app.privileged_write', 'on', true);
  update public.profiles set
    first_name = coalesce(p_first_name, first_name),
    last_name = coalesce(p_last_name, last_name),
    role = coalesce(p_role, role),
    organization_id = coalesce(p_organization_id, organization_id),
    is_active = coalesce(p_is_active, is_active),
    email = coalesce(p_email, email)
  where id = p_user_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'profile % not found', p_user_id using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$function$;

revoke all on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text) to service_role;
