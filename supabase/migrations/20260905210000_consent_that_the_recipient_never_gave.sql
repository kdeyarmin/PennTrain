-- Consent somebody else gave for you, a placeholder that outranked the real thing, and forty
-- aides nobody could reach (I21).
--
-- 1. A FABRICATED CONSENT RECORD. `update_profile_contact_preferences` let an org admin -- or a
--    facility manager scoped to the employee's facility -- pass p_sms_opt_in = true for ANOTHER
--    person's profile, and stamped `sms_consent_at = now()` as though that person had given it.
--    That column is the record a TCPA complaint asks about, and it could be written by an
--    ordinary "tidy up the roster" edit on a screen that does not mention consent at all. Opting
--    IN is now the recipient's own act. Everything else an administrator does here still works,
--    including turning texting OFF: an opt-out never needs the recipient's permission.
--
-- 2. A PLACEHOLDER THAT OUTRANKED THE REAL SUBSCRIPTION. `checkout.session.completed` inserts a
--    stub billing_subscriptions row so trial expiry cannot lock out a customer who has just paid.
--    It was stamped with the CHECKOUT event's timestamp, and the customer.subscription.created
--    upsert only applies when its (provider_event_created_at, provider_event_id) sorts strictly
--    higher. Stripe emits both within the same second and their `created` values do not order
--    reliably, so the real event could lose: seat_quantity stuck at 1, no billing period, and
--    `billing_subscription_items` never populated -- which is exactly the state the hourly
--    billing-quantity-sync reports as `partial`, indefinitely, on a paying customer.
--    The stub is now marked as one, and a real provider event supersedes a stub whatever the
--    clocks say. Between two real events the existing ordering is untouched.
--
-- 3. FORTY AIDES NOBODY COULD REACH. Every enqueue_* path resolves recipients through
--    `profiles.email` / `profiles.phone`, and the reminder jobs join `employees.profile_id is not
--    null`. The import worker writes `employees.phone`, which no delivery path reads. So a
--    facility that imports its roster and invites nobody gets zero reminders, zero deliveries and
--    zero failures -- the system is working exactly as written and no screen says so.
--
--    Deliberately NOT fixed by writing a `skipped` delivery row per employee per notification:
--    that is one row per aide per reminder per day, describing a condition that does not change
--    between them, and it would need editing into eight separate queue jobs. What is missing is
--    not a log line, it is a number somebody sees. `get_notification_reach()` is that number, and
--    it is continuous rather than per-send.

------------------------------------------------------------------------------------------------
-- 1. Consent comes from the recipient
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_profile_contact_preferences(p_profile_id uuid, p_first_name text, p_last_name text, p_phone text, p_sms_opt_in boolean, p_preferred_notification_channel text)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not coalesce((
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ), false) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  -- Consent to be texted has to come from the person who will be texted. Before this, an org
  -- admin or a scoped facility manager could set p_sms_opt_in on somebody else's profile and the
  -- statement below stamped sms_consent_at = now() as though the recipient had given it -- a
  -- fabricated consent record on the exact column a TCPA complaint asks about, produced by an
  -- ordinary "tidy up the roster" edit. The refusal is scoped to the transition, not the caller:
  -- an administrator may still fix a name, correct a phone number, and turn texting OFF (which is
  -- an opt-out, and never needs the recipient's permission). What they may not do is create a
  -- state that would stamp a new consent -- exactly the condition the CASE below tests.
  if auth.uid() <> v_target.id
     and p_sms_opt_in
     and (
       not v_target.sms_opt_in
       or public.notification_phone_key(v_target.phone)
         is distinct from public.notification_phone_key(v_phone)
     ) then
    raise exception 'Text-message consent has to come from the recipient. They can turn text messages on from their own notification preferences; you can turn them off.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms', 'web_push')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null))
     or (p_preferred_notification_channel = 'web_push'
       and v_target.preferred_notification_channel is distinct from 'web_push'
       and not exists (
         select 1 from public.push_subscriptions s
         where s.profile_id = v_target.id and s.organization_id = v_target.organization_id
           and s.disabled_at is null
           and (s.expiration_time is null or s.expiration_time > now())
       )) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$

;

revoke all on function public.update_profile_contact_preferences(uuid, text, text, text, boolean, text)
  from public, anon;
grant execute on function public.update_profile_contact_preferences(uuid, text, text, text, boolean, text)
  to authenticated;

------------------------------------------------------------------------------------------------
-- 2. A checkout stub is a stand-in, and says so
------------------------------------------------------------------------------------------------
alter table public.billing_subscriptions
  add column if not exists is_provider_placeholder boolean not null default false;

comment on column public.billing_subscriptions.is_provider_placeholder is
  'True while this row is the stub inserted by checkout.session.completed so trial expiry cannot '
  'lock out a customer who has just paid. It carries one seat, no billing period and no items; '
  'the first customer.subscription.* event supersedes it regardless of event timestamps and '
  'clears the flag. BACKLOG.md I21.';
CREATE OR REPLACE FUNCTION public.process_stripe_billing_event(p_event_id text, p_event_type text, p_event_created_at timestamp with time zone, p_payload jsonb, p_payload_sha256 text, p_correlation_id text)
 RETURNS TABLE(was_duplicate boolean, was_applied boolean, was_stale boolean, resolved_organization_id uuid, canonical_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_duplicate_live boolean := false;
  v_admin record;
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
    -- Trusted billing writer: allow package_id / subscription_status stamps
    -- past protect_subscription_fields (no JWT on the webhook path).
    perform set_config('app.privileged_write', 'on', true);

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
        -- Marked as a placeholder. Stripe creates the subscription object and completes the
        -- checkout session within the same second, and their `created` timestamps do not order
        -- reliably -- so the stub, stamped with the CHECKOUT event's time, could outrank the
        -- customer.subscription.created event that actually describes the subscription. The
        -- ordering guard on that upsert then rejected the real row, leaving seat_quantity 1, no
        -- billing period, and billing_subscription_items EMPTY, which is what the hourly quantity
        -- sync reports as partial forever. The flag says "this row is a stand-in", and the
        -- subscription branch overwrites a stand-in regardless of timestamps.
        insert into public.billing_subscriptions (
          organization_id, billing_account_id, package_id, stripe_subscription_id,
          provider_status, billing_state, seat_quantity,
          provider_event_created_at, provider_event_id, is_provider_placeholder
        ) values (
          v_org_id, v_account_id, v_package_id, v_subscription_id,
          v_provider_status, v_state, 1,
          p_event_created_at, p_event_id, true
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

      -- A second live subscription for one org is real Stripe state, so it is recorded --
      -- but it is almost always the checkout race the deterministic idempotency key could
      -- not collapse (two admins, distinct params or an hour-boundary straddle), and it
      -- double-bills the org until someone cancels one. Detect it on the CREATED event,
      -- before this upsert makes the second row indistinguishable from ordinary state.
      v_duplicate_live := p_event_type = 'customer.subscription.created' and exists (
        select 1 from public.billing_subscriptions s
        where s.organization_id = v_org_id
          and s.stripe_subscription_id <> v_object->>'id'
          and s.billing_state in ('trial', 'active', 'grace', 'past_due')
      );

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
        is_provider_placeholder = false,
        updated_at = now()
      -- A checkout stub is always superseded, whatever the clocks say: it holds one seat, no
      -- period and no items, and it exists only so trial expiry cannot lock out someone who has
      -- just paid. Between two real provider events the timestamp+id ordering still decides.
      where public.billing_subscriptions.is_provider_placeholder
        or (excluded.provider_event_created_at, excluded.provider_event_id)
        > (public.billing_subscriptions.provider_event_created_at,
           public.billing_subscriptions.provider_event_id)
      returning id into v_subscription_pk;
      get diagnostics v_count = row_count;
      v_applied := v_count > 0;
      v_stale := not v_applied;

      -- Page the operator through the in-app bell (the demo-request fan-out shape,
      -- 20260804010000): one row per active platform_admin, exactly once per duplicate
      -- creation -- a replayed created event is stale by the ordering guard above and
      -- never re-alerts. get_billing_reconciliation already *shows* subscriptionCount 2,
      -- but only if someone happens to look; this makes someone look.
      if v_applied and v_duplicate_live then
        for v_admin in
          select id, organization_id from public.profiles
          where role = 'platform_admin' and is_active
        loop
          insert into public.notifications (
            organization_id, profile_id, notification_type, title, body, link
          ) values (
            v_admin.organization_id, v_admin.id, 'billing_duplicate_subscription',
            'Duplicate live subscription',
            'Stripe subscription ' || (v_object->>'id') || ' was created for organization '
              || v_org_id::text || ' while another live subscription exists. The org is '
              || 'being billed twice until one is canceled in Stripe.',
            null
          );
        end loop;
      end if;

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
$function$

;

revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  to service_role;

------------------------------------------------------------------------------------------------
-- 3. How many people the product can actually reach
------------------------------------------------------------------------------------------------
-- A number, per organization, of active employees with no login -- which is the same thing as
-- "nobody can send them anything". Read by the platform notifications console (every tenant) and
-- by an organization's own settings page (its own row), because the person who can fix it is the
-- administrator who has not sent the invitations, not the platform operator watching deliveries.
create or replace function public.get_notification_reach()
returns table (
  organization_id uuid,
  organization_name text,
  active_employees integer,
  reachable_employees integer,
  unreachable_employees integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (public.is_platform_admin() or public.current_org_id() is not null) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.name,
    count(e.id)::integer,
    count(e.id) filter (where e.profile_id is not null)::integer,
    count(e.id) filter (where e.profile_id is null)::integer
  from public.organizations o
  join public.employees e
    on e.organization_id = o.id and e.status = 'active'
  where public.is_platform_admin() or o.id = public.current_org_id()
  group by o.id, o.name
  having count(e.id) > 0
  order by count(e.id) filter (where e.profile_id is null) desc, o.name;
end;
$function$;

comment on function public.get_notification_reach() is
  'Per organization: active employees, how many have a linked login, and how many do not. An '
  'employee with no profile receives nothing from any notification path -- every enqueue_* '
  'resolves the recipient through profiles -- and produces no delivery row to notice. '
  'BACKLOG.md I21.';

revoke all on function public.get_notification_reach() from public, anon;
grant execute on function public.get_notification_reach() to authenticated, service_role;
