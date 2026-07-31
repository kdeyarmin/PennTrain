-- Per-connection SCIM rate limiting (audit residual: credential theft could
-- mass provision / map org_admin without a throttle). Mirrors integration API.

alter table public.scim_connections
  add column if not exists rate_limit_per_minute integer not null default 60
    check (rate_limit_per_minute between 1 and 10000);

create table if not exists app_private.scim_rate_limit_windows (
  connection_id uuid not null references public.scim_connections(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (connection_id, window_started_at)
);

alter table app_private.scim_rate_limit_windows enable row level security;
revoke all on table app_private.scim_rate_limit_windows from public, anon, authenticated;
grant select, insert, update, delete on table app_private.scim_rate_limit_windows to service_role;

create or replace function public.consume_scim_rate_limit(
  p_connection_id uuid,
  p_cost integer default 1
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  if p_cost < 1 or p_cost > 100 then
    raise exception 'Invalid rate-limit cost' using errcode = '22023';
  end if;
  select c.rate_limit_per_minute into v_limit
  from public.scim_connections c
  where c.id = p_connection_id
    and c.status in ('pilot', 'active');
  if v_limit is null then
    return query select false, 0, v_window + interval '1 minute';
    return;
  end if;
  insert into app_private.scim_rate_limit_windows (
    connection_id, window_started_at, request_count
  ) values (p_connection_id, v_window, p_cost)
  on conflict (connection_id, window_started_at) do update
    set request_count = app_private.scim_rate_limit_windows.request_count + excluded.request_count
  returning request_count into v_count;
  return query select
    v_count <= v_limit,
    greatest(v_limit - v_count, 0),
    v_window + interval '1 minute';
end;
$$;

revoke all on function public.consume_scim_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_scim_rate_limit(uuid, integer) to service_role;

comment on function public.consume_scim_rate_limit(uuid, integer) is
  'Per-minute SCIM connection throttle. Service-role only; called after credential verification.';
