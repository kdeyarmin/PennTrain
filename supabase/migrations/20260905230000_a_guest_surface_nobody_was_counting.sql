-- Seventeen anonymous entry points, no throttle, and no record of a wrong guess (I16 residual).
--
-- The guest and resident-portal flows are reached by tokenised link with no account, so they are
-- anon-executable by design -- their security is the token each one validates, not the grant. That
-- is sound as far as it goes, and it leaves four things unattended:
--
--   1. NOTHING COUNTED THE ATTEMPTS. Seventeen SECURITY DEFINER functions take a bearer token from
--      an unauthenticated caller and answer. A script can present as many as it likes, as fast as
--      it likes. The tokens are 32 random bytes, so guessing one is not the threat; being able to
--      try forever, from anywhere, against a surface that reads resident schedules, financial
--      statements and shared clinical documents, is.
--   2. A WRONG GUESS LEFT NO TRACE. Each function answers `invalid` or raises 42501 and returns.
--      Nobody could tell a scan from a family member with a stale link, because neither wrote
--      anything down. The first evidence of an attack would have been its success.
--   3. SUSPENSION STOPPED AT THE FRONT DOOR. An organization suspended for non-payment or during
--      an investigation keeps every outstanding guest link live: the grant rows are untouched by
--      suspension and no guest RPC looks at the organization at all.
--   4. ONE ISSUER HAD NO CEILING. `issue_move_in_guest_grant` validates that the expiry is in the
--      future and stops there, while its three siblings cap at 30 or 90 days.
--
-- ONE GATE RATHER THAN SEVENTEEN CHECKS. `assert_guest_request_allowed(surface, token)` is called
-- as the first statement of every one of the seventeen -- a mechanical, reviewable one-line
-- insertion -- and does all three of the first items in one place. Putting the rules in the
-- functions themselves would mean seventeen copies of a policy that has to agree with itself, and
-- the eighteenth guest endpoint would be written without them.
--
-- KEYED ON THE CALLER, NOT THE TOKEN. A limit per token throttles nobody: an enumerating client
-- presents a different token every time, which is the whole point of enumerating. The key is the
-- first hop of `x-forwarded-for`, falling back to the token's own hash when there is no header
-- (a direct database session). Unknown tokens get a much tighter budget than known ones, because
-- a legitimate guest always presents a token that exists.
--
-- IT ADDS NO ORACLE. A single unknown-token attempt is recorded and allowed through; the calling
-- function then gives its usual refusal. Only the eleventh in a minute is answered differently,
-- and by then the caller has told us what they are doing.

------------------------------------------------------------------------------------------------
-- Storage
------------------------------------------------------------------------------------------------
create table if not exists app_private.guest_request_windows (
  caller_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  unknown_token_count integer not null default 0 check (unknown_token_count >= 0),
  primary key (caller_key, window_started_at)
);

alter table app_private.guest_request_windows enable row level security;
revoke all on table app_private.guest_request_windows from public, anon, authenticated;
grant select, insert, update, delete on table app_private.guest_request_windows to service_role;

comment on table app_private.guest_request_windows is
  'Per-caller, per-minute counters for the anonymous guest and resident-portal RPCs. Rows older '
  'than fifteen minutes are swept opportunistically by the gate. BACKLOG.md I16.';

create table if not exists app_private.guest_token_failures (
  id bigint generated always as identity primary key,
  surface text not null,
  token_sha256 text not null,
  caller_key text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists guest_token_failures_recent_idx
  on app_private.guest_token_failures (occurred_at desc);
create index if not exists guest_token_failures_caller_idx
  on app_private.guest_token_failures (caller_key, occurred_at desc);

alter table app_private.guest_token_failures enable row level security;
revoke all on table app_private.guest_token_failures from public, anon, authenticated;
grant select, insert, delete on table app_private.guest_token_failures to service_role;

comment on table app_private.guest_token_failures is
  'One row per guest token that resolved to nothing: the surface, the SHA-256 of what was '
  'presented (never the token itself, and a failed guess is not replayable anyway) and the caller '
  'it came from. This is how a scan becomes visible before it succeeds. BACKLOG.md I16.';

------------------------------------------------------------------------------------------------
-- The caller key
------------------------------------------------------------------------------------------------
create or replace function app_private.guest_caller_key(p_token_sha256 text)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_headers jsonb := '{}'::jsonb;
  v_forwarded text;
begin
  -- request.headers is set by PostgREST per request and is absent in a plain SQL session; a
  -- malformed value must not take a guest page down, so this fails soft to the token key.
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  -- First hop only. The rest of the chain is whatever the client claimed.
  v_forwarded := btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
  if v_forwarded <> '' and length(v_forwarded) <= 45 then
    return 'ip:' || v_forwarded;
  end if;
  return 'token:' || p_token_sha256;
end;
$function$;

revoke all on function app_private.guest_caller_key(text) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- The gate
------------------------------------------------------------------------------------------------
create or replace function public.assert_guest_request_allowed(p_surface text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  -- A guest page load makes a handful of calls; sixty a minute is generous for a person and
  -- useless for a scanner. Ten unknown tokens a minute is more than any real link mistyped.
  c_request_limit constant integer := 60;
  c_unknown_limit constant integer := 10;
  v_hash text;
  v_caller text;
  v_org uuid;
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
  v_unknown integer;
begin
  v_hash := encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
  v_caller := app_private.guest_caller_key(v_hash);

  -- Does this token resolve to a live grant? The four grant tables share the shape that matters
  -- (organization_id, token_sha256, expires_at, revoked_at), and the safety-report poster is a
  -- facility token rather than a grant -- including the legacy facility-UUID form, which is a
  -- real QR code in the world and must not be counted as a wrong guess.
  if p_surface = 'resident_portal' then
    select g.organization_id into v_org from public.resident_portal_grants g
    where g.token_sha256 = v_hash and g.revoked_at is null and g.expires_at > now();
  elsif p_surface = 'evidence_guest' then
    select g.organization_id into v_org from public.evidence_guest_grants g
    where g.token_sha256 = v_hash and g.revoked_at is null and g.expires_at > now();
  elsif p_surface = 'move_in_guest' then
    select g.organization_id into v_org from public.move_in_guest_grants g
    where g.token_sha256 = v_hash and g.revoked_at is null and g.expires_at > now();
  elsif p_surface = 'resident_agreement_guest' then
    select g.organization_id into v_org from public.resident_agreement_guest_grants g
    where g.token_sha256 = v_hash and g.revoked_at is null and g.expires_at > now();
  elsif p_surface = 'survey_packet_guest' then
    select g.organization_id into v_org from public.survey_packet_guest_grants g
    where g.token_sha256 = v_hash and g.revoked_at is null and g.expires_at > now();
  elsif p_surface = 'safety_report' then
    select f.organization_id into v_org from public.facilities f
    where f.safety_report_token = btrim(coalesce(p_token, ''))
       or (btrim(coalesce(p_token, '')) ~ '^[0-9a-fA-F-]{36}$'
           and f.id = btrim(p_token)::uuid);
  else
    raise exception 'Unknown guest surface %', p_surface using errcode = '22023';
  end if;

  insert into app_private.guest_request_windows (
    caller_key, window_started_at, request_count, unknown_token_count
  ) values (
    v_caller, v_window, 1, case when v_org is null then 1 else 0 end
  )
  on conflict (caller_key, window_started_at) do update set
    request_count = app_private.guest_request_windows.request_count + 1,
    unknown_token_count = app_private.guest_request_windows.unknown_token_count
      + case when v_org is null then 1 else 0 end
  returning request_count, unknown_token_count into v_count, v_unknown;

  -- Swept here rather than by a job: the first call of a new minute for this caller is the
  -- cheapest moment, and a table nobody prunes is its own outage later.
  if v_count = 1 then
    delete from app_private.guest_request_windows
    where window_started_at < v_window - interval '15 minutes';
  end if;

  if v_org is null then
    insert into app_private.guest_token_failures (surface, token_sha256, caller_key)
    values (p_surface, v_hash, v_caller);
  end if;

  if v_unknown > c_unknown_limit then
    raise exception 'Too many invalid access attempts from this connection. Wait a minute and open the link again.'
      using errcode = 'P0001';
  end if;
  if v_count > c_request_limit then
    raise exception 'Too many requests from this connection. Wait a minute and try again.'
      using errcode = 'P0001';
  end if;

  -- A suspended or cancelled organization's outstanding links stop working. The grant rows are
  -- untouched, so they resume if the account does.
  if v_org is not null and exists (
    select 1 from public.organizations o
    where o.id = v_org and o.subscription_status in ('suspended', 'canceled')
  ) then
    raise exception 'This facility''s account is not active. Please contact the facility directly.'
      using errcode = '42501';
  end if;
end;
$function$;

comment on function public.assert_guest_request_allowed(text, text) is
  'The first statement of every anonymous guest RPC: throttles the caller, records a token that '
  'resolved to nothing, and refuses a suspended organization''s outstanding links. Keyed on the '
  'caller rather than the token, because an enumerating client presents a different token each '
  'time. BACKLOG.md I16.';

revoke all on function public.assert_guest_request_allowed(text, text) from public;
grant execute on function public.assert_guest_request_allowed(text, text) to anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- What an operator sees
------------------------------------------------------------------------------------------------
create or replace function public.get_guest_access_health(p_hours integer default 24)
returns table (
  surface text,
  failed_lookups integer,
  distinct_callers integer,
  worst_caller_failures integer,
  last_failure_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'Window must be between 1 and 720 hours' using errcode = '22023';
  end if;
  return query
  select f.surface,
         count(*)::integer,
         count(distinct f.caller_key)::integer,
         coalesce(max(per_caller.n), 0)::integer,
         max(f.occurred_at)
  from app_private.guest_token_failures f
  left join lateral (
    select count(*)::integer as n
    from app_private.guest_token_failures g
    where g.caller_key = f.caller_key and g.surface = f.surface
      and g.occurred_at >= now() - make_interval(hours => p_hours)
  ) per_caller on true
  where f.occurred_at >= now() - make_interval(hours => p_hours)
  group by f.surface
  order by count(*) desc;
end;
$function$;

comment on function public.get_guest_access_health(integer) is
  'Platform-admin view of guest tokens that resolved to nothing, by surface and by caller. A '
  'single caller with many failures on one surface is an enumeration attempt; scattered singles '
  'are stale links. BACKLOG.md I16.';

revoke all on function public.get_guest_access_health(integer) from public, anon;
grant execute on function public.get_guest_access_health(integer) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- The seventeen, each spliced from its deployed body with one statement inserted after BEGIN
------------------------------------------------------------------------------------------------
-- accept_resident_portal_terms (resident_portal)
CREATE OR REPLACE FUNCTION public.accept_resident_portal_terms(p_token text, p_terms_version text, p_request_fingerprint_sha256 text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_grant public.resident_portal_grants%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.terms_version <> p_terms_version then return false; end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  update public.resident_portal_grants set accepted_terms_at = coalesce(accepted_terms_at, now()),
    last_accessed_at = now() where id = v_grant.id;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'terms_accepted', p_request_fingerprint_sha256
  );
  return true;
end;
$function$

;

-- authorize_resident_portal_document_download (resident_portal)
CREATE OR REPLACE FUNCTION public.authorize_resident_portal_document_download(p_token text, p_shared_document_id uuid, p_request_fingerprint_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_shared public.resident_portal_shared_documents%rowtype;
  v_document public.resident_documents%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  select * into v_shared from public.resident_portal_shared_documents where id = p_shared_document_id;
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('documents' = any(v_grant.permissions))
     or v_shared.id is null or v_shared.grant_id <> v_grant.id or v_shared.withdrawn_at is not null then
    raise exception 'Portal document access denied' using errcode = '42501';
  end if;
  perform app_private.assert_clinical_disclosure_allowed(v_grant.resident_id);
  select * into v_document from public.resident_documents where id = v_shared.document_id;
  if v_document.id is null or v_document.resident_id <> v_grant.resident_id
     or v_document.storage_bucket is null or v_document.storage_path is null then
    raise exception 'Portal document is unavailable' using errcode = 'P0002';
  end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Portal request fingerprint is invalid' using errcode = '22023';
  end if;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'document_downloaded', p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'authorized', true, 'bucket', v_document.storage_bucket, 'path', v_document.storage_path,
    'fileName', v_document.file_name, 'fileType', v_document.file_type
  );
end;
$function$

;

-- get_resident_portal_experience (resident_portal)
CREATE OR REPLACE FUNCTION public.get_resident_portal_experience(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_grant public.resident_portal_grants%rowtype; v_snapshot jsonb; v_requests jsonb := '[]'::jsonb; v_payment jsonb := 'null'::jsonb;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_snapshot := public.get_resident_portal_snapshot(p_token, null);
  if v_snapshot->>'accessStatus' <> 'active' then return v_snapshot; end if;
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if 'requests' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'requestType', r.request_type, 'subject', r.subject, 'detail', r.detail,
      'status', r.status, 'facilityResponse', r.facility_response, 'createdAt', r.created_at
    ) order by r.created_at desc), '[]'::jsonb) into v_requests
    from public.resident_portal_requests r where r.grant_id = v_grant.id;
  end if;
  if 'payments' = any(v_grant.permissions) then
    select coalesce(to_jsonb(x), 'null'::jsonb) into v_payment from (
      select p.id, p.provider_name as "providerName", p.secure_url as "secureUrl",
        p.amount_due as "amountDue", p.expires_at as "expiresAt"
      from public.resident_payment_links p
      where p.resident_id = v_grant.resident_id and p.status = 'active' and p.expires_at > now()
      order by p.created_at desc limit 1
    ) x;
  end if;
  return v_snapshot || jsonb_build_object('requests', v_requests, 'payment', v_payment);
end;
$function$

;

-- get_resident_portal_snapshot (resident_portal)
CREATE OR REPLACE FUNCTION public.get_resident_portal_snapshot(p_token text, p_request_fingerprint_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_disclosure_ok boolean;
  v_schedule jsonb := '[]'::jsonb;
  v_finance jsonb := 'null'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null then return jsonb_build_object('accessStatus', 'invalid'); end if;
  if v_grant.accepted_terms_at is null then
    return jsonb_build_object(
      'accessStatus', 'terms_required', 'termsVersion', v_grant.terms_version,
      'expiresAt', v_grant.expires_at
    );
  end if;
  select * into v_resident from public.residents where id = v_grant.resident_id;
  select * into v_facility from public.facilities where id = v_grant.facility_id;
  v_disclosure_ok := app_private.clinical_disclosure_allowed(v_resident.clinical_data_consent);
  if 'schedule' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(s) order by s."startsAt"), '[]'::jsonb) into v_schedule
    from (
      select e.id, e.event_type as "eventType", e.title, e.starts_at as "startsAt",
        e.ends_at as "endsAt", e.location_name as "locationName",
        e.transportation_mode as "transportationMode",
        case when v_disclosure_ok then e.preparation_instructions else null end as "preparationInstructions"
      from public.resident_service_calendar_events e
      where e.resident_id = v_grant.resident_id and e.status = 'scheduled'
        and e.starts_at >= now() and e.starts_at < now() + interval '90 days'
      order by e.starts_at limit 25
    ) s;
  end if;
  if 'finance' = any(v_grant.permissions) then
    select coalesce(to_jsonb(s), 'null'::jsonb) into v_finance from (
      select f.statement_number as "statementNumber", f.issued_on as "issuedOn",
        f.due_date as "dueDate", f.balance_due as "balanceDue",
        f.delinquent_amount as "delinquentAmount"
      from public.resident_financial_statements f where f.resident_id = v_grant.resident_id
      order by f.issued_on desc, f.created_at desc limit 1
    ) s;
  end if;
  -- Shared documents are an outbound PHI disclosure — only when consent is granted.
  if v_disclosure_ok and 'documents' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(d) order by d."sharedAt" desc), '[]'::jsonb) into v_documents
    from (
      select sd.id, sd.display_label as "displayLabel", rd.file_name as "fileName",
        rd.file_type as "fileType", sd.shared_at as "sharedAt"
      from public.resident_portal_shared_documents sd
      join public.resident_documents rd on rd.id = sd.document_id
      where sd.grant_id = v_grant.id and sd.withdrawn_at is null
    ) d;
  end if;
  if 'messages' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(m) order by m."createdAt"), '[]'::jsonb) into v_messages
    from (
      select pm.id, pm.direction, pm.body, pm.created_at as "createdAt"
      from public.resident_portal_messages pm where pm.grant_id = v_grant.id
      order by pm.created_at desc limit 50
    ) m;
  end if;
  update public.resident_portal_grants set last_accessed_at = now() where id = v_grant.id;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    case when v_disclosure_ok and 'documents' = any(v_grant.permissions)
      then 'document_list_viewed' else 'view' end,
    p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'accessStatus', 'active',
    'expiresAt', v_grant.expires_at,
    'designatedPersonName', v_grant.designated_person_name,
    'relationship', v_grant.relationship_label,
    'permissions', to_jsonb(v_grant.permissions),
    'clinicalDisclosureAllowed', v_disclosure_ok,
    'clinicalDataConsent', v_resident.clinical_data_consent,
    'resident', jsonb_build_object(
      'displayName', v_resident.first_name || ' ' || v_resident.last_name,
      'room', v_resident.room
    ),
    'facility', jsonb_build_object(
      'name', v_facility.name, 'phone', v_facility.phone,
      'address', concat_ws(', ', v_facility.address, v_facility.city, v_facility.state, v_facility.zip)
    ),
    'schedule', v_schedule, 'finance', v_finance,
    'documents', v_documents, 'messages', v_messages
  );
end;
$function$

;

-- post_resident_portal_message (resident_portal)
CREATE OR REPLACE FUNCTION public.post_resident_portal_message(p_token text, p_body text, p_request_fingerprint_sha256 text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_grant public.resident_portal_grants%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null
     or not ('messages' = any(v_grant.permissions)) then return false; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Message must be between 1 and 5000 characters' using errcode = '22023';
  end if;
  insert into public.resident_portal_messages(
    organization_id, facility_id, grant_id, resident_id, direction, body
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'designated_person_to_facility', btrim(p_body)
  );
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'message_sent', p_request_fingerprint_sha256
  );
  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select distinct v_grant.organization_id, p.id, 'portal_message_received',
    'Designated-person portal message', 'A new designated-person message needs review.',
    '/app/residents/' || v_grant.resident_id
  from public.profiles p
  left join public.facility_assignments fa on fa.profile_id = p.id and fa.facility_id = v_grant.facility_id
  where p.organization_id = v_grant.organization_id and p.is_active
    and (p.role = 'org_admin' or (p.role = 'facility_manager' and fa.id is not null));
  return true;
end;
$function$

;

-- post_resident_portal_request (resident_portal)
CREATE OR REPLACE FUNCTION public.post_resident_portal_request(p_token text, p_request_type text, p_subject text, p_detail text, p_request_fingerprint_sha256 text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_grant public.resident_portal_grants%rowtype; v_id uuid;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('requests' = any(v_grant.permissions)) then
    raise exception 'Portal request access denied' using errcode = '42501';
  end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Portal request fingerprint is invalid' using errcode = '22023';
  end if;
  insert into public.resident_portal_requests(
    organization_id, facility_id, grant_id, resident_id, request_type, subject, detail
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    p_request_type, btrim(p_subject), btrim(p_detail)
  ) returning id into v_id;
  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select v_grant.organization_id, p.id, 'resident_portal_request',
    'New designated-person portal request', left(btrim(p_subject), 300),
    concat('/app/residents/', v_grant.resident_id)
  from public.profiles p
  where p.organization_id = v_grant.organization_id and p.is_active and p.role in ('org_admin', 'facility_manager');
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'request_submitted', p_request_fingerprint_sha256
  );
  return v_id;
end;
$function$

;

-- respond_resident_portal_schedule_event (resident_portal)
CREATE OR REPLACE FUNCTION public.respond_resident_portal_schedule_event(p_token text, p_calendar_event_id uuid, p_response text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_grant public.resident_portal_grants%rowtype; v_id uuid;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_portal', p_token);
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('schedule' = any(v_grant.permissions))
     or not exists (select 1 from public.resident_service_calendar_events e where e.id = p_calendar_event_id and e.resident_id = v_grant.resident_id)
     or p_response not in ('confirmed', 'needs_change', 'cannot_attend') then
    raise exception 'Schedule response is outside portal scope' using errcode = '42501';
  end if;
  insert into public.resident_portal_schedule_responses(
    organization_id, facility_id, grant_id, resident_id, calendar_event_id, response, note
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    p_calendar_event_id, p_response, nullif(btrim(p_note), '')
  ) on conflict (grant_id, calendar_event_id) do update set
    response = excluded.response, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$

;

-- accept_evidence_guest_terms (evidence_guest)
CREATE OR REPLACE FUNCTION public.accept_evidence_guest_terms(p_token text, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('evidence_guest', p_token);
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if v_grant.id is null then
    return jsonb_build_object('accepted', false, 'reason', 'access_denied');
  end if;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;
  if v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_col.status <> 'published'
     or v_org.subscription_status in ('suspended', 'canceled') then
    return jsonb_build_object('accepted', false, 'reason', 'access_denied');
  end if;

  if v_grant.accepted_at is null then
    update public.evidence_guest_grants
    set accepted_at = now()
    where id = v_grant.id
    returning * into v_grant;
    insert into public.evidence_guest_access_events (
      organization_id, facility_id, guest_grant_id, collection_id,
      event_type, request_fingerprint_sha256, reason)
    values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
      'terms_accepted', p_fingerprint, format('Guest accepted terms %s', v_grant.terms_version));
  end if;
  return jsonb_build_object(
    'accepted', true,
    'termsVersion', v_grant.terms_version,
    'acceptedAt', v_grant.accepted_at);
end;
$function$

;

-- authorize_evidence_guest_artifact (evidence_guest)
CREATE OR REPLACE FUNCTION public.authorize_evidence_guest_artifact(p_token text, p_artifact_id uuid, p_event_type text, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_art public.evidence_collection_artifacts%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
  v_allowed boolean;
  v_reason text;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('evidence_guest', p_token);
  if p_event_type not in ('view', 'download', 'comment', 'share') then
    raise exception 'Invalid guest event type' using errcode = '22023';
  end if;
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select a.* into v_art from public.evidence_collection_artifacts a where a.id = p_artifact_id;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;

  v_allowed := coalesce(
    v_grant.id is not null
    and v_art.id is not null
    and v_art.collection_id = v_grant.collection_id
    and v_art.facility_id = v_grant.facility_id
    and p_artifact_id = any(v_grant.allowed_artifact_ids)
    and v_grant.revoked_at is null
    and v_grant.expires_at > now()
    and v_grant.accepted_at is not null
    and (not v_grant.step_up_required or v_grant.step_up_verified_at is not null)
    and v_art.withdrawn_at is null
    and v_col.status = 'published'
    and v_org.subscription_status not in ('suspended', 'canceled'), false);
  v_reason := case
    when v_allowed then 'authorized'
    else 'grant expired, revoked, unaccepted, unverified, withdrawn, suspended, or outside scope'
  end;
  if v_grant.id is not null and v_art.id is not null then
    insert into public.evidence_guest_access_events (
      organization_id, facility_id, guest_grant_id, collection_id, artifact_id,
      event_type, request_fingerprint_sha256, reason)
    values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id, v_art.id,
      case when v_allowed then p_event_type else 'denied' end, p_fingerprint, v_reason);
  end if;
  if not v_allowed then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  return jsonb_build_object(
    'artifactId', v_art.id,
    'displayName', v_art.display_name,
    'scope', v_art.artifact_scope,
    'authorized', true);
end;
$function$

;

-- get_evidence_guest_room (evidence_guest)
CREATE OR REPLACE FUNCTION public.get_evidence_guest_room(p_token text, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.evidence_guest_grants%rowtype;
  v_col public.evidence_collections%rowtype;
  v_org public.organizations%rowtype;
  v_artifacts jsonb;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('evidence_guest', p_token);
  select g.* into v_grant
  from public.evidence_guest_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if v_grant.id is null then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  select c.* into v_col from public.evidence_collections c where c.id = v_grant.collection_id;
  select o.* into v_org from public.organizations o where o.id = v_grant.organization_id;
  if v_grant.revoked_at is not null
     or v_grant.expires_at <= now()
     or v_col.status <> 'published'
     or v_org.subscription_status in ('suspended', 'canceled') then
    return jsonb_build_object('authorized', false, 'reason', 'access_denied');
  end if;
  if v_grant.step_up_required and v_grant.step_up_verified_at is null then
    return jsonb_build_object('authorized', false, 'reason', 'step_up_required');
  end if;
  if v_grant.accepted_at is null then
    return jsonb_build_object(
      'authorized', false,
      'needsTerms', true,
      'guestLabel', v_grant.guest_label,
      'termsVersion', v_grant.terms_version,
      'expiresAt', v_grant.expires_at,
      'collection', jsonb_build_object('name', v_col.name, 'purpose', v_col.purpose));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'displayName', a.display_name,
      'addedAt', a.added_at,
      'artifactType', sa.artifact_type,
      'byteSize', sa.byte_size,
      'contentSha256', sa.content_sha256)
      order by a.added_at), '[]'::jsonb)
  into v_artifacts
  from public.evidence_collection_artifacts a
  join public.report_snapshot_artifacts sa on sa.id = a.snapshot_artifact_id
  where a.collection_id = v_grant.collection_id
    and a.id = any(v_grant.allowed_artifact_ids)
    and a.withdrawn_at is null
    and sa.withdrawn_at is null;

  insert into public.evidence_guest_access_events (
    organization_id, facility_id, guest_grant_id, collection_id,
    event_type, request_fingerprint_sha256, reason)
  values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.collection_id,
    'view', p_fingerprint, 'Guest opened the evidence room');

  return jsonb_build_object(
    'authorized', true,
    'guestLabel', v_grant.guest_label,
    'termsVersion', v_grant.terms_version,
    'acceptedAt', v_grant.accepted_at,
    'expiresAt', v_grant.expires_at,
    'collection', jsonb_build_object('name', v_col.name, 'purpose', v_col.purpose),
    'artifacts', v_artifacts);
end;
$function$

;

-- accept_move_in_guest_terms (move_in_guest)
CREATE OR REPLACE FUNCTION public.accept_move_in_guest_terms(p_token text, p_fingerprint text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.move_in_guest_grants%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('move_in_guest', p_token);
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Move-in guest link is invalid or expired' using errcode = '42501';
  end if;
  update public.move_in_guest_grants set accepted_at = coalesce(accepted_at, now()) where id = v.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id,
    event_type, ip_hash, user_agent_hash
  ) values (
    v.organization_id, v.facility_id, v.id, v.workspace_id, 'view',
    p_fingerprint, p_fingerprint
  );
  return true;
end;
$function$

;

-- get_move_in_guest_workspace (move_in_guest)
CREATE OR REPLACE FUNCTION public.get_move_in_guest_workspace(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.move_in_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('move_in_guest', p_token);
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Move-in guest access denied' using errcode = '42501';
  end if;
  if v.accepted_at is null then
    raise exception 'Move-in guest terms acceptance required' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'residentProfile', jsonb_build_object(
      'preferredName', v_resident.preferred_name,
      'preferredLanguage', v_resident.preferred_language,
      'communicationPreferences', v_resident.communication_preferences,
      'contractStatus', v_resident.contract_status,
      'residentRightsAcknowledgedAt', v_resident.resident_rights_acknowledged_at
    ),
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'state', t.state,
        'requiresSignature', t.requires_signature,
        'requiresDocument', t.requires_document,
        'signed', t.signature_evidence is not null
      ) order by t.due_at), '[]'::jsonb)
      from public.move_in_tasks t where t.id = any(v.allowed_task_ids)
    )
  );
end;
$function$

;

-- sign_move_in_guest_task (move_in_guest)
CREATE OR REPLACE FUNCTION public.sign_move_in_guest_task(p_token text, p_task_id uuid, p_signer_name text, p_relationship text, p_attestation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.move_in_guest_grants%rowtype;
  v_task public.move_in_tasks%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('move_in_guest', p_token);
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null
    or not (p_task_id = any(v.allowed_task_ids)) then
    raise exception 'Move-in guest signing denied' using errcode = '42501';
  end if;
  select * into v_task from public.move_in_tasks
  where id = p_task_id and workspace_id = v.workspace_id for update;
  if not found or not v_task.requires_signature
    or v_task.signature_evidence is not null
    or v_task.state not in ('open', 'in_progress')
    or length(btrim(p_signer_name)) < 2
    or length(btrim(p_relationship)) < 2
    or length(btrim(p_attestation)) < 5 then
    raise exception 'Invalid or already-recorded guest signature' using errcode = '23514';
  end if;
  update public.move_in_tasks
  set signature_evidence = jsonb_build_object(
    'signerName', btrim(p_signer_name), 'relationship', btrim(p_relationship),
    'attestation', btrim(p_attestation), 'signedAt', now(),
    'authenticationMethod', 'expiring_guest_link', 'termsVersion', v.terms_version
  ), state = 'submitted', updated_at = now()
  where id = v_task.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id, task_id, event_type
  ) values (
    v.organization_id, v.facility_id, v.id, v.workspace_id, v_task.id, 'sign'
  );
  insert into public.move_in_task_history(
    organization_id, facility_id, workspace_id, task_id, event_type,
    prior_state, resulting_state, reason, evidence
  ) values (
    v.organization_id, v.facility_id, v.workspace_id, v_task.id, 'guest_signature',
    v_task.state, 'submitted', 'Guest signature captured',
    jsonb_build_object('guestGrantId', v.id, 'signerName', btrim(p_signer_name))
  );
  perform public.refresh_move_in_readiness(v.workspace_id);
  return true;
end;
$function$

;

-- accept_resident_agreement_guest_terms (resident_agreement_guest)
CREATE OR REPLACE FUNCTION public.accept_resident_agreement_guest_terms(p_token text, p_device_evidence text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.resident_agreement_guest_grants%rowtype; v_hash text;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_agreement_guest', p_token);
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex') for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Resident agreement link is invalid or expired' using errcode = '42501';
  end if;
  v_hash := case when nullif(p_device_evidence, '') is null then null
    else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end;
  update public.resident_agreement_guest_grants set accepted_at = coalesce(accepted_at, now()),
    accepted_device_hash = coalesce(accepted_device_hash, v_hash) where id = v.id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type, device_hash
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'terms_accepted', v_hash);
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, guest_grant_id, event_type, summary
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id,
    'external_terms_accepted', 'External signer accepted resident e-sign terms');
  return true;
end;
$function$

;

-- get_resident_agreement_guest_workspace (resident_agreement_guest)
CREATE OR REPLACE FUNCTION public.get_resident_agreement_guest_workspace(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.resident_agreement_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_agreement_guest', p_token);
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Resident agreement access denied' using errcode = '42501';
  end if;
  if v.accepted_at is null then
    raise exception 'Resident agreement terms acceptance required' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'viewed');
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'signerRole', v.signer_role,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agreementId', a.id, 'versionId', av.id, 'agreementType', a.agreement_type,
        'title', a.title, 'versionLabel', av.version_label, 'contentText', av.content_text,
        'contentSha256', av.content_sha256, 'effectiveAt', av.effective_at,
        'requiredSignerRoles', av.required_signer_roles,
        'signerRole', v.signer_role,
        'documentLabel', coalesce(d.document_label, d.file_name),
        'responded', exists(select 1 from public.resident_agreement_signatures s
          where s.agreement_version_id = av.id and s.guest_grant_id = v.id)
      ) order by av.effective_at, a.title)
      from public.resident_agreement_versions av
      join public.resident_agreements a on a.id = av.agreement_id
      left join public.resident_documents d on d.id = av.document_id
      where av.id = any(v.allowed_version_ids)
        and av.status = 'active'
        and v.signer_role = any(av.required_signer_roles)
    ), '[]'::jsonb)
  );
end;
$function$

;

-- respond_to_resident_agreement_guest (resident_agreement_guest)
CREATE OR REPLACE FUNCTION public.respond_to_resident_agreement_guest(p_token text, p_version_id uuid, p_outcome text, p_signer_name text, p_signer_role text, p_relationship text, p_legal_authority text, p_attestation text, p_reason text, p_witness_name text, p_witness_relationship text, p_device_evidence text DEFAULT NULL::text, p_ip_evidence text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.resident_agreement_guest_grants%rowtype;
  v_id uuid;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('resident_agreement_guest', p_token);
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found
    or v.revoked_at is not null
    or v.expires_at <= now()
    or v.accepted_at is null
    or p_outcome <> 'signed'
    or p_signer_role <> v.signer_role
    or not (p_version_id = any(v.allowed_version_ids))
    or not exists (
      select 1 from public.resident_agreement_versions av
      where av.id = p_version_id
        and av.status = 'active'
        and v.signer_role = any(av.required_signer_roles)
    )
    or exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = p_version_id
        and s.guest_grant_id = v.id
    )
  then
    raise exception 'Resident agreement signing denied' using errcode = '42501';
  end if;

  v_id := app_private.insert_resident_agreement_outcome(
    p_version_id, 'signed', p_signer_name, v.signer_role, p_relationship,
    p_legal_authority, 'external_link', p_attestation, null,
    p_witness_name, p_witness_relationship, p_ip_evidence, p_device_evidence,
    v.id, null, null, null
  );
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id,
    agreement_version_id, signature_id, event_type, device_hash
  ) values (
    v.organization_id, v.facility_id, v.resident_id, v.id, p_version_id, v_id,
    'signed', case when nullif(p_device_evidence, '') is null then null
      else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end
  );
  return v_id;
end;
$function$

;

-- resolve_safety_report_facility (safety_report)
CREATE OR REPLACE FUNCTION public.resolve_safety_report_facility(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_fac public.facilities%rowtype;
  v_matched_by_token boolean := false;
begin
  -- Throttle, record and scope-check this guest request before anything else runs.
  perform public.assert_guest_request_allowed('safety_report', p_token);
  if length(v_token) < 8 then
    return null;
  end if;

  -- Preferred: opaque non-enumerable token printed on facility posters / QR codes.
  select * into v_fac
  from public.facilities f
  where f.safety_report_token = v_token
  limit 1;
  v_matched_by_token := found;

  -- Legacy QR links still carry the facility UUID; resolve name without listing facilities.
  if not found and v_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_fac
    from public.facilities f
    where f.id = v_token::uuid
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'facilityId', v_fac.id,
    'facilityName', v_fac.name,
    -- Only a caller who already held the token gets it back. Facility UUIDs appear in URLs all
    -- over the product, so returning it on the legacy branch handed the credential to anyone who
    -- had a link -- and handed them the NEW one after every rotation.
    'token', case when v_matched_by_token then v_fac.safety_report_token else null end
  );
end;
$function$

;

------------------------------------------------------------------------------------------------
-- And the one issuer with no ceiling
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_move_in_guest_grant(p_workspace_id uuid, p_guest_label text, p_task_ids uuid[], p_expires_at timestamp with time zone, p_terms_version text DEFAULT 'v1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.move_in_workspaces%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  select * into v from public.move_in_workspaces where id = p_workspace_id;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  -- Upper bound, which this issuer alone was missing: the evidence and survey-packet grants cap
  -- at 90 days and the resident-agreement grant at 30. A move-in grant hands an outside person a
  -- resident's admission workspace, so it takes the shorter of the two -- and without any cap at
  -- all a well-meaning "make it easy for the family" could issue a link good for a decade.
  if p_expires_at > now() + interval '30 days' then
    raise exception 'A move-in guest link may not last longer than 30 days'
      using errcode = '22023';
  end if;
  if p_expires_at <= now() or cardinality(p_task_ids) = 0
    or exists (
      select 1 from unnest(p_task_ids) id
      where not exists (select 1 from public.move_in_tasks t where t.id = id and t.workspace_id = v.id)
    ) then raise exception 'Invalid guest grant scope' using errcode = '22023'; end if;
  insert into public.move_in_guest_grants(
    organization_id, facility_id, workspace_id, resident_id, token_sha256,
    guest_label, allowed_task_ids, expires_at, terms_version, created_by
  ) values (
    v.organization_id, v.facility_id, v.id, v.resident_id,
    encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_task_ids, p_expires_at, p_terms_version, auth.uid()
  ) returning id into v_id;
  return jsonb_build_object('grantId', v_id, 'token', v_token);
end;
$function$

;
