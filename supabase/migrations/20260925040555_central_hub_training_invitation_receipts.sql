-- Email is external to PostgreSQL. Reserve its exact intent before dispatch and
-- retain an unknown result across timeout/crash; a retry can observe, never resend.
create table app_private.training_admin_invitations (
 hub_user_id uuid not null, request_id uuid not null, actor_profile_id uuid not null,
 hub_session_id uuid not null, authentication_method text not null check(authentication_method in ('jwt_aal2','app_sms')),
 operation jsonb not null, dispatch_token uuid not null default gen_random_uuid(),
 invitation_id uuid, delivery_status text not null default 'unknown' check(delivery_status in ('sent','failed','unknown')),
 created_at timestamptz not null default clock_timestamp(), finalized_at timestamptz,
 primary key(hub_user_id,request_id), check((delivery_status='sent')=(invitation_id is not null))
);
alter table app_private.training_admin_invitations enable row level security;
revoke all on app_private.training_admin_invitations from public,anon,authenticated,service_role;

create function app_private.protect_training_invitation_receipt() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.finalized_at is not null
  or (to_jsonb(new)-array['invitation_id','delivery_status','finalized_at']) is distinct from
     (to_jsonb(old)-array['invitation_id','delivery_status','finalized_at'])
  or new.finalized_at is null then raise exception 'Invitation receipts retain their original intent and outcome' using errcode='42501'; end if;
 return new;
end;
$$;
create trigger protect_training_invitation_receipt before update or delete on app_private.training_admin_invitations
 for each row execute function app_private.protect_training_invitation_receipt();
revoke all on function app_private.protect_training_invitation_receipt() from public,anon,authenticated,service_role;

create function app_private.training_invitation_result(p_receipt app_private.training_admin_invitations,p_replayed boolean)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('requestId',p_receipt.request_id,'action','invitations.create',
  'organizationId',p_receipt.operation->>'organizationId','replayed',p_replayed,
  'result',jsonb_build_object('invitationId',p_receipt.invitation_id,'deliveryStatus',p_receipt.delivery_status));
$$;
revoke all on function app_private.training_invitation_result(app_private.training_admin_invitations,boolean) from public,anon,authenticated,service_role;

create function app_private.assert_training_invitation_scope(p_operation jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p jsonb:=p_operation->'parameters'; org uuid; fac uuid; employee uuid;
begin
 if not app_private.training_admin_keys(p_operation,array['domain','operation','requestId','action','organizationId','parameters','reason'])
  or p_operation->>'domain' is distinct from 'training.v1' or p_operation->>'operation' is distinct from 'apply'
  or p_operation->>'action' is distinct from 'invitations.create' or octet_length(p_operation::text)>8192
  or not app_private.training_admin_keys(p,array['role','firstName','lastName','email','facilityId','employeeId'])
  or coalesce(p->>'role','') not in ('org_admin','employee')
  or jsonb_typeof(p_operation->'reason') is distinct from 'string'
  or jsonb_typeof(p->'firstName') is distinct from 'string' or jsonb_typeof(p->'lastName') is distinct from 'string'
  or jsonb_typeof(p->'email') is distinct from 'string'
  or length(btrim(coalesce(p_operation->>'reason',''))) not between 10 and 500
  or length(btrim(coalesce(p->>'firstName',''))) not between 1 and 100
  or length(btrim(coalesce(p->>'lastName',''))) not between 1 and 100
  or length(coalesce(p->>'email','')) not between 3 and 320
  or p->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  or ((p_operation->>'reason')||(p->>'firstName')||(p->>'lastName')||(p->>'email')) ~ '[[:cntrl:]]'
  or p_operation->>'requestId' is null then raise exception 'Invalid training invitation' using errcode='22023'; end if;
 org:=(p_operation->>'organizationId')::uuid; fac:=(p->>'facilityId')::uuid; employee:=(p->>'employeeId')::uuid;
 if org is null or (p->>'role'='org_admin' and (fac is not null or employee is not null))
  or (p->>'role'='employee' and (fac is null or employee is null)) then raise exception 'Invalid training invitation scope' using errcode='22023'; end if;
 perform 1 from public.organizations where id=org and not is_demo and subscription_status<>'suspended' for share;
 if not found then raise exception 'Organization unavailable for invitation' using errcode='42501'; end if;
 -- GoTrue reuses an unconfirmed identity on re-invite. Provisioning that identity
 -- must never turn a training invitation into an organization/role transfer.
 if exists(select 1 from auth.users u left join public.profiles profile on profile.id=u.id
  where lower(u.email)=lower(btrim(p->>'email')) and u.deleted_at is null and (
   profile.id is null or profile.organization_id is distinct from org or profile.role is distinct from p->>'role'
   or profile.role='platform_admin' or (p->>'role'='employee' and exists(select 1 from public.employees linked
    where linked.profile_id=profile.id and linked.id is distinct from employee)))) then
  raise exception 'Existing identity is outside invitation scope' using errcode='40001';
 end if;
 if employee is not null then
  perform 1 from public.employees e join public.facilities f on f.id=e.facility_id and f.organization_id=e.organization_id
   where e.id=employee and e.organization_id=org and e.facility_id=fac and f.is_active
    and e.status='active' and e.profile_id is null and lower(btrim(e.email))=lower(btrim(p->>'email')) for share of e,f;
  if not found then raise exception 'Student unavailable for invitation' using errcode='42501'; end if;
 end if;
end;
$$;
revoke all on function app_private.assert_training_invitation_scope(jsonb) from public,anon,authenticated,service_role;

create function public.platform_admin_training_invitation_reserve(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
 p_authentication_method text,p_operation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt app_private.training_admin_invitations; request_id uuid:=(p_operation->>'requestId')::uuid;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 if request_id is null then raise exception 'Invalid training invitation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hub_user::text||request_id::text,0));
 select * into receipt from app_private.training_admin_invitations i where i.hub_user_id=p_hub_user and i.request_id=platform_admin_training_invitation_reserve.request_id;
 if found then
  if receipt.operation is distinct from p_operation or receipt.actor_profile_id is distinct from p_actor then raise exception 'Request ID already used' using errcode='40001'; end if;
  -- A fresh login can observe the original outcome, but never gains its dispatch token.
  return jsonb_build_object('execute',false,'receipt',app_private.training_invitation_result(receipt,true),'dispatchToken',null);
 end if;
 perform app_private.assert_training_invitation_scope(p_operation);
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 insert into app_private.training_admin_invitations(hub_user_id,request_id,actor_profile_id,hub_session_id,authentication_method,operation)
  values(p_hub_user,request_id,p_actor,p_hub_session,p_authentication_method,p_operation) returning * into receipt;
 insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
  values((p_operation->>'organizationId')::uuid,p_actor,'hub.training.invitation_reserved','organizations',p_operation->>'organizationId',
   jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'authenticationMethod',p_authentication_method,'requestId',request_id,'reason',p_operation->>'reason'));
 return jsonb_build_object('execute',true,'receipt',app_private.training_invitation_result(receipt,false),'dispatchToken',receipt.dispatch_token);
end;
$$;

create function public.platform_admin_training_invitation_authorize(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
 p_authentication_method text,p_operation jsonb,p_dispatch_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 perform 1 from app_private.training_admin_invitations i where i.hub_user_id=p_hub_user and i.request_id=(p_operation->>'requestId')::uuid
  and i.actor_profile_id=p_actor and i.hub_session_id=p_hub_session and i.authentication_method=p_authentication_method
  and i.operation=p_operation and i.dispatch_token=p_dispatch_token and i.finalized_at is null for update;
 if not found then raise exception 'Invitation reservation unavailable' using errcode='42501'; end if;
 perform app_private.assert_training_invitation_scope(p_operation);
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 return true;
end;
$$;

create function public.platform_admin_training_invitation_finalize(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_request_id uuid,p_dispatch_token uuid,p_invitation_id uuid,p_delivery_status text default 'unknown')
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt app_private.training_admin_invitations;
begin
 -- Finalization records an already-attempted external effect. Expiry or deactivation
 -- must not erase its outcome; it grants no authority to dispatch another message.
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if coalesce(p_delivery_status,'') not in ('sent','failed','unknown') or (p_delivery_status='sent') is distinct from (p_invitation_id is not null) then
  raise exception 'Invalid invitation result' using errcode='22023'; end if;
 select * into receipt from app_private.training_admin_invitations i where i.hub_user_id=p_hub_user and i.request_id=p_request_id
  and i.actor_profile_id=p_actor and i.hub_session_id=p_hub_session and i.dispatch_token=p_dispatch_token for update;
 if not found then raise exception 'Invitation reservation unavailable' using errcode='42501'; end if;
 if receipt.finalized_at is not null then
  if receipt.invitation_id is distinct from p_invitation_id or receipt.delivery_status is distinct from p_delivery_status then raise exception 'Invitation result already recorded' using errcode='40001'; end if;
  return app_private.training_invitation_result(receipt,true);
 end if;
 if p_invitation_id is not null and not exists(select 1 from public.user_invitation_lifecycle i
  where i.id=p_invitation_id and i.organization_id=(receipt.operation->>'organizationId')::uuid
   and i.created_by=p_actor and i.invited_role=receipt.operation->'parameters'->>'role'
   and lower(i.email)=lower(receipt.operation->'parameters'->>'email')
   and i.employee_id is not distinct from (receipt.operation->'parameters'->>'employeeId')::uuid
   and i.last_sent_at>=receipt.created_at-interval '5 seconds') then
  raise exception 'Invitation receipt does not match reservation' using errcode='42501';
 end if;
 update app_private.training_admin_invitations i set invitation_id=p_invitation_id,
  delivery_status=p_delivery_status,finalized_at=clock_timestamp()
  where i.hub_user_id=p_hub_user and i.request_id=p_request_id returning * into receipt;
 insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
  values((receipt.operation->>'organizationId')::uuid,p_actor,'hub.training.invitation_result','organizations',receipt.operation->>'organizationId',
   jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'requestId',p_request_id,'deliveryStatus',receipt.delivery_status,'invitationId',p_invitation_id));
 return app_private.training_invitation_result(receipt,false);
end;
$$;
revoke all on function public.platform_admin_training_invitation_reserve(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb),
 public.platform_admin_training_invitation_authorize(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,uuid),
 public.platform_admin_training_invitation_finalize(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_training_invitation_reserve(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb),
 public.platform_admin_training_invitation_authorize(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,uuid),
 public.platform_admin_training_invitation_finalize(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- Record the ordinary invitation lifecycle and the exact command result together.
-- A lost response after COMMIT is recoverable by replaying reserve; no email is retried.
create function public.platform_admin_training_invitation_record(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_request_id uuid,p_dispatch_token uuid,p_invited_user_id uuid,p_redirect_to text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt app_private.training_admin_invitations; p jsonb; invitation_id uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into receipt from app_private.training_admin_invitations i where i.hub_user_id=p_hub_user and i.request_id=p_request_id
  and i.actor_profile_id=p_actor and i.hub_session_id=p_hub_session and i.dispatch_token=p_dispatch_token for update;
 if not found then raise exception 'Invitation reservation unavailable' using errcode='42501'; end if;
 if receipt.finalized_at is not null then
  if receipt.delivery_status<>'sent' then raise exception 'Invitation result already recorded' using errcode='40001'; end if;
  return app_private.training_invitation_result(receipt,true);
 end if;
 p:=receipt.operation->'parameters';
 perform 1 from public.profiles profile join auth.users u on u.id=profile.id
  where profile.id=p_invited_user_id and profile.role=p->>'role' and profile.organization_id=(receipt.operation->>'organizationId')::uuid
   and profile.is_active and lower(u.email)=lower(p->>'email') and u.deleted_at is null
   and (p->>'role'<>'employee' or exists(select 1 from public.employees e where e.id=(p->>'employeeId')::uuid
     and e.profile_id=p_invited_user_id and e.organization_id=profile.organization_id and e.facility_id=(p->>'facilityId')::uuid)) for share of profile,u;
 if not found then raise exception 'Invited identity does not match reservation' using errcode='42501'; end if;
 invitation_id:=public.record_user_invitation_sent(p_invited_user_id,p->>'email',p->>'firstName',p->>'lastName',p->>'role',
  (receipt.operation->>'organizationId')::uuid,(p->>'employeeId')::uuid,p_redirect_to,p_actor);
 return public.platform_admin_training_invitation_finalize(p_actor,p_hub_user,p_hub_session,p_request_id,p_dispatch_token,invitation_id,'sent');
end;
$$;
revoke all on function public.platform_admin_training_invitation_record(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_training_invitation_record(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;
