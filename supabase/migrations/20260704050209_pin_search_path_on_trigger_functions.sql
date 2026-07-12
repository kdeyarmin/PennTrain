create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    new.role := old.role;
    new.organization_id := old.organization_id;
    new.is_active := old.is_active;
    new.email := old.email;
  end if;
  return new;
end;
$$;

create or replace function public.protect_organization_subscription_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    new.subscription_status := old.subscription_status;
    new.package_id := old.package_id;
    new.max_facilities := old.max_facilities;
    new.max_users := old.max_users;
  end if;
  return new;
end;
<<<<<<< HEAD
$$;
=======
$$;
>>>>>>> origin/main
