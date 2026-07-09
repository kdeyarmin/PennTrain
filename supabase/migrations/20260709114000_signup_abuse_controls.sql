-- Private signup abuse ledger used only by the signup-organization Edge Function's service-role
-- client. It stores hashes, not raw IP addresses or email addresses, and has no client policies.
create table public.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  ip_hash text not null,
  success boolean not null default false,
  error_code text,
  created_at timestamptz not null default now()
);

create index signup_attempts_ip_created_idx on public.signup_attempts(ip_hash, created_at desc);
create index signup_attempts_email_created_idx on public.signup_attempts(email_hash, created_at desc);
create index signup_attempts_created_idx on public.signup_attempts(created_at desc);

alter table public.signup_attempts enable row level security;
revoke all on table public.signup_attempts from public, anon, authenticated;
grant select, insert on table public.signup_attempts to service_role;
