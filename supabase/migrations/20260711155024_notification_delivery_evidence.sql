-- Phase 1 notification delivery evidence.
--
-- Provider API acceptance is not proof of delivery. This migration adds an
-- attempt ledger, signed-callback evidence, terminal outcome reconciliation,
-- centralized consent enforcement, and recipient-local SMS quiet hours.
-- Provider payloads and message bodies are deliberately not persisted here.

alter table public.profiles
  add column notification_timezone text not null default 'America/New_York',
  add column email_opt_out boolean not null default false,
  add column email_opt_out_at timestamptz,
  add column sms_opt_out_at timestamptz;

-- Do not infer consent for legacy rows that have the live flag but no timestamped
-- evidence. A new START event or explicit UI consent can opt the profile in.
update public.profiles
set sms_opt_in = false
where sms_opt_in and sms_consent_at is null;

create or replace function public.validate_profile_notification_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.notification_timezone
  ) then
    raise exception 'Unknown IANA notification time zone: %', new.notification_timezone
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger validate_profile_notification_timezone
before insert or update of notification_timezone on public.profiles
for each row execute function public.validate_profile_notification_timezone();

revoke all on function public.validate_profile_notification_timezone() from public, anon, authenticated;

alter table public.notification_deliveries
  add column provider text check (provider in ('twilio', 'sendgrid')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz not null default now(),
  add column accepted_at timestamptz,
  add column delivered_at timestamptz,
  add column finalized_at timestamptz,
  add column final_outcome text check (final_outcome in ('delivered', 'failed', 'unknown')),
  add column last_provider_status text,
  add column error_code text,
  add column skip_reason text,
  add column quiet_hours_deferred_count integer not null default 0
    check (quiet_hours_deferred_count >= 0);

alter table public.notification_deliveries
  drop constraint notification_deliveries_status_check,
  add constraint notification_deliveries_status_check
    check (status in (
      'pending', 'processing', 'sent', 'accepted', 'delivered', 'failed', 'skipped'
    ));

drop index public.notification_deliveries_status_idx;
create index notification_deliveries_status_idx
  on public.notification_deliveries(status, next_attempt_at, updated_at)
  where status in ('pending', 'processing');

create index notification_deliveries_final_outcome_idx
  on public.notification_deliveries(final_outcome, finalized_at desc)
  where final_outcome is not null;

create table public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null check (provider in ('twilio', 'sendgrid')),
  callback_token uuid not null default gen_random_uuid(),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'started'
    check (status in ('started', 'accepted', 'retry_scheduled', 'delivered', 'failed', 'unknown')),
  provider_message_id text,
  provider_status text,
  response_status integer,
  error_code text,
  error_detail text,
  started_at timestamptz not null default now(),
  accepted_at timestamptz,
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (delivery_id, attempt_number),
  unique (callback_token)
);

create unique index notification_delivery_attempts_provider_message_idx
  on public.notification_delivery_attempts(provider, provider_message_id)
  where provider_message_id is not null;
create index notification_delivery_attempts_org_started_idx
  on public.notification_delivery_attempts(organization_id, started_at desc);
create index notification_delivery_attempts_delivery_idx
  on public.notification_delivery_attempts(delivery_id, attempt_number desc);

create trigger set_updated_at before update on public.notification_delivery_attempts
  for each row execute function public.set_updated_at();

create table public.notification_provider_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.notification_delivery_attempts(id) on delete cascade,
  delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('twilio', 'sendgrid')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 512),
  provider_message_id text,
  event_type text not null,
  outcome text check (outcome in ('delivered', 'failed')),
  error_code text,
  error_detail text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  signature_valid boolean not null default true check (signature_valid),
  unique (provider, provider_event_id)
);

create index notification_provider_events_delivery_idx
  on public.notification_provider_events(delivery_id, occurred_at desc);
create index notification_provider_events_org_received_idx
  on public.notification_provider_events(organization_id, received_at desc);

create table public.notification_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  attempt_id uuid references public.notification_delivery_attempts(id) on delete set null,
  channel text not null check (channel in ('email', 'sms')),
  action text not null check (action in ('opt_in', 'opt_out', 'help')),
  provider text not null check (provider in ('twilio', 'sendgrid')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 512),
  recipient_fingerprint text not null
    check (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  source text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index notification_consent_events_org_received_idx
  on public.notification_consent_events(organization_id, received_at desc);
create index notification_consent_events_profile_idx
  on public.notification_consent_events(profile_id, occurred_at desc);

alter table public.notification_delivery_attempts enable row level security;
alter table public.notification_provider_events enable row level security;
alter table public.notification_consent_events enable row level security;

-- Facility managers are facility-scoped throughout the application. Delivery
-- evidence has no direct facility_id, so derive scope through the recipient's
-- employee record instead of granting every manager organization-wide access.
drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select
on public.notification_deliveries for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or profile_id = (select auth.uid())
      or (
        (select public.current_role()) = 'facility_manager'
        and exists (
          select 1
          from public.employees e
          where e.profile_id = notification_deliveries.profile_id
            and e.organization_id = notification_deliveries.organization_id
            and public.is_assigned_to_facility(e.facility_id)
        )
      )
    )
  )
);

create policy notification_delivery_attempts_select
on public.notification_delivery_attempts for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or profile_id = (select auth.uid())
      or (
        (select public.current_role()) = 'facility_manager'
        and exists (
          select 1
          from public.employees e
          where e.profile_id = notification_delivery_attempts.profile_id
            and e.organization_id = notification_delivery_attempts.organization_id
            and public.is_assigned_to_facility(e.facility_id)
        )
      )
    )
  )
);

create policy notification_provider_events_select
on public.notification_provider_events for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or exists (
        select 1
        from public.notification_delivery_attempts a
        where a.id = notification_provider_events.attempt_id
          and (
            a.profile_id = (select auth.uid())
            or (
              (select public.current_role()) = 'facility_manager'
              and exists (
                select 1
                from public.employees e
                where e.profile_id = a.profile_id
                  and e.organization_id = notification_provider_events.organization_id
                  and public.is_assigned_to_facility(e.facility_id)
              )
            )
          )
      )
    )
  )
);

create policy notification_consent_events_select
on public.notification_consent_events for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or profile_id = (select auth.uid())
      or (
        (select public.current_role()) = 'facility_manager'
        and exists (
          select 1
          from public.employees e
          where e.profile_id = notification_consent_events.profile_id
            and e.organization_id = notification_consent_events.organization_id
            and public.is_assigned_to_facility(e.facility_id)
        )
      )
    )
  )
);

-- Current Supabase projects may not expose new SQL-created tables to the Data
-- API automatically. Grants and RLS are both explicit: authenticated users get
-- evidence read access through the policies above; only service_role may write.
revoke all on table public.notification_delivery_attempts from anon, authenticated;
revoke all on table public.notification_provider_events from anon, authenticated;
revoke all on table public.notification_consent_events from anon, authenticated;
revoke all on table public.notification_delivery_attempts from service_role;
revoke all on table public.notification_provider_events from service_role;
revoke all on table public.notification_consent_events from service_role;
grant select on table public.notification_delivery_attempts to authenticated;
grant select on table public.notification_provider_events to authenticated;
grant select on table public.notification_consent_events to authenticated;
grant select on table public.notification_delivery_attempts to service_role;
grant select on table public.notification_provider_events to service_role;
grant select on table public.notification_consent_events to service_role;

create or replace function public.notification_next_permitted_at(
  p_requested_at timestamptz,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  v_local timestamp;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown IANA notification time zone: %', p_timezone
      using errcode = '22023';
  end if;

  v_local := p_requested_at at time zone p_timezone;
  if v_local::time >= time '21:00' then
    return ((v_local::date + 1) + time '08:00') at time zone p_timezone;
  elsif v_local::time < time '08:00' then
    return (v_local::date + time '08:00') at time zone p_timezone;
  end if;
  return p_requested_at;
end;
$function$;

revoke all on function public.notification_next_permitted_at(timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.notification_next_permitted_at(timestamptz, text)
  to service_role;

create or replace function public.prepare_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_profile public.profiles%rowtype;
  v_permitted_at timestamptz;
begin
  select * into v_profile from public.profiles where id = new.profile_id;

  if v_profile.id is null or not v_profile.is_active then
    new.status := 'skipped';
    new.skip_reason := 'Recipient profile is inactive or unavailable';
    new.finalized_at := now();
    return new;
  end if;

  if new.channel = 'sms' and (
    not v_profile.sms_opt_in
    or v_profile.sms_consent_at is null
    or v_profile.phone is distinct from new.recipient
  ) then
    new.status := 'skipped';
    new.skip_reason := 'SMS consent is not active for this recipient';
    new.finalized_at := now();
    return new;
  end if;

  if new.channel = 'email' and (
    v_profile.email_opt_out
    or v_profile.email is distinct from new.recipient
  ) then
    new.status := 'skipped';
    new.skip_reason := 'Email preference is not active for this recipient';
    new.finalized_at := now();
    return new;
  end if;

  -- These are non-emergency compliance/training messages. SMS is deferred to
  -- the next 08:00-21:00 window in the recipient's IANA time zone.
  if new.channel = 'sms' and new.status = 'pending' then
    v_permitted_at := public.notification_next_permitted_at(
      greatest(coalesce(new.next_attempt_at, now()), now()),
      v_profile.notification_timezone
    );
    if v_permitted_at > coalesce(new.next_attempt_at, now()) then
      new.quiet_hours_deferred_count := coalesce(new.quiet_hours_deferred_count, 0) + 1;
    end if;
    new.next_attempt_at := v_permitted_at;
  end if;

  return new;
end;
$function$;

create trigger prepare_notification_delivery
before insert on public.notification_deliveries
for each row execute function public.prepare_notification_delivery();

revoke all on function public.prepare_notification_delivery() from public, anon, authenticated;

-- Atomically creates evidence before any provider request is attempted. A
-- consent change, disabled channel, changed recipient, or quiet-hours window
-- puts the delivery back into a safe non-send state instead.
create or replace function public.begin_notification_delivery_attempt(
  p_delivery_id uuid,
  p_provider text,
  p_content_sha256 text
)
returns setof public.notification_delivery_attempts
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_profile public.profiles%rowtype;
  v_email_enabled boolean;
  v_sms_enabled boolean;
  v_permitted_at timestamptz;
  v_attempt_id uuid;
begin
  if p_provider not in ('twilio', 'sendgrid') then
    raise exception 'Unsupported notification provider' using errcode = '22023';
  end if;
  if p_content_sha256 is not null and p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content SHA-256' using errcode = '22023';
  end if;

  select * into v_delivery
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if v_delivery.id is null or v_delivery.status <> 'processing' then
    return;
  end if;
  if (v_delivery.channel = 'sms' and p_provider <> 'twilio')
     or (v_delivery.channel = 'email' and p_provider <> 'sendgrid') then
    raise exception 'Provider does not match delivery channel' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_delivery.profile_id;
  select email_notifications_enabled, sms_notifications_enabled
    into v_email_enabled, v_sms_enabled
  from public.organization_settings
  where organization_id = v_delivery.organization_id;

  if v_profile.id is null or not v_profile.is_active then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'Recipient profile is inactive or unavailable',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;

  if v_delivery.channel = 'sms' and (
    not coalesce(v_sms_enabled, false)
    or not v_profile.sms_opt_in
    or v_profile.sms_consent_at is null
    or v_profile.phone is distinct from v_delivery.recipient
  ) then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'SMS consent or channel preference is not active',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;

  if v_delivery.channel = 'email' and (
    not coalesce(v_email_enabled, false)
    or v_profile.email_opt_out
    or v_profile.email is distinct from v_delivery.recipient
  ) then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'Email channel preference is not active',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;

  if v_delivery.channel = 'sms' then
    v_permitted_at := public.notification_next_permitted_at(now(), v_profile.notification_timezone);
    if v_permitted_at > now() + interval '1 second' then
      update public.notification_deliveries
      set status = 'pending', next_attempt_at = v_permitted_at,
          quiet_hours_deferred_count = quiet_hours_deferred_count + 1
      where id = p_delivery_id;
      return;
    end if;
  end if;

  if v_delivery.attempt_count >= 5 then
    update public.notification_deliveries
    set status = 'failed', final_outcome = 'failed', finalized_at = now(),
        error_code = 'retry_budget_exhausted',
        error_message = 'Notification provider retry budget exhausted'
    where id = p_delivery_id;
    return;
  end if;

  insert into public.notification_delivery_attempts (
    delivery_id, organization_id, profile_id, attempt_number, provider, content_sha256
  ) values (
    v_delivery.id, v_delivery.organization_id, v_delivery.profile_id,
    v_delivery.attempt_count + 1, p_provider, p_content_sha256
  ) returning id into v_attempt_id;

  update public.notification_deliveries
  set provider = p_provider,
      attempt_count = attempt_count + 1,
      error_code = null,
      error_message = null,
      skip_reason = null
  where id = p_delivery_id;

  return query
    select * from public.notification_delivery_attempts where id = v_attempt_id;
end;
$function$;

revoke all on function public.begin_notification_delivery_attempt(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_notification_delivery_attempt(uuid, text, text)
  to service_role;

create or replace function public.complete_notification_delivery_attempt(
  p_attempt_id uuid,
  p_result text,
  p_provider_message_id text,
  p_provider_status text,
  p_http_status integer,
  p_error_code text,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.notification_delivery_attempts%rowtype;
  v_delay_seconds integer;
begin
  if p_result not in ('accepted', 'retryable', 'failed', 'unknown') then
    raise exception 'Unsupported provider attempt result' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.notification_delivery_attempts
  where id = p_attempt_id
  for update;
  if v_attempt.id is null then
    raise exception 'Notification attempt not found' using errcode = 'P0002';
  end if;
  if v_attempt.status <> 'started' then
    return;
  end if;

  if p_result = 'accepted' then
    update public.notification_delivery_attempts
    set status = 'accepted', provider_message_id = p_provider_message_id,
        provider_status = left(p_provider_status, 100), response_status = p_http_status,
        accepted_at = now(), error_code = null, error_detail = null
    where id = p_attempt_id;

    update public.notification_deliveries
    set status = 'accepted', provider_message_id = p_provider_message_id,
        last_provider_status = left(p_provider_status, 100), accepted_at = now(),
        sent_at = now(), error_code = null, error_message = null
    where id = v_attempt.delivery_id
      and status = 'processing'
      and final_outcome is null;
    return;
  end if;

  if p_result = 'unknown' then
    update public.notification_delivery_attempts
    set status = 'unknown', provider_message_id = p_provider_message_id,
        provider_status = left(p_provider_status, 100), response_status = p_http_status,
        error_code = coalesce(left(p_error_code, 100), 'ambiguous_provider_result'),
        error_detail = left(p_error_detail, 500), finalized_at = now()
    where id = p_attempt_id;

    update public.notification_deliveries
    set status = 'failed', provider_message_id = p_provider_message_id,
        last_provider_status = left(p_provider_status, 100),
        final_outcome = 'unknown', finalized_at = now(),
        error_code = coalesce(left(p_error_code, 100), 'ambiguous_provider_result'),
        error_message = left(p_error_detail, 500)
    where id = v_attempt.delivery_id and status = 'processing';
    return;
  end if;

  if p_result = 'retryable' and v_attempt.attempt_number < 5 then
    -- Exponential backoff with +/-10% jitter, capped at 30 seconds. The cron
    -- cadence may make the effective delay longer, but never shorter.
    v_delay_seconds := greatest(1, ceil(
      least(30000.0, 100.0 * power(2.0, v_attempt.attempt_number - 1))
      * (0.9 + random() * 0.2) / 1000.0
    )::integer);

    update public.notification_delivery_attempts
    set status = 'retry_scheduled', provider_message_id = p_provider_message_id,
        provider_status = left(p_provider_status, 100), response_status = p_http_status,
        error_code = left(p_error_code, 100), error_detail = left(p_error_detail, 500),
        finalized_at = now()
    where id = p_attempt_id;

    update public.notification_deliveries
    set status = 'pending', provider_message_id = p_provider_message_id,
        last_provider_status = left(p_provider_status, 100),
        error_code = left(p_error_code, 100), error_message = left(p_error_detail, 500),
        next_attempt_at = now() + make_interval(secs => v_delay_seconds)
    where id = v_attempt.delivery_id and status = 'processing';
    return;
  end if;

  update public.notification_delivery_attempts
  set status = 'failed', provider_message_id = p_provider_message_id,
      provider_status = left(p_provider_status, 100), response_status = p_http_status,
      error_code = left(p_error_code, 100), error_detail = left(p_error_detail, 500),
      finalized_at = now()
  where id = p_attempt_id;

  update public.notification_deliveries
  set status = 'failed', provider_message_id = p_provider_message_id,
      last_provider_status = left(p_provider_status, 100),
      final_outcome = 'failed', finalized_at = now(),
      error_code = left(p_error_code, 100), error_message = left(p_error_detail, 500)
  where id = v_attempt.delivery_id and status = 'processing';
end;
$function$;

revoke all on function public.complete_notification_delivery_attempt(uuid, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_notification_delivery_attempt(uuid, text, text, text, integer, text, text)
  to service_role;

create or replace function public.record_notification_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_attempt_id uuid,
  p_provider_message_id text,
  p_event_type text,
  p_outcome text,
  p_error_code text,
  p_error_detail text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.notification_delivery_attempts%rowtype;
  v_delivery public.notification_deliveries%rowtype;
  v_event_id uuid;
  v_event_time timestamptz := coalesce(p_occurred_at, now());
begin
  if p_provider not in ('twilio', 'sendgrid')
     or nullif(trim(p_provider_event_id), '') is null
     or length(p_provider_event_id) > 512
     or nullif(trim(p_event_type), '') is null
     or p_outcome is not null and p_outcome not in ('delivered', 'failed') then
    raise exception 'Invalid provider event' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.notification_delivery_attempts
  where id = p_attempt_id
  for update;
  if v_attempt.id is null or v_attempt.provider <> p_provider then
    return false;
  end if;

  select * into v_delivery
  from public.notification_deliveries
  where id = v_attempt.delivery_id
  for update;

  insert into public.notification_provider_events (
    attempt_id, delivery_id, organization_id, provider, provider_event_id,
    provider_message_id, event_type, outcome, error_code, error_detail, occurred_at
  ) values (
    v_attempt.id, v_delivery.id, v_delivery.organization_id, p_provider,
    p_provider_event_id, nullif(left(p_provider_message_id, 255), ''),
    left(p_event_type, 100), p_outcome, nullif(left(p_error_code, 100), ''),
    nullif(left(p_error_detail, 500), ''), v_event_time
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return false;
  end if;

  update public.notification_delivery_attempts
  set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
      provider_status = left(p_event_type, 100),
      status = case p_outcome
        when 'delivered' then 'delivered'
        when 'failed' then 'failed'
        else status
      end,
      error_code = case when p_outcome = 'failed' then nullif(left(p_error_code, 100), '') else error_code end,
      error_detail = case when p_outcome = 'failed' then nullif(left(p_error_detail, 500), '') else error_detail end,
      finalized_at = case when p_outcome is not null then v_event_time else finalized_at end
  where id = v_attempt.id
    and (
      (p_outcome is null and finalized_at is null)
      or (
        p_outcome is not null
        and (
          status = 'unknown'
          or finalized_at is null
          or v_event_time >= finalized_at
        )
      )
    );

  -- Late callbacks from an earlier retry remain in the evidence ledger but may
  -- not overwrite the outcome of the current attempt.
  if v_attempt.attempt_number = v_delivery.attempt_count
     and (
       (p_outcome is null and v_delivery.finalized_at is null)
       or (
         p_outcome is not null
         and (
           v_delivery.final_outcome = 'unknown'
           or v_delivery.finalized_at is null
           or v_event_time >= v_delivery.finalized_at
         )
       )
     ) then
    update public.notification_deliveries
    set provider_message_id = coalesce(provider_message_id, nullif(p_provider_message_id, '')),
        last_provider_status = left(p_event_type, 100)
    where id = v_delivery.id;

    if p_outcome is not null then
      update public.notification_deliveries
      set status = case p_outcome when 'delivered' then 'delivered' else 'failed' end,
          final_outcome = p_outcome,
          finalized_at = v_event_time,
          delivered_at = case when p_outcome = 'delivered' then v_event_time else delivered_at end,
          error_code = case when p_outcome = 'failed' then nullif(left(p_error_code, 100), '') else null end,
          error_message = case when p_outcome = 'failed' then nullif(left(p_error_detail, 500), '') else null end
      where id = v_delivery.id;
    end if;
  end if;

  return true;
end;
$function$;

revoke all on function public.record_notification_provider_event(text, text, uuid, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_notification_provider_event(text, text, uuid, text, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.record_notification_provider_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_event jsonb;
  v_recorded integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 1000 then
    raise exception 'Provider event batch must be an array of at most 1000 items'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    if public.record_notification_provider_event(
      v_event->>'provider',
      v_event->>'provider_event_id',
      (v_event->>'attempt_id')::uuid,
      v_event->>'provider_message_id',
      v_event->>'event_type',
      v_event->>'outcome',
      v_event->>'error_code',
      v_event->>'error_detail',
      (v_event->>'occurred_at')::timestamptz
    ) then
      v_recorded := v_recorded + 1;
    end if;
  end loop;
  return v_recorded;
end;
$function$;

revoke all on function public.record_notification_provider_events(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_notification_provider_events(jsonb) to service_role;

create or replace function public.notification_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 10
      then '1' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  end;
$function$;

revoke all on function public.notification_phone_key(text) from public, anon, authenticated;

create or replace function public.record_notification_consent_event(
  p_channel text,
  p_action text,
  p_provider text,
  p_provider_event_id text,
  p_recipient_fingerprint text,
  p_occurred_at timestamptz,
  p_source text,
  p_attempt_id uuid default null,
  p_recipient text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_profile_id uuid;
  v_organization_id uuid;
  v_event_id uuid;
  v_changed integer := 0;
begin
  if p_channel not in ('email', 'sms')
     or p_action not in ('opt_in', 'opt_out', 'help')
     or p_provider not in ('twilio', 'sendgrid')
     or nullif(trim(p_provider_event_id), '') is null
     or length(p_provider_event_id) > 512
     or nullif(trim(p_source), '') is null
     or p_recipient_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid notification consent event' using errcode = '22023';
  end if;

  if p_attempt_id is not null then
    select d.profile_id, d.organization_id
      into v_profile_id, v_organization_id
    from public.notification_delivery_attempts a
    join public.notification_deliveries d on d.id = a.delivery_id
    where a.id = p_attempt_id;
  elsif p_channel = 'sms' and p_recipient is not null then
    select id, organization_id into v_profile_id, v_organization_id
    from public.profiles
    where public.notification_phone_key(phone) = public.notification_phone_key(p_recipient)
      and is_active
    order by created_at
    limit 1;
  end if;

  insert into public.notification_consent_events (
    organization_id, profile_id, attempt_id, channel, action, provider,
    provider_event_id, recipient_fingerprint, source, occurred_at
  ) values (
    v_organization_id, v_profile_id, p_attempt_id, p_channel, p_action, p_provider,
    p_provider_event_id, p_recipient_fingerprint, left(p_source, 100),
    coalesce(p_occurred_at, now())
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null or p_action = 'help' then
    return 0;
  end if;

  if p_channel = 'sms' then
    update public.profiles
    set sms_opt_in = (p_action = 'opt_in'),
        sms_consent_at = case when p_action = 'opt_in' then coalesce(p_occurred_at, now()) else sms_consent_at end,
        sms_opt_out_at = case when p_action = 'opt_out' then coalesce(p_occurred_at, now()) else null end
    where (
        p_recipient is not null
        and public.notification_phone_key(phone) = public.notification_phone_key(p_recipient)
      )
       or (p_recipient is null and id = v_profile_id);
  else
    update public.profiles
    set email_opt_out = (p_action = 'opt_out'),
        email_opt_out_at = case when p_action = 'opt_out' then coalesce(p_occurred_at, now()) else null end
    where id = v_profile_id;
  end if;
  get diagnostics v_changed = row_count;

  if p_action = 'opt_out' then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = upper(p_channel) || ' recipient opted out',
        finalized_at = now()
    where channel = p_channel
      and status in ('pending', 'processing')
      and (
        profile_id = v_profile_id
        or (
          p_channel = 'sms' and p_recipient is not null
          and public.notification_phone_key(recipient) = public.notification_phone_key(p_recipient)
        )
      );
  end if;

  return v_changed;
end;
$function$;

revoke all on function public.record_notification_consent_event(text, text, text, text, text, timestamptz, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_notification_consent_event(text, text, text, text, text, timestamptz, text, uuid, text)
  to service_role;

create or replace function public.record_notification_consent_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_event jsonb;
  v_changed integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 1000 then
    raise exception 'Consent event batch must be an array of at most 1000 items'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_changed := v_changed + public.record_notification_consent_event(
      v_event->>'channel',
      v_event->>'action',
      v_event->>'provider',
      v_event->>'provider_event_id',
      v_event->>'recipient_fingerprint',
      (v_event->>'occurred_at')::timestamptz,
      v_event->>'source',
      case
        when nullif(v_event->>'attempt_id', '') is null then null
        else (v_event->>'attempt_id')::uuid
      end,
      v_event->>'recipient'
    );
  end loop;
  return v_changed;
end;
$function$;

revoke all on function public.record_notification_consent_events(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_notification_consent_events(jsonb) to service_role;

-- Replace the queue claim to respect retry/quiet-hours scheduling and to avoid
-- blindly resending an ambiguous attempt after a worker crash. Once an attempt
-- row exists, automatic replay could create a duplicate provider message; it is
-- quarantined as unknown for evidence-driven reconciliation instead.
create or replace function public.claim_pending_notification_deliveries(
  p_batch_size integer,
  p_stale_after_seconds integer
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if p_batch_size < 1 or p_batch_size > 500
     or p_stale_after_seconds < 60 or p_stale_after_seconds > 86400 then
    raise exception 'Invalid notification claim bounds' using errcode = '22023';
  end if;

  with ambiguous as materialized (
    select nd.id, a.id as attempt_id
    from public.notification_deliveries nd
    join public.notification_delivery_attempts a
      on a.delivery_id = nd.id and a.attempt_number = nd.attempt_count
    where nd.status = 'processing'
      and nd.updated_at < now() - make_interval(secs => p_stale_after_seconds)
      and a.status = 'started'
    for update of nd, a skip locked
  ),
  marked_attempts as (
    update public.notification_delivery_attempts a
    set status = 'unknown', finalized_at = now(), error_code = 'dispatch_interrupted',
        error_detail = 'Dispatch interrupted after provider attempt began; manual reconciliation required'
    from ambiguous x
    where a.id = x.attempt_id
    returning a.id
  )
  update public.notification_deliveries nd
  set status = 'failed', final_outcome = 'unknown', finalized_at = now(),
      error_code = 'dispatch_interrupted',
      error_message = 'Dispatch interrupted after provider attempt began; manual reconciliation required'
  from ambiguous x
  where nd.id = x.id;

  return query
  with candidates as (
    select nd.id
    from public.notification_deliveries nd
    where (nd.status = 'pending' and nd.next_attempt_at <= now())
       or (
         nd.status = 'processing'
         and nd.updated_at < now() - make_interval(secs => p_stale_after_seconds)
         and not exists (
           select 1 from public.notification_delivery_attempts a
           where a.delivery_id = nd.id
             and a.attempt_number = nd.attempt_count
             and a.status = 'started'
         )
       )
    order by nd.next_attempt_at, nd.created_at, nd.id
    limit p_batch_size
    for update skip locked
  )
  update public.notification_deliveries nd
  set status = 'processing'
  from candidates c
  where nd.id = c.id
  returning nd.*;
end;
$function$;

revoke all on function public.claim_pending_notification_deliveries(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_pending_notification_deliveries(integer, integer)
  to service_role;

create or replace function public.retry_notification_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may retry notification deliveries' using errcode = '42501';
  end if;

  update public.notification_deliveries d
  set status = 'pending', provider = null, provider_message_id = null,
      error_message = null, error_code = null, skip_reason = null,
      sent_at = null, accepted_at = null, delivered_at = null,
      finalized_at = null, final_outcome = null,
      next_attempt_at = case
        when d.channel = 'sms' then public.notification_next_permitted_at(
          now(), (select p.notification_timezone from public.profiles p where p.id = d.profile_id)
        )
        else now()
      end
  where id = p_delivery_id
    and status = 'failed'
    and final_outcome = 'failed'
    and attempt_count < 5;

  if not found then
    raise exception 'Delivery % is not a safely retryable failure or its retry budget is exhausted', p_delivery_id
      using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.retry_notification_delivery(uuid) from public, anon;
grant execute on function public.retry_notification_delivery(uuid) to authenticated;

create or replace function public.get_notification_delivery_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect notification delivery health'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'pendingReady', count(*) filter (where status = 'pending' and next_attempt_at <= now()),
    'deferred', count(*) filter (where status = 'pending' and next_attempt_at > now()),
    'processing', count(*) filter (where status = 'processing'),
    'awaitingFinal', count(*) filter (where status in ('sent', 'accepted')),
    'delivered24h', count(*) filter (where final_outcome = 'delivered' and finalized_at >= now() - interval '24 hours'),
    'failed24h', count(*) filter (where final_outcome = 'failed' and finalized_at >= now() - interval '24 hours'),
    'unknown', count(*) filter (where final_outcome = 'unknown'),
    'oldestActionableAt', min(created_at) filter (where status in ('pending', 'failed'))
  ) into v_result
  from public.notification_deliveries;

  return v_result || jsonb_build_object(
    'signedProviderEvents24h', (
      select count(*) from public.notification_provider_events
      where received_at >= now() - interval '24 hours'
    )
  );
end;
$function$;

revoke all on function public.get_notification_delivery_health() from public, anon;
grant execute on function public.get_notification_delivery_health() to authenticated;
