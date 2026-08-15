-- A second live Stripe subscription for one organization now pages someone.
--
-- Checkout's existing-subscription guard is check-then-act: two admins racing it both
-- passed, and until reconciliation the webhook recorded both subscriptions without
-- complaint -- get_billing_reconciliation reports subscriptionCount 2, but only to a
-- reader who happens to run it, so the org was silently double-billed. The deterministic
-- checkout idempotency key (create-billing-session) collapses the realistic race; this is
-- the webhook-side backstop for what slips through it: on customer.subscription.created
-- for an org already holding a live subscription under a different Stripe id, the event
-- still applies (the subscription is real -- hiding it would misstate provider state) and
-- every active platform_admin gets an in-app notification naming both facts. Exactly once:
-- replays of the same created event are stale under the (event_created_at, event_id)
-- ordering guard and never re-alert.
--
-- The notification type is registered additively -- full current list re-declared plus the
-- new value, mirroring 20260804010000's handling of the same constraint.
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published',
    'announcement_published', 'manager_weekly_digest',
    'automation_action_due', 'report_subscription_ready', 'resident_portal_request',
    'billing_trial_expiring',
    'compliance_requirement_assigned', 'compliance_requirement_due_soon',
    'compliance_requirement_overdue', 'compliance_requirement_awaiting_review',
    'plan_of_correction_due_soon', 'plan_of_correction_overdue',
    'demo_request_received',
    'billing_duplicate_subscription'
  )
);

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
        updated_at = now()
      where (excluded.provider_event_created_at, excluded.provider_event_id)
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
$$;

revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text)
  to service_role;
