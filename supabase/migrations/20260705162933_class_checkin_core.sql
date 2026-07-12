-- Rotating short-lived signed token for QR check-in: a DB-backed random token rather than a
-- stateless HMAC scheme -- simpler to validate (does this token exist and is it unexpired?) and
-- fits this schema's existing style of relying on Postgres/RLS over external crypto.
create table public.class_checkin_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(9), 'base64'),
  class_id uuid not null references public.training_classes(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  created_at timestamptz not null default now()
);
create index class_checkin_tokens_class_idx on public.class_checkin_tokens(class_id);
create index class_checkin_tokens_expires_idx on public.class_checkin_tokens(expires_at);
alter table public.class_checkin_tokens enable row level security;

-- Verified seat-time timestamps -- refine (not replace) the existing `attended` boolean flag:
-- an instructor can still mark attendance manually with no timestamps (Tier 1 behavior
-- preserved), while a QR/kiosk check-in additionally captures when they arrived/left so
-- complete_training_class() can compute actual hours instead of always using the class's fixed
-- duration_hours.
alter table public.training_class_attendees
  add column checked_in_at timestamptz,
  add column checked_out_at timestamptz,
  add column checkin_method text check (checkin_method in ('qr','kiosk_pin','manual'));

-- A hashed PIN for kiosk-mode self check-in on a shared facility tablet -- sha256 (via pgcrypto,
-- already enabled), not a reversible credential; null until an admin sets one for this employee.
alter table public.employees add column checkin_pin_hash text;
