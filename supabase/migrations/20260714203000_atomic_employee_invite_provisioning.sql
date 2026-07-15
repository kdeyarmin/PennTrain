-- Complete invited employee provisioning in one transaction. The Edge Function deliberately
-- cannot UPDATE public.employees directly because service_role table grants are narrowed; this
-- RPC is the sole service-role entrypoint and fixes the role/org to employee + the employee's
-- existing tenant before attaching the profile.
create or replace function public.provision_invited_employee_profile(
  p_user_id uuid,
  p_employee_id uuid,
  p_organization_id uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles;
  v_linked_employee_id uuid;
  v_invite_email text;
begin
  select lower(trim(p.email)) into v_invite_email
  from public.profiles p
  where p.id = p_user_id;

  if not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.organization_id = p_organization_id
      and e.profile_id is null
      and lower(trim(e.email)) = v_invite_email
  ) then
    raise exception 'employee is unavailable or the invite email does not match'
      using errcode = '23514';
  end if;

  v_profile := public.admin_update_profile(
    p_user_id => p_user_id,
    p_role => 'employee',
    p_organization_id => p_organization_id
  );

  update public.employees
  set profile_id = p_user_id
  where id = p_employee_id
    and organization_id = p_organization_id
    and profile_id is null
    and lower(trim(email)) = v_invite_email
  returning id into v_linked_employee_id;

  if v_linked_employee_id is null then
    raise exception 'employee was linked concurrently' using errcode = '23505';
  end if;

  return v_profile;
end;
$function$;

revoke all on function public.provision_invited_employee_profile(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.provision_invited_employee_profile(uuid, uuid, uuid)
to service_role;

comment on function public.provision_invited_employee_profile(uuid, uuid, uuid) is
  'Atomically applies the employee role/tenant to an invited profile and links its employee row. Trusted Edge Functions only.';
