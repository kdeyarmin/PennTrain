-- Signup rollback + Checkout completion (2026-08-13)
--
-- Two Stripe-signup defects:
--
-- 1. signup-organization creates the org via record_organization_signup, which
--    fires provision_enterprise_organization and writes
--    enterprise_organization_memberships (ON DELETE RESTRICT). On invite or
--    profile failure the handler then `delete from organizations`, which the
--    restrict FK rejects. The invited user is deleted, the org is not, and a
--    retry creates another tenant. rollback_organization_signup tears down
--    the restrict rows first and refuses to touch a tenant that already has
--    a Stripe customer or subscription.
--
-- 2. process_stripe_billing_event treated checkout.session.completed as a
--    no-op besides upserting billing_accounts. Package and subscription were
--    applied only on customer.subscription.*. If that event is delayed or
--    not configured, a customer who just paid stays on the in-app trial
--    (and can be locked out when trial_ends_at lapses). The completed
--    session now stamps package_id from metadata and inserts a subscription
--    stub when the session already carries a sub_ id (Basil/Clover). Existing
--    subscription rows are never overwritten from checkout.

create or replace function public.rollback_organization_signup(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null then
    raise exception 'organization_id is required' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.billing_accounts a
    where a.organization_id = p_organization_id
      and a.stripe_customer_id is not null
  ) or exists (
    select 1 from public.billing_subscriptions s
    where s.organization_id = p_organization_id
  ) then
    raise exception 'cannot roll back an organization that already has billing state'
      using errcode = '42501';
  end if;

  delete from public.enterprise_organization_memberships
  where organization_id = p_organization_id;

  delete from public.enterprise_scope_memberships
  where organization_id = p_organization_id
     or profile_id in (
       select p.id from public.profiles p where p.organization_id = p_organization_id
     );

  -- profiles.organization_id has no ON DELETE clause (NO ACTION). A leftover
  -- org_admin profile from a failed invite would block the org delete.
  -- privileged_write is required to move organization_id.
  perform set_config('app.privileged_write', 'on', true);
  update public.profiles
  set organization_id = null
  where organization_id = p_organization_id;

  delete from public.organizations
  where id = p_organization_id;
end;
$$;

revoke all on function public.rollback_organization_signup(uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_organization_signup(uuid)
  to service_role;

create or replace function public.process_stripe_billing_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_payload jsonb,
  p_payload_sha256 text,
  p_correlation_id text
)
returns table (
  was_duplicate boolean,
  was_applied boolean,
  was_stale boolean,
  resolved_organization_id uuid,
  canonical_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object jsonb := p_payload #> '{data,object}';
  v_org_id uuid;
  v_customer_id text;
  v_subscription_id text;
  v_package_id uuid;
  v_account_id uuid;
  v_subscription_pk uuid;
  v_provider_status text;
  v_state text;
  v_count integer := 0;
  v_applied boolean := false;
  v_stale boolean := false;
  v_existing app_private.stripe_billing_events%rowtype;
begin
  -- An invalid envelope is a caller (edge function) bug, not a poison Stripe
  -- event: there may not even be a usable event id to key a receipt on.
  if nullif(trim(p_event_id), '') is null
     or nullif(trim(p_event_type), '') is null
     or p_event_created_at is null
     or p_payload is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(trim(p_correlation_id), '') is null then
    raise exception 'Invalid signed Stripe event envelope' using errcode = '22023';
  end if;

  insert into app_private.stripe_billing_events (
    event_id, event_type, event_created_at, payload_sha256, payload,
    correlation_id, signature_verified_at, provider_api_version
  ) values (
    p_event_id, p_event_type, p_event_created_at, p_payload_sha256, p_payload,
    left(p_correlation_id, 200), clock_timestamp(),
    left(nullif(trim(p_payload->>'api_version'), ''), 40)
  ) on conflict (event_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    select * into v_existing
    from app_private.stripe_billing_events e where e.event_id = p_event_id;
    if v_existing.payload_sha256 <> p_payload_sha256 then
      -- Event-id reuse with different content will never succeed on retry.
      -- Record the rejected replay on the durable receipt (the original event's
      -- status stays authoritative) and answer as a duplicate so the webhook
      -- returns 200 and Stripe stops redelivering the poison payload.
      update app_private.stripe_billing_events
      set processing_error = left(
            coalesce(processing_error || ' | ', '')
              || 'Rejected replay: event id reused with different payload sha256 '
              || p_payload_sha256,
            500)
      where event_id = p_event_id;
      return query select true, false, false,
        v_existing.organization_id,
        (select a.billing_state from public.billing_accounts a
         where a.organization_id = v_existing.organization_id);
      return;
    end if;
    return query select true, false,
      v_existing.processing_status = 'stale',
      v_existing.organization_id,
      (select a.billing_state from public.billing_accounts a
       where a.organization_id = v_existing.organization_id);
    return;
  end if;

  -- Customer is a string id on unexpanded webhook objects. Expanded objects
  -- (or some Basil/Clover payloads) send {"id":"cus_..."}; read both.
  v_customer_id := nullif(coalesce(
    case when jsonb_typeof(v_object->'customer') = 'string' then v_object->>'customer' end,
    v_object #>> '{customer,id}'), '');
  -- Post-Basil, an invoice references its subscription through
  -- parent.subscription_details.subscription; older payloads used the top-level
  -- subscription field. Prefer the post-Basil location and treat the top-level
  -- field as a legacy fallback. Subscription events still identify themselves by id.
  v_subscription_id := nullif(coalesce(
    v_object #>> '{parent,subscription_details,subscription}',
    v_object->>'subscription',
    case when p_event_type like 'customer.subscription.%' then v_object->>'id' end), '');
  v_org_id := app_private.try_uuid(v_object #>> '{metadata,organization_id}');
  if v_org_id is null then
    v_org_id := app_private.try_uuid(v_object->>'client_reference_id');
  end if;
  if v_org_id is null and v_customer_id is not null then
    select a.organization_id into v_org_id
    from public.billing_accounts a where a.stripe_customer_id = v_customer_id;
  end if;
  if v_org_id is null and v_subscription_id is not null then
    select s.organization_id into v_org_id
    from public.billing_subscriptions s
    where s.stripe_subscription_id = v_subscription_id;
  end if;

  update app_private.stripe_billing_events
  set organization_id = v_org_id
  where event_id = p_event_id;

  if v_org_id is null then
    update app_private.stripe_billing_events
    set processing_status = 'ignored', processed_at = now(),
        processing_error = 'No tenant mapping in signed event'
    where event_id = p_event_id;
    return query select false, false, false, null::uuid, null::text;
    return;
  end if;

  -- Processing runs inside a nested block so a non-retryable failure rolls
  -- back only this block's work (implicit savepoint) while the receipt above
  -- survives as the dead-letter record.
  begin
    -- Cross-tenant customer binding fails closed before any account write, so
    -- the rejection is a deterministic 42501 dead letter instead of a unique
    -- violation (23505) raised from the upsert below, which the retry
    -- classification would treat as transient.
    if v_customer_id is not null and exists (
      select 1 from public.billing_accounts a
      where a.stripe_customer_id = v_customer_id
        and a.organization_id <> v_org_id
    ) then
      raise exception 'Stripe customer is already bound to a different tenant account'
        using errcode = '42501';
    end if;

    insert into public.billing_accounts (
      organization_id, stripe_customer_id, billing_state, provider_state,
      state_source, provider_event_created_at, provider_event_id
    ) values (
      v_org_id, v_customer_id, 'trial', 'uninitialized', 'stripe',
      null, null
    )
    on conflict (organization_id) do update set
      stripe_customer_id = coalesce(excluded.stripe_customer_id, public.billing_accounts.stripe_customer_id),
      updated_at = now()
    where public.billing_accounts.stripe_customer_id is null
       or public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id;

    select a.id into v_account_id
    from public.billing_accounts a where a.organization_id = v_org_id;
    if v_customer_id is not null and exists (
      select 1 from public.billing_accounts a
      where a.id = v_account_id and a.stripe_customer_id is not null
        and a.stripe_customer_id <> v_customer_id
    ) then
      raise exception 'Stripe customer is already bound to a different tenant account'
        using errcode = '42501';
    end if;

    if p_event_type = 'checkout.session.completed' then
      -- Apply the purchased package immediately so the tenant is on the plan
      -- they just checked out, even if customer.subscription.* is delayed or
      -- missing from the webhook endpoint configuration.
      v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
      v_subscription_id := nullif(coalesce(
        case when jsonb_typeof(v_object->'subscription') = 'string'
          then v_object->>'subscription' end,
        v_object #>> '{subscription,id}'), '');
      if v_package_id is not null then
        update public.organizations o
        set package_id = coalesce(v_package_id, o.package_id),
            plan_name = coalesce(
              (select p.name from public.packages p where p.id = v_package_id),
              o.plan_name),
            updated_at = now()
        where o.id = v_org_id;
      end if;
      -- Basil/Clover attaches the subscription id on the completed session.
      -- Insert a stub if none exists so trial-expiry cannot lock out a customer
      -- who just paid while subscription.created is still in flight. Never
      -- overwrite a richer customer.subscription.* row (ON CONFLICT DO NOTHING).
      if v_subscription_id is not null
         and v_subscription_id ~ '^sub_[A-Za-z0-9]+$'
         and v_account_id is not null
         and not exists (
           select 1 from public.billing_subscriptions s
           where s.stripe_subscription_id = v_subscription_id
         ) then
        v_provider_status := case
          when coalesce(v_object->>'payment_status', '') = 'paid' then 'active'
          else 'trialing' end;
        v_state := case
          when v_provider_status = 'active' then 'active'
          else 'trial' end;
        insert into public.billing_subscriptions (
          organization_id, billing_account_id, package_id, stripe_subscription_id,
          provider_status, billing_state, seat_quantity,
          provider_event_created_at, provider_event_id
        ) values (
          v_org_id, v_account_id, v_package_id, v_subscription_id,
          v_provider_status, v_state, 1,
          p_event_created_at, p_event_id
        )
        on conflict (stripe_subscription_id) do nothing;
        get diagnostics v_count = row_count;
        if v_count > 0 and v_state = 'active' then
          update public.billing_accounts a
          set billing_state = case
                when a.billing_state = 'trial' then 'active'
                else a.billing_state end,
              provider_state = coalesce(a.provider_state, 'active'),
              state_source = case
                when a.billing_state = 'trial' then 'stripe'
                else a.state_source end,
              updated_at = now()
          where a.id = v_account_id;
          update public.organizations o
          set subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
              updated_at = now()
          where o.id = v_org_id;
        end if;
      end if;
      v_applied := true;
    elsif p_event_type like 'customer.subscription.%' then
      v_provider_status := coalesce(v_object->>'status',
        case when p_event_type = 'customer.subscription.deleted' then 'canceled' else 'unknown' end);
      v_state := case v_provider_status
        when 'trialing' then 'trial'
        when 'active' then 'active'
        when 'past_due' then case
          when p_event_created_at + interval '7 days' > now() then 'grace'
          else 'past_due' end
        when 'unpaid' then 'past_due'
        when 'canceled' then 'canceled'
        when 'incomplete_expired' then 'canceled'
        when 'paused' then 'suspended'
        else 'past_due'
      end;
      v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
      if exists (
        select 1 from public.billing_subscriptions s
        where s.stripe_subscription_id = v_object->>'id'
          and s.organization_id <> v_org_id
      ) then
        raise exception 'Stripe subscription is already bound to another tenant'
          using errcode = '42501';
      end if;

      insert into public.billing_subscriptions (
        organization_id, billing_account_id, package_id, stripe_subscription_id,
        provider_status, billing_state, seat_quantity, current_period_start,
        current_period_end, trial_ends_at, cancel_at_period_end, canceled_at,
        provider_event_created_at, provider_event_id
      ) values (
        v_org_id, v_account_id, v_package_id, v_object->>'id',
        v_provider_status, v_state,
        greatest(coalesce((v_object #>> '{items,data,0,quantity}')::integer, 1), 1),
        -- Basil moved the billing period onto subscription items; read the item-level
        -- field first and fall back to the pre-Basil top-level field for legacy
        -- payloads and stored-event replays.
        app_private.stripe_epoch(coalesce(
          v_object #>> '{items,data,0,current_period_start}',
          v_object->>'current_period_start')),
        app_private.stripe_epoch(coalesce(
          v_object #>> '{items,data,0,current_period_end}',
          v_object->>'current_period_end')),
        app_private.stripe_epoch(v_object->>'trial_end'),
        coalesce((v_object->>'cancel_at_period_end')::boolean, false),
        app_private.stripe_epoch(v_object->>'canceled_at'),
        p_event_created_at, p_event_id
      )
      on conflict (stripe_subscription_id) do update set
        package_id = coalesce(excluded.package_id, public.billing_subscriptions.package_id),
        provider_status = excluded.provider_status,
        billing_state = excluded.billing_state,
        seat_quantity = excluded.seat_quantity,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        trial_ends_at = excluded.trial_ends_at,
        cancel_at_period_end = excluded.cancel_at_period_end,
        canceled_at = excluded.canceled_at,
        provider_event_created_at = excluded.provider_event_created_at,
        provider_event_id = excluded.provider_event_id,
        updated_at = now()
      where (excluded.provider_event_created_at, excluded.provider_event_id)
        > (public.billing_subscriptions.provider_event_created_at,
           public.billing_subscriptions.provider_event_id)
      returning id into v_subscription_pk;
      get diagnostics v_count = row_count;
      v_applied := v_count > 0;
      v_stale := not v_applied;

      if v_applied then
        delete from public.billing_subscription_items
        where subscription_id = v_subscription_pk;
        insert into public.billing_subscription_items (
          organization_id, subscription_id, stripe_subscription_item_id,
          stripe_price_id, quantity
        )
        select
          v_org_id, v_subscription_pk, item->>'id', item #>> '{price,id}',
          greatest(coalesce((item->>'quantity')::integer, 1), 1)
        from jsonb_array_elements(coalesce(v_object #> '{items,data}', '[]'::jsonb)) item
        where nullif(item->>'id', '') is not null
          and nullif(item #>> '{price,id}', '') is not null;

        update public.billing_accounts a
        set
          stripe_customer_id = coalesce(v_customer_id, a.stripe_customer_id),
          provider_state = v_provider_status,
          billing_state = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
            when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
            else v_state end,
          state_source = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
            when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.state_source
            else 'stripe' end,
          grace_ends_at = case when v_state = 'grace' then p_event_created_at + interval '7 days' else null end,
          comped_until = case
            when a.billing_state = 'comped' and a.state_source = 'manual_comp'
              and (a.comped_until is null or a.comped_until > now()) then a.comped_until
            else null end,
          suspension_reason = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension'
              then a.suspension_reason
            when v_state = 'suspended' then 'Stripe subscription paused'
            else null end,
          provider_event_created_at = p_event_created_at,
          provider_event_id = p_event_id,
          updated_at = now()
        where a.id = v_account_id
          and (a.provider_event_created_at is null
            or (p_event_created_at, p_event_id) > (a.provider_event_created_at, a.provider_event_id));

        update public.organizations o
        set package_id = coalesce(v_package_id, o.package_id),
            plan_name = coalesce((select p.name from public.packages p where p.id = v_package_id), o.plan_name),
            subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
            updated_at = now()
        where o.id = v_org_id;
      end if;
    elsif p_event_type like 'invoice.%' then
      -- Basil moved the invoice -> subscription reference under
      -- parent.subscription_details.subscription; read it first and keep the
      -- pre-Basil top-level field as a fallback.
      v_subscription_id := nullif(coalesce(
        v_object #>> '{parent,subscription_details,subscription}',
        v_object->>'subscription'), '');
      select s.id into v_subscription_pk
      from public.billing_subscriptions s
      where s.stripe_subscription_id = v_subscription_id;
      v_provider_status := coalesce(v_object->>'status', replace(p_event_type, 'invoice.', ''));
      if exists (
        select 1 from public.billing_invoices i
        where i.stripe_invoice_id = v_object->>'id'
          and i.organization_id <> v_org_id
      ) then
        raise exception 'Stripe invoice is already bound to another tenant'
          using errcode = '42501';
      end if;

      insert into public.billing_invoices (
        organization_id, subscription_id, stripe_subscription_id, stripe_invoice_id,
        provider_status, currency, amount_due, amount_paid, amount_remaining,
        issued_at, due_at, paid_at, hosted_invoice_url,
        provider_event_created_at, provider_event_id
      ) values (
        v_org_id, v_subscription_pk, v_subscription_id, v_object->>'id',
        v_provider_status, lower(coalesce(v_object->>'currency', 'usd')),
        greatest(coalesce((v_object->>'amount_due')::bigint, 0), 0),
        greatest(coalesce((v_object->>'amount_paid')::bigint, 0), 0),
        greatest(coalesce((v_object->>'amount_remaining')::bigint, 0), 0),
        app_private.stripe_epoch(v_object->>'created'),
        app_private.stripe_epoch(v_object->>'due_date'),
        app_private.stripe_epoch(v_object #>> '{status_transitions,paid_at}'),
        nullif(v_object->>'hosted_invoice_url', ''),
        p_event_created_at, p_event_id
      )
      on conflict (stripe_invoice_id) do update set
        subscription_id = coalesce(excluded.subscription_id, public.billing_invoices.subscription_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.billing_invoices.stripe_subscription_id),
        provider_status = excluded.provider_status,
        amount_due = excluded.amount_due,
        amount_paid = excluded.amount_paid,
        amount_remaining = excluded.amount_remaining,
        due_at = excluded.due_at,
        paid_at = excluded.paid_at,
        hosted_invoice_url = excluded.hosted_invoice_url,
        provider_event_created_at = excluded.provider_event_created_at,
        provider_event_id = excluded.provider_event_id,
        updated_at = now()
      where (excluded.provider_event_created_at, excluded.provider_event_id)
        > (public.billing_invoices.provider_event_created_at,
           public.billing_invoices.provider_event_id);
      get diagnostics v_count = row_count;
      v_applied := v_count > 0;
      v_stale := not v_applied;

      if v_applied and p_event_type in ('invoice.payment_failed', 'invoice.payment_succeeded', 'invoice.paid') then
        v_state := case when p_event_type = 'invoice.payment_failed' then 'grace' else 'active' end;
        update public.billing_accounts a
        set
          provider_state = case when v_state = 'grace' then 'past_due' else 'active' end,
          billing_state = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
            when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
            else v_state end,
          state_source = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
            when a.billing_state = 'comped' and a.state_source = 'manual_comp'
              and (a.comped_until is null or a.comped_until > now()) then a.state_source
            else 'stripe' end,
          grace_ends_at = case when v_state = 'grace' then p_event_created_at + interval '7 days' else null end,
          comped_until = case
            when a.billing_state = 'comped' and a.state_source = 'manual_comp'
              and (a.comped_until is null or a.comped_until > now()) then a.comped_until
            else null end,
          suspension_reason = case
            when a.billing_state = 'suspended' and a.state_source = 'manual_suspension'
              then a.suspension_reason
            else null end,
          provider_event_created_at = p_event_created_at,
          provider_event_id = p_event_id,
          updated_at = now()
        where a.id = v_account_id
          and (a.provider_event_created_at is null
            or (p_event_created_at, p_event_id) > (a.provider_event_created_at, a.provider_event_id));
        update public.organizations o
        set subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
            updated_at = now()
        where o.id = v_org_id;
      end if;
    else
      v_applied := false;
    end if;

    update app_private.stripe_billing_events
    set processing_status = case
          when v_stale then 'stale'
          when v_applied then 'applied'
          else 'ignored' end,
        processed_at = now()
    where event_id = p_event_id;
  exception
    when others then
      -- Non-retryable: tenant-binding guards (42501) and payload-shape errors
      -- (invalid parameter/text representation, check/not-null/range
      -- violations) fail identically on every redelivery. Keep the receipt as
      -- the dead letter and return normally so the webhook answers 200.
      if sqlstate in ('42501', '22023', '22P02', '22003', '23502', '23514') then
        update app_private.stripe_billing_events
        set processing_status = 'failed',
            processed_at = now(),
            processing_error = left('[' || sqlstate || '] ' || sqlerrm, 500)
        where event_id = p_event_id;
        return query select false, false, false, v_org_id,
          (select a.billing_state from public.billing_accounts a where a.organization_id = v_org_id);
        return;
      end if;
      -- Transient (deadlock, serialization, FK timing, ...): re-raise so the
      -- whole transaction rolls back and the webhook's 500 makes Stripe retry.
      raise;
  end;

  return query select false, v_applied, v_stale, v_org_id,
    (select a.billing_state from public.billing_accounts a where a.organization_id = v_org_id);
end;
$$;

revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  to service_role;

-- Trial-expiry in-app notice now deep-links to the billing page.
create or replace function app_private.enqueue_trial_expiry_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_admin record;
  v_threshold integer;
  v_days_left integer;
  v_notification_id uuid;
  v_enqueued integer := 0;
begin
  for v_org in
    select o.id, o.name, o.trial_ends_at
    from public.organizations o
    join public.billing_accounts a on a.organization_id = o.id
    where o.trial_ends_at is not null
      and o.trial_ends_at > now()
      and o.trial_ends_at <= now() + interval '7 days'
      and not o.is_demo
      -- Only accounts still living off the signup trial. Comped, active,
      -- suspended, and already-downgraded accounts are not trial-notice
      -- audiences.
      and a.billing_state = 'trial'
      -- A live subscription (its own Stripe trial included) overrides the
      -- in-app window -- same guard as get_effective_entitlements.
      and not exists (
        select 1 from public.billing_subscriptions s
        where s.organization_id = o.id
          and s.billing_state in ('trial', 'active', 'grace')
      )
  loop
    -- Most-imminent applicable threshold only: T-7 through T-2 send the
    -- 7-day notice once; T-1 (or a catch-up run landing inside the final
    -- day) sends the 1-day notice once.
    v_threshold := case
      when v_org.trial_ends_at <= now() + interval '1 day' then 1
      else 7
    end;

    insert into app_private.billing_trial_notice_log (
      organization_id, threshold_days, trial_ends_at
    ) values (v_org.id, v_threshold, v_org.trial_ends_at)
    on conflict do nothing;
    if not found then
      continue; -- already notified for this window+threshold
    end if;

    v_days_left := greatest(
      1, ceil(extract(epoch from (v_org.trial_ends_at - now())) / 86400)::integer);

    for v_admin in
      select p.id
      from public.profiles p
      where p.organization_id = v_org.id
        and p.role = 'org_admin'
        and p.is_active
    loop
      insert into public.notifications (
        organization_id, profile_id, notification_type, title, body, link
      ) values (
        v_org.id, v_admin.id, 'billing_trial_expiring',
        case when v_threshold = 1
          then 'Your free trial ends tomorrow'
          else 'Your free trial is ending soon' end,
        'The ' || v_org.name || ' free trial ends on '
          || to_char(v_org.trial_ends_at, 'FMMonth DD, YYYY')
          || ' (' || v_days_left || ' day' || case when v_days_left = 1 then '' else 's' end
          || ' left). Choose a plan to keep uninterrupted access to your subscribed modules.',
        '/app/billing'
      ) returning id into v_notification_id;

      -- Off-platform delivery honors the recipient's preferred channel,
      -- consent, and org channel settings; the dispatch worker sends the
      -- generic external copy for this type.
      perform public.enqueue_preferred_notification_delivery(
        v_org.id, v_admin.id, v_notification_id, 'alert');
      v_enqueued := v_enqueued + 1;
    end loop;
  end loop;

  return v_enqueued;
end;
$$;
revoke all on function app_private.enqueue_trial_expiry_notices()
  from public, anon, authenticated;
