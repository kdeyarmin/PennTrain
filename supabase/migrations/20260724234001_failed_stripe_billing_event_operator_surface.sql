-- Operator surface for failed Stripe webhook dead letters (PT-057, remaining
-- slice).
--
-- 20260724180002 made poison Stripe events durable: the receipt in
-- app_private.stripe_billing_events survives with processing_status='failed'
-- and the error text. But app_private is unreachable from the client, so no
-- operator could see -- let alone act on -- the dead letters. This adds:
--
--   * list_failed_stripe_billing_events: platform-admin-only read model over
--     the dead letters (event id/type/created, tenant, provider object ids
--     extracted from the stored payload, error, timestamps).
--   * retry_failed_stripe_billing_event: replays the event through
--     public.process_stripe_billing_event. This is possible because the full
--     signed payload is stored on the receipt (payload jsonb not null since
--     20260711200648), not just its sha256. The dead-letter receipt is
--     removed inside the same transaction so the processor -- which keys its
--     receipt on event_id -- re-runs the identical code path; a transient
--     failure raises and rolls the delete back, so the dead letter is never
--     lost, while a still-poison payload simply lands back in 'failed' with
--     fresh error text.

create or replace function public.list_failed_stripe_billing_events(
  p_limit integer default 50
)
returns table (
  event_id text,
  event_type text,
  event_created_at timestamptz,
  organization_id uuid,
  organization_name text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  processing_error text,
  failed_at timestamptz,
  received_at timestamptz,
  correlation_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may inspect billing event dead letters'
      using errcode = '42501';
  end if;

  return query
  select
    e.event_id,
    e.event_type,
    e.event_created_at,
    e.organization_id,
    o.name,
    nullif(e.payload #>> '{data,object,customer}', ''),
    nullif(coalesce(
      e.payload #>> '{data,object,parent,subscription_details,subscription}',
      case when e.event_type like 'customer.subscription.%'
        then e.payload #>> '{data,object,id}'
        else e.payload #>> '{data,object,subscription}' end), ''),
    case when e.event_type like 'invoice.%'
      then nullif(e.payload #>> '{data,object,id}', '') end,
    e.processing_error,
    e.processed_at,
    e.created_at,
    e.correlation_id
  from app_private.stripe_billing_events e
  left join public.organizations o on o.id = e.organization_id
  where e.processing_status = 'failed'
  order by e.event_created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.list_failed_stripe_billing_events(integer)
  from public, anon, authenticated;
grant execute on function public.list_failed_stripe_billing_events(integer)
  to authenticated;

create or replace function public.retry_failed_stripe_billing_event(
  p_event_id text
)
returns table (
  was_duplicate boolean,
  was_applied boolean,
  was_stale boolean,
  resolved_organization_id uuid,
  canonical_state text,
  processing_status text,
  processing_error text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event app_private.stripe_billing_events%rowtype;
  v_outcome record;
  v_status text;
  v_error text;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may retry failed billing events'
      using errcode = '42501';
  end if;

  select * into v_event
  from app_private.stripe_billing_events e
  where e.event_id = p_event_id
  for update;
  if not found then
    raise exception 'Billing event not found' using errcode = 'P0002';
  end if;
  if v_event.processing_status <> 'failed' then
    raise exception 'Only failed billing events can be retried (current status: %)',
      v_event.processing_status using errcode = '22023';
  end if;

  -- Context for audit triggers on the billing tables the replay touches.
  perform set_config('app.audit_reason',
    left('Operator retry of failed Stripe event ' || p_event_id, 500), true);

  -- The processor keys its receipt on event_id, so the dead letter must be
  -- removed for the stored payload to replay through the identical code
  -- path. If the replay raises (transient failure), this whole transaction
  -- -- delete included -- rolls back and the dead letter survives untouched.
  delete from app_private.stripe_billing_events e where e.event_id = p_event_id;

  select * into v_outcome
  from public.process_stripe_billing_event(
    v_event.event_id,
    v_event.event_type,
    v_event.event_created_at,
    v_event.payload,
    v_event.payload_sha256,
    left('retry:' || v_event.correlation_id, 200)
  ) as t;

  -- The replay re-verified nothing cryptographically -- it consumed the
  -- stored payload -- so the receipt keeps the original intake evidence.
  update app_private.stripe_billing_events e
  set signature_verified_at = v_event.signature_verified_at,
      created_at = v_event.created_at
  where e.event_id = p_event_id;

  select e.processing_status, e.processing_error into v_status, v_error
  from app_private.stripe_billing_events e
  where e.event_id = p_event_id;

  return query select
    v_outcome.was_duplicate,
    v_outcome.was_applied,
    v_outcome.was_stale,
    v_outcome.resolved_organization_id,
    v_outcome.canonical_state,
    v_status,
    v_error;
end;
$$;
revoke all on function public.retry_failed_stripe_billing_event(text)
  from public, anon, authenticated;
grant execute on function public.retry_failed_stripe_billing_event(text)
  to authenticated;
