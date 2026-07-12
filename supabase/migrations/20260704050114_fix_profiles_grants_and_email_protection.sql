-- Column-level GRANT can't distinguish platform_admin from other authenticated users
-- (all logged-in users share the single Postgres `authenticated` role) -- the real protection
-- is the row-level policy (own row only, unless platform_admin) plus the trigger below
-- (silently locks privileged columns to their old value unless the caller is platform_admin).
-- Simplify to a single unrestricted-by-column grant; drop the misleading column-scoped grant.
revoke update on public.profiles from authenticated;
grant update on public.profiles to authenticated;

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql as $$
begin
  if not public.is_platform_admin() then
    new.role := old.role;
    new.organization_id := old.organization_id;
    new.is_active := old.is_active;
    new.email := old.email;
  end if;
  return new;
end;
<<<<<<< HEAD
$$;
=======
$$;
>>>>>>> origin/main
