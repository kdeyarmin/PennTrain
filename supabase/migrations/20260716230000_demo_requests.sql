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

-- Triage may change status only -- a submitted request's contact details are immutable through
-- the client path. Enforced by trigger rather than a column-level grant: the phase1 access
-- matrix requires every authenticated RLS command to carry its matching TABLE-level grant
-- (has_table_privilege ignores column grants), so the UPDATE grant below is table-wide and this
-- trigger provides the column scoping. The service-role writer (the request-demo Edge Function)
-- only ever INSERTs, so it is unaffected.
create or replace function app_private.demo_requests_status_only_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.name is distinct from old.name
    or new.email is distinct from old.email
    or new.organization is distinct from old.organization
    or new.facility_count is distinct from old.facility_count
    or new.message is distinct from old.message
    or new.source_path is distinct from old.source_path
    or new.ip_hash is distinct from old.ip_hash
  then
    raise exception 'demo_requests updates may only change status';
  end if;
  return new;
end;
$$;

create trigger demo_requests_status_only_update
  before update on public.demo_requests
  for each row execute function app_private.demo_requests_status_only_update();

-- No client-side INSERT path at all: the anon key cannot write here even if a policy bug ever
-- appeared, because the grants are gone.
revoke all on table public.demo_requests from public, anon, authenticated, service_role;
grant select on table public.demo_requests to authenticated;
grant update on table public.demo_requests to authenticated;
grant all on table public.demo_requests to service_role;
