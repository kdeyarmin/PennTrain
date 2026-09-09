-- Customer Portal changes subscription item prices, but retains the metadata
-- copied from the original Checkout. Reconcile the purchased package from the
-- signed current items so an upgrade/downgrade also changes app entitlements.
-- Keep the existing freshness guard, tenant binding and failed-event receipt.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.process_stripe_billing_event(text,text,timestamptz,jsonb,text,text)'::regprocedure);

  -- Checkout metadata is useful only until the subscription itself has been
  -- reconciled. Its delayed first delivery must not undo a later Portal change.
  v_old := $old$      if v_package_id is not null then
        update public.organizations o$old$;
  v_new := $new$      if v_package_id is not null and not exists (
        select 1 from public.billing_subscriptions s
        where s.stripe_subscription_id = v_subscription_id
          and not s.is_provider_placeholder
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
          if jsonb_typeof(v_items) <> 'array'
             or coalesce(v_object #> '{items,has_more}', 'false'::jsonb) <> 'false'::jsonb then
            raise exception 'Subscription plan requires a complete item list'
              using errcode = '22023';
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
              using errcode = '22023';
          elsif coalesce(cardinality(v_packages), 0) = 1 then
            if v_unknown_items > 0 then
              raise exception 'Subscription plan includes an unmapped or incomplete item'
                using errcode = '22023';
            end if;
            v_package_id := v_packages[1];
          elsif v_catalog_managed then
            -- A terminal event can omit removed items. It may end the current
            -- plan, but cannot introduce a different package through metadata.
            if jsonb_array_length(v_items) = 0
               and v_provider_status in ('canceled', 'incomplete_expired') then
              select coalesce(s.package_id, o.package_id) into v_package_id
              from public.billing_subscriptions s
              join public.organizations o on o.id = s.organization_id
              where s.id = v_subscription_pk;
            else
              raise exception 'Subscription plan has no recognized application price'
                using errcode = '22023';
            end if;
          else
            v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
          end if;

          update public.billing_subscriptions
          set package_id = coalesce(v_package_id, package_id)
          where id = v_subscription_pk;
        end;

        delete from public.billing_subscription_items
        where subscription_id = v_subscription_pk;$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Stripe subscription freshness block no longer matches the plan reconciliation patch';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;
