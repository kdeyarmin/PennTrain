-- Customer Portal changes subscription item prices, but retains the metadata
-- copied from the original Checkout. Reconcile the purchased package from the
-- signed current items so an upgrade/downgrade also changes app entitlements.
-- Keep the existing freshness guard, tenant binding and failed-event receipt.
-- Retain the independent package that existed before a provisional Checkout.
-- A missing value on an older placeholder is deliberately an unknown prior tier.
alter table public.billing_subscriptions
  add column checkout_previous_package_id uuid references public.packages(id) on delete restrict;
comment on column public.billing_subscriptions.checkout_previous_package_id is
  'Package before the initial provisional Checkout stamp; never replaced by repeated Checkout. NULL also represents older placeholders with no trustworthy provenance.';

-- Resolve only a currently entitled, authoritative surviving subscription.
-- Status and invoice clocks remain separate; the latest matching invoice for
-- each subscription wins over its older status, even if a sibling receipt now
-- occupies the account event pointer.
create or replace function app_private.stripe_surviving_subscription_package(
  p_organization_id uuid,
  p_billing_account_id uuid,
  p_exclude_subscription_id text
)
returns table (package_id uuid)
language sql
stable
security invoker
set search_path = ''
as $function$
  select s.package_id
  from public.billing_subscriptions s
  join public.billing_accounts a on a.id = s.billing_account_id and a.organization_id = s.organization_id
  left join lateral (
    select e.event_type, e.event_created_at, e.event_id
    from app_private.stripe_billing_events e
    where e.organization_id = s.organization_id and e.processing_status = 'applied'
      and e.event_type in ('invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed')
      and coalesce(e.payload #>> '{data,object,parent,subscription_details,subscription}',
                   e.payload #>> '{data,object,subscription}') = s.stripe_subscription_id
      and (e.event_created_at, app_private.stripe_event_received_at(e.event_id))
          > (s.provider_event_created_at, app_private.stripe_event_received_at(s.provider_event_id))
    order by e.event_created_at desc, app_private.stripe_event_received_at(e.event_id) desc, e.event_id
    limit 1
  ) payment on true
  where s.organization_id = p_organization_id
    and s.billing_account_id = p_billing_account_id
    and not s.is_provider_placeholder
    and s.provider_status not in ('canceled', 'incomplete_expired')
    and (p_exclude_subscription_id is null or s.stripe_subscription_id <> p_exclude_subscription_id)
    and case
      when payment.event_id is not null then case
        -- Dunning grace intentionally extends past the old paid period. Its
        -- original invoice deadline is the authority, including when expired.
        when payment.event_type = 'invoice.payment_failed'
          then payment.event_created_at + interval '7 days' > now()
        else s.current_period_end is null or s.current_period_end > now()
      end
      when s.billing_state = 'active'
        then s.current_period_end is null or s.current_period_end > now()
      when s.billing_state = 'trial'
        then (s.trial_ends_at is null or s.trial_ends_at > now())
          and (s.current_period_end is null or s.current_period_end > now())
      when s.billing_state = 'grace'
        then s.provider_event_created_at + interval '7 days' > now()
      else false
    end
  order by s.provider_event_created_at desc,
           app_private.stripe_event_received_at(s.provider_event_id) desc, s.id
  limit 1;
$function$;

revoke all on function app_private.stripe_surviving_subscription_package(uuid, uuid, text)
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.process_stripe_billing_event(text,text,timestamptz,jsonb,text,text)'::regprocedure);

  v_old := $old$  v_admin record;$old$;
  v_new := $new$  v_admin record;
  v_checkout_previous_package_id uuid;
  v_was_placeholder boolean := false;
  v_plan_recovery boolean := false;
  v_terminal_survivor_found boolean := false;
  v_preserve_subscription_items boolean := false;$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe processor declarations no longer match the plan recovery patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$      v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
      v_subscription_id := nullif(coalesce($old$;
  v_new := $new$      -- Capture the actual independent tier immediately before this
      -- Checkout. The insert below stores it only on initial placeholder creation;
      -- a duplicate Checkout cannot replace it with the provisional tier.
      select s.checkout_previous_package_id into v_checkout_previous_package_id
      from public.organizations o
      join public.billing_subscriptions s on s.organization_id = o.id
        and s.is_provider_placeholder and s.package_id is not distinct from o.package_id
      where o.id = v_org_id
      order by s.created_at, s.id limit 1;
      if not found then
        select o.package_id into v_checkout_previous_package_id
        from public.organizations o where o.id = v_org_id;
      end if;
      v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
      v_subscription_id := nullif(coalesce($new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Checkout package provenance capture no longer matches';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$          provider_event_created_at, provider_event_id, is_provider_placeholder
        ) values (
          v_org_id, v_account_id, v_package_id, v_subscription_id,
          v_provider_status, v_state, 1,
          p_event_created_at, p_event_id, true$old$;
  v_new := $new$          provider_event_created_at, provider_event_id, is_provider_placeholder,
          checkout_previous_package_id
        ) values (
          v_org_id, v_account_id, v_package_id, v_subscription_id,
          v_provider_status, v_state, 1,
          p_event_created_at, p_event_id, true, v_checkout_previous_package_id$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Checkout placeholder insert no longer matches provenance capture';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- Checkout metadata is useful only until the subscription itself has been
  -- reconciled. Its delayed first delivery must not undo a later Portal change.
  v_old := $old$      if v_package_id is not null then
        update public.organizations o$old$;
  v_new := $new$      if v_package_id is not null and not exists (
        select 1 from public.billing_subscriptions s
        where s.stripe_subscription_id = v_subscription_id
          and (not s.is_provider_placeholder or s.provider_status = 'plan_reconciliation_failed')
      ) then
        update public.organizations o$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Checkout package stamp no longer matches the plan reconciliation patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$      v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
      if exists (
        select 1 from public.billing_subscriptions s$old$;
  v_new := $new$      -- Resolve the package only after this event wins the freshness guard.
      -- In particular, stale Checkout metadata must not fail an otherwise valid
      -- mapped-price change before its authoritative item prices are considered.
      v_package_id := null;
      select s.is_provider_placeholder, s.checkout_previous_package_id
      into v_was_placeholder, v_checkout_previous_package_id
      from public.billing_subscriptions s
      where s.organization_id = v_org_id and s.stripe_subscription_id = v_object->>'id';
      select exists (
        select 1 from public.billing_subscriptions s
        where s.organization_id = v_org_id and s.stripe_subscription_id = v_object->>'id'
          and s.is_provider_placeholder and s.provider_status = 'plan_reconciliation_failed'
      ) into v_plan_recovery;
      if exists (
        select 1 from public.billing_subscriptions s$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe subscription metadata assignment no longer matches the plan reconciliation patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$      if v_applied then
        delete from public.billing_subscription_items
        where subscription_id = v_subscription_pk;$old$;
  v_new := $new$      if v_applied then
        declare
          v_items jsonb := coalesce(v_object #> '{items,data}', '[]'::jsonb);
          v_packages uuid[];
          v_unknown_items integer;
          v_catalog_managed boolean;
        begin
          -- Cancellation ends access even when Stripe includes an unmapped,
          -- ambiguous or truncated final item snapshot. Preserve package/item
          -- history; price validation must not undo authoritative termination.
          if v_provider_status in ('canceled', 'incomplete_expired') then
            v_preserve_subscription_items := true;
            if v_was_placeholder then
              -- Termination validates no provisional Checkout tier. Preserve the
              -- independent comp, using original provenance just as quarantine
              -- does; NULL provenance must clear an unknown historical claim.
              select survivor.package_id into v_package_id
              from app_private.stripe_surviving_subscription_package(
                v_org_id, v_account_id, v_object->>'id') survivor;
              v_terminal_survivor_found := found;
              if not v_terminal_survivor_found then
                v_package_id := v_checkout_previous_package_id;
              end if;
              update public.billing_subscriptions set package_id = v_package_id
              where id = v_subscription_pk;
              update public.organizations o
              set package_id = v_package_id,
                  plan_name = case when v_terminal_survivor_found and v_package_id is null
                    then o.plan_name else (select p.name from public.packages p where p.id = v_package_id) end,
                  updated_at = now()
              where o.id = v_org_id;
            elsif exists (
              select 1 from public.billing_accounts a
              where a.id = v_account_id and a.organization_id = v_org_id
                and a.billing_state = 'comped' and a.state_source = 'manual_comp'
                and (a.comped_until is null or a.comped_until > now())
            ) then
              -- Preserve separate histories: the operator's current comp tier
              -- and the terminated subscription's prior validated package.
              v_package_id := null;
            else
              -- A repeated terminal receipt must not turn a package retained
              -- during placeholder termination into authoritative price history.
              -- Only persisted items establish a previously validated contract,
              -- including legitimate custom prices outside the managed catalog.
              select case when exists (
                select 1 from public.billing_subscription_items i
                where i.subscription_id = s.id and i.organization_id = s.organization_id
              ) then coalesce(s.package_id, o.package_id) else o.package_id end
              into v_package_id
              from public.billing_subscriptions s
              join public.organizations o on o.id = s.organization_id
              where s.id = v_subscription_pk;
            end if;
          else
            begin
              if jsonb_typeof(v_items) <> 'array'
                 or coalesce(v_object #> '{items,has_more}', 'false'::jsonb) <> 'false'::jsonb then
                raise exception 'Subscription plan requires a complete item list'
                  using errcode = 'P0B01';
              end if;

              -- Price mappings are immutable identities, including archived prices
              -- still used by existing subscriptions. Do not limit this to today's
              -- primary/active Checkout catalog.
              select array_agg(distinct bp.package_id) filter (where bp.package_id is not null),
                     count(*) filter (where bp.package_id is null or nullif(item->>'id', '') is null)
              into v_packages, v_unknown_items
              from jsonb_array_elements(v_items) item
              left join public.package_billing_prices bp on bp.stripe_price_id = item #>> '{price,id}';

              -- Legacy/custom subscriptions with no mapped package or historical
              -- item retain their metadata contract. Once catalog-managed, an
              -- unknown replacement cannot silently retain or invent a paid plan.
              select exists (
                select 1 from public.package_billing_prices bp
                where bp.stripe_price_id is not null and (
                  bp.package_id = app_private.try_uuid(v_object #>> '{metadata,package_id}')
                  or bp.package_id = (select s.package_id from public.billing_subscriptions s
                                     where s.id = v_subscription_pk)
                  or bp.package_id = (select o.package_id from public.organizations o where o.id = v_org_id)
                  or exists (select 1 from public.billing_subscription_items i
                             where i.subscription_id = v_subscription_pk and i.stripe_price_id = bp.stripe_price_id)
                )
              ) into v_catalog_managed;

              if coalesce(cardinality(v_packages), 0) > 1 then
                raise exception 'Subscription items map to multiple application packages'
                  using errcode = 'P0B01';
              elsif coalesce(cardinality(v_packages), 0) = 1 then
                if v_unknown_items > 0 then
                  raise exception 'Subscription plan includes an unmapped or incomplete item'
                    using errcode = 'P0B01';
                end if;
                v_package_id := v_packages[1];
              elsif v_catalog_managed then
                raise exception 'Subscription plan has no recognized application price'
                  using errcode = 'P0B01';
              else
                v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
              end if;
            exception when sqlstate 'P0B01' then
              -- Keep normal mapped-plan changes during grace/dunning. Only an
              -- unresolvable restrictive snapshot falls back to plan history.
              -- Pre-migration authoritative rows may have no mapped items; their
              -- missing price history must not suppress a signed restriction.
              if v_was_placeholder is false and v_provider_status in ('paused', 'unpaid', 'past_due') then
                v_preserve_subscription_items := true;
                -- An unresolved restriction validates no new pricing. Preserve
                -- the current independent comp separately from provider history.
                select case when exists (
                  select 1 from public.billing_accounts a
                  where a.id = v_account_id and a.organization_id = v_org_id
                    and a.billing_state = 'comped' and a.state_source = 'manual_comp'
                    and (a.comped_until is null or a.comped_until > now())
                ) then null::uuid else coalesce(s.package_id, o.package_id) end into v_package_id
                from public.billing_subscriptions s
                join public.organizations o on o.id = s.organization_id
                where s.id = v_subscription_pk;
              else
                raise;
              end if;
            end;
          end if;

          update public.billing_subscriptions
          set package_id = coalesce(v_package_id, package_id)
          where id = v_subscription_pk;
        end;

        if not v_preserve_subscription_items then
        delete from public.billing_subscription_items
        where subscription_id = v_subscription_pk;$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe subscription freshness block no longer matches the plan reconciliation patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$          and nullif(item #>> '{price,id}', '') is not null;

        update public.billing_accounts a$old$;
  v_new := $new$          and nullif(item #>> '{price,id}', '') is not null;
        end if;

        update public.billing_accounts a$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe subscription item replacement no longer matches the terminal-state patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- Keep subscription status and invoice evidence in the right order when
  -- webhook delivery order differs from provider event timestamps.
  v_old := $old$        update public.billing_accounts a
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
            or (p_event_created_at, app_private.stripe_event_received_at(p_event_id))
              > (a.provider_event_created_at, app_private.stripe_event_received_at(a.provider_event_id)));$old$;
  v_new := $new$        declare
          v_account_state text := v_state;
          v_account_provider_status text := v_provider_status;
          v_account_event_created_at timestamptz := p_event_created_at;
          v_account_event_id text := p_event_id;
          v_invoice record;
          v_override_invoice boolean := false;
        begin
          -- Failed plan validation does not invalidate signed restrictive
          -- status. During recovery, merge its latest applicable receipt with
          -- payment evidence, using the original event clock for grace.
          select e.event_type, e.event_created_at, e.event_id,
                 e.payload #>> '{data,object,status}' as provider_status into v_invoice
          from app_private.stripe_billing_events e
          where e.organization_id = v_org_id
            and (
              (e.processing_status = 'applied'
                and e.event_type in ('invoice.payment_failed', 'invoice.payment_succeeded', 'invoice.paid')
                and ((v_plan_recovery and v_provider_status not in ('canceled', 'incomplete_expired')) or e.event_id = (
                  select a.provider_event_id from public.billing_accounts a where a.id = v_account_id))
                and coalesce(e.payload #>> '{data,object,parent,subscription_details,subscription}',
                             e.payload #>> '{data,object,subscription}') = v_object->>'id')
              or (v_plan_recovery and v_provider_status not in ('canceled', 'incomplete_expired')
                and e.processing_status = 'failed' and e.processing_error like '[P0B01]%'
                and e.event_type like 'customer.subscription.%'
                and e.payload #>> '{data,object,id}' = v_object->>'id'
                and e.payload #>> '{data,object,status}' in ('past_due', 'unpaid', 'paused'))
            )
            and (e.event_created_at, app_private.stripe_event_received_at(e.event_id))
                > (p_event_created_at, app_private.stripe_event_received_at(p_event_id))
          order by e.event_created_at desc, e.signature_verified_at desc, e.event_id
          limit 1;
          v_override_invoice := found and (v_plan_recovery
            or v_provider_status in ('canceled', 'incomplete_expired'));
          if v_override_invoice and v_plan_recovery
             and v_provider_status not in ('canceled', 'incomplete_expired') then
            if v_invoice.event_type like 'customer.subscription.%' then
              v_account_provider_status := v_invoice.provider_status;
              v_account_state := case v_invoice.provider_status
                when 'paused' then 'suspended'
                when 'unpaid' then 'past_due'
                when 'past_due' then case
                  when v_invoice.event_created_at + interval '7 days' > now() then 'grace' else 'past_due' end
              end;
              -- Keep recovered items/package, but retain the later signed
              -- restrictive status as this subscription's freshness boundary.
              update public.billing_subscriptions
              set provider_status = v_account_provider_status, billing_state = v_account_state,
                  provider_event_created_at = v_invoice.event_created_at,
                  provider_event_id = v_invoice.event_id
              where id = v_subscription_pk;
            else
              v_account_state := case when v_invoice.event_type = 'invoice.payment_failed' then
                case when v_invoice.event_created_at + interval '7 days' > now() then 'grace' else 'past_due' end
                else 'active' end;
              v_account_provider_status := case when v_invoice.event_type = 'invoice.payment_failed' then 'past_due' else 'active' end;
            end if;
            v_account_event_created_at := v_invoice.event_created_at;
            v_account_event_id := v_invoice.event_id;
          end if;
          update public.billing_accounts a
          set
            stripe_customer_id = coalesce(v_customer_id, a.stripe_customer_id),
            provider_state = v_account_provider_status,
            billing_state = case
              when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
              when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
              else v_account_state end,
            state_source = case
              when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
              when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.state_source
              else 'stripe' end,
            grace_ends_at = case when v_account_state = 'grace' then v_account_event_created_at + interval '7 days' else null end,
            comped_until = case
              when a.billing_state = 'comped' and a.state_source = 'manual_comp'
                and (a.comped_until is null or a.comped_until > now()) then a.comped_until
              else null end,
            suspension_reason = case
              when a.billing_state = 'suspended' and a.state_source = 'manual_suspension'
                then a.suspension_reason
              when v_account_state = 'suspended' then 'Stripe subscription paused'
              else null end,
            provider_event_created_at = v_account_event_created_at,
            provider_event_id = v_account_event_id,
            updated_at = now()
          where a.id = v_account_id
            and ((v_override_invoice and (
                  v_provider_status in ('canceled', 'incomplete_expired')
                  or a.provider_event_id = v_account_event_id))
              or a.provider_event_created_at is null
              or (v_account_event_created_at, app_private.stripe_event_received_at(v_account_event_id))
                > (a.provider_event_created_at, app_private.stripe_event_received_at(a.provider_event_id)));
        end;$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe subscription account update no longer matches the invoice ordering patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- A paid invoice does not validate the application plan that a quarantined
  -- Checkout placeholder claimed. Store the invoice but wait for a valid
  -- subscription snapshot before allowing that placeholder's account access.
  v_old := $old$      if v_applied and p_event_type in ('invoice.payment_failed', 'invoice.payment_succeeded', 'invoice.paid') then$old$;
  v_new := $new$      if v_applied and p_event_type in ('invoice.payment_failed', 'invoice.payment_succeeded', 'invoice.paid')
         and not exists (
           select 1 from public.billing_subscriptions s
           where s.organization_id = v_org_id
             and ((s.is_provider_placeholder and s.provider_status = 'plan_reconciliation_failed')
                  or s.provider_status in ('canceled', 'incomplete_expired'))
             and (v_subscription_id is null or s.stripe_subscription_id = v_subscription_id)
         ) then$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe invoice state promotion no longer matches the placeholder quarantine patch';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- Plan validation uses a dedicated failure code so malformed/unbound events
  -- cannot invalidate a different customer's placeholder. The inner savepoint
  -- rolls back first; quarantine therefore rechecks and locks current rows.
  v_old := $old$      if sqlstate in ('42501', '22023', '22P02', '22003', '23502', '23514') then
        update app_private.stripe_billing_events$old$;
  v_new := $new$      if sqlstate in ('42501', '22023', '22P02', '22003', '23502', '23514', 'P0B01') then
        if sqlstate = 'P0B01' and v_applied and p_event_type like 'customer.subscription.%' then
          perform set_config('app.privileged_write', 'on', true);
          -- Recheck binding and reacquire account -> subscription locks after
          -- rollback. The first event may have created both rows inside the
          -- rolled-back block, or bound an existing account's NULL customer.
          if not exists (
            select 1 from public.billing_accounts a
            where a.stripe_customer_id = v_customer_id and a.organization_id <> v_org_id
          ) and not exists (
            select 1 from public.billing_subscriptions s
            where s.stripe_subscription_id = v_object->>'id' and s.organization_id <> v_org_id
          ) then
            insert into public.billing_accounts (
              organization_id, stripe_customer_id, billing_state, provider_state, state_source
            ) values (v_org_id, v_customer_id, 'trial', 'uninitialized', 'stripe')
            on conflict (organization_id) do update
            set stripe_customer_id = coalesce(public.billing_accounts.stripe_customer_id, excluded.stripe_customer_id),
                updated_at = now()
            where public.billing_accounts.stripe_customer_id is null
               or excluded.stripe_customer_id is null
               or public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id
            returning id into v_account_id;
          else
            v_account_id := null;
          end if;
          if v_account_id is not null then
            -- This invalid subscription may precede its own Checkout while an
            -- earlier provisional Checkout still supplies the current org tier.
            select s.checkout_previous_package_id into v_checkout_previous_package_id
            from public.organizations o
            join public.billing_subscriptions s on s.organization_id = o.id
              and s.is_provider_placeholder and s.package_id is not distinct from o.package_id
            where o.id = v_org_id
            order by s.created_at, s.id limit 1;
            if not found then
              select o.package_id into v_checkout_previous_package_id
              from public.organizations o where o.id = v_org_id;
            end if;
            -- Persist a quarantined placeholder even before Checkout arrives.
            -- Its later metadata and invoices cannot create a provisional grant;
            -- a validated subscription snapshot can still recover the row.
            insert into public.billing_subscriptions (
              organization_id, billing_account_id, package_id, stripe_subscription_id,
              provider_status, billing_state, seat_quantity,
              provider_event_created_at, provider_event_id, is_provider_placeholder,
              checkout_previous_package_id
            ) values (
              v_org_id, v_account_id, (select o.package_id from public.organizations o where o.id = v_org_id),
              v_object->>'id', 'plan_reconciliation_failed', 'suspended', 1,
              p_event_created_at, p_event_id, true, v_checkout_previous_package_id
            )
            on conflict (stripe_subscription_id) do update
            set billing_state = 'suspended', provider_status = 'plan_reconciliation_failed', updated_at = now()
            where public.billing_subscriptions.organization_id = excluded.organization_id
              and public.billing_subscriptions.billing_account_id = excluded.billing_account_id
              and public.billing_subscriptions.is_provider_placeholder;
            get diagnostics v_count = row_count;
            if v_count > 0 then
              -- Another valid subscription must keep its own package, not the
              -- higher metadata package from a rejected second Checkout.
              select survivor.package_id into v_package_id
              from app_private.stripe_surviving_subscription_package(
                v_org_id, v_account_id, v_object->>'id') survivor;
              if found then
                update public.organizations o
                set package_id = v_package_id,
                    plan_name = coalesce((select p.name from public.packages p where p.id = v_package_id), o.plan_name),
                    updated_at = now()
                where o.id = v_org_id;
              else
                -- The comp itself is independent, but a rejected provisional
                -- package is not. Restore captured provenance, including NULL
                -- when an older placeholder has no trustworthy prior package.
                update public.organizations o
                set package_id = s.checkout_previous_package_id,
                    plan_name = (select p.name from public.packages p where p.id = s.checkout_previous_package_id),
                    updated_at = now()
                from public.billing_subscriptions s
                where o.id = v_org_id and s.organization_id = o.id
                  and s.billing_account_id = v_account_id
                  and s.stripe_subscription_id = v_object->>'id'
                  and s.is_provider_placeholder;
                -- Keep prior account event ordering: a later valid snapshot
                -- may legitimately predate the rejected event and must recover.
                update public.billing_accounts a
                set provider_state = 'suspended',
                    billing_state = case
                      when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
                      when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
                      else 'suspended' end,
                    state_source = case
                      when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
                      when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.state_source
                      else 'stripe' end,
                    suspension_reason = case
                      when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.suspension_reason
                      when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.suspension_reason
                      else 'Stripe subscription plan could not be reconciled.' end,
                    updated_at = now()
                where a.id = v_account_id
                  and (
                    a.billing_state = 'grace' and a.provider_state = 'past_due'
                    and a.grace_ends_at is not null and a.grace_ends_at <= now()
                    and exists (
                      select 1
                      from app_private.stripe_billing_events e
                      join public.billing_subscriptions s
                        on s.organization_id = a.organization_id and s.billing_account_id = a.id
                        and s.stripe_subscription_id = coalesce(
                          e.payload #>> '{data,object,parent,subscription_details,subscription}',
                          e.payload #>> '{data,object,subscription}')
                      where e.event_id = a.provider_event_id and e.organization_id = a.organization_id
                        and e.processing_status = 'applied' and e.event_type = 'invoice.payment_failed'
                        and not s.is_provider_placeholder
                        and s.provider_status not in ('canceled', 'incomplete_expired')
                        and s.stripe_subscription_id <> v_object->>'id'
                        and a.grace_ends_at = e.event_created_at + interval '7 days'
                        and (e.event_created_at, app_private.stripe_event_received_at(e.event_id))
                            > (s.provider_event_created_at, app_private.stripe_event_received_at(s.provider_event_id))
                    )
                  ) is not true;
              end if;
              update public.organizations o
              set subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
                  updated_at = now()
              where o.id = v_org_id;
            end if;
          end if;
        end if;
        update app_private.stripe_billing_events$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe failed receipt handler no longer matches the placeholder quarantine patch';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

-- Payment receipts can restore access while the subscription retains its older
-- restrictive provider snapshot. Keep that chronology intact: derive purchased
-- seat eligibility from each subscription’s newer payment receipt history.
-- A sibling event may occupy the account pointer without erasing paid seats.
-- This numeric cap does not grant access; canonical account state still controls
-- grace expiry, and the existing p_as_of period boundary remains unchanged.
do $seat_cap_migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.get_effective_entitlements(uuid,timestamptz)'::regprocedure);
  v_old := $old$    where s.organization_id = v_org_id
      and s.billing_state in ('trial', 'active', 'grace')
      and (s.current_period_end is null or s.current_period_end > p_as_of)$old$;
  v_new := $new$    where s.organization_id = v_org_id
      and not s.is_provider_placeholder
      and s.provider_status not in ('canceled', 'incomplete_expired')
      and (s.current_period_end is null or s.current_period_end > p_as_of)
      and exists (
        select 1 from public.billing_accounts a
        left join lateral (
          select e.event_type, e.event_id, e.event_created_at
          from app_private.stripe_billing_events e
          where e.organization_id = s.organization_id and e.processing_status = 'applied'
            and e.event_type in ('invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed')
            and coalesce(e.payload #>> '{data,object,parent,subscription_details,subscription}',
                         e.payload #>> '{data,object,subscription}') = s.stripe_subscription_id
          order by e.event_created_at desc, app_private.stripe_event_received_at(e.event_id) desc, e.event_id
          limit 1
        ) payment on true
        where a.id = s.billing_account_id and a.organization_id = s.organization_id
          and case
            when (payment.event_created_at, app_private.stripe_event_received_at(payment.event_id))
                 > (s.provider_event_created_at, app_private.stripe_event_received_at(s.provider_event_id))
              then payment.event_type <> 'invoice.payment_failed'
                or payment.event_created_at + interval '7 days' > p_as_of
                or (
                  v_billing_state = 'past_due' and a.billing_state in ('grace', 'past_due')
                  and a.provider_event_id = payment.event_id
                  and a.grace_ends_at = payment.event_created_at + interval '7 days'
                  and a.grace_ends_at <= p_as_of
                )
            when s.billing_state = 'active' then true
            when s.billing_state = 'trial' then s.trial_ends_at is null or s.trial_ends_at > p_as_of
            when s.billing_state = 'grace'
              then s.provider_event_created_at + interval '7 days' > p_as_of
                or (
                  v_billing_state = 'past_due' and a.billing_state in ('grace', 'past_due')
                  and a.provider_event_id = s.provider_event_id
                  and a.grace_ends_at = s.provider_event_created_at + interval '7 days'
                  and a.grace_ends_at <= p_as_of
                )
            else false
          end
      )$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe seat entitlement filter no longer matches the payment ordering patch';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$seat_cap_migration$;
