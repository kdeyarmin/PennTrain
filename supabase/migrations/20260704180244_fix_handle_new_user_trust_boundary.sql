-- Security fix: handle_new_user() previously trusted new.raw_user_meta_data for role and
-- organization_id -- the same "data" field an unauthenticated caller can set via a plain
-- POST /auth/v1/signup request using only the public anon key. Since profiles.role and
-- profiles.organization_id are exactly the two columns every RLS policy keys off of via
-- current_role()/current_org_id()/is_platform_admin(), this let anyone self-register as
-- platform_admin (or spoof any organization_id) with zero authorization -- confirmed live:
-- the project currently has self-service email signup enabled (disable_signup=false).
--
-- auth.users.raw_app_meta_data, by contrast, can only ever be set via the Admin API using the
-- service-role key (auth.admin.createUser's app_metadata param) -- never by the public signup
-- endpoint -- so it is the correct trust boundary for these two fields. The create-user Edge
-- Function is updated in the same change to pass role/organization_id via app_metadata instead
-- of user_metadata so legitimate admin-provisioned accounts are unaffected.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role, organization_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_app_meta_data->>'role', 'employee'),
    nullif(new.raw_app_meta_data->>'organization_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
