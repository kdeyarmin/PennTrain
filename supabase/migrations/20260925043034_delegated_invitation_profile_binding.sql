-- GoTrue can reuse one unconfirmed Auth identity across concurrent invitations.
-- Bind that returned identity while holding its profile lock before invoking the
-- existing privileged provisioning writers. Pre-dispatch checks alone race.
create function public.platform_admin_training_invitation_provision(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
 p_authentication_method text,p_request_id uuid,p_dispatch_token uuid,p_invited_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt app_private.training_admin_invitations; p jsonb; org uuid; employee uuid; fac uuid;
 profile public.profiles; identity auth.users; student public.employees;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 select * into receipt from app_private.training_admin_invitations i
  where i.hub_user_id=p_hub_user and i.request_id=p_request_id and i.actor_profile_id=p_actor
   and i.hub_session_id=p_hub_session and i.authentication_method=p_authentication_method
   and i.dispatch_token=p_dispatch_token and i.finalized_at is null for update;
 if not found then raise exception 'Invitation reservation unavailable' using errcode='42501'; end if;
 p:=receipt.operation->'parameters'; org:=(receipt.operation->>'organizationId')::uuid;
 employee:=(p->>'employeeId')::uuid; fac:=(p->>'facilityId')::uuid;
 perform 1 from public.organizations where id=org and not is_demo and subscription_status<>'suspended' for share;
 if not found then raise exception 'Organization unavailable for invitation' using errcode='42501'; end if;

 select * into identity from auth.users where id=p_invited_user_id for update;
 if not found or identity.deleted_at is not null or identity.email_confirmed_at is not null
  or identity.last_sign_in_at is not null or lower(btrim(identity.email)) is distinct from lower(btrim(p->>'email')) then
  raise exception 'Invited identity is outside invitation scope' using errcode='40001'; end if;
 select * into profile from public.profiles where id=p_invited_user_id for update;
 if not found or lower(btrim(profile.email)) is distinct from lower(btrim(p->>'email'))
  or not coalesce((
   (profile.organization_id=org and profile.role=p->>'role')
   or (profile.organization_id is null and profile.role='employee' and identity.created_at>=receipt.created_at-interval '5 seconds'
    and not exists(select 1 from public.employees e where e.profile_id=p_invited_user_id)
    and not exists(select 1 from public.user_invitation_lifecycle i where i.invited_user_id=p_invited_user_id))
  ),false) then raise exception 'Invited identity is outside invitation scope' using errcode='40001'; end if;
 if exists(select 1 from public.employees e where e.profile_id=p_invited_user_id and e.id is distinct from employee) then
  raise exception 'Invited identity is linked to another student' using errcode='40001'; end if;
 if employee is not null then
  select e.* into student from public.employees e join public.facilities f on f.id=e.facility_id and f.organization_id=e.organization_id
   where e.id=employee and e.organization_id=org and e.facility_id=fac and e.status='active' and f.is_active
    and (e.profile_id is null or e.profile_id=p_invited_user_id)
    and lower(btrim(e.email))=lower(btrim(p->>'email')) for update of e;
  if not found then raise exception 'Student unavailable for invitation' using errcode='42501'; end if;
 end if;
 -- Lock waits cannot extend the original administrator assurance window.
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 profile:=public.admin_update_profile(p_user_id=>p_invited_user_id,p_role=>p->>'role',p_organization_id=>org,p_is_active=>true);
 if employee is not null and student.profile_id is null then
  profile:=public.provision_invited_employee_profile(p_invited_user_id,employee,org);
 end if;
 return to_jsonb(profile);
end;
$$;
revoke all on function public.platform_admin_training_invitation_provision(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_training_invitation_provision(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid) to service_role;
