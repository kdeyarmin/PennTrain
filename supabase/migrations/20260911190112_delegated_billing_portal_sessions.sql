-- Provider calls occur outside transactions. A durable lease and immutable
-- provider parameters make uncertain retries reuse the same Stripe key.
-- This increment creates portal sessions only; it never changes subscriptions.
create table app_private.billing_portal_commands (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_profile_id uuid not null,
  hub_user_id uuid not null,
  hub_session_id uuid not null,
  authentication_method text not null check (authentication_method in ('jwt_aal2','app_sms')),
  organization_id uuid not null,
  billing_account_id uuid not null,
  reason text not null check (length(reason) between 10 and 500),
  provider_parameters jsonb not null check (jsonb_typeof(provider_parameters)='object'),
  summary jsonb not null,
  preview_digest text not null check (preview_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  state text not null default 'previewed' check (state in ('previewed','executing','indeterminate','succeeded','failed')),
  first_started_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  result jsonb,
  unique(hub_user_id,hub_session_id,request_id),
  check ((state in ('succeeded','failed')) = (completed_at is not null)),
  check ((state='succeeded') = (result is not null)),
  check ((state='previewed') = (first_started_at is null))
);
alter table app_private.billing_portal_commands enable row level security;
revoke all on table app_private.billing_portal_commands from public,anon,authenticated,service_role;

create function app_private.protect_billing_portal_command()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Billing command receipts are immutable' using errcode='42501'; end if;
  if (to_jsonb(new)-array['state','first_started_at','lease_id','lease_until','completed_at','result'])
       is distinct from (to_jsonb(old)-array['state','first_started_at','lease_id','lease_until','completed_at','result'])
     or old.state in ('succeeded','failed')
     or (old.first_started_at is not null and new.first_started_at is distinct from old.first_started_at)
     or new.state='previewed' then
    raise exception 'Billing command receipts are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger protect_billing_portal_command before update or delete on app_private.billing_portal_commands
  for each row execute function app_private.protect_billing_portal_command();
revoke all on function app_private.protect_billing_portal_command() from public,anon,authenticated,service_role;

create function app_private.billing_portal_public_result(p_row app_private.billing_portal_commands,p_replayed boolean)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('commandId',p_row.id,'action','billing.portal.create','targetId',p_row.organization_id,
    'outcome',case p_row.state when 'succeeded' then 'created' when 'failed' then 'failed' else 'pending' end,
    'replayed',p_replayed,'completedAt',p_row.completed_at,
    'retryAfterSeconds',case when p_row.state not in ('succeeded','failed') then 30 else null end,
    'session',p_row.result);
$$;
revoke all on function app_private.billing_portal_public_result(app_private.billing_portal_commands,boolean)
  from public,anon,authenticated,service_role;

create function app_private.audit_billing_portal_command(p_row app_private.billing_portal_commands,p_action text,p_provider_id text)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid;
begin
  -- Retention or actor deletion after the provider call must not prevent its
  -- receipt. Surviving foreign-key identities are locked; immutable IDs remain
  -- in the private ledger and bounded audit metadata when native rows are gone.
  select id into v_actor from public.profiles where id=p_row.actor_profile_id for key share;
  select id into v_org from public.organizations where id=p_row.organization_id for key share;
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,new_values,metadata)
  values(v_org,v_actor,p_row.hub_user_id::text,'billing_session_command',p_row.id::text,p_action,'hub_delegate',
    p_row.id::text,p_row.request_id::text,p_row.reason,jsonb_build_object('stripeSessionId',p_provider_id,'kind','portal'),
    jsonb_build_object('commandId',p_row.id,'hubUserId',p_row.hub_user_id,'hubSessionId',p_row.hub_session_id,
      'authenticationMethod',p_row.authentication_method,'nativeActorId',p_row.actor_profile_id,'organizationId',p_row.organization_id));
end;
$$;
revoke all on function app_private.audit_billing_portal_command(app_private.billing_portal_commands,text,text)
  from public,anon,authenticated,service_role;

create function app_private.assert_billing_portal_source(p_row app_private.billing_portal_commands,p_configuration text,p_return_url text)
returns void language plpgsql security definer set search_path='' as $$
declare v_customer text; v_name text;
begin
  select stripe_customer_id into v_customer from public.billing_accounts
    where id=p_row.billing_account_id and organization_id=p_row.organization_id for share;
  if not found or v_customer is distinct from p_row.provider_parameters->>'customer'
    or p_configuration is distinct from p_row.provider_parameters->>'configuration'
    or p_return_url is distinct from p_row.provider_parameters->>'return_url' then
    raise exception 'Billing configuration changed' using errcode='40001';
  end if;
  select name into v_name from public.organizations where id=p_row.organization_id for share;
  if not found or v_name is distinct from p_row.summary->>'organizationName' then
    raise exception 'Organization changed' using errcode='40001';
  end if;
end;
$$;
revoke all on function app_private.assert_billing_portal_source(app_private.billing_portal_commands,text,text)
  from public,anon,authenticated,service_role;

create function public.platform_admin_preview_billing_portal(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_request_id uuid,p_target uuid,p_reason text,p_provider_parameters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row app_private.billing_portal_commands;
  v_account public.billing_accounts;
  v_name text;
  v_id uuid := gen_random_uuid();
  v_summary jsonb;
  v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if p_request_id is null or p_target is null or p_reason is null or length(btrim(p_reason)) not between 10 and 500
    or p_reason ~ '[[:cntrl:]]' or jsonb_typeof(p_provider_parameters) is distinct from 'object'
    or (p_provider_parameters - array['customer','configuration','return_url']) <> '{}'::jsonb
    or coalesce(p_provider_parameters->>'customer','') !~ '^cus_[A-Za-z0-9]+$'
    or coalesce(p_provider_parameters->>'configuration','') !~ '^bpc_[A-Za-z0-9]+$'
    or coalesce(p_provider_parameters->>'return_url','') !~ '^https://[^/?#@]+/admin/enterprise$' then
    raise exception 'Invalid billing command' using errcode='22023';
  end if;
  -- Serialize retries even when their UUID row has not been inserted yet.
  perform pg_advisory_xact_lock(hashtextextended('billing-portal:'||p_hub_user::text||':'||p_hub_session::text||':'||p_request_id::text,0));
  select * into v_row from app_private.billing_portal_commands
    where hub_user_id=p_hub_user and hub_session_id=p_hub_session and request_id=p_request_id;
  if found then
    if v_row.actor_profile_id<>p_actor or v_row.authentication_method<>p_authentication_method
      or v_row.organization_id<>p_target or v_row.reason<>btrim(p_reason)
      or v_row.provider_parameters<>p_provider_parameters or v_row.expires_at<=clock_timestamp() then
      raise exception 'Billing preview conflict' using errcode='40001';
    end if;
  else
    select name into v_name from public.organizations where id=p_target for share;
    if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
    select * into v_account from public.billing_accounts where organization_id=p_target for share;
    if not found or v_account.stripe_customer_id is distinct from p_provider_parameters->>'customer' then
      raise exception 'Billing customer changed' using errcode='40001';
    end if;
    v_summary := jsonb_build_object('kind','portal','organizationName',v_name,
      'providerCustomerId',v_account.stripe_customer_id,'providerConfigurationId',p_provider_parameters->>'configuration',
      'returnPath','/admin/enterprise');
    v_digest := encode(extensions.digest(convert_to(jsonb_build_object('id',v_id,'actor',p_actor,'hub',p_hub_user,
      'session',p_hub_session,'method',p_authentication_method,'target',p_target,'reason',btrim(p_reason),
      'account',v_account.id,'parameters',p_provider_parameters,'summary',v_summary)::text,'UTF8'),'sha256'),'hex');
    insert into app_private.billing_portal_commands(id,request_id,actor_profile_id,hub_user_id,hub_session_id,authentication_method,
      organization_id,billing_account_id,reason,provider_parameters,summary,preview_digest,expires_at)
    values(v_id,p_request_id,p_actor,p_hub_user,p_hub_session,p_authentication_method,p_target,v_account.id,btrim(p_reason),
      p_provider_parameters,v_summary,v_digest,clock_timestamp()+interval '5 minutes') returning * into v_row;
  end if;
  return jsonb_build_object('commandId',v_row.id,'action','billing.portal.create','targetId',v_row.organization_id,
    'reason',v_row.reason,'expiresAt',v_row.expires_at,'previewDigest',v_row.preview_digest,'summary',v_row.summary);
end;
$$;

create function public.platform_admin_claim_billing_portal(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_command_id uuid,p_expected_digest text,p_configuration text,p_return_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row app_private.billing_portal_commands;
  v_replayed boolean;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  select * into v_row from app_private.billing_portal_commands where id=p_command_id for update;
  if not found then raise exception 'Billing command not found' using errcode='P0002'; end if;
  if v_row.actor_profile_id<>p_actor or v_row.hub_user_id<>p_hub_user or v_row.hub_session_id<>p_hub_session
    or v_row.authentication_method<>p_authentication_method then raise exception 'Billing command forbidden' using errcode='42501'; end if;
  if v_row.preview_digest is distinct from p_expected_digest then raise exception 'Billing preview changed' using errcode='40001'; end if;
  perform app_private.assert_billing_portal_source(v_row,p_configuration,p_return_url);
  if v_row.state in ('succeeded','failed') then
    return jsonb_build_object('kind','result','data',app_private.billing_portal_public_result(v_row,true));
  end if;
  if v_row.state in ('executing','indeterminate') and v_row.lease_until>clock_timestamp() then
    return jsonb_build_object('kind','result','data',app_private.billing_portal_public_result(v_row,true));
  end if;
  if (v_row.first_started_at is null and v_row.expires_at<=clock_timestamp())
    or v_row.first_started_at<=clock_timestamp()-interval '23 hours' then
    -- Stripe may prune idempotency keys after 24h. Never issue this operation
    -- with a new key, or retry it after our shorter safe replay window.
    raise exception 'Billing preview expired or requires reconciliation' using errcode='40001';
  end if;
  v_replayed := v_row.first_started_at is not null;
  update app_private.billing_portal_commands set state='executing',first_started_at=coalesce(first_started_at,clock_timestamp()),
    lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds' where id=v_row.id returning * into v_row;
  if not v_replayed then
    perform app_private.audit_billing_portal_command(v_row,'billing_portal_requested',null);
  end if;
  return jsonb_build_object('kind','execute','commandId',v_row.id,'targetId',v_row.organization_id,'leaseId',v_row.lease_id,
    'idempotencyKey','carebase:portal:'||v_row.id::text,'values',v_row.provider_parameters,'replayed',v_replayed);
end;
$$;

create function public.platform_admin_finish_billing_portal(p_command_id uuid,p_lease_id uuid,p_outcome text,p_session jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_row app_private.billing_portal_commands;
begin
  -- A claimed server operation may finish after the operator is revoked. Persist
  -- its receipt regardless; retrieving it separately requires current authority.
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into v_row from app_private.billing_portal_commands where id=p_command_id for update;
  if not found or v_row.lease_id is distinct from p_lease_id or v_row.state<>'executing' then
    raise exception 'Billing lease changed' using errcode='40001';
  end if;
  if p_outcome='succeeded' then
    if jsonb_typeof(p_session) is distinct from 'object'
      or (p_session-array['kind','id','url','expiresAt','livemode'])<>'{}'::jsonb
      or not (p_session ?& array['kind','id','url','expiresAt','livemode'])
      or p_session->>'kind' is distinct from 'portal' or coalesce(p_session->>'id','') !~ '^bps_[A-Za-z0-9]+$'
      or coalesce(p_session->>'url','') !~ '^https://billing[.]stripe[.]com/p/session/[A-Za-z0-9_/-]+([?][^[:cntrl:]#]*)?$'
      or jsonb_typeof(p_session->'livemode') is distinct from 'boolean'
      or p_session->'expiresAt' is distinct from 'null'::jsonb then
      raise exception 'Invalid provider result' using errcode='22023';
    end if;
  elsif p_outcome is null or p_outcome not in ('failed','indeterminate') or p_session is not null then
    raise exception 'Invalid provider outcome' using errcode='22023';
  end if;
  update app_private.billing_portal_commands set state=p_outcome,result=p_session,
    completed_at=case when p_outcome in ('succeeded','failed') then clock_timestamp() else null end,
    lease_until=case when p_outcome='indeterminate' then lease_until else null end where id=v_row.id;
  if p_outcome in ('succeeded','failed') then
    perform app_private.audit_billing_portal_command(v_row,
      case when p_outcome='succeeded' then 'billing_portal_created' else 'billing_portal_rejected' end,p_session->>'id');
  end if;
end;
$$;

create function public.platform_admin_read_billing_portal_result(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_command_id uuid,p_expected_digest text,p_replayed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.billing_portal_commands;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  select * into v_row from app_private.billing_portal_commands where id=p_command_id;
  if not found then raise exception 'Billing command not found' using errcode='P0002'; end if;
  if v_row.actor_profile_id<>p_actor or v_row.hub_user_id<>p_hub_user or v_row.hub_session_id<>p_hub_session
    or v_row.authentication_method<>p_authentication_method then raise exception 'Billing command forbidden' using errcode='42501'; end if;
  if v_row.preview_digest is distinct from p_expected_digest then raise exception 'Billing preview changed' using errcode='40001'; end if;
  perform app_private.assert_billing_portal_source(v_row,v_row.provider_parameters->>'configuration',v_row.provider_parameters->>'return_url');
  return app_private.billing_portal_public_result(v_row,coalesce(p_replayed,false));
end;
$$;

revoke all on function public.platform_admin_preview_billing_portal(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb),
  public.platform_admin_claim_billing_portal(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,text,text),
  public.platform_admin_finish_billing_portal(uuid,uuid,text,jsonb),
  public.platform_admin_read_billing_portal_result(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.platform_admin_preview_billing_portal(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb),
  public.platform_admin_claim_billing_portal(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,text,text),
  public.platform_admin_finish_billing_portal(uuid,uuid,text,jsonb),
  public.platform_admin_read_billing_portal_result(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean)
  to service_role;
