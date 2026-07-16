-- On-site "request a demo" intake for the public marketing pages. Rows are written only by the
-- request-demo Edge Function's service-role client (Cloudflare Turnstile plus a hashed-IP
-- submission cap live there -- see supabase/functions/request-demo/index.ts), so there is
-- deliberately no anon/authenticated INSERT policy. Platform admins triage submissions in-app:
-- SELECT plus a status-only UPDATE ('new' -> 'contacted' -> 'closed'). ip_hash stores a peppered
-- SHA-256 of the caller IP used only for rate limiting, never the raw address -- the same
-- privacy stance as signup_attempts.

create table public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  organization text check (char_length(organization) <= 200),
  facility_count integer check (facility_count between 1 and 1000),
  message text check (char_length(message) <= 4000),
  source_path text check (char_length(source_path) <= 300),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  ip_hash text
);

create index demo_requests_ip_created_idx on public.demo_requests(ip_hash, created_at desc);
create index demo_requests_status_created_idx on public.demo_requests(status, created_at desc);

alter table public.demo_requests enable row level security;

create policy demo_requests_admin_select on public.demo_requests
  for select to authenticated using ((select public.is_platform_admin()));
create policy demo_requests_admin_update on public.demo_requests
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

-- No client-side INSERT path at all: the anon key cannot write here even if a policy bug ever
-- appeared, because the grants are gone. The status-only UPDATE column grant keeps triage from
-- rewriting submitted contact details.
revoke all on table public.demo_requests from public, anon, authenticated, service_role;
grant select on table public.demo_requests to authenticated;
grant update (status) on public.demo_requests to authenticated;
grant all on table public.demo_requests to service_role;
