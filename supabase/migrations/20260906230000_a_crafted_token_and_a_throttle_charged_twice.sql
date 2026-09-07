-- BACKLOG J74 (P3) -- the guest gate, twice over.
--
-- 1. A crafted 36-character safety-report token raised 22P02 INSIDE the gate, so the public
--    "report a safety concern" page answered a guess with a 500 instead of an ordinary denial --
--    and the exception rolled back the throttle row the gate had just written for that caller, so
--    the one shape of request most worth counting was the one shape that was never counted.
--
-- 2. The designated-person portal home page charged the caller TWICE per load:
--    get_resident_portal_experience called guest_request_denial and then called
--    get_resident_portal_snapshot, which calls it again. Sixty requests a minute became thirty,
--    and -- worse -- ten unknown-token strikes became five, so a family member who opened a
--    mistyped link a handful of times was locked out at half the intended budget.
--
-- Both are patched onto the LIVE bodies with pg_get_functiondef + a guarded replace, because the
-- deployed definitions have drifted from every file that ever defined them (20260905360000 wrote
-- the gate; 20260906120000 spliced a caller into resolve_survey_packet_guest_token), and a fresh
-- `create or replace` from any one of those files would silently revert the others.

------------------------------------------------------------------------------------------------
-- 1. public.guest_request_denial -- a bad token is a denial, not an error
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.guest_request_denial(text, text)'::regprocedure);

  v_old := $old$  elsif p_surface = 'safety_report' then
    select f.organization_id into v_org from public.facilities f
    where f.safety_report_token = btrim(coalesce(p_token, ''))
       or (btrim(coalesce(p_token, '')) ~ '^[0-9a-fA-F-]{36}$'
           and f.id = btrim(p_token)::uuid);$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'guest_request_denial no longer contains the safety_report branch this migration patches';
  end if;

  v_new := $patch$  elsif p_surface = 'safety_report' then
    -- BACKLOG J74. '^[0-9a-fA-F-]{36}$' matches plenty of things that are not uuids -- thirty-six
    -- hyphens, thirty-six hex digits with no dashes at all -- so `::uuid` raised 22P02 and the
    -- caller got a 500 for a wrong guess. Postgres does not promise to evaluate the two halves of
    -- that AND left to right either, so the regex was never a dependable guard for the cast.
    -- Parse in plpgsql, under an IF, where the order IS guaranteed, and match the real uuid
    -- layout rather than its character set. The legacy facility-UUID poster URL still resolves.
    declare
      v_safety_token text := btrim(coalesce(p_token, ''));
      v_legacy_facility uuid;
    begin
      if v_safety_token ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_legacy_facility := v_safety_token::uuid;
      end if;
      select f.organization_id into v_org from public.facilities f
      where f.safety_report_token = v_safety_token
         or (v_legacy_facility is not null and f.id = v_legacy_facility);
    end;$patch$;

  execute replace(v_def, v_old, v_new);
end
$do$;

-- The grants pg_get_functiondef does not carry. Unchanged from 20260905360000: every caller is
-- itself SECURITY DEFINER, so this needs no role grant at all.
revoke all on function public.guest_request_denial(text, text) from public, anon, authenticated, service_role;

comment on function public.guest_request_denial(text, text) is
  'Records a guest request and returns why it is denied, or null when it is allowed. Never raises for a denial -- see 20260905360000 -- and never raises for a malformed token either, see 20260906230000. Needs no anon grant: every caller is SECURITY DEFINER.';

------------------------------------------------------------------------------------------------
-- 2. public.get_resident_portal_experience -- one gate call per page load
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.get_resident_portal_experience(text)'::regprocedure);

  v_old := $old$  -- Throttle, record and scope-check this guest request before anything else runs.
  v_guest_denial := public.guest_request_denial('resident_portal', p_token);
  if v_guest_denial is not null then return app_private.guest_denied(v_guest_denial); end if;
  v_snapshot := public.get_resident_portal_snapshot(p_token, null);
  if v_snapshot->>'accessStatus' <> 'active' then return v_snapshot; end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'get_resident_portal_experience no longer opens with the double gate call this migration removes';
  end if;

  v_new := $patch$  -- BACKLOG J74. get_resident_portal_snapshot throttles, records and scope-checks this same
  -- request itself, so doing it here as well spent two of the caller's sixty requests a minute on
  -- a single page load -- and two of the ten unknown-token strikes on a single wrong link. One
  -- gate call, made by the function that needs it; its denial is returned unchanged, including
  -- the 403 app_private.guest_denied has already set on the response.
  --
  -- `is distinct from`, not `<>`: a denial body carries no accessStatus at all, and
  -- `null <> 'active'` is null, so the old test was never taken and a refused request went on to
  -- read the grant, the requests and the payment link anyway.
  v_snapshot := public.get_resident_portal_snapshot(p_token, null);
  if v_snapshot->>'accessStatus' is distinct from 'active' then return v_snapshot; end if;$patch$;

  v_def := replace(v_def, v_old, v_new);

  -- ... and the now-unused declaration, so plpgsql_check has nothing to say about it.
  v_old := 'v_guest_denial text; v_grant public.resident_portal_grants%rowtype;';
  if position(v_old in v_def) = 0 then
    raise exception 'get_resident_portal_experience declaration block is not the shape this migration trims';
  end if;
  v_def := replace(v_def, v_old, 'v_grant public.resident_portal_grants%rowtype;');

  execute v_def;
end
$do$;

-- No grant statement here on purpose. This one IS reachable by anon (the designated-person portal
-- has no session), and 20260716160000 granted it there; `create or replace function` keeps the
-- existing privileges, so restating the grant would only re-assert an anon grant a later reviewer
-- would have to adjudicate again -- and scripts/check-migration-policies.mjs rightly flags a new
-- migration that hands anything to anon.
