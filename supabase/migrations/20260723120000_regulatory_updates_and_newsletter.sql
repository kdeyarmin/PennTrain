-- Public-facing regulatory-update feed + marketing newsletter capture.
--
-- Two surfaces are added here, both wired to the public marketing site:
--
--   1. public.regulatory_updates -- a curated, human-authored feed of Pennsylvania
--      regulation changes, clarifications, and guidance. Platform admins publish
--      entries; the signed-out marketing page reads only *published* rows through the
--      SECURITY DEFINER list_regulatory_updates() RPC (the same anon-read pattern as
--      verify_certificate -- no anon table grant). This is distinct from the internal
--      regulatory_update_sources/regulatory_change_proposals monitoring pipeline, which
--      watches official source pages for machine-detected diffs; this table is the
--      editorial layer operators actually read.
--
--   2. public.newsletter_subscribers -- email capture for the "get regulatory updates by
--      email" signup. Rows are written only by the subscribe-updates Edge Function's
--      service-role client (Cloudflare Turnstile + a hashed-IP submission cap live there,
--      mirroring request-demo/demo_requests), so there is deliberately no anon/authenticated
--      INSERT policy. ip_hash stores a peppered SHA-256 of the caller IP for rate limiting
--      only, never the raw address.

-- ---------------------------------------------------------------------------
-- 1. Regulatory updates feed (editorial content, platform_admin managed)
-- ---------------------------------------------------------------------------

create table public.regulatory_updates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stable, URL-safe identifier for per-update deep links and de-duplication.
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 160),
  title text not null check (char_length(title) between 3 and 200),
  summary text not null check (char_length(summary) between 3 and 600),
  -- Long-form body, rendered as simple paragraphs on the marketing page.
  body text check (char_length(body) <= 20000),
  category text not null default 'update'
    check (category in ('new_regulation', 'clarification', 'update', 'guidance', 'enforcement')),
  -- Stored facility_type codes (PCH, ALR, ...). The label layer maps ALR -> "Assisted
  -- Living Facility (ALF)"; see src/lib/facilityTypes.ts. Empty array = applies broadly.
  facility_types text[] not null default '{}'::text[],
  -- The regulation citation this update concerns, e.g. "55 Pa. Code Chapter 2600".
  citation text check (char_length(citation) <= 200),
  state text not null default 'PA' check (char_length(state) between 2 and 40),
  source_name text check (char_length(source_name) <= 200),
  source_uri text check (char_length(source_uri) <= 2048),
  -- Date the underlying regulatory change takes/took effect (may differ from published_at).
  effective_date date,
  published_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_featured boolean not null default false,
  created_by uuid references auth.users(id) on delete set null
);

create index regulatory_updates_public_feed_idx
  on public.regulatory_updates(published_at desc)
  where status = 'published';
create index regulatory_updates_status_idx
  on public.regulatory_updates(status, published_at desc);
create index regulatory_updates_category_idx
  on public.regulatory_updates(category);

create trigger set_updated_at before update on public.regulatory_updates
  for each row execute function public.set_updated_at();

alter table public.regulatory_updates enable row level security;

-- Platform admins are the sole editors: full CRUD, gated by is_platform_admin(). Signed-out
-- visitors never touch the table directly -- they read published rows via the RPC below.
create policy regulatory_updates_admin_select on public.regulatory_updates
  for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_updates_admin_insert on public.regulatory_updates
  for insert to authenticated with check ((select public.is_platform_admin()));
create policy regulatory_updates_admin_update on public.regulatory_updates
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));
create policy regulatory_updates_admin_delete on public.regulatory_updates
  for delete to authenticated using ((select public.is_platform_admin()));

revoke all on table public.regulatory_updates from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.regulatory_updates to authenticated;
grant all on table public.regulatory_updates to service_role;

-- Public read path: returns only published rows, newest first, optionally filtered by
-- category or facility type. SECURITY DEFINER so anon callers never need a table grant --
-- draft/archived content is unreachable because the WHERE clause is fixed here.
create or replace function public.list_regulatory_updates(
  p_category text default null,
  p_facility_type text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  slug text,
  title text,
  summary text,
  body text,
  category text,
  facility_types text[],
  citation text,
  state text,
  source_name text,
  source_uri text,
  effective_date date,
  published_at timestamptz,
  is_featured boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    u.id, u.slug, u.title, u.summary, u.body, u.category, u.facility_types,
    u.citation, u.state, u.source_name, u.source_uri, u.effective_date,
    u.published_at, u.is_featured
  from public.regulatory_updates u
  where u.status = 'published'
    and u.published_at is not null
    and (p_category is null or u.category = p_category)
    and (p_facility_type is null or p_facility_type = any(u.facility_types))
  order by u.is_featured desc, u.published_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

revoke all on function public.list_regulatory_updates(text, text, integer) from public;
grant execute on function public.list_regulatory_updates(text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Newsletter / regulatory-update email subscribers (marketing capture)
-- ---------------------------------------------------------------------------

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stored lowercased by the Edge Function; unique so re-subscribing upserts one row.
  email text not null unique check (char_length(email) between 3 and 320),
  name text check (char_length(name) <= 200),
  organization text check (char_length(organization) <= 200),
  source_path text check (char_length(source_path) <= 300),
  -- What the subscriber opted into (e.g. 'regulatory_updates', 'product_news'). Drives which
  -- drip campaigns a given contact receives.
  topics text[] not null default '{regulatory_updates}'::text[],
  status text not null default 'subscribed'
    check (status in ('subscribed', 'unsubscribed', 'bounced')),
  -- Set once double opt-in is confirmed; null until then (single opt-in still delivers).
  confirmed_at timestamptz,
  -- Opaque token for one-click unsubscribe links in outbound email.
  unsubscribe_token uuid not null default gen_random_uuid(),
  ip_hash text
);

create index newsletter_subscribers_status_created_idx
  on public.newsletter_subscribers(status, created_at desc);
create index newsletter_subscribers_ip_created_idx
  on public.newsletter_subscribers(ip_hash, created_at desc);

create trigger set_updated_at before update on public.newsletter_subscribers
  for each row execute function public.set_updated_at();

alter table public.newsletter_subscribers enable row level security;

-- Platform admins triage/manage the list (view, edit status, delete on request). There is no
-- client INSERT path: the subscribe-updates Edge Function's service-role client owns writes,
-- after Turnstile + rate-limit checks. The anon key cannot write here even if a policy bug
-- appeared, because the grants below are gone.
create policy newsletter_subscribers_admin_select on public.newsletter_subscribers
  for select to authenticated using ((select public.is_platform_admin()));
create policy newsletter_subscribers_admin_update on public.newsletter_subscribers
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));
create policy newsletter_subscribers_admin_delete on public.newsletter_subscribers
  for delete to authenticated using ((select public.is_platform_admin()));

revoke all on table public.newsletter_subscribers from public, anon, authenticated, service_role;
grant select, update, delete on table public.newsletter_subscribers to authenticated;
grant all on table public.newsletter_subscribers to service_role;

-- ---------------------------------------------------------------------------
-- 3. Seed the feed so the public page renders on first deploy. Real Pennsylvania
--    Chapter 2600 (PCH) / Chapter 2800 (ALF) references; slugs are stable.
-- ---------------------------------------------------------------------------

-- state defaults to 'PA' for every seed row, so it is omitted from the column list below.
insert into public.regulatory_updates
  (slug, title, summary, body, category, facility_types, citation, source_name, source_uri, effective_date, published_at, status, is_featured)
values
  (
    'pch-annual-training-hours-2600-65',
    'Personal care home annual training requirement stays at 12 hours',
    'Chapter 2600 continues to require 12 hours of annual training for direct-care staff, with orientation and first-aid/CPR tracked separately. A quick refresher on how the hours break down.',
    E'Under 55 Pa. Code § 2600.65, each direct-care staff person in a personal care home must complete a minimum of 12 hours of annual training relevant to their job duties.\n\nThe 12 annual hours are separate from the initial orientation and from first-aid/CPR certification, which carry their own requirements. Administrators must complete their own annual training in addition to staff hours.\n\nCareBase tracks each staff member''s annual hours against their assignment date, flags shortfalls before the anniversary, and produces the per-employee training summary surveyors ask for.',
    'clarification',
    array['PCH'],
    '55 Pa. Code § 2600.65',
    'PA Department of Human Services',
    'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/chap2600toc.html',
    date '2026-01-01',
    timestamptz '2026-06-02 13:00:00+00',
    'published',
    true
  ),
  (
    'alf-annual-training-hours-2800-65',
    'Assisted living facilities: 16 annual training hours confirmed',
    'Chapter 2800 requires 16 hours of annual training for direct-care staff at assisted living facilities — four more than personal care homes. Here is what counts and how to evidence it.',
    E'Direct-care staff at an assisted living facility must complete at least 16 hours of annual training under 55 Pa. Code § 2800.65 — four hours more than the personal care home standard.\n\nDementia-specific training, medication administration, and job-specific competencies all count toward the total when documented. Keep the completion evidence (rosters, certificates, competency sign-offs) attached to each staff record so it is producible on survey day.\n\nCareBase applies the correct 16-hour target automatically to facilities coded as assisted living and surfaces the gap per employee.',
    'update',
    array['ALR'],
    '55 Pa. Code § 2800.65',
    'PA Department of Human Services',
    'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/chap2800toc.html',
    date '2026-01-01',
    timestamptz '2026-06-02 13:05:00+00',
    'published',
    true
  ),
  (
    'medication-administration-training-refresh',
    'Medication administration training and observation — documentation reminder',
    'A reminder on the medication administration training records surveyors expect for both PCH and ALF staff, including practicum observation and retraining after an error.',
    E'Both Chapter 2600 and Chapter 2800 require staff who administer medications to complete the Department-approved medication administration training, including a supervised practicum observation, before they administer medications unsupervised.\n\nAfter a medication error, retraining and a fresh observation are expected. Keep the observer, date, and outcome on record for each cycle.\n\nCareBase logs each medication-administration practicum, tracks the observation record, and schedules retraining when an error is recorded against a staff member.',
    'guidance',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.190, 2800.190',
    'PA Department of Human Services',
    'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/chap2800toc.html',
    date '2026-03-01',
    timestamptz '2026-05-19 14:30:00+00',
    'published',
    false
  ),
  (
    'resident-assessment-support-plan-timelines',
    'Resident assessment and support-plan timelines: what triggers a re-assessment',
    'The initial assessment, support-plan development, and re-assessment timelines that drive resident compliance — and the change-of-condition events that reset the clock.',
    E'Chapter 2600 and Chapter 2800 both set timelines for the initial resident assessment and support plan, then require re-assessment at least annually and upon a significant change in condition.\n\nA hospitalization, a fall with injury, or a documented change in status can each trigger an earlier re-assessment and a support-plan update. Missing these windows is a common citation.\n\nCareBase tracks each resident''s assessment and support-plan dates, opens a task on a logged change of condition, and shows which residents are approaching or past their re-assessment window.',
    'update',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.224–2600.228, 2800.224–2800.228',
    'PA Department of Human Services',
    'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2600/chap2600toc.html',
    date '2026-02-15',
    timestamptz '2026-04-28 15:00:00+00',
    'published',
    false
  ),
  (
    'fire-safety-drills-documentation',
    'Fire drills: frequency, shift coverage, and the records surveyors check',
    'Unannounced fire drills must cover every shift over time and be documented with date, time, and evacuation duration. A summary of the recordkeeping expectation.',
    E'Personal care homes and assisted living facilities must conduct unannounced fire drills on a recurring basis, rotating across shifts so that every shift is drilled over time. Each drill must be documented — date, time of day, shift, evacuation time, and any problems identified with corrective follow-up.\n\nSurveyors frequently review the drill log for shift coverage and for evidence that identified problems were corrected.\n\nCareBase logs each fire drill, tracks shift coverage across the required window, and flags when a shift has not been drilled recently.',
    'guidance',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.131, 2800.131',
    'PA Department of Human Services',
    'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/055/chapter2800/chap2800toc.html',
    date '2026-03-20',
    timestamptz '2026-03-31 16:00:00+00',
    'published',
    false
  );
