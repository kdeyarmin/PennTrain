-- Platform-wide settings/feature-flag store. Deliberately platform_admin-only at the RLS layer --
-- public consumers (signup page, maintenance banner) go through the get-platform-status edge
-- function, which exposes only the two fields that are safe to leak pre-auth, never this table
-- directly. Every setting here is wired to a real code path (see the edge functions that check
-- it) -- no decorative toggles, matching this codebase's own established standard.
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.platform_settings enable row level security;

create policy platform_settings_select on public.platform_settings for select to authenticated using (
  public.is_platform_admin()
);
create policy platform_settings_write on public.platform_settings for all to authenticated using (
  public.is_platform_admin()
) with check (
  public.is_platform_admin()
);

insert into public.platform_settings (key, value) values
  ('signup_enabled', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('default_trial_days', '14'::jsonb),
  ('ai_course_generation_enabled', 'true'::jsonb),
  ('ai_video_generation_enabled', 'true'::jsonb);

-- Read-only helper for service-role edge functions to fetch one setting's value without RLS
-- friction (service role already bypasses RLS, but this keeps the call sites terse/typed).
create or replace function public.get_platform_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.platform_settings where key = p_key;
$$;

grant execute on function public.get_platform_setting(text) to authenticated, service_role;
