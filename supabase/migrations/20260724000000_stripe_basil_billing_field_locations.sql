-- Align the signed Stripe event processor with the billing field locations used
-- by the pinned Stripe API version (2026-02-25.clover).
--
-- Stripe's Basil release (2025-03-31.basil) relocated two fields that
-- process_stripe_billing_event depended on. Because the Edge Functions pin
-- Stripe-Version = 2026-02-25.clover (see supabase/functions/_shared/phase2Billing.ts),
-- every live webhook payload uses the post-Basil shape, so the previous top-level
-- reads silently resolved to NULL:
--
--   * Subscription billing period: current_period_start / current_period_end moved
--     off the Subscription object and onto each Subscription Item
--     (items.data[].current_period_start / current_period_end). Reading them from
--     the top level left billing_subscriptions.current_period_start/end NULL, which
--     degraded the quantity-sync ordering and hid each subscription's renewal window
--     from operators and entitlement period gating.
--
--   * Invoice -> subscription link: the Invoice.subscription field moved to
--     invoice.parent.subscription_details.subscription. Reading the old top-level
--     field left billing_invoices.subscription_id / stripe_subscription_id NULL, so
--     invoices were never tied back to the subscription they billed.
--
-- The reads below coalesce the post-Basil location first-class while still falling
-- back to the pre-Basil top-level field, so replays of older stored events and any
-- account still emitting a legacy API version keep reconciling correctly. Nothing
-- else the processor reads was relocated by Basil (status, customer, metadata,
-- trial_end, cancel_at_period_end, canceled_at, and the item id/price/quantity shape
-- are all unchanged).
--
-- We also durably record each event's api_version so version drift -- the root cause
-- of this class of silent field relocation -- is observable in the receipt ledger.

alter table app_private.stripe_billing_events
  add column if not exists provider_api_version text;

comment on column app_private.stripe_billing_events.provider_api_version is
  'Stripe API version (event.api_version) the payload was serialized with. Recorded so field-location drift between Stripe versions is observable.';

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
      raise exception 'Stripe event id was reused with different content'
        using errcode = '23505';
    end if;
    return query select true, false,
      v_existing.processing_status = 'stale',
      v_existing.organization_id,
      (select a.billing_state from public.billing_accounts a
       where a.organization_id = v_existing.organization_id);
    return;
  end if;

  v_customer_id := nullif(v_object->>'customer', '');
  -- Post-Basil, an invoice references its subscription through
  -- parent.subscription_details.subscription; older payloads used the top-level
  -- subscription field. Subscription events still identify themselves by id.
  v_subscription_id := nullif(coalesce(
    v_object->>'subscription',
    v_object #>> '{parent,subscription_details,subscription}',
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
      -- Basil moved the billing period onto subscription items; fall back to the
      -- pre-Basil top-level field for legacy payloads and stored-event replays.
      app_private.stripe_epoch(coalesce(
        v_object->>'current_period_start',
        v_object #>> '{items,data,0,current_period_start}')),
      app_private.stripe_epoch(coalesce(
        v_object->>'current_period_end',
        v_object #>> '{items,data,0,current_period_end}')),
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
    -- parent.subscription_details.subscription; keep the pre-Basil field as a fallback.
    v_subscription_id := nullif(coalesce(
      v_object->>'subscription',
      v_object #>> '{parent,subscription_details,subscription}'), '');
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

  return query select false, v_applied, v_stale, v_org_id,
    (select a.billing_state from public.billing_accounts a where a.organization_id = v_org_id);
end;
$$;

revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  to service_role;
