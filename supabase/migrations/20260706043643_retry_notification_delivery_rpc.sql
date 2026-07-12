-- notification_deliveries has select-only RLS (even for platform_admin -- see
-- notification_delivery_engine.sql) since rows are meant to be system-populated only. A retry
-- action therefore needs a SECURITY DEFINER RPC rather than a direct client update.
create or replace function public.retry_notification_delivery(p_delivery_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may retry notification deliveries' using errcode = '42501';
  end if;

  update public.notification_deliveries
  set status = 'pending', error_message = null, sent_at = null
  where id = p_delivery_id and status = 'failed';

  if not found then
    raise exception 'Delivery % not found or not in failed status', p_delivery_id using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.retry_notification_delivery(uuid) to authenticated;
revoke execute on function public.retry_notification_delivery(uuid) from anon;
