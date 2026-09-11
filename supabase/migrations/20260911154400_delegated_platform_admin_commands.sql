-- Shared native access-control cores; existing interactive wrappers keep their authorization.
create or replace function app_private.set_organization_suspension_core(
  p_actor uuid,
  p_organization_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_account public.billing_accounts;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_restored text;
begin

  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  if p_suspended and v_reason is null then
    -- billing_accounts already refuses a suspension with no reason
    -- (check (billing_state <> 'suspended' or suspension_reason is not null)); raise the readable
    -- error here rather than letting the constraint speak.
    raise exception 'A suspension reason is required' using errcode = '22023';
  end if;

  select * into v_account from public.billing_accounts where organization_id = p_organization_id for update;

  if p_suspended then
    update public.billing_accounts
    set billing_state = 'suspended',
        state_source = 'manual_suspension',
        suspension_reason = v_reason,
        updated_at = now()
    where organization_id = p_organization_id;
    v_restored := 'suspended';
  else
    -- Restore what the provider says, not 'active'. A tenant suspended while its trial had
    -- lapsed comes back past_due, which is what get_effective_entitlements already believes.
    v_restored := case
      when v_account.id is null then coalesce(v_org.subscription_status, 'trial')
      when v_account.state_source = 'manual_comp'
        and (v_account.comped_until is null or v_account.comped_until > now()) then 'comped'
      else app_private.billing_state_for_provider_state(v_account.provider_state)
    end;
    if v_restored = 'suspended' then
      -- The provider itself has the subscription paused; lifting the manual hold cannot
      -- contradict that, so hand it back to Stripe's own reason.
      update public.billing_accounts
      set state_source = 'stripe',
          suspension_reason = coalesce(suspension_reason, 'Stripe subscription paused'),
          updated_at = now()
      where organization_id = p_organization_id;
    else
      update public.billing_accounts
      set billing_state = v_restored,
          state_source = case when v_restored = 'comped' then 'manual_comp' else 'stripe' end,
          suspension_reason = null,
          updated_at = now()
      where organization_id = p_organization_id;
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.organizations
  set subscription_status = v_restored,
      updated_at = now()
  where id = p_organization_id
  returning * into v_org;
  perform set_config('app.privileged_write', '', true);

  insert into public.audit_logs (organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id,
    p_actor,
    case when p_suspended then 'organization_suspended' else 'organization_reactivated' end,
    'organizations',
    p_organization_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'restoredState', v_restored,
      'previousState', v_account.billing_state
    )
  );

  return v_org;
end;
$$;

create or replace function app_private.set_billing_account_override_core(
  p_organization_id uuid,
  p_override_state text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_state text;
  v_previous_write text := coalesce(current_setting('app.privileged_write', true), '');
begin

  if p_override_state not in ('comped', 'suspended', 'provider')
     or nullif(trim(p_reason), '') is null then
    raise exception 'A valid override state and reason are required' using errcode = '22023';
  end if;
  if p_override_state = 'comped' and p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Comped access expiry must be in the future' using errcode = '22023';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  perform set_config('app.audit_reason', left(trim(p_reason), 500), true);
  select * into v_account from public.billing_accounts
  where organization_id = p_organization_id for update;
  if not found then raise exception 'Billing account not found' using errcode = 'P0002'; end if;
  v_state := case when p_override_state <> 'provider' then p_override_state
    when v_account.provider_state = 'trialing' then 'trial'
    when v_account.provider_state = 'active' then 'active'
    when v_account.provider_state = 'past_due' then 'past_due'
    when v_account.provider_state in ('canceled', 'incomplete_expired') then 'canceled'
    when v_account.provider_state = 'paused' then 'suspended'
    else 'past_due' end;
  update public.billing_accounts
  set billing_state = v_state,
      state_source = case p_override_state
        when 'comped' then 'manual_comp'
        when 'suspended' then 'manual_suspension'
        else 'stripe' end,
      comped_until = case when p_override_state = 'comped' then p_expires_at else null end,
      suspension_reason = case
        when v_state = 'suspended' then trim(p_reason) else null end,
      updated_at = now()
  where id = v_account.id;
  perform set_config('app.privileged_write', 'on', true);
  update public.organizations
  set subscription_status = v_state, updated_at = now()
  where id = p_organization_id;

  if p_override_state = 'comped' then
    -- Preserve the later native Checkout-provenance patch: an explicit comp
    -- makes the current organization tier independent of provisional Checkout.
    update public.billing_subscriptions s
    set checkout_previous_package_id = o.package_id,
        checkout_previous_plan_name = o.plan_name,
        updated_at = now()
    from public.organizations o
    where o.id = p_organization_id and s.organization_id = o.id
      and s.billing_account_id = v_account.id and s.is_provider_placeholder
      and (s.checkout_previous_package_id, s.checkout_previous_plan_name)
        is distinct from (o.package_id, o.plan_name);
  end if;
  perform set_config('app.privileged_write', v_previous_write, true);
end;
$$;

revoke all on function app_private.set_organization_suspension_core(uuid,uuid,boolean,text),
  app_private.set_billing_account_override_core(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.set_organization_suspension(p_organization_id uuid,p_suspended boolean,p_reason text default null)
returns public.organizations language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator may suspend or reactivate an organization' using errcode='42501';
  end if;
  return app_private.set_organization_suspension_core(auth.uid(),p_organization_id,p_suspended,p_reason);
end;
$$;

create or replace function public.set_billing_account_override(p_organization_id uuid,p_override_state text,p_reason text,p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may override billing state' using errcode='42501';
  end if;
  perform app_private.set_billing_account_override_core(p_organization_id,p_override_state,p_reason,p_expires_at);
end;
$$;

-- Hub JWTs are verified by the app adapter, never converted into native JWTs.
-- Only the existing server credential may invoke these narrowly scoped commands.
create table app_private.platform_admin_commands (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_profile_id uuid not null,
  hub_user_id uuid not null,
  hub_session_id uuid not null,
  action text not null check (action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride')),
  target_id uuid not null,
  parameters jsonb not null check (jsonb_typeof(parameters)='object'),
  reason text not null check (length(reason) between 10 and 500),
  before_state jsonb not null,
  after_state jsonb not null,
  state_digest text not null check (state_digest ~ '^[0-9a-f]{64}$'),
  preview_digest text not null check (preview_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  applied_at timestamptz,
  result jsonb,
  unique(hub_user_id,hub_session_id,request_id),
  check ((applied_at is null) = (result is null))
);
alter table app_private.platform_admin_commands enable row level security;
revoke all on table app_private.platform_admin_commands from public,anon,authenticated,service_role;

create function app_private.protect_platform_admin_command()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Command receipts are immutable' using errcode='42501'; end if;
  if (to_jsonb(new)-array['applied_at','result']) is distinct from (to_jsonb(old)-array['applied_at','result'])
     or old.applied_at is not null or new.applied_at is null or new.result is null then
    raise exception 'Command receipts are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger protect_platform_admin_command before update or delete on app_private.platform_admin_commands
  for each row execute function app_private.protect_platform_admin_command();
revoke all on function app_private.protect_platform_admin_command() from public,anon,authenticated,service_role;

create function app_private.assert_platform_admin_delegate(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     or p_actor is null or p_hub_user is null or p_hub_session is null then
    raise exception 'Delegation forbidden' using errcode='42501';
  end if;
  if p_session_started_at is null or p_assurance_expires_at is null
     or p_session_started_at > clock_timestamp()+interval '5 minutes'
     or p_session_started_at < clock_timestamp()-interval '480 minutes'
     or p_assurance_expires_at <= clock_timestamp()
     or p_assurance_expires_at > p_session_started_at+interval '480 minutes' then
    raise exception 'Fresh Hub session required' using errcode='42501';
  end if;
  -- Hold the mapped actor against concurrent demotion, deactivation or deletion.
  perform 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_actor and p.role='platform_admin' and p.is_active
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    for share of p,u;
  if not found then raise exception 'Delegation forbidden' using errcode='42501'; end if;
end;
$$;
revoke all on function app_private.assert_platform_admin_delegate(uuid,uuid,uuid,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;

create function app_private.platform_admin_command_plan(p_actor uuid,p_action text,p_target uuid,p_parameters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_profile public.profiles;
  v_user auth.users;
  v_org public.organizations;
  v_account public.billing_accounts;
  v_before jsonb;
  v_after jsonb;
  v_state jsonb;
  v_restored text;
  v_expires timestamptz;
begin
  if p_target is null or jsonb_typeof(p_parameters) is distinct from 'object' then
    raise exception 'Invalid command' using errcode='22023';
  end if;
  if p_action='users.setActive' then
    if p_parameters-array['active'] <> '{}'::jsonb or jsonb_typeof(p_parameters->'active') is distinct from 'boolean' then
      raise exception 'Invalid command' using errcode='22023';
    end if;
    select * into v_profile from public.profiles where id=p_target for update;
    if not found then raise exception 'Target not found' using errcode='P0002'; end if;
    if p_target=p_actor or v_profile.role='platform_admin' then
      raise exception 'Self and platform administrator targets are excluded' using errcode='42501';
    end if;
    select * into v_user from auth.users where id=p_target for update;
    if not found or v_user.deleted_at is not null then raise exception 'Target not found' using errcode='P0002'; end if;
    if (p_parameters->>'active')::boolean and
      (coalesce(v_user.is_anonymous,false) or v_user.banned_until > clock_timestamp()) then
      raise exception 'Target account cannot be activated' using errcode='42501';
    end if;
    v_before := jsonb_build_object('active',v_profile.is_active);
    v_after := jsonb_build_object('active',(p_parameters->>'active')::boolean);
    v_state := jsonb_build_object('profileUpdatedAt',v_profile.updated_at,'role',v_profile.role,
      'organization',v_profile.organization_id,'active',v_profile.is_active,'deletedAt',v_user.deleted_at,
      'bannedUntil',v_user.banned_until,'anonymous',v_user.is_anonymous,'authUpdatedAt',v_user.updated_at);
  elsif p_action in ('organizations.setSuspension','billing.setAccessOverride') then
    select * into v_org from public.organizations where id=p_target for update;
    if not found then raise exception 'Target not found' using errcode='P0002'; end if;
    select * into v_account from public.billing_accounts where organization_id=p_target for update;
    if not found then raise exception 'Billing account not found' using errcode='P0002'; end if;
    v_before := jsonb_build_object('status',v_org.subscription_status,'billingState',v_account.billing_state,
      'stateSource',v_account.state_source,'compedUntil',v_account.comped_until);
    v_after := v_before;
    if p_action='organizations.setSuspension' then
      if p_parameters-array['suspended'] <> '{}'::jsonb or jsonb_typeof(p_parameters->'suspended') is distinct from 'boolean' then
        raise exception 'Invalid command' using errcode='22023';
      end if;
      if (p_parameters->>'suspended')::boolean then
        v_after := v_after || jsonb_build_object('status','suspended','billingState','suspended','stateSource','manual_suspension');
      else
        v_restored := case when v_account.state_source='manual_comp'
          and (v_account.comped_until is null or v_account.comped_until>now()) then 'comped'
          else app_private.billing_state_for_provider_state(v_account.provider_state) end;
        v_after := v_after || jsonb_build_object('status',v_restored,
          'billingState',case when v_restored='suspended' then v_account.billing_state else v_restored end,
          'stateSource',case when v_restored='comped' then 'manual_comp' else 'stripe' end);
      end if;
    else
      if p_parameters-array['state','expiresAt'] <> '{}'::jsonb
         or not (p_parameters ?& array['state','expiresAt'])
         or coalesce(p_parameters->>'state','') not in ('comped','provider')
         or jsonb_typeof(p_parameters->'expiresAt') not in ('null','string') then
        raise exception 'Invalid command' using errcode='22023';
      end if;
      v_expires := (p_parameters->>'expiresAt')::timestamptz;
      if v_expires is not null and not isfinite(v_expires)
         or p_parameters->>'state'='provider' and v_expires is not null
         or p_parameters->>'state'='comped' and v_expires<=clock_timestamp() then
        raise exception 'Invalid access expiry' using errcode='22023';
      end if;
      -- Match the native override's state mapping exactly, including unknown=>past_due.
      v_restored := case when p_parameters->>'state'='comped' then 'comped'
        when v_account.provider_state='trialing' then 'trial'
        when v_account.provider_state='active' then 'active'
        when v_account.provider_state='past_due' then 'past_due'
        when v_account.provider_state in ('canceled','incomplete_expired') then 'canceled'
        when v_account.provider_state='paused' then 'suspended' else 'past_due' end;
      v_after := jsonb_build_object('status',v_restored,'billingState',v_restored,
        'stateSource',case when p_parameters->>'state'='comped' then 'manual_comp' else 'stripe' end,'compedUntil',v_expires);
    end if;
    v_state := v_before || jsonb_build_object('organizationUpdatedAt',v_org.updated_at,'accountUpdatedAt',v_account.updated_at,
      'providerState',v_account.provider_state,'suspensionReason',v_account.suspension_reason,
      'packageId',v_org.package_id,'planName',v_org.plan_name);
  else raise exception 'Invalid command' using errcode='22023'; end if;
  return jsonb_build_object('before',v_before,'after',v_after,
    'stateDigest',encode(extensions.digest(v_state::text,'sha256'),'hex'));
end;
$$;
revoke all on function app_private.platform_admin_command_plan(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create function app_private.platform_admin_command_changes(p_before jsonb,p_after jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field',key,'before',p_before->>key,'after',p_after->>key) order by key),'[]'::jsonb)
  from jsonb_object_keys(p_before) key;
$$;
revoke all on function app_private.platform_admin_command_changes(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.platform_admin_preview_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_request_id uuid,p_action text,p_target uuid,p_parameters jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row app_private.platform_admin_commands;
  v_plan jsonb;
  v_id uuid := gen_random_uuid();
  v_expiry timestamptz := least(clock_timestamp()+interval '5 minutes',p_assurance_expires_at);
  v_reason text := btrim(p_reason);
  v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at);
  if p_request_id is null or v_reason is null or length(v_reason) not between 10 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid command reason or request identifier' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-admin-preview:'||p_hub_session::text||':'||p_request_id::text,0));
  select * into v_row from app_private.platform_admin_commands
    where hub_user_id=p_hub_user and hub_session_id=p_hub_session and request_id=p_request_id for update;
  if found then
    if v_row.actor_profile_id<>p_actor or v_row.action is distinct from p_action or v_row.target_id is distinct from p_target
      or v_row.parameters is distinct from p_parameters or v_row.reason is distinct from v_reason then
      raise exception 'Request identifier already has different inputs' using errcode='40001';
    end if;
    if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  else
    v_plan := app_private.platform_admin_command_plan(p_actor,p_action,p_target,p_parameters);
    if p_action='billing.setAccessOverride' and p_parameters->>'state'='comped' then
      v_expiry := least(v_expiry,(p_parameters->>'expiresAt')::timestamptz);
    end if;
    if v_expiry<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
    v_digest := encode(extensions.digest(jsonb_build_object('commandId',v_id,'actor',p_actor,'hubUser',p_hub_user,
      'session',p_hub_session,'action',p_action,'target',p_target,'parameters',p_parameters,'reason',v_reason,
      'plan',v_plan,'expiresAt',v_expiry)::text,'sha256'),'hex');
    insert into app_private.platform_admin_commands(id,request_id,actor_profile_id,hub_user_id,hub_session_id,action,target_id,
      parameters,reason,before_state,after_state,state_digest,preview_digest,expires_at)
    values(v_id,p_request_id,p_actor,p_hub_user,p_hub_session,p_action,p_target,p_parameters,v_reason,
      v_plan->'before',v_plan->'after',v_plan->>'stateDigest',v_digest,v_expiry) returning * into v_row;
  end if;
  return jsonb_build_object('commandId',v_row.id,'action',v_row.action,'targetId',v_row.target_id,'reason',v_row.reason,
    'expiresAt',v_row.expires_at,'previewDigest',v_row.preview_digest,
    'changes',app_private.platform_admin_command_changes(v_row.before_state,v_row.after_state));
end;
$$;

create function public.platform_admin_apply_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_command_id uuid,p_expected_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row app_private.platform_admin_commands;
  v_plan jsonb;
  v_after jsonb;
  v_result jsonb;
  v_org uuid;
  v_applied timestamptz;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at);
  select * into v_row from app_private.platform_admin_commands where id=p_command_id for update;
  if not found then raise exception 'Preview not found' using errcode='P0002'; end if;
  if v_row.actor_profile_id<>p_actor or v_row.hub_user_id<>p_hub_user or v_row.hub_session_id<>p_hub_session then
    raise exception 'Preview belongs to another administrator session' using errcode='42501';
  end if;
  if p_expected_digest is distinct from v_row.preview_digest then raise exception 'Preview changed' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result || jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  v_plan := app_private.platform_admin_command_plan(p_actor,v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_assurance_expires_at<=clock_timestamp() then
    raise exception 'Preview expired' using errcode='40001';
  end if;
  if v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Target changed since preview' using errcode='40001';
  end if;
  perform set_config('app.request_id',v_row.id::text,true);
  perform set_config('app.correlation_id',v_row.request_id::text,true);
  perform set_config('app.audit_reason',v_row.reason,true);
  if v_row.action='users.setActive' then
    perform public.admin_update_profile(p_user_id=>v_row.target_id,p_is_active=>(v_row.parameters->>'active')::boolean);
    perform set_config('app.privileged_write','',true);
    select organization_id,jsonb_build_object('active',is_active) into v_org,v_after from public.profiles where id=v_row.target_id;
  else
    v_org := v_row.target_id;
    if v_row.action='organizations.setSuspension' then
      perform app_private.set_organization_suspension_core(p_actor,v_row.target_id,(v_row.parameters->>'suspended')::boolean,v_row.reason);
    else
      perform app_private.set_billing_account_override_core(v_row.target_id,v_row.parameters->>'state',v_row.reason,(v_row.parameters->>'expiresAt')::timestamptz);
    end if;
    select jsonb_build_object('status',o.subscription_status,'billingState',a.billing_state,'stateSource',a.state_source,'compedUntil',a.comped_until)
      into v_after from public.organizations o join public.billing_accounts a on a.organization_id=o.id where o.id=v_row.target_id;
  end if;
  -- If native behavior evolves, a stale preview implementation cannot apply a surprise.
  if v_after is distinct from v_row.after_state then raise exception 'Native result differed from preview' using errcode='40001'; end if;
  v_applied := clock_timestamp();
  v_result := jsonb_build_object('commandId',v_row.id,'action',v_row.action,'targetId',v_row.target_id,
    'appliedAt',v_applied,'replayed',false,'changes',app_private.platform_admin_command_changes(v_row.before_state,v_after));
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,old_values,new_values,metadata)
  values(v_org,p_actor,p_hub_user::text,'central_admin_command',v_row.id::text,'central_admin_command_applied','hub_delegate',
    v_row.id::text,v_row.request_id::text,v_row.reason,v_row.before_state,v_after,
    jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'nativeActorId',p_actor,'commandAction',v_row.action,
      'targetId',v_row.target_id,'unchanged',v_row.before_state=v_after));
  update app_private.platform_admin_commands set applied_at=v_applied,result=v_result where id=v_row.id;
  return v_result;
end;
$$;
revoke all on function public.platform_admin_preview_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb,text),
  public.platform_admin_apply_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_admin_preview_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb,text),
  public.platform_admin_apply_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) to service_role;
