-- On-site "email me my savings model" intake for the public /savings calculator. Rows are written
-- only by the email-savings-model Edge Function's service-role client (Cloudflare Turnstile plus a
-- hashed-IP submission cap live there -- see supabase/functions/email-savings-model/index.ts), so
-- there is deliberately no anon/authenticated INSERT policy. The row doubles as a warm-lead record
-- platform admins can review (SELECT only; append-only, never updated from the client). ip_hash
-- stores a peppered SHA-256 of the caller IP used only for rate limiting, never the raw address --
-- the same privacy stance as demo_requests / signup_attempts.

create table public.savings_model_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null check (char_length(email) between 3 and 320),
  weekly_admin_hours integer check (weekly_admin_hours between 0 and 1000),
  loaded_hourly_rate integer check (loaded_hourly_rate between 0 and 10000),
  monthly_tool_spend integer check (monthly_tool_spend between 0 and 1000000),
  expected_reduction_percent integer check (expected_reduction_percent between 0 and 100),
  facility_count integer check (facility_count between 1 and 1000),
  gross_opportunity integer,
  net_after_carebase integer,
  ip_hash text
);

create index savings_model_requests_ip_created_idx on public.savings_model_requests(ip_hash, created_at desc);
create index savings_model_requests_created_idx on public.savings_model_requests(created_at desc);

alter table public.savings_model_requests enable row level security;

create policy savings_model_requests_admin_select on public.savings_model_requests
  for select to authenticated using ((select public.is_platform_admin()));

-- No client-side write path at all: only the service-role Edge Function writes here, and it only
-- ever INSERTs. Grants are stripped from anon/authenticated so the anon key cannot write even if a
-- policy bug ever appeared.
revoke all on table public.savings_model_requests from public, anon, authenticated, service_role;
grant select on table public.savings_model_requests to authenticated;
grant all on table public.savings_model_requests to service_role;
