-- Durable rate limit for the public report-client-error telemetry endpoint.

create table if not exists app_private.client_error_report_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists client_error_report_attempts_rate_idx
  on app_private.client_error_report_attempts (ip_hash, created_at desc);

alter table app_private.client_error_report_attempts enable row level security;
revoke all on table app_private.client_error_report_attempts from public, anon, authenticated;
grant select, insert, delete on table app_private.client_error_report_attempts to service_role;

create or replace function public.reserve_client_error_report(
  p_ip_hash text,
  p_limit integer default 30
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 then
    raise exception 'invalid_client_error_rate_args' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('client-error:' || p_ip_hash, 0));
  if (
    select count(*) from app_private.client_error_report_attempts
    where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour'
  ) >= p_limit then
    raise exception 'client_error_rate_limited' using errcode = 'P0001';
  end if;
  insert into app_private.client_error_report_attempts (ip_hash) values (p_ip_hash);
  -- Opportunistic prune of old rows for this hash (keeps the table small).
  delete from app_private.client_error_report_attempts
  where ip_hash = p_ip_hash and created_at < now() - interval '2 hours';
end;
$$;

revoke all on function public.reserve_client_error_report(text, integer) from public, anon, authenticated;
grant execute on function public.reserve_client_error_report(text, integer) to service_role;

comment on function public.reserve_client_error_report(text, integer) is
  'Peppered-IP hourly cap for report-client-error. Raises client_error_rate_limited when exceeded.';
