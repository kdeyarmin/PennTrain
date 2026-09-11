-- Native and Hub callers share this organization reservation. No network calls
-- occur in SQL. Provider uncertainty never releases a payable reservation.
create table app_private.checkout_native_grants (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null, session_id uuid not null,
  organization_id uuid not null, request_key text not null, request_parameters jsonb not null,
  authority_snapshot jsonb not null, expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp()
);
create table app_private.checkout_intents (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null, principal_id uuid not null, session_id uuid not null,
  authentication_method text not null check(authentication_method in ('native_session','jwt_aal2','app_sms')),
  request_key text not null, organization_id uuid not null, reason text not null,
  action text not null default 'billing.checkout.create' check(action in ('billing.checkout.create','billing.checkout.recover')),
  provider_parameters jsonb not null, source_snapshot jsonb not null, summary jsonb not null,
  preview_digest text not null, expires_at timestamptz not null, reservation_id uuid,
  created_at timestamptz not null default clock_timestamp(), unique(principal_id,session_id,request_key)
);
create table app_private.checkout_reservations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  first_intent_id uuid not null references app_private.checkout_intents(id),
  current_intent_id uuid not null references app_private.checkout_intents(id),
  provider_parameters jsonb not null, state text not null check(state in ('executing','indeterminate','open','complete','expired','failed','closed')),
  create_attempts integer not null default 0 check(create_attempts>=0), subscription_status text,
  first_started_at timestamptz not null default clock_timestamp(), lease_id uuid not null, lease_until timestamptz,
  session jsonb, provider_checked_at timestamptz, provider_available boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
alter table app_private.checkout_intents add foreign key(reservation_id) references app_private.checkout_reservations(id);
create unique index checkout_one_payable_reservation on app_private.checkout_reservations(organization_id)
  where state not in ('expired','failed','closed');
alter table app_private.checkout_native_grants enable row level security;
alter table app_private.checkout_intents enable row level security;
alter table app_private.checkout_reservations enable row level security;
revoke all on app_private.checkout_native_grants,app_private.checkout_intents,app_private.checkout_reservations from public,anon,authenticated,service_role;

create function app_private.protect_checkout_record() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Checkout evidence is immutable' using errcode='42501'; end if;
  if tg_table_name='checkout_native_grants' then raise exception 'Checkout evidence is immutable' using errcode='42501'; end if;
  if tg_table_name='checkout_intents' then
    if (to_jsonb(new)-'reservation_id') is distinct from (to_jsonb(old)-'reservation_id') or old.reservation_id is not null then
      raise exception 'Checkout evidence is immutable' using errcode='42501'; end if;
  elsif tg_table_name='checkout_reservations' then
    if (to_jsonb(new)-array['state','lease_id','lease_until','current_intent_id','session','provider_checked_at','provider_available','create_attempts','subscription_status'])
      is distinct from (to_jsonb(old)-array['state','lease_id','lease_until','current_intent_id','session','provider_checked_at','provider_available','create_attempts','subscription_status'])
      or (new.current_intent_id is distinct from old.current_intent_id and new.lease_id is not distinct from old.lease_id)
      or old.state in ('expired','failed','closed') or new.create_attempts not between old.create_attempts and old.create_attempts+1
      or (old.session is not null and (new.session->>'id' is distinct from old.session->>'id'
        or new.session->>'livemode' is distinct from old.session->>'livemode'))
      or (old.session->>'status'='complete' and new.session->>'status' is distinct from 'complete') then
      raise exception 'Checkout evidence is immutable' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
create trigger protect_checkout_native_grant before update or delete on app_private.checkout_native_grants for each row execute function app_private.protect_checkout_record();
create trigger protect_checkout_intent before update or delete on app_private.checkout_intents for each row execute function app_private.protect_checkout_record();
create trigger protect_checkout_reservation before update or delete on app_private.checkout_reservations for each row execute function app_private.protect_checkout_record();

create function app_private.checkout_native_authority_snapshot(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',p.role,'organizationId',p.organization_id,'organizationStatus',o.subscription_status,
   'isDemo',o.is_demo,'policy',to_jsonb(s)) from public.profiles p left join public.organizations o on o.id=p.organization_id
   left join public.identity_security_policies s on s.organization_id=p.organization_id where p.id=p_actor;
$$;

create function public.authorize_native_checkout(p_organization_id uuid,p_request_key text,p_parameters jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles; v_session auth.sessions; v_id uuid; v_expires timestamptz; v_max_minutes integer:=480;
begin
  if coalesce(auth.jwt()->>'role','')<>'authenticated' or not public.identity_assurance_is_current('billing_admin') then
    raise exception 'Fresh native billing authority required' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and is_active;
  if not found or not exists(select 1 from auth.users where id=v_profile.id and deleted_at is null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=clock_timestamp())) then
    raise exception 'Current native billing authority required' using errcode='42501'; end if;
  if v_profile.role<>'platform_admin' and (v_profile.organization_id is distinct from p_organization_id
    or (v_profile.role<>'org_admin' and not public.has_effective_permission('billing.account.manage','organization',p_organization_id,clock_timestamp()))) then
    raise exception 'Checkout organization forbidden' using errcode='42501'; end if;
  select * into v_session from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=v_profile.id;
  if not found or (v_session.not_after is not null and v_session.not_after<=clock_timestamp())
    or v_session.created_at>clock_timestamp()+interval '5 minutes' then raise exception 'Current native session required' using errcode='42501'; end if;
  if p_request_key is null or length(p_request_key) not between 1 and 200 or p_request_key ~ '[[:cntrl:]]'
    or (p_parameters is distinct from '{"action":"recover"}'::jsonb and (jsonb_typeof(p_parameters) is distinct from 'object' or p_parameters-array['packageId','billingInterval','successUrl','cancelUrl']<>'{}'::jsonb
    or not(p_parameters ?& array['packageId','billingInterval','successUrl','cancelUrl'])
    or coalesce(p_parameters->>'packageId','') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(p_parameters->>'billingInterval','') not in ('month','year')
    or length(coalesce(p_parameters->>'successUrl','')) not between 1 and 2048
    or length(coalesce(p_parameters->>'cancelUrl','')) not between 1 and 2048)) then
    raise exception 'Invalid native checkout intent' using errcode='22023'; end if;
  v_expires:=least(clock_timestamp()+interval '90 seconds',coalesce(v_session.not_after,'infinity'::timestamptz));
  if public.identity_operation_requires_aal2('billing_admin') then
    if v_profile.role<>'platform_admin' then select coalesce(max_privileged_session_minutes,480) into v_max_minutes
      from public.identity_security_policies where organization_id=v_profile.organization_id; end if;
    v_expires:=least(v_expires,v_session.created_at+make_interval(mins=>coalesce(v_max_minutes,480)));
  end if;
  insert into app_private.checkout_native_grants(actor_id,session_id,organization_id,request_key,request_parameters,authority_snapshot,expires_at)
    values(v_profile.id,v_session.id,p_organization_id,p_request_key,p_parameters,
      app_private.checkout_native_authority_snapshot(v_profile.id),v_expires) returning id into v_id;
  return v_id;
end;
$$;

create function app_private.assert_checkout_grant(p_grant uuid,p_actor uuid) returns app_private.checkout_native_grants
language plpgsql security definer set search_path='' as $$
declare v_grant app_private.checkout_native_grants; v_profile public.profiles;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into v_grant from app_private.checkout_native_grants where id=p_grant and actor_id=p_actor and expires_at>clock_timestamp();
  if not found then raise exception 'Native checkout grant expired' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=p_actor and is_active;
  if not found or not exists(select 1 from auth.users where id=p_actor and deleted_at is null and not coalesce(is_anonymous,false)
      and (banned_until is null or banned_until<=clock_timestamp()))
    or not exists(select 1 from auth.sessions where id=v_grant.session_id and user_id=p_actor and (not_after is null or not_after>clock_timestamp()))
    or exists(select 1 from public.session_lock_events where profile_id=p_actor and session_id=v_grant.session_id::text and unlocked_at is null)
    or app_private.checkout_native_authority_snapshot(p_actor) is distinct from v_grant.authority_snapshot
    or (exists(select 1 from app_private.sms_mfa_accounts where profile_id=p_actor) and not app_private.sms_mfa_is_current(p_actor,v_grant.session_id)) then
    raise exception 'Native checkout authority changed' using errcode='42501'; end if;
  if v_profile.role<>'platform_admin' and (v_profile.organization_id is distinct from v_grant.organization_id
    or (v_profile.role<>'org_admin' and not app_private.profile_has_effective_permission(p_actor,'billing.account.manage','organization',v_grant.organization_id,clock_timestamp()))) then
    raise exception 'Checkout organization forbidden' using errcode='42501';
  end if;
  return v_grant;
end;
$$;

create function app_private.assert_checkout_plan(p_org uuid,p_values jsonb,p_snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_account jsonb; v_price jsonb; v_org jsonb; v_package uuid; v_usage record; v_quantity numeric; v_measured numeric; v_trial integer;
begin
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or p_values->>'mode' is distinct from 'subscription'
    or p_values-array['mode','client_reference_id','customer','customer_email','payment_method_collection','success_url','cancel_url','line_items','metadata','subscription_data']<>'{}'::jsonb
    or p_values->>'payment_method_collection' is distinct from 'always'
    or p_values->>'client_reference_id' is distinct from p_org::text
    or p_values#>>'{metadata,organization_id}' is distinct from p_org::text
    or p_values->'metadata' is distinct from p_values#>'{subscription_data,metadata}'
    or coalesce(p_values#>>'{metadata,billing_interval}','') not in ('month','year')
    or jsonb_array_length(p_values->'line_items') is distinct from 1
    or coalesce(p_values#>>'{line_items,0,price}','') !~ '^price_[A-Za-z0-9]+$'
    or coalesce(p_values#>>'{line_items,0,quantity}','') !~ '^[0-9]+$' then
    raise exception 'Invalid checkout provider plan' using errcode='22023'; end if;
  v_package:=(p_values#>>'{metadata,package_id}')::uuid;
  if exists(select 1 from public.billing_subscriptions where organization_id=p_org and
    (billing_state in ('trial','active','grace','past_due') or (stripe_subscription_id is not null and
      (provider_status is null or provider_status not in ('canceled','incomplete_expired'))))) then
    raise exception 'Existing subscription requires portal' using errcode='40001'; end if;
  select jsonb_build_object('id',id,'stripe_customer_id',stripe_customer_id,'billing_state',billing_state) into v_account
    from public.billing_accounts where organization_id=p_org for share;
  select jsonb_build_object('stripe_price_id',p.stripe_price_id,'currency',p.currency,'interval_count',p.interval_count,'billing_metric',p.billing_metric,'pricing_model',p.pricing_model,
    'minimum_quantity',p.minimum_quantity,'maximum_quantity',p.maximum_quantity,'packages',jsonb_build_object('is_active',k.is_active,'trial_days',k.trial_days))
    into v_price from public.package_billing_prices p join public.packages k on k.id=p.package_id
    where p.package_id=v_package and p.is_active and p.is_primary and k.is_active
      and p.recurring_interval=p_values#>>'{metadata,billing_interval}' and p.stripe_price_id is not null
      and p.effective_from<=clock_timestamp() and (p.effective_to is null or p.effective_to>clock_timestamp())
    order by p.effective_from desc,p.id desc limit 1 for share of p,k;
  select jsonb_build_object('trial_ends_at',trial_ends_at) into v_org from public.organizations where id=p_org;
  if v_price is null or coalesce(v_account,'null'::jsonb) is distinct from p_snapshot->'account'
    or v_price is distinct from p_snapshot->'price'
    or (v_org->>'trial_ends_at')::timestamptz is distinct from (p_snapshot#>>'{organization,trial_ends_at}')::timestamptz
    or v_price->>'stripe_price_id' is distinct from p_values#>>'{line_items,0,price}'
    or v_account->>'stripe_customer_id' is distinct from p_values->>'customer' then
    raise exception 'Checkout source changed' using errcode='40001'; end if;
  v_quantity:=(p_values#>>'{line_items,0,quantity}')::numeric;
  if v_price->>'billing_metric'='flat' or v_price->>'pricing_model'='flat' then v_measured:=1;
  else
    select * into v_usage from public.get_organization_billing_usage(p_org);
    v_measured:=case v_price->>'billing_metric' when 'active_learner' then v_usage.active_learners when 'active_user' then v_usage.active_users
      when 'active_resident' then v_usage.active_residents when 'facility' then v_usage.facilities else null end;
    if v_measured is null then raise exception 'Checkout usage unavailable' using errcode='40001'; end if;
    v_measured:=greatest(v_measured,(v_price->>'minimum_quantity')::numeric);
  end if;
  if v_quantity is distinct from v_measured or v_quantity not between 1 and 9007199254740991
    or ((v_price->>'maximum_quantity')::numeric is not null and v_quantity>(v_price->>'maximum_quantity')::numeric)
    or p_values#>>'{metadata,billing_metric}' is distinct from v_price->>'billing_metric' then
    raise exception 'Checkout quantity changed' using errcode='40001'; end if;
  v_trial:=least(greatest(coalesce((v_price#>>'{packages,trial_days}')::integer,0),0),
    greatest(coalesce(ceil(extract(epoch from ((v_org->>'trial_ends_at')::timestamptz-clock_timestamp()))/86400)::integer,0),0));
  if coalesce((p_values#>>'{subscription_data,trial_period_days}')::integer,0)<>v_trial then
    raise exception 'Checkout trial changed' using errcode='40001'; end if;
end;
$$;

create function app_private.create_checkout_intent(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_request text,p_org uuid,
  p_reason text,p_values jsonb,p_snapshot jsonb,p_authority_expires timestamptz) returns app_private.checkout_intents
language plpgsql security definer set search_path='' as $$
declare v_row app_private.checkout_intents; v_id uuid:=gen_random_uuid(); v_name text; v_summary jsonb;
begin
  if p_request is null or length(p_request) not between 1 and 200 or p_reason is null or length(btrim(p_reason)) not between 10 and 500
    or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid checkout intent' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout-intent:'||p_principal::text||':'||p_session::text||':'||p_request,0));
  select * into v_row from app_private.checkout_intents where principal_id=p_principal and session_id=p_session and request_key=p_request;
  if found then
    if v_row.action<>'billing.checkout.create' or v_row.actor_id<>p_actor or v_row.authentication_method<>p_method or v_row.organization_id<>p_org
      or v_row.provider_parameters is distinct from p_values or v_row.reason<>btrim(p_reason) then
      raise exception 'Checkout request changed' using errcode='40001'; end if;
    return v_row;
  end if;
  perform app_private.assert_checkout_plan(p_org,p_values,p_snapshot);
  select name into v_name from public.organizations where id=p_org;
  v_summary:=jsonb_build_object('kind','checkout','organizationName',v_name,'packageId',p_values#>>'{metadata,package_id}',
    'billingInterval',p_values#>>'{metadata,billing_interval}','intervalCount',(p_snapshot#>>'{price,interval_count}')::integer,
    'currency',p_snapshot#>>'{price,currency}','billingMetric',p_values#>>'{metadata,billing_metric}',
    'quantity',(p_values#>>'{line_items,0,quantity}')::numeric,'providerPriceId',p_values#>>'{line_items,0,price}',
    'providerCustomerId',p_values->>'customer','trialDays',coalesce((p_values#>>'{subscription_data,trial_period_days}')::integer,0));
  insert into app_private.checkout_intents(id,actor_id,principal_id,session_id,authentication_method,request_key,organization_id,reason,
    provider_parameters,source_snapshot,summary,preview_digest,expires_at)
  values(v_id,p_actor,p_principal,p_session,p_method,p_request,p_org,btrim(p_reason),p_values,p_snapshot,v_summary,
    encode(extensions.digest(jsonb_build_object('id',v_id,'actor',p_actor,'principal',p_principal,'session',p_session,'method',p_method,
      'request',p_request,'org',p_org,'reason',btrim(p_reason),'action','billing.checkout.create','values',p_values,'source',p_snapshot)::text,'sha256'),'hex'),
    least(clock_timestamp()+interval '5 minutes',p_authority_expires)) returning * into v_row;
  return v_row;
end;
$$;


-- Recovery creates a separate current-authority intent. It copies the original
-- reservation terms and never resolves today's catalog or enables a POST.
create function app_private.checkout_can_start(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $
 select exists(select 1 from public.organizations where id=p_org)
   and not exists(select 1 from app_private.checkout_reservations where organization_id=p_org and state not in ('expired','failed','closed'))
   and not exists(select 1 from public.billing_subscriptions where organization_id=p_org and
     (billing_state in ('trial','active','grace','past_due') or (stripe_subscription_id is not null and
       (provider_status is null or provider_status not in ('canceled','incomplete_expired')))));
$;
create function app_private.recover_checkout_intent(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_request text,p_org uuid,
 p_reason text,p_authority_expires timestamptz) returns app_private.checkout_intents
language plpgsql security definer set search_path='' as $
declare v_row app_private.checkout_intents; v_original app_private.checkout_intents; r app_private.checkout_reservations;
 v_id uuid:=gen_random_uuid();
begin
 if p_request is null or length(p_request) not between 1 and 200 or p_reason is null or length(btrim(p_reason)) not between 10 and 500
   or p_reason ~ '[[:cntrl:]]' then raise exception 'Invalid checkout recovery' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-intent:'||p_principal::text||':'||p_session::text||':'||p_request,0));
 perform 1 from public.organizations where id=p_org for update;
 if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
 select * into v_row from app_private.checkout_intents where principal_id=p_principal and session_id=p_session and request_key=p_request;
 if found then
   if v_row.action<>'billing.checkout.recover' or v_row.actor_id<>p_actor or v_row.authentication_method<>p_method
     or v_row.organization_id<>p_org or v_row.reason<>btrim(p_reason) then raise exception 'Checkout request changed' using errcode='40001'; end if;
   if v_row.reservation_id is null and exists(select 1 from app_private.checkout_reservations where organization_id=p_org
     and state not in ('expired','failed','closed')) then raise exception 'Checkout reservation changed' using errcode='40001'; end if;
   return v_row;
 end if;
 select * into r from app_private.checkout_reservations where organization_id=p_org and state not in ('expired','failed','closed') for update;
 if found then select * into strict v_original from app_private.checkout_intents where id=r.first_intent_id; end if;
 insert into app_private.checkout_intents(id,actor_id,principal_id,session_id,authentication_method,request_key,organization_id,reason,action,
   provider_parameters,source_snapshot,summary,preview_digest,expires_at,reservation_id)
 values(v_id,p_actor,p_principal,p_session,p_method,p_request,p_org,btrim(p_reason),'billing.checkout.recover',
   coalesce(r.provider_parameters,'{}'::jsonb),coalesce(v_original.source_snapshot,'{}'::jsonb),coalesce(v_original.summary,'{}'::jsonb),
   encode(extensions.digest(jsonb_build_object('id',v_id,'actor',p_actor,'principal',p_principal,'session',p_session,'method',p_method,
     'request',p_request,'org',p_org,'reason',btrim(p_reason),'action','billing.checkout.recover','reservation',r.id,
     'values',r.provider_parameters,'source',v_original.source_snapshot)::text,'sha256'),'hex'),
   least(clock_timestamp()+interval '5 minutes',p_authority_expires),r.id) returning * into v_row;
 return v_row;
end;
$;
create function app_private.checkout_preview(p_intent app_private.checkout_intents) returns jsonb
language sql stable security definer set search_path='' as $
 select jsonb_build_object('commandId',p_intent.id,'action',p_intent.action,'targetId',p_intent.organization_id,'reason',p_intent.reason,
   'expiresAt',p_intent.expires_at,'previewDigest',p_intent.preview_digest,'summary',p_intent.summary);
$;
create function app_private.checkout_recovery_preview(p_intent app_private.checkout_intents) returns jsonb
language sql stable security definer set search_path='' as $
 select jsonb_build_object('preview',case when p_intent.reservation_id is null then null else app_private.checkout_preview(p_intent) end,
   'canStartNewCheckout',app_private.checkout_can_start(p_intent.organization_id));
$;

create function app_private.checkout_handoff_allowed(p_intent app_private.checkout_intents) returns boolean
language sql stable security definer set search_path='' as $
 select coalesce((select p.stripe_price_id=p_intent.provider_parameters#>>'{line_items,0,price}'
   and p.currency=p_intent.source_snapshot#>>'{price,currency}'
   and p.interval_count=(p_intent.source_snapshot#>>'{price,interval_count}')::integer
   from public.package_billing_prices p join public.packages k on k.id=p.package_id
   where p.package_id=(p_intent.provider_parameters#>>'{metadata,package_id}')::uuid and p.is_active and p.is_primary and k.is_active
     and p.recurring_interval=p_intent.provider_parameters#>>'{metadata,billing_interval}' and p.stripe_price_id is not null
     and p.effective_from<=statement_timestamp() and (p.effective_to is null or p.effective_to>statement_timestamp())
   order by p.effective_from desc,p.id desc limit 1),false);
$;

create function app_private.checkout_public_result(p_intent app_private.checkout_intents,p_replayed boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_customer text; r app_private.checkout_reservations; v_can_start boolean; v_handoff boolean;
begin
  if not exists(select 1 from public.organizations where id=p_intent.organization_id) then
    raise exception 'Checkout reservation unavailable' using errcode='40001'; end if;
  v_can_start:=app_private.checkout_can_start(p_intent.organization_id);
  -- An expired intent that never acquired a reservation provably never dispatched.
  -- Its original apply is permanently unavailable; checking it never creates a lease.
  if p_intent.reservation_id is null and p_intent.expires_at<=clock_timestamp() then
    return jsonb_build_object('commandId',p_intent.id,'action',p_intent.action,'targetId',p_intent.organization_id,
      'outcome','failed','replayed',p_replayed,'checkedAt',clock_timestamp(),'providerStatus',null,'availability','available',
      'canStartNewCheckout',v_can_start,'retryAfterSeconds',null,'session',null);
  end if;
  select * into r from app_private.checkout_reservations where id=p_intent.reservation_id;
  if not found then
    raise exception 'Checkout reservation unavailable' using errcode='40001'; end if;
  select stripe_customer_id into v_customer from public.billing_accounts where organization_id=p_intent.organization_id;
  if v_customer is distinct from p_intent.provider_parameters->>'customer'
    and (r.session is null or v_customer is distinct from r.session->>'customerId') then
    raise exception 'Checkout customer changed' using errcode='40001'; end if;
  v_handoff:=r.provider_available and r.state='open' and (r.session->>'expiresAt')::timestamptz>clock_timestamp()
    and app_private.checkout_handoff_allowed(p_intent);
  return jsonb_build_object('commandId',p_intent.id,'action',p_intent.action,'targetId',p_intent.organization_id,
    'outcome',case when r.state in ('executing','indeterminate') or not r.provider_available
      or (r.state='open' and not v_handoff) then 'pending' when r.state='closed' then 'complete' else r.state end,
    'replayed',p_replayed,'checkedAt',r.provider_checked_at,'providerStatus',r.session->>'status',
    'availability',case when r.provider_available then 'available' else 'unavailable' end,
    'canStartNewCheckout',r.state in ('expired','failed','closed') and v_can_start,
    'retryAfterSeconds',case when r.state in ('executing','indeterminate') or not r.provider_available
      or (r.state='open' and not v_handoff) then 30 else null end,
    'session',case when v_handoff
      then r.session-array['customerId','subscriptionId','status'] else null end);
end;
$$;

create function app_private.claim_checkout(p_intent app_private.checkout_intents,p_check_only boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.checkout_reservations; v_replayed boolean:=p_intent.reservation_id is not null; v_customer text;
begin
  perform 1 from public.organizations where id=p_intent.organization_id for update;
  if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
  select * into p_intent from app_private.checkout_intents where id=p_intent.id for update;
  if p_intent.action='billing.checkout.recover' and (not coalesce(p_check_only,false) or p_intent.reservation_id is null) then
    raise exception 'Checkout recovery is observation only' using errcode='42501'; end if;
  if p_intent.reservation_id is null then
    if p_check_only and p_intent.expires_at<=clock_timestamp() then
      return jsonb_build_object('kind','result','data',app_private.checkout_public_result(p_intent,true)); end if;
    if p_check_only or p_intent.expires_at<=clock_timestamp() then raise exception 'Checkout preview expired or not applied' using errcode='40001'; end if;
    perform app_private.assert_checkout_plan(p_intent.organization_id,p_intent.provider_parameters,p_intent.source_snapshot);
    select * into v_row from app_private.checkout_reservations where organization_id=p_intent.organization_id and state not in ('expired','failed','closed') for update;
    if found then
      if v_row.provider_parameters is distinct from p_intent.provider_parameters then raise exception 'Organization already has a checkout reservation' using errcode='40001'; end if;
      v_replayed:=true;
    else
      insert into app_private.checkout_reservations(organization_id,first_intent_id,current_intent_id,provider_parameters,state,lease_id,lease_until)
        values(p_intent.organization_id,p_intent.id,p_intent.id,p_intent.provider_parameters,'executing',gen_random_uuid(),clock_timestamp()) returning * into v_row;
    end if;
    update app_private.checkout_intents set reservation_id=v_row.id where id=p_intent.id returning * into p_intent;
  else select * into v_row from app_private.checkout_reservations where id=p_intent.reservation_id for update;
  end if;
  select stripe_customer_id into v_customer from public.billing_accounts where organization_id=p_intent.organization_id for share;
  if v_customer is distinct from p_intent.provider_parameters->>'customer'
    and (v_row.session is null or v_customer is distinct from v_row.session->>'customerId') then
    raise exception 'Checkout customer changed' using errcode='40001'; end if;
  if v_row.state in ('expired','failed','closed') or v_row.lease_until>clock_timestamp() then
    return jsonb_build_object('kind','result','data',app_private.checkout_public_result(p_intent,true)); end if;
  if v_row.session is null and (p_check_only or v_row.first_started_at<=clock_timestamp()-interval '23 hours') then
    -- No provider identifier exists to GET. A new key is never safe here.
    return jsonb_build_object('kind','result','data',app_private.checkout_public_result(p_intent,true)); end if;
  if v_row.session is null then
    perform app_private.assert_checkout_plan(p_intent.organization_id,p_intent.provider_parameters,p_intent.source_snapshot);
  end if;
  update app_private.checkout_reservations set state='executing',lease_id=gen_random_uuid(),current_intent_id=p_intent.id,lease_until=clock_timestamp()+interval '30 seconds',
    create_attempts=create_attempts+case when session is null then 1 else 0 end,
    provider_available=false where id=v_row.id returning * into v_row;
  return jsonb_build_object('kind',case when v_row.session is null then 'create' else 'check' end,'reservationId',v_row.id,
    'commandId',p_intent.id,'targetId',p_intent.organization_id,'leaseId',v_row.lease_id,
    'idempotencyKey','carebase:checkout:'||v_row.id::text,'values',v_row.provider_parameters,'priorSession',v_row.session,'replayed',v_replayed,
    'firstDispatch',v_row.session is null and v_row.create_attempts=1,'priceConfiguration',p_intent.source_snapshot->'price');
end;
$$;

create function public.platform_admin_preview_checkout(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,
 p_assurance_expires_at timestamptz,p_authentication_method text,p_request_id uuid,p_target uuid,p_reason text,p_provider_parameters jsonb,p_source_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.checkout_intents;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 v_row:=app_private.create_checkout_intent(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_request_id::text,p_target,p_reason,p_provider_parameters,p_source_snapshot,p_assurance_expires_at);
 return app_private.checkout_preview(v_row);
end;
$$;
create function public.platform_admin_claim_checkout(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,
 p_assurance_expires_at timestamptz,p_authentication_method text,p_command_id uuid,p_expected_digest text,p_check_only boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.checkout_intents;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 select * into v_row from app_private.checkout_intents where id=p_command_id;
 if not found or v_row.actor_id is distinct from p_actor or v_row.principal_id is distinct from p_hub_user or v_row.session_id is distinct from p_hub_session
   or v_row.authentication_method is distinct from p_authentication_method then raise exception 'Checkout intent forbidden' using errcode='42501'; end if;
 if v_row.preview_digest is distinct from p_expected_digest then raise exception 'Checkout preview changed' using errcode='40001'; end if;
 return app_private.claim_checkout(v_row,coalesce(p_check_only,true));
end;
$$;
create function public.claim_native_checkout(p_grant_id uuid,p_actor uuid,p_provider_parameters jsonb,p_source_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_grant app_private.checkout_native_grants; v_row app_private.checkout_intents;
begin
 v_grant:=app_private.assert_checkout_grant(p_grant_id,p_actor);
 if v_grant.request_parameters->>'packageId' is distinct from p_provider_parameters#>>'{metadata,package_id}'
   or v_grant.request_parameters->>'billingInterval' is distinct from p_provider_parameters#>>'{metadata,billing_interval}'
   or v_grant.request_parameters->>'successUrl' is distinct from p_provider_parameters->>'success_url'
   or v_grant.request_parameters->>'cancelUrl' is distinct from p_provider_parameters->>'cancel_url' then
   raise exception 'Native checkout grant does not match plan' using errcode='42501'; end if;
 v_row:=app_private.create_checkout_intent(p_actor,p_actor,v_grant.session_id,'native_session',v_grant.request_key,v_grant.organization_id,
   'Native administrator requested Checkout',p_provider_parameters,p_source_snapshot,v_grant.expires_at);
 return app_private.claim_checkout(v_row,false);
end;
$$;

create function public.finish_checkout_reservation(p_reservation_id uuid,p_lease_id uuid,p_outcome text,p_session jsonb,p_subscription_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_row app_private.checkout_reservations; v_intent app_private.checkout_intents; v_actor uuid; v_org uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into v_row from app_private.checkout_reservations where id=p_reservation_id for update;
 if not found or v_row.state<>'executing' or v_row.lease_id is distinct from p_lease_id then raise exception 'Checkout lease changed' using errcode='40001'; end if;
 if p_outcome is null or p_outcome not in ('open','complete','expired','closed','failed','indeterminate')
   or (p_subscription_status is not null and p_subscription_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')) then
   raise exception 'Invalid checkout observation' using errcode='22023'; end if;
 if p_session is not null then
   if jsonb_typeof(p_session) is distinct from 'object' or p_session-array['kind','id','url','expiresAt','livemode','customerId','subscriptionId','status']<>'{}'::jsonb
     or not(p_session ?& array['kind','id','url','expiresAt','livemode','customerId','subscriptionId','status'])
     or p_session->>'kind' is distinct from 'checkout' or coalesce(p_session->>'status','') not in ('open','complete','expired')
     or (p_outcome<>'indeterminate' and p_session->>'status' is distinct from case when p_outcome='closed' then 'complete' else p_outcome end)
     or coalesce(p_session->>'id','') !~ '^cs_(test|live)_[A-Za-z0-9]+$' or length(p_session->>'id')>255
     or jsonb_typeof(p_session->'livemode') is distinct from 'boolean'
     or (left(p_session->>'id',8)='cs_live_') is distinct from (p_session->>'livemode')::boolean
     or jsonb_typeof(p_session->'expiresAt') is distinct from 'string'
     or (p_session->>'status'='open' and (coalesce(p_session->>'url','') !~ '^https://checkout[.]stripe[.]com/c/pay/cs_[A-Za-z0-9_]+(#[A-Za-z0-9%._~!$&()*+,;=:/?@-]+)?$'
       or split_part(substring(p_session->>'url' from length('https://checkout.stripe.com/c/pay/')+1),'#',1) is distinct from p_session->>'id'
       or p_session->>'url' ~ '%([^0-9a-fA-F]|[0-9a-fA-F]([^0-9a-fA-F]|$)|$)'
       or length(p_session->>'url')>4096 or (p_outcome='open' and (p_session->>'expiresAt')::timestamptz<=clock_timestamp())))
     or (p_session->>'status'<>'open' and p_session->'url' is distinct from 'null'::jsonb)
     or (p_session->>'customerId' is not null and p_session->>'customerId' !~ '^cus_[A-Za-z0-9]+$')
     or (p_session->>'subscriptionId' is not null and p_session->>'subscriptionId' !~ '^sub_[A-Za-z0-9]+$')
     or not isfinite((p_session->>'expiresAt')::timestamptz)
     or (v_row.session is not null and p_session->>'id' is distinct from v_row.session->>'id') then
     raise exception 'Invalid checkout provider result' using errcode='22023'; end if;
   if (v_row.provider_parameters->>'customer' is not null and p_session->>'customerId' is distinct from v_row.provider_parameters->>'customer')
     or (v_row.session->>'customerId' is not null and p_session->>'customerId' is distinct from v_row.session->>'customerId')
     or (v_row.session->>'subscriptionId' is not null and p_session->>'subscriptionId' is distinct from v_row.session->>'subscriptionId') then
     raise exception 'Checkout provider association changed' using errcode='40001'; end if;
   if p_outcome='closed' and (p_subscription_status is null or p_subscription_status not in ('canceled','incomplete_expired')
     or p_session->>'subscriptionId' is null or p_session->>'customerId' is null) then
     raise exception 'Subscription closure is not verified' using errcode='22023'; end if;
 elsif p_outcome is null or p_outcome not in ('failed','indeterminate')
   or (p_outcome='failed' and (v_row.session is not null or v_row.create_attempts<>1)) then raise exception 'Invalid checkout outcome' using errcode='22023'; end if;
 update app_private.checkout_reservations set state=p_outcome,session=coalesce(p_session,session),
   provider_checked_at=case when p_outcome<>'indeterminate' then clock_timestamp() else provider_checked_at end,
   provider_available=p_outcome<>'indeterminate',subscription_status=p_subscription_status,
   lease_until=case when p_outcome='indeterminate' then lease_until else null end where id=v_row.id;
 select * into v_intent from app_private.checkout_intents where id=v_row.current_intent_id;
 select id into v_actor from public.profiles where id=v_intent.actor_id for key share;
 select id into v_org from public.organizations where id=v_row.organization_id for key share;
 insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,request_id,reason,new_values,metadata)
 values(v_org,v_actor,v_intent.principal_id::text,'checkout_reservation',v_row.id::text,'checkout_provider_observed',
   case when v_intent.authentication_method='native_session' then 'native_editor' else 'hub_delegate' end,v_intent.id::text,v_intent.reason,
   jsonb_build_object('state',p_outcome,'sessionId',p_session->>'id'),jsonb_build_object('nativeActorId',v_intent.actor_id,
    'organizationId',v_row.organization_id,'sessionId',v_intent.session_id,'authenticationMethod',v_intent.authentication_method));
end;
$$;

create function public.read_native_checkout_result(p_grant_id uuid,p_actor uuid,p_command_id uuid,p_replayed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_grant app_private.checkout_native_grants; v_intent app_private.checkout_intents;
begin
 v_grant:=app_private.assert_checkout_grant(p_grant_id,p_actor);
 select * into v_intent from app_private.checkout_intents where id=p_command_id and actor_id=p_actor and principal_id=p_actor
   and session_id=v_grant.session_id and organization_id=v_grant.organization_id and request_key=v_grant.request_key and authentication_method='native_session';
 if not found or (v_intent.action='billing.checkout.recover') is distinct from (v_grant.request_parameters='{"action":"recover"}'::jsonb) then
   raise exception 'Native checkout receipt forbidden' using errcode='42501'; end if;
 return app_private.checkout_public_result(v_intent,coalesce(p_replayed,false));
end;
$$;
create function public.platform_admin_read_checkout_result(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,
 p_assurance_expires_at timestamptz,p_authentication_method text,p_command_id uuid,p_expected_digest text,p_replayed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_intent app_private.checkout_intents;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 select * into v_intent from app_private.checkout_intents where id=p_command_id;
 if not found or v_intent.actor_id is distinct from p_actor or v_intent.principal_id is distinct from p_hub_user
   or v_intent.session_id is distinct from p_hub_session or v_intent.authentication_method is distinct from p_authentication_method
   or v_intent.preview_digest is distinct from p_expected_digest then raise exception 'Checkout receipt forbidden' using errcode='42501'; end if;
 return app_private.checkout_public_result(v_intent,coalesce(p_replayed,false));
end;
$$;

revoke all on function app_private.protect_checkout_record(),app_private.checkout_native_authority_snapshot(uuid),app_private.assert_checkout_grant(uuid,uuid),app_private.assert_checkout_plan(uuid,jsonb,jsonb),
 app_private.create_checkout_intent(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb,timestamptz),app_private.checkout_public_result(app_private.checkout_intents,boolean),
 app_private.claim_checkout(app_private.checkout_intents,boolean),public.authorize_native_checkout(uuid,text,jsonb),
 public.platform_admin_preview_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb,jsonb),
 public.platform_admin_claim_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean),public.claim_native_checkout(uuid,uuid,jsonb,jsonb),
 public.finish_checkout_reservation(uuid,uuid,text,jsonb,text),public.read_native_checkout_result(uuid,uuid,uuid,boolean),
 public.platform_admin_read_checkout_result(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.authorize_native_checkout(uuid,text,jsonb) to authenticated;
grant execute on function public.platform_admin_preview_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb,jsonb),
 public.platform_admin_claim_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean),public.claim_native_checkout(uuid,uuid,jsonb,jsonb),
 public.finish_checkout_reservation(uuid,uuid,text,jsonb,text),public.read_native_checkout_result(uuid,uuid,uuid,boolean),
 public.platform_admin_read_checkout_result(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text,boolean) to service_role;


create function public.platform_admin_recover_checkout(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,
 p_assurance_expires_at timestamptz,p_authentication_method text,p_request_id uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $
declare v_row app_private.checkout_intents;
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 v_row:=app_private.recover_checkout_intent(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_request_id::text,p_target,p_reason,p_assurance_expires_at);
 return app_private.checkout_recovery_preview(v_row);
end;
$;
create function public.recover_native_checkout(p_grant_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $
declare v_grant app_private.checkout_native_grants; v_row app_private.checkout_intents;
begin
 v_grant:=app_private.assert_checkout_grant(p_grant_id,p_actor);
 if v_grant.request_parameters is distinct from '{"action":"recover"}'::jsonb then
   raise exception 'Native checkout grant does not match recovery' using errcode='42501'; end if;
 v_row:=app_private.recover_checkout_intent(p_actor,p_actor,v_grant.session_id,'native_session',v_grant.request_key,v_grant.organization_id,
   'Native administrator requested Checkout recovery',v_grant.expires_at);
 return app_private.checkout_recovery_preview(v_row);
end;
$;
create function public.claim_native_checkout_recovery(p_grant_id uuid,p_actor uuid,p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $
declare v_grant app_private.checkout_native_grants; v_row app_private.checkout_intents;
begin
 v_grant:=app_private.assert_checkout_grant(p_grant_id,p_actor);
 select * into v_row from app_private.checkout_intents where id=p_command_id and actor_id=p_actor and principal_id=p_actor
   and session_id=v_grant.session_id and organization_id=v_grant.organization_id and request_key=v_grant.request_key
   and authentication_method='native_session' and action='billing.checkout.recover';
 if not found or v_grant.request_parameters is distinct from '{"action":"recover"}'::jsonb then
   raise exception 'Native checkout recovery forbidden' using errcode='42501'; end if;
 return app_private.claim_checkout(v_row,true);
end;
$;
revoke all on function app_private.checkout_can_start(uuid),app_private.checkout_handoff_allowed(app_private.checkout_intents),app_private.recover_checkout_intent(uuid,uuid,uuid,text,text,uuid,text,timestamptz),
 app_private.checkout_preview(app_private.checkout_intents),app_private.checkout_recovery_preview(app_private.checkout_intents),
 public.platform_admin_recover_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text),
 public.recover_native_checkout(uuid,uuid),public.claim_native_checkout_recovery(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_admin_recover_checkout(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text),
 public.recover_native_checkout(uuid,uuid),public.claim_native_checkout_recovery(uuid,uuid,uuid) to service_role;

create function public.platform_admin_checkout_catalog(p_search text default '',p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_pattern text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_search is null or length(p_search)>100 or p_search ~ '[[:cntrl:]*]' or p_limit is null or p_limit not between 1 and 50
   or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid catalog bounds' using errcode='22023'; end if;
 v_pattern:='%'||replace(replace(replace(btrim(p_search),'\','\\'),'%','\%'),'_','\_')||'%';
 with choices as materialized (
   select distinct on(p.package_id,p.recurring_interval) p.*,k.name as package_name,k.description as package_description,k.trial_days
   from public.package_billing_prices p join public.packages k on k.id=p.package_id
   where p.is_active and p.is_primary and k.is_active and p.effective_from<=statement_timestamp()
     and (p.effective_to is null or p.effective_to>statement_timestamp()) and k.name ilike v_pattern escape '\'
   -- Match the native planner's effective mapped price; show an unmapped row
   -- only when this package/cadence has no callable provider mapping at all.
   order by p.package_id,p.recurring_interval,(p.stripe_price_id is null),p.effective_from desc,p.id desc
 ), page as (
   select * from choices order by package_name,package_id,recurring_interval,id limit p_limit offset p_offset
 ) select jsonb_build_object('source','application_database','providerAvailability','not_checked','total',(select count(*) from choices),
   'limit',p_limit,'offset',p_offset,'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'packageId',package_id,
    'name',left(package_name,500),'description',left(package_description,4000),'status','active',
    'availability',case when stripe_price_id is null then 'unmapped' else 'mapped' end,'providerPriceId',stripe_price_id,
    'billingInterval',recurring_interval,'intervalCount',interval_count,'billingMetric',billing_metric,'pricingModel',pricing_model,
    'currency',currency,'baseAmountMinor',base_amount_cents::text,'unitAmountMinor',unit_amount_cents::text,
    'includedQuantity',included_quantity,'minimumQuantity',minimum_quantity,'maximumQuantity',maximum_quantity,'trialDays',trial_days)
    order by package_name,package_id,recurring_interval,id),'[]'::jsonb)) into v_result from page;
 return v_result;
end;
$$;
revoke all on function public.platform_admin_checkout_catalog(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.platform_admin_checkout_catalog(text,integer,integer) to service_role;
