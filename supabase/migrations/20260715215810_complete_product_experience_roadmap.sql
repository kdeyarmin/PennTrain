-- Complete product-experience roadmap (D2-D10).
--
-- This migration is deliberately forward-only. The platform-intelligence work
-- (A1-C3) is already live; this release composes those primitives into the
-- shared-device, communication, portability, navigation, identity, sandbox,
-- digest, and product-discovery experiences requested by the roadmap.

-- ---------------------------------------------------------------------------
-- D2 / D6 / D7 / D8 / D10: additive configuration and release metadata
-- ---------------------------------------------------------------------------

alter table public.organization_settings
  add column idle_timeout_minutes integer not null default 30
    check (idle_timeout_minutes between 5 and 480),
  add column kiosk_idle_timeout_minutes integer not null default 5
    check (kiosk_idle_timeout_minutes between 1 and 60),
  add column hidden_navigation_sections text[] not null default '{}'::text[];

alter table public.facilities
  add column is_sandbox boolean not null default false,
  add column sandbox_seed_version integer,
  add column sandbox_reset_at timestamptz,
  add constraint facilities_sandbox_seed_check check (
    (not is_sandbox and sandbox_seed_version is null)
    or (is_sandbox and sandbox_seed_version is not null and sandbox_seed_version > 0)
  );

create unique index one_active_sandbox_facility_per_org
  on public.facilities(organization_id)
  where is_sandbox and is_active;

alter table public.employees add column is_synthetic boolean not null default false;
alter table public.residents add column is_synthetic boolean not null default false;

alter table public.release_flags
  add column changelog_title text,
  add column changelog_summary text,
  add column help_path text,
  add column released_at timestamptz,
  add constraint release_flags_changelog_shape_check check (
    (changelog_title is null and changelog_summary is null and help_path is null)
    or (
      length(btrim(changelog_title)) between 3 and 120
      and length(btrim(changelog_summary)) between 10 and 500
      and (help_path is null or help_path ~ '^/')
    )
  );

-- The release-flag control plane is the source of truth for customer-visible
-- changes. When a flag is enabled for the first time, preserve that release
-- timestamp rather than making the changelog depend on mutable updated_at.
create or replace function app_private.stamp_release_flag_changelog()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.is_enabled and (tg_op = 'INSERT' or not old.is_enabled)
     and new.changelog_title is not null then
    new.released_at := coalesce(new.released_at, now());
  end if;
  return new;
end;
$function$;

create trigger stamp_release_flag_changelog
before insert or update on public.release_flags
for each row execute function app_private.stamp_release_flag_changelog();

-- ---------------------------------------------------------------------------
-- D6: durable favorites and recently visited pages
-- ---------------------------------------------------------------------------

create table public.navigation_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  favorite_paths text[] not null default '{}'::text[],
  recent_paths jsonb not null default '[]'::jsonb
    check (jsonb_typeof(recent_paths) = 'array' and jsonb_array_length(recent_paths) <= 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.navigation_preferences
for each row execute function public.set_updated_at();

alter table public.navigation_preferences enable row level security;
create policy navigation_preferences_self_select on public.navigation_preferences
  for select to authenticated using (profile_id = (select auth.uid()));
create policy navigation_preferences_self_insert on public.navigation_preferences
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and organization_id is not distinct from (select public.current_org_id())
  );
create policy navigation_preferences_self_update on public.navigation_preferences
  for update to authenticated using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and organization_id is not distinct from (select public.current_org_id())
  );

revoke all on table public.navigation_preferences from public, anon, authenticated, service_role;
grant select, insert, update on table public.navigation_preferences to authenticated;
grant all on table public.navigation_preferences to service_role;

create or replace function public.record_navigation_visit(p_path text, p_label text)
returns public.navigation_preferences
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_path text := split_part(split_part(btrim(coalesce(p_path, '')), '?', 1), '#', 1);
  v_label text := btrim(coalesce(p_label, ''));
  v_row public.navigation_preferences%rowtype;
begin
  if auth.uid() is null or v_path !~ '^/(admin|app|trainer|me|account)(/|$)'
     or length(v_path) > 300 or length(v_label) not between 1 and 120 then
    raise exception 'Navigation visit is invalid' using errcode = '22023';
  end if;

  insert into public.navigation_preferences (
    profile_id, organization_id, recent_paths
  ) values (
    auth.uid(), public.current_org_id(),
    jsonb_build_array(jsonb_build_object('path', v_path, 'label', v_label, 'visitedAt', now()))
  )
  on conflict (profile_id) do update set
    recent_paths = (
      select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
      from (
        select item, ordinal
        from jsonb_array_elements(
          jsonb_build_array(jsonb_build_object(
            'path', v_path, 'label', v_label, 'visitedAt', now()
          )) || coalesce(navigation_preferences.recent_paths, '[]'::jsonb)
        ) with ordinality as entries(item, ordinal)
        where item->>'path' is distinct from v_path or ordinal = 1
        order by ordinal
        limit 12
      ) kept
    ),
    organization_id = excluded.organization_id,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.record_navigation_visit(text,text) from public, anon;
grant execute on function public.record_navigation_visit(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- D3: organization announcements and lightweight read receipts
-- ---------------------------------------------------------------------------

create table public.org_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  body text not null check (length(btrim(body)) between 3 and 5000),
  audience_roles text[] not null default '{}'::text[]
    check (audience_roles <@ array[
      'org_admin','facility_manager','trainer','employee','auditor'
    ]::text[]),
  audience_facility_ids uuid[] not null default '{}'::uuid[],
  expires_at timestamptz,
  published_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);

create index org_announcements_active_idx
  on public.org_announcements(organization_id, published_at desc)
  where expires_at is null;

create table public.org_announcement_receipts (
  announcement_id uuid not null references public.org_announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

create index org_announcement_receipts_profile_idx
  on public.org_announcement_receipts(profile_id, seen_at desc);

create trigger set_updated_at before update on public.org_announcements
for each row execute function public.set_updated_at();

create or replace function app_private.profile_matches_announcement(
  p_announcement public.org_announcements,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.is_active
      and p.organization_id = p_announcement.organization_id
      and (
        cardinality(p_announcement.audience_roles) = 0
        or p.role = any(p_announcement.audience_roles)
      )
      and (
        cardinality(p_announcement.audience_facility_ids) = 0
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = p.id
            and fa.facility_id = any(p_announcement.audience_facility_ids)
        )
        or exists (
          select 1 from public.employees e
          where e.profile_id = p.id
            and e.facility_id = any(p_announcement.audience_facility_ids)
        )
      )
  );
$function$;

alter table public.org_announcements enable row level security;
alter table public.org_announcement_receipts enable row level security;

create policy org_announcements_visible on public.org_announcements
  for select to authenticated using (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and published_at <= now()
      and (expires_at is null or expires_at > now())
      and app_private.profile_matches_announcement(org_announcements, (select auth.uid()))
    )
  );
create policy org_announcement_receipts_self_select on public.org_announcement_receipts
  for select to authenticated using (profile_id = (select auth.uid()));

revoke all on table public.org_announcements, public.org_announcement_receipts
  from public, anon, authenticated, service_role;
grant select on table public.org_announcements, public.org_announcement_receipts to authenticated;
grant all on table public.org_announcements, public.org_announcement_receipts to service_role;

create or replace function public.publish_org_announcement(
  p_title text,
  p_body text,
  p_audience_roles text[] default '{}'::text[],
  p_audience_facility_ids uuid[] default '{}'::uuid[],
  p_expires_at timestamptz default null
)
returns public.org_announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_announcement public.org_announcements%rowtype;
begin
  if v_org_id is null or public.current_role() not in ('org_admin','facility_manager') then
    raise exception 'Only organization administrators and facility managers may publish announcements'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160
     or length(btrim(coalesce(p_body,''))) not between 3 and 5000
     or p_audience_roles is null
     or not p_audience_roles <@ array[
       'org_admin','facility_manager','trainer','employee','auditor'
     ]::text[]
     or (p_expires_at is not null and p_expires_at <= now()) then
    raise exception 'Announcement content or audience is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_audience_facility_ids) requested(id)
    where not exists (
      select 1 from public.facilities f
      where f.id = requested.id and f.organization_id = v_org_id and f.is_active
        and not f.is_sandbox
        and (public.current_role() = 'org_admin' or public.is_assigned_to_facility(f.id))
    )
  ) then
    raise exception 'Announcement facility audience is outside your active scope'
      using errcode = '42501';
  end if;

  insert into public.org_announcements (
    organization_id, title, body, audience_roles, audience_facility_ids,
    expires_at, created_by
  ) values (
    v_org_id, btrim(p_title), btrim(p_body), p_audience_roles,
    p_audience_facility_ids, p_expires_at, auth.uid()
  ) returning * into v_announcement;

  insert into public.notifications (
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_org_id, p.id, 'announcement_published', v_announcement.title,
    left(v_announcement.body, 500), '/account/announcements'
  from public.profiles p
  where app_private.profile_matches_announcement(v_announcement, p.id);

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'org_announcement', v_announcement.id::text,
    'published', jsonb_build_object(
      'audienceRoles', p_audience_roles,
      'audienceFacilityIds', p_audience_facility_ids,
      'expiresAt', p_expires_at
    )
  );
  return v_announcement;
end;
$function$;

create or replace function public.mark_org_announcement_seen(p_announcement_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_announcement public.org_announcements%rowtype;
  v_seen_at timestamptz;
begin
  select * into v_announcement from public.org_announcements
  where id = p_announcement_id;
  if v_announcement.id is null
     or not app_private.profile_matches_announcement(v_announcement, auth.uid()) then
    raise exception 'Announcement is not available to this profile' using errcode = '42501';
  end if;
  insert into public.org_announcement_receipts (
    announcement_id, profile_id, organization_id
  ) values (v_announcement.id, auth.uid(), v_announcement.organization_id)
  on conflict (announcement_id, profile_id) do update
    set seen_at = least(org_announcement_receipts.seen_at, excluded.seen_at)
  returning seen_at into v_seen_at;
  return v_seen_at;
end;
$function$;

create or replace function public.get_announcement_read_summary(p_announcement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_announcement public.org_announcements%rowtype;
begin
  select * into v_announcement from public.org_announcements where id = p_announcement_id;
  if v_announcement.id is null
     or not (
       public.is_platform_admin()
       or (
         v_announcement.organization_id = public.current_org_id()
         and public.current_role() in ('org_admin','facility_manager')
       )
     ) then
    raise exception 'Announcement summary is outside your scope' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'audienceCount', (
      select count(*) from public.profiles p
      where app_private.profile_matches_announcement(v_announcement, p.id)
    ),
    'seenCount', (
      select count(*) from public.org_announcement_receipts r
      where r.announcement_id = v_announcement.id
    )
  );
end;
$function$;

revoke all on function public.publish_org_announcement(text,text,text[],uuid[],timestamptz),
  public.mark_org_announcement_seen(uuid), public.get_announcement_read_summary(uuid)
  from public, anon;
grant execute on function public.publish_org_announcement(text,text,text[],uuid[],timestamptz),
  public.mark_org_announcement_seen(uuid), public.get_announcement_read_summary(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- D4: employee-owned, revocable portable training passport
-- ---------------------------------------------------------------------------

create table public.training_passports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  slug text not null unique default encode(extensions.gen_random_bytes(18), 'hex')
    check (slug ~ '^[0-9a-f]{36}$'),
  is_active boolean not null default true,
  include_expired boolean not null default false,
  last_shared_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create trigger set_updated_at before update on public.training_passports
for each row execute function public.set_updated_at();

alter table public.training_passports enable row level security;
create policy training_passports_owner_select on public.training_passports
  for select to authenticated using (
    profile_id = (select auth.uid())
    or (select public.is_platform_admin())
  );

revoke all on table public.training_passports from public, anon, authenticated, service_role;
grant select on table public.training_passports to authenticated;
grant all on table public.training_passports to service_role;

create or replace function public.enable_my_training_passport(
  p_include_expired boolean default false
)
returns public.training_passports
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_passport public.training_passports%rowtype;
begin
  select * into v_employee from public.employees
  where profile_id = auth.uid() and status <> 'terminated';
  if v_employee.id is null then
    raise exception 'A linked employee record is required' using errcode = '42501';
  end if;
  insert into public.training_passports (
    employee_id, organization_id, profile_id, include_expired
  ) values (
    v_employee.id, v_employee.organization_id, auth.uid(), p_include_expired
  ) on conflict (employee_id) do update set
    slug = case when training_passports.is_active then training_passports.slug
      else encode(extensions.gen_random_bytes(18), 'hex') end,
    is_active = true,
    include_expired = excluded.include_expired,
    revoked_at = null,
    updated_at = now()
  returning * into v_passport;
  return v_passport;
end;
$function$;

create or replace function public.revoke_my_training_passport()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.training_passports
  set is_active = false, revoked_at = now(), updated_at = now()
  where profile_id = auth.uid() and is_active;
end;
$function$;

create or replace function public.verify_training_passport(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_passport public.training_passports%rowtype;
  v_employee public.employees%rowtype;
  v_certificate_count integer;
  v_total_hours numeric;
  v_certificates jsonb;
begin
  if p_slug is null or p_slug !~ '^[0-9a-f]{36}$' then return null; end if;
  select * into v_passport from public.training_passports
  where slug = p_slug and is_active;
  if v_passport.id is null then return null; end if;
  select * into v_employee from public.employees where id = v_passport.employee_id;
  if v_employee.id is null then return null; end if;

  select count(*),
    coalesce(sum(coalesce(c.estimated_duration_minutes, 0)) / 60.0, 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'certificateId', cert.id,
      'credentialNumber', cert.credential_number,
      'courseTitle', c.title,
      'issuedAt', cert.issued_at,
      'expiresAt', cert.expires_at,
      'isValid', cert.expires_at is null or cert.expires_at > now(),
      'verificationPath', '/verify/' || cert.slug,
      'ceHours', round(coalesce(c.estimated_duration_minutes, 0) / 60.0, 2)
    ) order by cert.issued_at desc), '[]'::jsonb)
  into v_certificate_count, v_total_hours, v_certificates
  from public.certificates cert
  join public.courses c on c.id = cert.course_id
  where cert.employee_id = v_employee.id
    and (
      v_passport.include_expired
      or cert.expires_at is null
      or cert.expires_at > now()
    );

  return jsonb_build_object(
    'passportId', v_passport.id,
    'employeeName', btrim(v_employee.first_name || ' ' || v_employee.last_name),
    'generatedAt', now(),
    'certificateCount', v_certificate_count,
    'totalCeHours', round(v_total_hours, 2),
    'certificates', v_certificates
  );
end;
$function$;

revoke all on function public.enable_my_training_passport(boolean),
  public.revoke_my_training_passport(), public.verify_training_passport(text)
  from public, anon, authenticated, service_role;
grant execute on function public.enable_my_training_passport(boolean),
  public.revoke_my_training_passport() to authenticated;
grant execute on function public.verify_training_passport(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- D5: asynchronous, complete organization data-export packages
-- ---------------------------------------------------------------------------

create table public.organization_export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  storage_bucket text,
  storage_path text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check (byte_size is null or byte_size > 0),
  table_count integer check (table_count is null or table_count >= 0),
  row_count bigint check (row_count is null or row_count >= 0),
  expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'processing'
    or (locked_at is not null and lock_token is not null)
  ),
  check (
    status <> 'succeeded'
    or (
      storage_bucket is not null and storage_path is not null
      and content_sha256 is not null and byte_size is not null
      and table_count is not null and row_count is not null
      and completed_at is not null and expires_at is not null
    )
  )
);

create index organization_export_jobs_claim_idx
  on public.organization_export_jobs(available_at, requested_at)
  where status in ('pending','failed');
create index organization_export_jobs_org_idx
  on public.organization_export_jobs(organization_id, requested_at desc);
create trigger set_updated_at before update on public.organization_export_jobs
for each row execute function public.set_updated_at();

alter table public.organization_export_jobs enable row level security;
create policy organization_export_jobs_select on public.organization_export_jobs
  for select to authenticated using (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  );
revoke all on table public.organization_export_jobs from public, anon, authenticated, service_role;
grant select on table public.organization_export_jobs to authenticated;
grant all on table public.organization_export_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-exports', 'organization-exports', false, 1073741824,
  array['application/zip']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy organization_exports_download on storage.objects
  for select to authenticated using (
    bucket_id = 'organization-exports'
    and (
      (select public.is_platform_admin())
      or (
        (select public.current_role()) = 'org_admin'
        and (storage.foldername(name))[1] = (select public.current_org_id())::text
      )
    )
  );

create or replace function public.request_organization_export()
returns public.organization_export_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_job public.organization_export_jobs%rowtype;
begin
  if v_org_id is null or public.current_role() <> 'org_admin' then
    raise exception 'Only organization administrators may request a complete data export'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_export_jobs j
    where j.organization_id = v_org_id
      and j.status in ('pending','processing')
  ) then
    raise exception 'An organization export is already in progress' using errcode = '55000';
  end if;
  insert into public.organization_export_jobs (organization_id, requested_by)
  values (v_org_id, auth.uid()) returning * into v_job;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'organization_export', v_job.id::text, 'requested',
    jsonb_build_object('requestedAt', v_job.requested_at)
  );
  return v_job;
end;
$function$;

create or replace function public.claim_organization_export_jobs(
  p_batch_size integer default 2
)
returns table (
  job_id uuid,
  organization_id uuid,
  requested_by uuid,
  lock_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may claim jobs' using errcode = '42501';
  end if;
  if p_batch_size not between 1 and 10 then
    raise exception 'Batch size must be between 1 and 10' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select j.id
    from public.organization_export_jobs j
    where (
      (j.status in ('pending','failed') and j.available_at <= now() and j.attempt_count < j.max_attempts)
      or (j.status = 'processing' and j.locked_at < now() - interval '20 minutes')
    )
    order by j.requested_at
    for update skip locked
    limit p_batch_size
  ), claimed as (
    update public.organization_export_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        locked_at = now(),
        lock_token = extensions.gen_random_uuid(),
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    from candidates c where j.id = c.id
    returning j.*
  )
  select c.id, c.organization_id, c.requested_by, c.lock_token, c.attempt_count
  from claimed c;
end;
$function$;

create or replace function public.finish_organization_export_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_succeeded boolean,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_content_sha256 text default null,
  p_byte_size bigint default null,
  p_table_count integer default null,
  p_row_count bigint default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.organization_export_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may finish jobs' using errcode = '42501';
  end if;
  select * into v_job from public.organization_export_jobs
  where id = p_job_id and status = 'processing' and lock_token = p_lock_token
  for update;
  if v_job.id is null then return false; end if;
  if p_succeeded then
    if p_storage_bucket <> 'organization-exports'
       or p_storage_path is null
       or p_content_sha256 !~ '^[0-9a-f]{64}$'
       or coalesce(p_byte_size,0) <= 0
       or coalesce(p_table_count,0) <= 0
       or coalesce(p_row_count,0) < 0 then
      raise exception 'Completed export metadata is invalid' using errcode = '22023';
    end if;
    update public.organization_export_jobs set
      status = 'succeeded', completed_at = now(),
      storage_bucket = p_storage_bucket, storage_path = p_storage_path,
      content_sha256 = p_content_sha256, byte_size = p_byte_size,
      table_count = p_table_count, row_count = p_row_count,
      expires_at = now() + interval '7 days', locked_at = null, lock_token = null,
      updated_at = now()
    where id = v_job.id;
  else
    update public.organization_export_jobs set
      status = 'failed', available_at = now() + make_interval(mins => least(60, 5 * attempt_count)),
      last_error_code = left(coalesce(p_error_code,'export_failed'),100),
      last_error_message = left(coalesce(p_error_message,'Organization export failed'),2000),
      locked_at = null, lock_token = null, updated_at = now()
    where id = v_job.id;
  end if;
  return true;
end;
$function$;

revoke all on function public.request_organization_export(),
  public.claim_organization_export_jobs(integer),
  public.finish_organization_export_job(uuid,uuid,boolean,text,text,text,bigint,integer,bigint,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_organization_export() to authenticated;
grant execute on function public.claim_organization_export_jobs(integer),
  public.finish_organization_export_job(uuid,uuid,boolean,text,text,text,bigint,integer,bigint,text,text)
  to service_role;

-- Discover every tenant-owned public table at execution time. This keeps the
-- customer archive complete as new product modules add tables without needing
-- a second hard-coded list in the worker.
create or replace function public.get_organization_export_catalog()
returns table (table_name text)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'organization_id'
        and a.attnum > 0 and not a.attisdropped
    )
  order by c.relname;
$function$;

create or replace function public.export_organization_table(
  p_organization_id uuid,
  p_table_name text,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_has_id boolean;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may read export rows' using errcode = '42501';
  end if;
  if p_offset < 0 or p_limit not between 1 and 1000
     or not exists (
       select 1 from public.get_organization_export_catalog() c
       where c.table_name = p_table_name
     ) then
    raise exception 'Organization export table request is invalid' using errcode = '22023';
  end if;
  select exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = p_table_name
      and a.attname = 'id' and a.attnum > 0 and not a.attisdropped
  ) into v_has_id;
  if v_has_id then
    return query execute format(
      'select to_jsonb(t) from public.%I t where t.organization_id = $1 order by t.id offset $2 limit $3',
      p_table_name
    ) using p_organization_id, p_offset, p_limit;
  else
    return query execute format(
      'select to_jsonb(t) from public.%I t where t.organization_id = $1 order by t.ctid offset $2 limit $3',
      p_table_name
    ) using p_organization_id, p_offset, p_limit;
  end if;
end;
$function$;

revoke all on function public.get_organization_export_catalog(),
  public.export_organization_table(uuid,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_organization_export_catalog(),
  public.export_organization_table(uuid,text,integer,integer) to service_role;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values (
  'organization-data-export', 'Organization data exports',
  'Builds complete per-table CSV archives and signed document manifests',
  'worker', null, interval '15 minutes', interval '45 minutes', true,
  'automatic', '/admin/system-jobs'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- D8: tenant sandbox facility with synthetic-only resettable data
-- ---------------------------------------------------------------------------

create or replace function app_private.seed_sandbox_facility(p_facility_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_facility public.facilities%rowtype;
  v_employees integer;
  v_residents integer;
begin
  select * into v_facility from public.facilities
  where id = p_facility_id and is_sandbox for update;
  if v_facility.id is null then
    raise exception 'Sandbox facility not found' using errcode = 'P0002';
  end if;

  delete from public.residents where facility_id = v_facility.id and is_synthetic;
  delete from public.employees where facility_id = v_facility.id and is_synthetic;

  insert into public.employees (
    organization_id, facility_id, employee_number, first_name, last_name,
    email, hire_date, job_title, department, status, is_synthetic
  ) values
    (v_facility.organization_id, v_facility.id, 'SANDBOX-001', 'Avery', 'Jordan',
      'avery.jordan@example.invalid', current_date - 420, 'Direct Care Worker', 'Resident Care', 'active', true),
    (v_facility.organization_id, v_facility.id, 'SANDBOX-002', 'Morgan', 'Lee',
      'morgan.lee@example.invalid', current_date - 75, 'Medication Technician', 'Resident Care', 'active', true),
    (v_facility.organization_id, v_facility.id, 'SANDBOX-003', 'Taylor', 'Rivera',
      'taylor.rivera@example.invalid', current_date - 18, 'Activities Aide', 'Resident Services', 'active', true);
  get diagnostics v_employees = row_count;

  insert into public.residents (
    organization_id, facility_id, first_name, last_name, room,
    admission_date, status, is_synthetic
  ) values
    (v_facility.organization_id, v_facility.id, 'Sample', 'Resident One', '101', current_date - 180, 'active', true),
    (v_facility.organization_id, v_facility.id, 'Sample', 'Resident Two', '102', current_date - 45, 'active', true);
  get diagnostics v_residents = row_count;

  update public.facilities set sandbox_reset_at = now(), updated_at = now()
  where id = v_facility.id;
  return jsonb_build_object(
    'facilityId', v_facility.id,
    'employeesSeeded', v_employees,
    'residentsSeeded', v_residents,
    'resetAt', now()
  );
end;
$function$;

create or replace function public.ensure_organization_sandbox()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_facility public.facilities%rowtype;
  v_result jsonb;
begin
  if v_org_id is null or public.current_role() <> 'org_admin' then
    raise exception 'Only organization administrators may create the training sandbox'
      using errcode = '42501';
  end if;
  select * into v_facility from public.facilities
  where organization_id = v_org_id and is_sandbox and is_active
  limit 1;
  if v_facility.id is null then
    insert into public.facilities (
      organization_id, name, facility_type, state, is_active,
      is_sandbox, sandbox_seed_version
    ) values (
      v_org_id, 'Training Sandbox', 'PCH', 'PA', true, true, 1
    ) returning * into v_facility;
  end if;
  v_result := app_private.seed_sandbox_facility(v_facility.id);
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'sandbox_facility', v_facility.id::text,
    'reset', v_result
  );
  return v_result;
end;
$function$;

create or replace function public.reset_organization_sandbox()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_facility_id uuid;
  v_result jsonb;
begin
  if v_org_id is null or public.current_role() <> 'org_admin' then
    raise exception 'Only organization administrators may reset the training sandbox'
      using errcode = '42501';
  end if;
  select id into v_facility_id from public.facilities
  where organization_id = v_org_id and is_sandbox and is_active limit 1;
  if v_facility_id is null then
    return public.ensure_organization_sandbox();
  end if;
  v_result := app_private.seed_sandbox_facility(v_facility_id);
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'sandbox_facility', v_facility_id::text,
    'reset', v_result
  );
  return v_result;
end;
$function$;

create or replace function app_private.reject_sandbox_binder_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1 from unnest(new.facility_ids) scoped(id)
    join public.facilities f on f.id = scoped.id
    where f.is_sandbox
  ) then
    raise exception 'Sandbox facilities cannot be included in compliance binders'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;
create trigger reject_sandbox_binder_scope
before insert or update of facility_ids on public.binder_export_jobs
for each row execute function app_private.reject_sandbox_binder_scope();

create or replace function app_private.reject_sandbox_report_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.facility_id is not null and exists (
    select 1 from public.facilities f where f.id = new.facility_id and f.is_sandbox
  ) then
    raise exception 'Sandbox facilities cannot be included in report or benchmark snapshots'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;
create trigger reject_sandbox_report_snapshots
before insert or update of facility_id on public.report_snapshots
for each row execute function app_private.reject_sandbox_report_scope();
create trigger reject_sandbox_metric_snapshots
before insert or update of facility_id on public.historical_metric_snapshots
for each row execute function app_private.reject_sandbox_report_scope();

revoke all on function app_private.seed_sandbox_facility(uuid),
  public.ensure_organization_sandbox(), public.reset_organization_sandbox()
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_organization_sandbox(),
  public.reset_organization_sandbox() to authenticated;

-- ---------------------------------------------------------------------------
-- D2: idle-session soft locks for shared facility devices
-- ---------------------------------------------------------------------------

create table public.session_lock_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  route_path text not null check (route_path ~ '^/' and length(route_path) <= 300),
  lock_reason text not null check (lock_reason in ('idle_timeout','kiosk_timeout','manual')),
  locked_at timestamptz not null default now(),
  unlocked_at timestamptz,
  check (unlocked_at is null or unlocked_at >= locked_at)
);

create index session_lock_events_profile_idx
  on public.session_lock_events(profile_id, locked_at desc);
alter table public.session_lock_events enable row level security;
create policy session_lock_events_self_select on public.session_lock_events
  for select to authenticated using (profile_id = (select auth.uid()));
revoke all on table public.session_lock_events from public, anon, authenticated, service_role;
grant select on table public.session_lock_events to authenticated;
grant all on table public.session_lock_events to service_role;

create or replace function public.record_idle_session_lock(
  p_route_path text,
  p_lock_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_id uuid;
begin
  if auth.uid() is null
     or p_route_path is null or p_route_path !~ '^/' or length(p_route_path) > 300
     or p_lock_reason not in ('idle_timeout','kiosk_timeout','manual') then
    raise exception 'Session lock event is invalid' using errcode = '22023';
  end if;
  insert into public.session_lock_events (
    profile_id, organization_id, route_path, lock_reason
  ) values (
    auth.uid(), public.current_org_id(), p_route_path, p_lock_reason
  ) returning id into v_id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    public.current_org_id(), auth.uid(), 'auth_session', v_id::text,
    'soft_locked', jsonb_build_object('reason', p_lock_reason, 'route', p_route_path)
  );
  return v_id;
end;
$function$;

create or replace function public.record_idle_session_unlock(p_lock_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.session_lock_events set unlocked_at = now()
  where id = p_lock_event_id and profile_id = auth.uid() and unlocked_at is null;
  if not found then
    raise exception 'Active session lock event not found' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action
  ) values (
    public.current_org_id(), auth.uid(), 'auth_session', p_lock_event_id::text,
    'soft_unlocked'
  );
end;
$function$;

revoke all on function public.record_idle_session_lock(text,text),
  public.record_idle_session_unlock(uuid) from public, anon;
grant execute on function public.record_idle_session_lock(text,text),
  public.record_idle_session_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- D7: tenant MFA floor plus step-up on irreversible actions
-- ---------------------------------------------------------------------------

alter table public.identity_security_policies
  alter column sensitive_operations set default array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish'
  ]::text[];

update public.identity_security_policies p
set sensitive_operations = (
  select array_agg(distinct operation order by operation)
  from unnest(p.sensitive_operations || array[
    'evidence_grant_revoke','schedule_unpublish','course_unpublish'
  ]::text[]) operation
), updated_at = now();

alter table public.identity_security_policies
  drop constraint identity_security_policy_mfa_floor;
alter table public.identity_security_policies
  add constraint identity_security_policy_mfa_floor check (
    require_aal2
    and privileged_roles @> array['org_admin', 'facility_manager']::text[]
    and sensitive_operations @> array[
      'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
      'session_revocation', 'break_glass', 'scim_credential_rotation',
      'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
      'billing_admin', 'integration_admin', 'evidence_grant_revoke',
      'schedule_unpublish', 'course_unpublish'
    ]::text[]
  );

create or replace function public.identity_operation_requires_aal2(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text := public.current_role();
  v_org_id uuid := public.current_org_id();
  v_policy public.identity_security_policies%rowtype;
  v_baseline text[] := array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish'
  ]::text[];
begin
  if v_role = 'platform_admin' then return p_operation = any(v_baseline); end if;
  select * into v_policy from public.identity_security_policies
  where organization_id = v_org_id;
  if not found then
    return v_role = any(array['org_admin','facility_manager']::text[])
      and p_operation = any(v_baseline);
  end if;
  return v_policy.require_aal2
    and v_role = any(v_policy.privileged_roles)
    and p_operation = any(v_policy.sensitive_operations);
end;
$function$;

create or replace function public.get_my_mfa_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_policy public.identity_security_policies%rowtype;
  v_role text := public.current_role();
begin
  if v_role is null then return jsonb_build_object('required', false); end if;
  if v_role = 'platform_admin' then
    return jsonb_build_object('required', true, 'role', v_role, 'maxSessionMinutes', 480);
  end if;
  select * into v_policy from public.identity_security_policies
  where organization_id = public.current_org_id();
  return jsonb_build_object(
    'required', coalesce(v_policy.require_aal2, true)
      and v_role = any(coalesce(v_policy.privileged_roles,
        array['org_admin','facility_manager']::text[])),
    'role', v_role,
    'maxSessionMinutes', coalesce(v_policy.max_privileged_session_minutes, 480)
  );
end;
$function$;

create or replace function public.revoke_evidence_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns public.evidence_guest_grants
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select g.* into v_grant from public.evidence_guest_grants g
  where g.id = p_grant_id for update;
  if v_grant.id is null then
    raise exception 'Guest grant not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase5_manager(v_grant.organization_id, v_grant.facility_id);
  perform public.assert_identity_assurance('evidence_grant_revoke');
  if length(v_reason) < 5 then
    raise exception 'A revocation reason of at least 5 characters is required' using errcode = '22023';
  end if;
  if v_grant.revoked_at is not null then
    raise exception 'Guest grant is already revoked' using errcode = '22023';
  end if;
  update public.evidence_guest_grants
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = v_reason
  where id = v_grant.id returning * into v_grant;
  insert into public.evidence_guest_access_events (
    organization_id, facility_id, guest_grant_id, collection_id, event_type, reason
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
    'revoked', format('Guest access revoked by staff: %s', v_reason)
  );
  return v_grant;
end;
$function$;

create or replace function public.unpublish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_schedule public.schedules%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ) then raise exception 'Not authorized to unpublish this schedule' using errcode = '42501'; end if;
  perform public.assert_identity_assurance('schedule_unpublish');
  update public.schedules set status = 'draft', published_at = null
  where id = p_schedule_id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action
  ) values (
    v_schedule.organization_id, auth.uid(), 'schedule', p_schedule_id::text, 'unpublished'
  );
end;
$function$;

create or replace function public.unpublish_course(p_course_id uuid, p_reason text)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_course public.courses%rowtype;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  select * into v_course from public.courses where id = p_course_id for update;
  if v_course.id is null then raise exception 'Course not found' using errcode = 'P0002'; end if;
  if length(v_reason) < 8 then
    raise exception 'A reason of at least 8 characters is required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or (
      v_course.organization_id = public.current_org_id()
      and public.current_role() = 'org_admin'
    )
  ) then raise exception 'Not authorized to unpublish this course' using errcode = '42501'; end if;
  perform public.assert_identity_assurance('course_unpublish');
  update public.courses set status = 'archived', updated_at = now()
  where id = p_course_id returning * into v_course;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_course.organization_id, auth.uid(), 'course', p_course_id::text,
    'unpublished', jsonb_build_object('reason', v_reason)
  );
  return v_course;
end;
$function$;

revoke all on function public.get_my_mfa_policy(),
  public.unpublish_course(uuid,text) from public, anon;
grant execute on function public.get_my_mfa_policy(),
  public.unpublish_course(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- D9: a single weekly manager digest delivered in-app, email, and push
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published',
    'announcement_published', 'manager_weekly_digest'
  )
);

insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'announcement_published', 'email', 1, 'active',
    'New CareMetric announcement',
    'A new organization announcement is available. Sign in to CareMetric CareBase to read it.',
    '{}'::text[], now()),
  (null, 'announcement_published', 'web_push', 1, 'active',
    'New organization announcement',
    'Open CareMetric CareBase to read the new announcement.', '{}'::text[], now()),
  (null, 'manager_weekly_digest', 'email', 1, 'active',
    'Your weekly CareMetric manager digest',
    'Your weekly compliance and operations digest is ready. Open CareMetric CareBase for the prioritized list.',
    '{}'::text[], now()),
  (null, 'manager_weekly_digest', 'web_push', 1, 'active',
    'Your weekly manager digest is ready',
    'Open CareMetric CareBase for this week''s priorities.', '{}'::text[], now())
on conflict (organization_id, template_key, channel, version) do nothing;

create table public.manager_digest_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_started_on date not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  unique (profile_id, week_started_on)
);
create index manager_digest_snapshots_profile_idx
  on public.manager_digest_snapshots(profile_id, week_started_on desc);
alter table public.manager_digest_snapshots enable row level security;
create policy manager_digest_snapshots_self_select on public.manager_digest_snapshots
  for select to authenticated using (profile_id = (select auth.uid()));
revoke all on table public.manager_digest_snapshots from public, anon, authenticated, service_role;
grant select on table public.manager_digest_snapshots to authenticated;
grant all on table public.manager_digest_snapshots to service_role;

create or replace function public.queue_manager_weekly_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
  v_inserted integer := 0;
  v_body text;
  v_items jsonb;
  v_digest_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Only the trusted digest worker may queue manager digests'
      using errcode = '42501';
  end if;
  for v_profile in
    select p.* from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.is_active and p.role in ('org_admin','facility_manager')
      and o.subscription_status not in ('suspended','canceled')
  loop
    if exists (
      select 1 from public.notifications n
      where n.profile_id = v_profile.id
        and n.notification_type = 'manager_weekly_digest'
        and n.created_at >= date_trunc('week', now())
    ) then continue; end if;

    if v_profile.role = 'org_admin' then
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facilities f
      where f.organization_id = v_profile.organization_id
        and f.is_active and not f.is_sandbox;
    else
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = v_profile.id and f.is_active and not f.is_sandbox;
    end if;
    if cardinality(v_facility_ids) = 0 then continue; end if;

    select count(*) into v_credentials from public.employee_credentials c
    where c.facility_id = any(v_facility_ids)
      and c.expiration_date between current_date and current_date + 30;
    select count(*) into v_training from public.employee_training_records r
    where r.facility_id = any(v_facility_ids) and r.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between current_date and current_date + 6
      and c.status <> 'cancelled';

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; %s unacknowledged alerts; %s classes this week.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes
    );
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials?status=expiring&withinDays=30'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix?status=overdue'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents?status=open'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes?range=this-week')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, date_trunc('week', now())::date, v_items
    )
    on conflict (profile_id, week_started_on) do update set items = excluded.items
    returning id into v_digest_id;
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_profile.organization_id, v_profile.id, 'manager_weekly_digest',
      'Your weekly manager digest', v_body, '/account/manager-digest/' || v_digest_id
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$function$;

revoke all on function public.queue_manager_weekly_digests()
  from public, anon, authenticated;
grant execute on function public.queue_manager_weekly_digests() to service_role;

select cron.unschedule(jobname) from cron.job
where jobname = 'manager-weekly-digest';
select cron.schedule(
  'manager-weekly-digest', '0 12 * * 1',
  $$select public.queue_manager_weekly_digests();$$
);

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values (
  'manager-weekly-digest', 'Weekly manager digest',
  'Queues one consolidated weekly compliance and operations digest per manager',
  'sql_cron', 'manager-weekly-digest', interval '7 days', interval '8 days',
  false, 'manual', '/admin/system-jobs'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_eligible boolean := false;
  v_critical boolean;
  v_push_first boolean;
begin
  v_push_first := new.notification_type in (
    'course_assigned', 'schedule_published', 'open_shift_claim_changed',
    'shift_swap_changed', 'shift_handoff_assigned', 'shift_handoff_escalated',
    'time_off_request_changed', 'announcement_published', 'manager_weekly_digest'
  );
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update',
    'schedule_published', 'open_shift_claim_changed', 'shift_swap_changed',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'time_off_request_changed',
    'announcement_published', 'manager_weekly_digest'
  ) then
    v_eligible := true;
  elsif new.notification_type in (
    'credential_expiring', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'policy_attestation_assigned', 'incident_reported',
    'course_assignment_due_soon', 'course_assigned'
  ) and app_private.is_feature_release_active(
    new.organization_id, 'notifications.expanded_delivery_types'
  ) then v_eligible := true;
  end if;
  if not v_eligible then return new; end if;

  v_critical := new.notification_type in (
    'training_expired', 'credential_expiring', 'certificate_expiring',
    'practicum_expired', 'incident_reported'
  );
  if v_critical and app_private.is_feature_release_active(
    new.organization_id, 'notifications.critical_multichannel'
  ) then
    perform public.enqueue_critical_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  elsif v_push_first then
    perform public.enqueue_push_first_notification_delivery(
      new.organization_id, new.profile_id, new.id,
      case when new.notification_type = 'manager_weekly_digest' then 'digest' else 'alert' end
    );
  else
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- D10: caller-scoped product changelog backed by feature-release state
-- ---------------------------------------------------------------------------

create table public.product_changelog_reads (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.product_changelog_reads
for each row execute function public.set_updated_at();
alter table public.product_changelog_reads enable row level security;
create policy product_changelog_reads_self_select on public.product_changelog_reads
  for select to authenticated using (profile_id = (select auth.uid()));
revoke all on table public.product_changelog_reads from public, anon, authenticated, service_role;
grant select on table public.product_changelog_reads to authenticated;
grant all on table public.product_changelog_reads to service_role;

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values
  ('communications.announcements', 'Organization announcements', 'Targeted announcements with read receipts', 'boolean', 'true'::jsonb),
  ('training.portable_passport', 'Portable training passport', 'Employee-owned shareable training transcript', 'boolean', 'true'::jsonb),
  ('exports.organization_data', 'Organization data export', 'Complete per-table customer archive export', 'boolean', 'true'::jsonb),
  ('navigation.workspace', 'Navigation workspace', 'Favorites, recents, and module tailoring', 'boolean', 'true'::jsonb),
  ('sandbox.training_facility', 'Training sandbox', 'Resettable synthetic tenant facility', 'boolean', 'true'::jsonb),
  ('notifications.manager_digest', 'Manager weekly digest', 'Consolidated weekly manager priorities', 'boolean', 'true'::jsonb),
  ('product.changelog', 'Product changelog', 'Caller-scoped product release notes', 'boolean', 'true'::jsonb)
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason,
  changelog_title, changelog_summary, help_path, released_at
) values
  ('communications.announcements','global',true,'communications','Roadmap D3 release',
    'Organization announcements', 'Send targeted operational announcements and track lightweight read receipts.', '/account/announcements', now()),
  ('training.portable_passport','global',true,'learning','Roadmap D4 release',
    'Portable training passports', 'Employees can share a revocable transcript of valid certificates and continuing-education hours.', '/me/certificates', now()),
  ('exports.organization_data','global',true,'data_governance','Roadmap D5 release',
    'Complete customer data exports', 'Organization administrators can request a complete CSV archive and signed-document manifest.', '/app/settings', now()),
  ('navigation.workspace','global',true,'experience','Roadmap D6 release',
    'Favorites, recents, and tailored navigation', 'The navigation workspace now follows each user and organizations can hide unused modules.', '/app/settings', now()),
  ('sandbox.training_facility','global',true,'onboarding','Roadmap D8 release',
    'Resettable training sandbox', 'Practice with synthetic employees and residents without affecting reports, binders, or benchmarks.', '/app/settings', now()),
  ('notifications.manager_digest','global',true,'communications','Roadmap D9 release',
    'Weekly manager digest', 'Managers receive one consolidated Monday summary of credentials, training, incidents, alerts, and classes.', '/account/notifications', now()),
  ('product.changelog','global',true,'experience','Roadmap D10 release',
    'What is new in CareMetric', 'A role-aware changelog makes released capabilities and help links easy to discover.', '/account/whats-new', now())
on conflict (feature_key) do update set
  changelog_title = excluded.changelog_title,
  changelog_summary = excluded.changelog_summary,
  help_path = excluded.help_path,
  released_at = coalesce(public.release_flags.released_at, excluded.released_at);

create or replace function public.get_product_changelog(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_last_seen timestamptz;
  v_entries jsonb;
begin
  if auth.uid() is null or p_limit not between 1 and 100 then
    raise exception 'Changelog request is invalid' using errcode = '22023';
  end if;
  select r.last_seen_at into v_last_seen from public.product_changelog_reads r
  where r.profile_id = auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
    'featureKey', entry.feature_key,
    'title', entry.changelog_title,
    'summary', entry.changelog_summary,
    'helpPath', entry.help_path,
    'releasedAt', entry.released_at,
    'isUnread', v_last_seen is null or entry.released_at > v_last_seen
  ) order by entry.released_at desc), '[]'::jsonb)
  into v_entries
  from (
    select r.* from public.release_flags r
    where r.is_enabled and r.changelog_title is not null and r.released_at is not null
      and (
        public.is_platform_admin()
        or (v_org_id is not null and app_private.is_feature_release_active(v_org_id, r.feature_key))
      )
    order by r.released_at desc limit p_limit
  ) entry;
  return jsonb_build_object(
    'lastSeenAt', v_last_seen,
    'unreadCount', (
      select count(*) from public.release_flags r
      where r.is_enabled and r.changelog_title is not null and r.released_at is not null
        and (v_last_seen is null or r.released_at > v_last_seen)
        and (
          public.is_platform_admin()
          or (v_org_id is not null and app_private.is_feature_release_active(v_org_id, r.feature_key))
        )
    ),
    'entries', v_entries
  );
end;
$function$;

create or replace function public.mark_product_changelog_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare v_seen timestamptz := now();
begin
  insert into public.product_changelog_reads(profile_id, last_seen_at)
  values (auth.uid(), v_seen)
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at, updated_at = now();
  return v_seen;
end;
$function$;

revoke all on function public.get_product_changelog(integer),
  public.mark_product_changelog_seen() from public, anon;
grant execute on function public.get_product_changelog(integer),
  public.mark_product_changelog_seen() to authenticated;

-- The benchmark implementation predates the sandbox marker. Patch the two
-- facility sources in-place while preserving its reviewed k-anonymity logic.
do $block$
declare v_definition text;
begin
  select pg_get_functiondef('public.refresh_benchmark_snapshots(date,integer)'::regprocedure)
  into v_definition;
  if position('from public.facilities f where f.is_active and f.facility_type' in v_definition) = 0
     or position('join public.facilities f on f.id = v.facility_id and f.is_active' in v_definition) = 0 then
    raise exception 'Benchmark implementation changed; sandbox exclusion must be reviewed';
  end if;
  v_definition := replace(
    v_definition,
    'from public.facilities f where f.is_active and f.facility_type',
    'from public.facilities f where f.is_active and not f.is_sandbox and f.facility_type'
  );
  v_definition := replace(
    v_definition,
    'join public.facilities f on f.id = v.facility_id and f.is_active',
    'join public.facilities f on f.id = v.facility_id and f.is_active and not f.is_sandbox'
  );
  execute v_definition;
end;
$block$;

-- Apply the same exclusion at read/export boundaries so synthetic records can
-- never leak into a comparison, retention metric, or payroll file even when a
-- caller bypasses the application facility picker.
do $block$
declare v_definition text;
begin
  select pg_get_functiondef('public.get_facility_benchmark_comparison(uuid)'::regprocedure)
  into v_definition;
  if position('if not found then' in v_definition) = 0 then
    raise exception 'Benchmark comparison implementation changed; sandbox guard must be reviewed';
  end if;
  v_definition := replace(
    v_definition,
    'if not found then',
    'if v_facility.is_sandbox then return jsonb_build_object(''available'', false, ''reason'', ''sandbox_excluded''); end if; if not found then'
  );
  execute v_definition;

  select pg_get_functiondef('public.get_workforce_retention_metrics(uuid)'::regprocedure)
  into v_definition;
  if position('from public.employment_episodes ep join public.employees e on e.id = ep.employee_id' in v_definition) = 0 then
    raise exception 'Retention implementation changed; synthetic employee exclusion must be reviewed';
  end if;
  v_definition := replace(
    v_definition,
    'from public.employment_episodes ep join public.employees e on e.id = ep.employee_id',
    'from public.employment_episodes ep join public.employees e on e.id = ep.employee_id and not e.is_synthetic'
  );
  execute v_definition;

  select pg_get_functiondef('public.get_paid_training_payroll_export(uuid,date,date)'::regprocedure)
  into v_definition;
  if position('where f.id = p_facility_id' in v_definition) = 0
     or position('join public.employees e on e.id = r.employee_id' in v_definition) = 0 then
    raise exception 'Payroll export implementation changed; sandbox exclusion must be reviewed';
  end if;
  v_definition := replace(
    v_definition,
    'where f.id = p_facility_id',
    'where f.id = p_facility_id and not f.is_sandbox'
  );
  v_definition := replace(
    v_definition,
    'join public.employees e on e.id = r.employee_id',
    'join public.employees e on e.id = r.employee_id and not e.is_synthetic'
  );
  execute v_definition;
end;
$block$;

-- Workers run every fifteen minutes and can also be invoked through the
-- existing platform system-jobs runner.
select cron.unschedule(jobname) from cron.job
where jobname = 'process-organization-export-jobs';
select cron.schedule(
  'process-organization-export-jobs', '*/15 * * * *',
  $$select net.http_post(
    url := concat(rtrim(coalesce(
      (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'supabase_functions_base_url'
        limit 1
      ),
      current_setting('app.functions_base_url', true),
      ''
    ), '/'), '/functions/v1/process-organization-export-jobs'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-CareMetric-Cron-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );$$
);
