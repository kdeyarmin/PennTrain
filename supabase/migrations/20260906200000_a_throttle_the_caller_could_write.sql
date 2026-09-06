-- A throttle the caller could write, and an intake that counted its own failures against the
-- person reporting.
--
-- BACKLOG J46 and J47.
--
-- J46. `app_private.guest_caller_key` reads the FIRST hop of `x-forwarded-for`. That header is
-- append-only: every proxy adds its observation to the END, and the first entry is whatever the
-- client put there. So the throttle is keyed on a value the caller controls -- rotate it per
-- request and the limit never applies -- while everyone actually behind one address shares one
-- budget, because a caller who sends nothing gets the real address in the same slot.
--
-- The last non-empty hop is the one the gateway itself observed and the one a client cannot forge.
-- It is read by POSITION FROM THE END rather than by a fixed index, so adding a proxy in front
-- does not silently move the key.
--
-- The unknown-token limit also stops being global per caller. Ten wrong tokens a minute is
-- generous for one surface and punishing across six: a resident mistyping a portal link burned the
-- same budget the survey-packet and safety-report surfaces draw on, and after ten pauses the
-- building was locked out of all of them. It is now per (caller, surface).
--
-- J47. `reserve_confidential_intake_attempt` counts every attempt row in the hour whatever became
-- of it, so a submission that failed because the PRODUCT failed spends the reporter's quota. A
-- confidential safety report is exactly the wrong thing to rate-limit on our own errors: the
-- person is reporting abuse or neglect, from a phone, probably behind the building's own
-- connection, and the refusal they get says try again later. Attempts that failed for a reason
-- that is not the caller's stop counting. This is the shape I22 fixed for the signup limiter.

-- ---------------------------------------------------------------------------
-- J46 -- the hop the caller cannot write
-- ---------------------------------------------------------------------------

create or replace function app_private.guest_caller_key(p_token_sha256 text)
returns text
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_headers jsonb := '{}'::jsonb;
  v_hops text[];
  v_hop text;
  v_index integer;
begin
  -- request.headers is set by PostgREST per request and is absent in a plain SQL session; a
  -- malformed value must not take a guest page down, so this fails soft to the token key.
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  -- BACKLOG J46. The LAST non-empty hop, not the first.
  --
  -- `x-forwarded-for` is append-only: each proxy appends what IT observed, so the last entry is
  -- the address the gateway in front of us actually saw, and everything before it is a claim. The
  -- first entry is whatever the client sent -- rotate it per request and the throttle never
  -- applies to you, send nothing and you share a budget with every other caller behind your
  -- address. Read from the end rather than at a fixed index, so a proxy added in front of the
  -- platform later does not move the key without anyone noticing.
  v_hops := string_to_array(coalesce(v_headers->>'x-forwarded-for', ''), ',');
  for v_index in reverse coalesce(array_length(v_hops, 1), 0) .. 1 loop
    v_hop := btrim(v_hops[v_index]);
    if v_hop <> '' and length(v_hop) <= 45 then
      return 'ip:' || v_hop;
    end if;
  end loop;

  return 'token:' || p_token_sha256;
end;
$function$;

comment on function app_private.guest_caller_key(text) is
  'The throttle key for one guest request: the LAST non-empty hop of x-forwarded-for, which is what '
  'the gateway observed, falling back to the token digest when there is no header at all. The first '
  'hop is whatever the client sent -- keying on it let a caller rotate past the limit entirely and '
  'made everyone behind one address share one budget (BACKLOG J46).';

-- The unknown-token budget is per surface, so one mistyped portal link cannot lock a building out
-- of the safety-report poster.
alter table app_private.guest_request_windows
  add column if not exists surface text not null default 'unknown';

do $do$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'app_private.guest_request_windows'::regclass
      and conname = 'guest_request_windows_pkey'
      and pg_get_constraintdef(oid) like '%surface%'
  ) then
    alter table app_private.guest_request_windows
      drop constraint if exists guest_request_windows_pkey;
    alter table app_private.guest_request_windows
      add constraint guest_request_windows_pkey primary key (caller_key, window_started_at, surface);
  end if;
end;
$do$;

comment on column app_private.guest_request_windows.surface is
  'Which guest surface this minute''s counters belong to. The request budget is deliberately '
  'shared across surfaces -- a scanner is a scanner -- but the UNKNOWN-TOKEN budget is per '
  'surface: ten wrong tokens a minute is generous for one link and punishing across six, and a '
  'resident mistyping a portal link used to spend the budget the safety-report poster draws on '
  '(BACKLOG J46).';

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'guest_request_denial';
  if v_def is null then raise exception 'public.guest_request_denial is missing'; end if;

  if position('p_surface' in v_def) > 0 and position('surface = p_surface' in v_def) > 0 then
    raise notice 'guest_request_denial already counts per surface';
  else
    v_old := $q$  insert into app_private.guest_request_windows (
    caller_key, window_started_at, request_count, unknown_token_count
  ) values (
    v_caller, v_window, 1, case when v_org is null then 1 else 0 end
  )
  on conflict (caller_key, window_started_at) do update set
    request_count = app_private.guest_request_windows.request_count + 1,
    unknown_token_count = app_private.guest_request_windows.unknown_token_count
      + case when v_org is null then 1 else 0 end
  returning request_count, unknown_token_count into v_count, v_unknown;$q$;
    v_new := $q$  -- BACKLOG J46: counted per surface, so a mistyped portal link cannot spend the
  -- safety-report poster's budget. The REQUEST count is still summed across surfaces below,
  -- because a scanner hitting six surfaces is one scanner.
  insert into app_private.guest_request_windows (
    caller_key, window_started_at, surface, request_count, unknown_token_count
  ) values (
    v_caller, v_window, p_surface, 1, case when v_org is null then 1 else 0 end
  )
  on conflict (caller_key, window_started_at, surface) do update set
    request_count = app_private.guest_request_windows.request_count + 1,
    unknown_token_count = app_private.guest_request_windows.unknown_token_count
      + case when v_org is null then 1 else 0 end
  returning unknown_token_count into v_unknown;

  select coalesce(sum(w.request_count), 0)::integer into v_count
  from app_private.guest_request_windows w
  where w.caller_key = v_caller and w.window_started_at = v_window;$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'guest_request_denial no longer counts the window this migration patches';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- J47 -- the reporter is not charged for our failures
-- ---------------------------------------------------------------------------

alter table public.confidential_intake_attempts
  add column if not exists counts_toward_rate_limit boolean not null default true;

comment on column public.confidential_intake_attempts.counts_toward_rate_limit is
  'Whether this attempt spends the caller''s hourly quota. False for a failure that is not the '
  'caller''s: a submission the product could not complete, or a challenge that timed out. A '
  'confidential safety report is the wrong thing to rate-limit on our own errors -- the person is '
  'reporting abuse or neglect, from a phone, usually behind the building''s own connection '
  '(BACKLOG J47).';

update public.confidential_intake_attempts
set counts_toward_rate_limit = false
where not success
  and coalesce(error_code, '') in ('submission_failed', 'failed', 'turnstile_failed', 'reserved')
  and counts_toward_rate_limit;

create or replace function public.reserve_confidential_intake_attempt(
  p_ip_hash text,
  p_facility_id uuid,
  p_limit integer default 5
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id bigint;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 then
    raise exception 'invalid intake reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('confidential-intake:' || p_ip_hash, 0));
  -- BACKLOG J47. Only attempts that count. An in-flight reservation counts -- it is a submission
  -- in progress -- and finalize_confidential_intake_attempt decides afterwards whether it keeps
  -- counting, which is the same shape I22 gave the signup limiter.
  if (select count(*) from public.confidential_intake_attempts
      where ip_hash = p_ip_hash
        and counts_toward_rate_limit
        and created_at >= now() - interval '1 hour') >= p_limit then
    raise exception 'confidential_intake_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.confidential_intake_attempts(ip_hash, facility_id, success, error_code)
  values (p_ip_hash, p_facility_id, false, 'reserved') returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.finalize_confidential_intake_attempt(
  p_attempt_id bigint,
  p_success boolean,
  p_error_code text default null
)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  with changed as (
    update public.confidential_intake_attempts
    set success = p_success,
        error_code = case when p_success then null else left(coalesce(p_error_code, 'failed'), 100) end,
        -- BACKLOG J47. A failure the caller caused still counts; one the product caused does not.
        counts_toward_rate_limit = p_success
          or coalesce(p_error_code, 'failed') not in ('submission_failed', 'failed', 'turnstile_failed')
    where id = p_attempt_id and error_code = 'reserved'
    returning 1
  )
  select exists(select 1 from changed);
$function$;

comment on function public.finalize_confidential_intake_attempt(bigint, boolean, text) is
  'Closes out a reserved confidential-intake attempt. A failure the CALLER caused keeps counting '
  'against their hourly quota; one the product caused (submission_failed, a timed-out challenge) '
  'stops counting, so a reporter is not locked out of a safety report by our own errors '
  '(BACKLOG J47).';
