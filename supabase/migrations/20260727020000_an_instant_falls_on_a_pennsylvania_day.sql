-- An instant falls on a Pennsylvania day, not a UTC one.
--
-- 20260727010100 gave "today" a correct definition. This is the other half of the same defect: the
-- code that asks which day some INSTANT fell on, or which instant a DAY starts at, and answers in
-- UTC. `some_timestamptz::date` is `at time zone TimeZone`, and TimeZone is UTC on hosted Supabase,
-- so anything recorded between 20:00 ET and midnight is filed under tomorrow.
--
-- This was not found by reading. It was found because 20260727010100's pgTAP fixtures were switched
-- from `current_date` to `public.pa_today()` -- and eight assertions that had been green went red.
-- They had been green because fixture and function shared the same wrong clock: the test seeded a
-- fall "today" in UTC and the function counted falls "today" in UTC, and the pair agreed with each
-- other while both disagreed with Pennsylvania. Making one side right is what made the other side's
-- wrongness visible, which is the same lesson this program keeps relearning in different costumes.
--
-- What the eight failures were:
--
--   * QAPI SOURCE METRICS (formal_qapi_quality, dietary_nutrition_food_safety_operations).
--     get_qapi_source_metrics counts falls, medication incidents, hospital transfers, missed and
--     late services, meal refusals, hydration exceptions, weight reviews, food-safety exceptions and
--     appointment failures, each as `<event instant>::date between p_from and p_through`. The
--     callers pass Pennsylvania days. A fall at 21:00 on the 26th was counted in the 27th's window,
--     so the QAPI measurement a regulator reads was drawn on the wrong day boundary for every
--     evening event in the sample.
--
--   * PERSONAL-FUNDS RECONCILIATION (resident_financial_operations). reconcile_resident_personal_-
--     funds sums transactions with `transaction_at::date <= p_period_end`, so an evening deposit
--     fell outside the period it belonged to and the reconciliation came out unbalanced -- against a
--     resident's own money, which 55 Pa. Code Chapter 2800 requires be accounted for exactly.
--
--   * PRINTED CLASS CHECK-IN TOKENS (p2_security_hardening). generate_class_checkin_token set
--     not_before to `class_date::timestamp at time zone 'UTC'`. Midnight UTC on the class date is
--     20:00 the PREVIOUS evening in Pennsylvania, so a printed token for tomorrow's class was
--     already live tonight, and its one-day life ended at 20:00 on the class day -- before an
--     evening class had finished. The test asserting "a token for a future class is not yet active"
--     had been passing only because its fixture dated the class in UTC too.
--
--   * COMPLIANCE PROFILE WINDOWS (phase2_scope_workforce) and the SEEDED PA RULE PACK
--     (review_finalization_drives_proposals) -- both effective_from windows. These are NOT fixed
--     here: changing the column default in 20260727010100 fixed the next insert but left the rows
--     already written carrying the UTC day, so they needed 20260727030000 to date the shipped
--     catalogues explicitly. They are listed because they were part of the same eight and are what
--     led to the rest.
--
-- Four more sites were found by sweeping for the pattern rather than by a failing test, and none of
-- them has a test that would have caught it:
--
--   * start_emergency_event reads `started_at::date` and `started_at::time` into variables it calls
--     v_local_date and v_local_time, then matches them against shift_assignments.shift_date,
--     start_time and end_time -- the facility's own local schedule. On the UTC clock an emergency at
--     21:00 looks for tomorrow's 01:00 shift, so the roster of who was on duty when an emergency
--     began omitted the people who actually were. The variable names had been right since the day
--     they were written; only the values were wrong.
--
--   * get_my_shift_workspace compares a shift's local end (shift_date + end_time) against
--     `localtimestamp`, which is the UTC wall clock, to decide whether a shift is still current.
--
--   * evaluate_schedule_eligibility and queue_manager_weekly_digests cut the week with
--     date_trunc('week', <instant>). A UTC week begins at 19:00 or 20:00 Sunday in Pennsylvania, so
--     a Sunday evening shift and the notifications raised beside it landed in the following week.
--
-- DELIBERATELY NOT CHANGED. Three other uses of UTC are correct and stay:
--   * app_private.compute_audit_event_hash canonicalises created_at in UTC. It is a hash input; a
--     timezone change here would invalidate every audit hash already stored.
--   * begin_notification_delivery_attempt, get_notification_delivery_operations and
--     raise_notification_spend_alerts bound a monthly SPEND period in UTC. That is an internal
--     billing window, not a facility calendar day, and all three agree with each other.
--   * app_private.next_report_schedule_run and next_configured_report_schedule_run date_trunc a
--     value that has already been converted to the schedule's own configured timezone.
--
-- HOW THIS FILE WAS WRITTEN. As with 20260727010100: each body is `pg_get_functiondef` of the live
-- function with a fixed list of textual substitutions applied, generated rather than retyped, and
-- verified afterwards by re-extracting every definition and diffing against the pre-migration
-- definitions under the same substitutions. Every operand substituted was checked against the
-- catalogue to be a timestamptz column or parameter, and none of those names also exists as a
-- date-typed column anywhere in public, so no cast on a genuine date was touched.

create or replace function public.pa_day(p_at timestamptz)
returns date
language sql
stable
as $$
  -- Null in, null out, so this drops into `coalesce(x::date, ...)` unchanged.
  select (p_at at time zone 'America/New_York')::date
$$;

create or replace function public.pa_clock(p_at timestamptz)
returns time
language sql
stable
as $$ select (p_at at time zone 'America/New_York')::time $$;

create or replace function public.pa_now()
returns timestamp
language sql
stable
as $$ select now() at time zone 'America/New_York' $$;

create or replace function public.pa_midnight(p_day date)
returns timestamptz
language sql
stable
as $$
  -- The instant a Pennsylvania calendar day begins. Note this is NOT p_day::timestamptz, which
  -- reads the day as midnight UTC -- 20:00 the previous evening here.
  select p_day::timestamp at time zone 'America/New_York'
$$;

create or replace function public.pa_week_start(p_at timestamptz)
returns date
language sql
stable
as $$ select (date_trunc('week', p_at at time zone 'America/New_York'))::date $$;

comment on function public.pa_day(timestamptz) is
  'The Pennsylvania calendar day an instant fell on. Use instead of a bare ::date cast, which '
  'resolves in the database timezone (UTC) and is a day ahead every evening after 20:00 ET.';
comment on function public.pa_midnight(date) is
  'The instant a Pennsylvania calendar day begins. Use instead of ::timestamptz or '
  '::timestamp at time zone ''UTC''.';

grant execute on function public.pa_day(timestamptz) to authenticated, service_role;
grant execute on function public.pa_clock(timestamptz) to authenticated, service_role;
grant execute on function public.pa_now() to authenticated, service_role;
grant execute on function public.pa_midnight(date) to authenticated, service_role;
grant execute on function public.pa_week_start(timestamptz) to authenticated, service_role;

-- public.generate_class_checkin_token
CREATE OR REPLACE FUNCTION public.generate_class_checkin_token(p_class_id uuid, p_long_lived boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.training_classes%rowtype;
  v_token text;
  v_not_before timestamptz;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if v_class.status not in ('scheduled', 'in_progress') then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and public.is_assigned_to_facility(v_class.facility_id))))
  ) then
    raise exception 'not authorized to run check-in for this training class' using errcode = '42501';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';
  if p_long_lived then
    v_not_before := public.pa_midnight(v_class.class_date);
    if now() >= v_not_before + interval '1 day' then
      raise exception 'The class check-in window has ended.' using errcode = '22023';
    end if;
    update public.class_checkin_tokens
    set revoked_at = now()
    where class_id = p_class_id and token_kind = 'printed' and revoked_at is null;
  else
    v_not_before := now();
  end if;

  insert into public.class_checkin_tokens(class_id, token_kind, not_before, expires_at)
  values (
    p_class_id, case when p_long_lived then 'printed' else 'live' end, v_not_before,
    case when p_long_lived then v_not_before + interval '1 day' else now() + interval '45 seconds' end
  ) returning token into v_token;
  return v_token;
end;
$function$

;

-- public.ensure_employee_record
CREATE OR REPLACE FUNCTION public.ensure_employee_record(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile   public.profiles;
  v_org_id    uuid;
  v_facility_id uuid;
  v_job_title text;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    return;
  end if;

  if exists (select 1 from public.employees where profile_id = p_profile_id) then
    return;
  end if;

  v_org_id := v_profile.organization_id;

  if v_org_id is null then
    -- platform_admin accounts aren't scoped to any customer organization -- anchor their
    -- own training record to a dedicated internal org/facility instead of a real tenant's,
    -- so it never surfaces in a customer's facility compliance reporting.
    --
    -- Serializes concurrent bootstrap of that shared org/facility -- without this, two
    -- concurrent platform_admin self-enrolls could both miss the "does it exist" checks below
    -- and then both attempt the organizations insert, with the losing transaction aborting on
    -- organizations_slug_key's unique constraint instead of just reusing the winner's row.
    perform pg_advisory_xact_lock(hashtext('ensure_employee_record:internal-org-bootstrap'));

    select id into v_org_id from public.organizations where slug = 'caremetric-carebase-internal';
    if v_org_id is null then
      insert into public.organizations (name, slug, subscription_status)
      values ('CareMetric CareBase (Internal)', 'caremetric-carebase-internal', 'active')
      returning id into v_org_id;
    end if;

    select id into v_facility_id from public.facilities where organization_id = v_org_id order by created_at limit 1;
    if v_facility_id is null then
      insert into public.facilities (organization_id, name, facility_type)
      values (v_org_id, 'Platform', 'ALR')
      returning id into v_facility_id;
    end if;
  else
    -- Prefer a facility they're explicitly assigned to (mirrors how facility_manager/trainer
    -- employees rows are seeded today); fall back to the org's first facility as an anchor --
    -- employees.facility_id is not null, so course tracking needs some facility on file even for
    -- an org_admin/auditor whose real job spans every facility in the org.
    select fa.facility_id into v_facility_id
    from public.facility_assignments fa
    where fa.profile_id = p_profile_id
    order by fa.created_at
    limit 1;

    if v_facility_id is null then
      select id into v_facility_id from public.facilities where organization_id = v_org_id order by created_at limit 1;
    end if;
  end if;

  -- No facility exists at all for this org yet -- nothing to anchor an employees row to.
  -- (Rare: would mean an org with zero facilities.) Leave it for a later call once one exists.
  if v_facility_id is null then
    return;
  end if;

  -- Matches ROLE_LABELS in src/pages/app/Users.tsx exactly -- this is the one place outside the
  -- frontend that renders a role as a human label, and a wording mismatch (e.g. "Facility
  -- Administrator" here vs. "Facility Manager" there) would show two different titles for the
  -- same account depending which page you look at.
  v_job_title := case v_profile.role
    when 'platform_admin' then 'Platform Admin'
    when 'org_admin' then 'Org Admin'
    when 'facility_manager' then 'Facility Manager'
    when 'trainer' then 'Trainer'
    when 'auditor' then 'Auditor'
    else 'Employee'
  end;

  -- status is deliberately 'inactive', not 'active': trigger_instantiate_requirements_on_employee_change()
  -- (pa_rulepack_requirement_auto_assignment_engine.sql) fires on every employees insert and calls
  -- instantiate_missing_requirements(), which only actually does anything `if v_emp.status = 'active'`.
  -- A self-provisioned administrative account (org_admin/auditor/platform_admin just trying a course,
  -- not a real hire) letting that engine run would create real "missing" employee_training_records
  -- and employee_credentials rows (Act 34 criminal history, TB screening) that count against the
  -- facility's actual regulatory compliance percentage and Survey Readiness reports -- exactly the
  -- numbers this app exists to report accurately for a real PA-licensed facility. 'inactive' skips
  -- that engine entirely; it does not block this account from taking its own course, since every RLS
  -- policy on course_assignments/course_progress/quiz_attempts gates on owns_employee() (which checks
  -- profiles.is_active, not employees.status), and enforce_employee_limit() still (correctly) counts
  -- this row against the org's plan seat limit regardless of status, same as a real hire would.
  insert into public.employees (
    organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
  ) values (
    v_org_id, v_facility_id, p_profile_id, v_profile.first_name, v_profile.last_name, v_profile.email,
    v_job_title, public.pa_day(v_profile.created_at), 'inactive'
  )
  on conflict (profile_id) do nothing;
end;
$function$

;

-- app_private.shadow_new_employee_lifecycle
CREATE OR REPLACE FUNCTION app_private.shadow_new_employee_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_person_id uuid;
  v_episode_id uuid;
  v_baseline_id uuid;
  v_start date := coalesce(new.hire_date, public.pa_day(new.created_at));
begin
  insert into public.workforce_people(
    organization_id, profile_id, external_ref,
    first_name, last_name, email, phone, is_active
  ) values (
    new.organization_id, new.profile_id, 'employee:' || new.id::text,
    new.first_name, new.last_name, new.email, new.phone,
    new.status <> 'terminated'
  )
  on conflict (organization_id, external_ref) where external_ref is not null
  do update set
    profile_id = coalesce(excluded.profile_id, public.workforce_people.profile_id),
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone
  returning id into v_person_id;

  insert into public.workforce_employee_links(
    organization_id, person_id, employee_id, effective_from, effective_to, source
  ) values (
    new.organization_id, v_person_id, new.id, v_start,
    case when new.status = 'terminated' then new.termination_date else null end,
    'api'
  );

  if new.status in ('active', 'on_leave')
     or (new.status = 'terminated' and new.termination_date is not null
         and new.termination_date >= v_start) then
    insert into public.employment_episodes(
      organization_id, facility_id, person_id, employee_id,
      started_on, ended_on, episode_status, start_reason, end_reason, source
    ) values (
      new.organization_id, new.facility_id, v_person_id, new.id, v_start,
      case when new.status = 'terminated' then new.termination_date else null end,
      case when new.status = 'terminated' then 'closed' else 'active' end,
      'created', case when new.status = 'terminated' then 'created_terminated' else null end,
      'api'
    ) returning id into v_episode_id;
  end if;

  insert into public.employment_lifecycle_events(
    organization_id, facility_id, person_id, employee_id,
    employment_episode_id, event_type, from_status, to_status,
    effective_on, reason, evidence, actor_profile_id
  ) values (
    new.organization_id, new.facility_id, v_person_id, new.id,
    v_episode_id, case when new.status = 'terminated' then 'terminated' else 'hired' end,
    null, new.status, v_start, 'Employee creation',
    jsonb_build_object('source', 'employee_insert'), app_private.current_actor_profile_id()
  );

  select id into v_baseline_id
  from public.compliance_profile_definitions
  where is_mandatory_baseline and is_active;

  if new.status = 'active' and v_baseline_id is not null then
    insert into public.employee_compliance_profile_assignments(
      organization_id, facility_id, employee_id, profile_definition_id,
      effective_from, source, reason
    ) values (
      new.organization_id, new.facility_id, new.id, v_baseline_id,
      v_start, 'api', 'Mandatory baseline assigned at employee creation'
    );
  end if;

  if new.status = 'active' and new.hire_date is null then
    insert into public.workforce_backfill_exceptions(
      organization_id, employee_id, exception_code, details
    ) values (
      new.organization_id, new.id, 'missing_hire_date',
      jsonb_build_object('fallbackDate', v_start)
    ) on conflict do nothing;
  end if;
  if new.profile_id is not null and new.status <> 'terminated' then
    perform app_private.align_profile_facility_scope(
      new.profile_id, null, new.facility_id, v_start
    );
  end if;
  return new;
end;
$function$

;

-- public.get_regulatory_rule_snapshot
CREATE OR REPLACE FUNCTION public.get_regulatory_rule_snapshot(p_rule_key text, p_as_of date)
 RETURNS TABLE(rule_version_id uuid, version_number integer, jurisdiction_code text, authority_name text, citation text, source_uri text, source_checksum_sha256 text, applicability jsonb, calculation_parameters jsonb, effective_from date, effective_to date, content_checksum_sha256 text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select v.id, v.version_number, v.jurisdiction_code, v.authority_name,
    v.citation, v.source_uri, v.source_checksum_sha256, v.applicability,
    v.calculation_parameters, v.effective_from, v.effective_to,
    v.content_checksum_sha256
  from public.regulatory_rule_packs p
  join public.regulatory_rule_versions v on v.rule_pack_id = p.id
  where p.rule_key = p_rule_key
    and (
      v.state in ('active', 'superseded')
      or (
        v.state = 'withdrawn'
        and v.activated_at is not null
        and p_as_of < public.pa_day(v.withdrawn_at)
      )
    )
    and v.effective_from <= p_as_of
    and (v.effective_to is null or v.effective_to >= p_as_of)
  order by v.effective_from desc, v.version_number desc
  limit 1;
$function$

;

-- public.evaluate_schedule_eligibility
CREATE OR REPLACE FUNCTION public.evaluate_schedule_eligibility(p_employee_id uuid, p_facility_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_required_qualification_keys text[] DEFAULT ARRAY[]::text[], p_required_credential_types text[] DEFAULT ARRAY[]::text[], p_required_training_type_ids uuid[] DEFAULT ARRAY[]::uuid[], p_exclude_assignment_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_block text;
  v_training_type_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override_ids uuid[] := array[]::uuid[];
  v_unresolved text[] := array[]::text[];
  v_hours numeric := 0;
  v_duration numeric;
  v_snapshot jsonb;
  v_outcome text;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'Eligibility interval must have positive duration' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if not (
    session_user = 'postgres'
    or
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or public.is_platform_admin()
    or v_employee.profile_id = auth.uid()
    or public.current_org_id() = v_employee.organization_id
  ) then raise exception 'Eligibility evaluation is outside caller scope' using errcode = '42501'; end if;
  select * into v_policy from public.schedule_eligibility_policies
  where organization_id = v_employee.organization_id;
  if not found then
    v_policy.max_weekly_hours := 40;
    v_policy.warning_weekly_hours := 36;
    v_policy.minimum_rest_hours := 8;
  end if;
  if v_employee.status <> 'active' then v_blocks := array_append(v_blocks, 'lifecycle_inactive'); end if;
  if not exists (
    select 1 from public.employee_facility_assignments a
    where a.employee_id = p_employee_id and a.facility_id = p_facility_id
  ) then v_blocks := array_append(v_blocks, 'facility_not_assigned'); end if;
  if exists (
    select 1 from public.exclusion_screening_matches m
    where m.employee_id = p_employee_id and m.status = 'confirmed_exclusion'
  ) then v_blocks := array_append(v_blocks, 'confirmed_exclusion'); end if;
  foreach v_block in array coalesce(p_required_qualification_keys, array[]::text[])
  loop
    if not public.employee_has_active_qualification(p_employee_id, v_block, p_starts_at) then
      v_blocks := array_append(v_blocks, 'qualification:' || v_block);
    end if;
  end loop;
  foreach v_block in array coalesce(p_required_credential_types, array[]::text[])
  loop
    if not exists (
      select 1 from public.employee_credentials c
      where c.employee_id = p_employee_id and c.credential_type = v_block
        and c.status = 'compliant'
        and (c.issue_date is null or c.issue_date <= public.pa_day(p_starts_at))
        and (c.expiration_date is null or c.expiration_date >= public.pa_day(p_ends_at))
    ) then v_blocks := array_append(v_blocks, 'credential:' || v_block); end if;
  end loop;
  foreach v_training_type_id in array coalesce(p_required_training_type_ids, array[]::uuid[])
  loop
    if not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = v_training_type_id
        and r.status = 'compliant' and r.approval_status = 'approved'
        and (r.completion_date is null or r.completion_date <= public.pa_day(p_starts_at))
        and (r.due_date is null or r.due_date >= public.pa_day(p_ends_at))
    ) then v_blocks := array_append(v_blocks, 'training:' || v_training_type_id::text); end if;
  end loop;
  if exists (
    select 1 from public.shift_assignments s
    where s.employee_id = p_employee_id
      and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
      and s.status in ('scheduled', 'confirmed')
      and tstzrange(
        s.shift_date + s.start_time,
        s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end,
        '[)'
      ) && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_blocks := array_append(v_blocks, 'schedule_conflict'); end if;
  select coalesce(sum(
    extract(epoch from (
      s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end
      - (s.shift_date + s.start_time)
    )) / 3600
  ), 0) into v_hours
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed', 'completed')
    and s.shift_date between public.pa_week_start(p_starts_at)
      and public.pa_week_start(p_starts_at) + 6;
  v_duration := extract(epoch from (p_ends_at - p_starts_at)) / 3600;
  if v_hours + v_duration > v_policy.max_weekly_hours then
    v_blocks := array_append(v_blocks, 'weekly_hours_limit');
  elsif v_hours + v_duration > v_policy.warning_weekly_hours then
    v_warnings := array_append(v_warnings, 'weekly_hours_warning');
  end if;
  if exists (
    select 1 from public.employee_availability_windows a
    where a.employee_id = p_employee_id and a.availability_type = 'unavailable'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_warnings := array_append(v_warnings, 'outside_availability'); end if;
  foreach v_block in array v_blocks
  loop
    if v_block in ('lifecycle_inactive', 'confirmed_exclusion') then
      v_unresolved := array_append(v_unresolved, v_block);
    else
      declare v_override_id uuid;
      begin
        select o.id into v_override_id
        from public.schedule_eligibility_overrides o
        where o.employee_id = p_employee_id and o.facility_id = p_facility_id
          and o.block_code = v_block and o.revoked_at is null
          and o.effective_from <= p_starts_at and o.expires_at >= p_ends_at
        order by o.created_at desc limit 1;
        if v_override_id is null then
          v_unresolved := array_append(v_unresolved, v_block);
        else
          v_override_ids := array_append(v_override_ids, v_override_id);
        end if;
      end;
    end if;
  end loop;
  v_outcome := case when cardinality(v_unresolved) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 or cardinality(v_override_ids) > 0 then 'warning'
    else 'eligible' end;
  select jsonb_build_object(
    'policyUpdatedAt', v_policy.updated_at,
    'employeeStatus', v_employee.status,
    'facilityAssignmentIds', coalesce((select jsonb_agg(a.id order by a.id) from public.employee_facility_assignments a where a.employee_id = p_employee_id), '[]'::jsonb),
    'qualificationIds', coalesce((select jsonb_agg(q.id order by q.id) from public.employee_qualifications q where q.employee_id = p_employee_id and q.effective_from <= p_starts_at and (q.effective_to is null or q.effective_to > p_starts_at)), '[]'::jsonb),
    'credentialIds', coalesce((select jsonb_agg(c.id order by c.id) from public.employee_credentials c where c.employee_id = p_employee_id), '[]'::jsonb),
    'weeklyHoursBefore', v_hours,
    'requestedHours', v_duration
  ) into v_snapshot;
  return jsonb_build_object(
    'outcome', v_outcome,
    'hardBlocks', to_jsonb(v_unresolved),
    'warnings', to_jsonb(v_warnings),
    'appliedOverrideIds', to_jsonb(v_override_ids),
    'sourceSnapshot', v_snapshot,
    'sourceChecksumSha256', encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex')
  );
end;
$function$

;

-- app_private.service_effective_date
CREATE OR REPLACE FUNCTION app_private.service_effective_date(p_form resident_assessment_forms)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_candidate text := p_form.content #>> '{assessmentInfo,lastSupportPlanDate}';
begin
  begin
    if nullif(v_candidate, '') is not null then return v_candidate::date; end if;
  exception when others then
    null;
  end;
  return coalesce(public.pa_day(p_form.finalized_at), public.pa_today());
end;
$function$

;

-- public.materialize_service_requirements_from_assessment_form
CREATE OR REPLACE FUNCTION public.materialize_service_requirements_from_assessment_form(p_form_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_form public.resident_assessment_forms%rowtype;
  v_effective date;
  v_entry record;
  v_count integer;
begin
  select * into v_form
  from public.resident_assessment_forms
  where id = p_form_id
  for update;
  if not found or v_form.status <> 'finalized' then
    raise exception 'Only a finalized support plan can create service requirements' using errcode = '22023';
  end if;
  v_effective := app_private.service_effective_date(v_form);

  update public.resident_service_requirements
  set status = 'superseded',
      expires_on = greatest(effective_from, v_effective - 1),
      superseded_at = now(),
      updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'active';

  update public.resident_service_task_instances
  set status = 'superseded', updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'scheduled'
    and public.pa_day(scheduled_start) >= v_effective;

  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section1,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in
    select key, value from jsonb_each(jsonb_build_object(
      'supervision', coalesce(v_form.content #> '{section1,supervision}', '{}'),
      'mobility', coalesce(v_form.content #> '{section1,mobility}', '{}'),
      'medications', coalesce(v_form.content #> '{section1,medications}', '{}')
    ))
  loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section2,sensory}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'sensory', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section3,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'behavioral', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section4,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'social', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in
    select 'physical_' || (ordinality - 1)::text as key, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,physicalDiagnoses}', '[]')) with ordinality
    union all
    select 'dental_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dental}', '[]')) with ordinality
    union all
    select 'dietary_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dietary}', '[]')) with ordinality
    union all
    select 'behavioral_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section3,psychologicalDiagnoses}', '[]')) with ordinality
  loop
    perform app_private.insert_service_requirement(v_form, 'resident_specific', v_entry.key, v_entry.value, 'diagnosis', v_effective);
  end loop;

  select count(*)::integer into v_count
  from public.resident_service_requirements
  where source_assessment_form_id = v_form.id;
  perform public.generate_resident_service_tasks(
    greatest(public.pa_today(), v_effective),
    greatest(public.pa_today(), v_effective) + 14,
    null
  );
  return v_count;
end;
$function$

;

-- app_private.refresh_resident_agreement_status
CREATE OR REPLACE FUNCTION app_private.refresh_resident_agreement_status(p_agreement_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_agreement public.resident_agreements%rowtype;
  v_version public.resident_agreement_versions%rowtype;
  v_status text;
  v_signed_at timestamptz;
begin
  select * into v_agreement from public.resident_agreements where id = p_agreement_id for update;
  select * into v_version from public.resident_agreement_versions where id = v_agreement.current_version_id;
  if exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'refused') then
    v_status := 'refused';
  elsif exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'unable_to_sign') then
    v_status := 'unable_to_sign';
  elsif not exists (
    select 1 from unnest(v_version.required_signer_roles) role
    where (role = 'resident' and not exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = v_version.id and s.outcome = 'signed' and s.signer_role = 'resident'
    )) or (role = 'designated_person' and not exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = v_version.id and s.outcome = 'signed'
        and s.signer_role in ('designated_person', 'guardian', 'power_of_attorney')
    ))
  ) then
    v_status := 'executed';
  elsif exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'signed') then
    v_status := 'partially_executed';
  else
    v_status := 'pending_signature';
  end if;

  update public.resident_agreements set status = v_status, updated_at = now() where id = v_agreement.id;
  if v_status = 'executed' then
    select max(s.signed_at) into v_signed_at
    from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'signed';
    if v_agreement.agreement_type = 'resident_home_contract' then
      update public.residents set contract_status = case when v_version.version_number > 1 then 'amended' else 'executed' end,
        contract_effective_date = public.pa_day(v_version.effective_at),
        contract_document_id = coalesce(v_version.document_id, contract_document_id), updated_at = now()
      where id = v_agreement.resident_id;
    elsif v_agreement.agreement_type = 'resident_rights' then
      update public.residents set resident_rights_acknowledged_at = v_signed_at,
        resident_rights_document_id = coalesce(v_version.document_id, resident_rights_document_id), updated_at = now()
      where id = v_agreement.resident_id;
    end if;
    update public.move_in_tasks t set
      signature_evidence = jsonb_build_object(
        'agreementId', v_agreement.id, 'agreementVersionId', v_version.id,
        'versionLabel', v_version.version_label, 'contentSha256', v_version.content_sha256,
        'executedAt', v_signed_at
      ),
      state = case when t.state in ('open', 'in_progress') then 'submitted' else t.state end,
      updated_at = now()
    from public.move_in_workspaces w
    where t.workspace_id = w.id and w.resident_id = v_agreement.resident_id
      and w.state in ('active', 'ready') and t.task_key = 'resident_agreement';
  end if;
  return v_status;
end;
$function$

;

-- public.get_qapi_source_metrics
CREATE OR REPLACE FUNCTION public.get_qapi_source_metrics(p_facility_id uuid, p_from date, p_through date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype; v_complaints jsonb;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'QAPI metrics outside scope' using errcode = '42501';
  end if;
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'QAPI metric period is invalid' using errcode = '22023';
  end if;
  v_complaints := public.get_complaint_trends(v_fac.id, p_from, p_through);
  return jsonb_build_object(
    'falls', (select count(*) from public.resident_change_events where facility_id=v_fac.id and category='fall' and public.pa_day(identified_at) between p_from and p_through),
    'medicationIncidents', (select count(*) from public.incidents where facility_id=v_fac.id and incident_type='medication_error' and public.pa_day(occurred_at) between p_from and p_through),
    'hospitalTransfers', (select count(*) from public.resident_change_events where facility_id=v_fac.id and (category in('emergency_department_visit','hospital_return') or emergency_transfer) and public.pa_day(identified_at) between p_from and p_through),
    'missedServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='not_completed' and public.pa_day(scheduled_start) between p_from and p_through),
    'lateServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='completed_late' and public.pa_day(scheduled_start) between p_from and p_through),
    'lateAssessments', (select count(*) from public.resident_compliance_items where facility_id=v_fac.id and status='expired' and item_type in('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')),
    'trainingGaps', (select count(*) from public.employee_training_records where facility_id=v_fac.id and status in('missing','expired')),
    'citationRecurrence', (select count(*) from (select citation_topic_id from public.dhs_violations where facility_id=v_fac.id and inspection_date between p_from and p_through group by citation_topic_id having count(*)>1)x),
    'inspectionDeficiencies', (select count(*) from public.inspection_events where facility_id=v_fac.id and result in('fail','deficiency_noted') and performed_date between p_from and p_through),
    'nutritionExceptions', ((select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type is not null and public.pa_day(served_at) between p_from and p_through) + (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and public.pa_day(scheduled_at) between p_from and p_through) + (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and public.pa_day(measured_at) between p_from and p_through)),
    'mealRefusals', (select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type='meal_refusal' and public.pa_day(served_at) between p_from and p_through),
    'hydrationExceptions', (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and public.pa_day(scheduled_at) between p_from and p_through),
    'weightReviews', (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and public.pa_day(measured_at) between p_from and p_through),
    'foodSafetyExceptions', (select count(*) from public.food_safety_logs where facility_id=v_fac.id and result='exception' and public.pa_day(observed_at) between p_from and p_through),
    'openNutritionReferrals', (select count(*) from public.nutrition_risk_reviews where facility_id=v_fac.id and referral_status in('pending','scheduled')),
    'currentInactiveStaff', (select count(*) from public.employees where facility_id=v_fac.id and status<>'active'),
    'complaints', (v_complaints->>'total')::integer,
    'highRiskComplaints', (v_complaints->>'highRisk')::integer,
    'residentRightsComplaints', (v_complaints->>'residentRights')::integer,
    'appointmentFailures', (select count(*) from public.resident_service_calendar_events where facility_id=v_fac.id and event_type in('medical_appointment','dental_appointment','behavioral_health_appointment','laboratory_visit','therapy') and status in('canceled','no_show') and public.pa_day(starts_at) between p_from and p_through),
    'periodStart', p_from, 'periodEnd', p_through
  );
end;
$function$

;

-- public.get_complaint_trends
CREATE OR REPLACE FUNCTION public.get_complaint_trends(p_facility_id uuid, p_from date, p_through date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'Complaint trends outside scope' using errcode = '42501';
  end if;
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'Complaint trend period is invalid' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through),
    'open', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through and c.status <> 'closed'),
    'highRisk', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through and c.immediate_risk in ('high','imminent')),
    'residentRights', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through and c.category = 'resident_rights'),
    'ombudsmanReferrals', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through and c.ombudsman_referral_at is not null),
    'incidentLinked', (select count(*) from public.complaints c where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through and c.incident_id is not null),
    'byCategory', coalesce((
      select jsonb_object_agg(x.category, x.total)
      from (
        select c.category, count(*) as total
        from public.complaints c
        where c.facility_id = v_fac.id and public.pa_day(c.date_received) between p_from and p_through
        group by c.category
      ) x
    ), '{}'::jsonb),
    'periodStart', p_from,
    'periodEnd', p_through
  );
end
$function$

;

-- app_private.track_dietary_exception_pattern
CREATE OR REPLACE FUNCTION app_private.track_dietary_exception_pattern(p_org uuid, p_fac uuid, p_resident uuid, p_kind text, p_pattern_key text, p_label text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pattern public.dietary_exception_patterns%rowtype;
  v_project_id uuid;
  v_project_number text;
begin
  insert into public.dietary_exception_patterns(
    organization_id, facility_id, resident_id, pattern_kind, pattern_key
  ) values (p_org, p_fac, p_resident, p_kind, p_pattern_key)
  on conflict (organization_id, facility_id, pattern_key) do update set
    resident_id = excluded.resident_id,
    pattern_kind = excluded.pattern_kind,
    occurrence_count = case
      when public.dietary_exception_patterns.last_occurrence_at < now() - interval '30 days' then 1
      else public.dietary_exception_patterns.occurrence_count + 1 end,
    window_started_at = case
      when public.dietary_exception_patterns.last_occurrence_at < now() - interval '30 days' then now()
      else public.dietary_exception_patterns.window_started_at end,
    last_occurrence_at = now()
  returning * into v_pattern;

  if v_pattern.occurrence_count >= 3 and v_pattern.qapi_project_id is null then
    perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(p_org::text));
    v_project_number := 'QAPI-' || to_char(public.pa_today(), 'YYYY') || '-' || lpad((
      select (count(*) + 1)::text from public.qapi_projects where organization_id = p_org
    ), 4, '0');
    insert into public.qapi_projects(
      organization_id, facility_id, project_number, title, problem_statement,
      source_of_concern, source_type, source_id, baseline_data,
      measurable_objective, target_description, target_value,
      target_completion_date, created_by
    ) values (
      p_org, p_fac, v_project_number,
      'Repeated ' || p_label,
      'Three or more similar dietary or food-safety exceptions occurred within 30 days and require governed review.',
      'Automated dietary and food-safety exception trend', 'dietary_exception_pattern', v_pattern.id,
      v_pattern.occurrence_count || ' occurrences since ' || public.pa_day(v_pattern.window_started_at),
      'Review the pattern, identify contributing factors, and verify corrective actions.',
      'Reduce recurrence and sustain verified controls.', 0, public.pa_today() + 30, auth.uid()
    ) returning id into v_project_id;
    update public.dietary_exception_patterns set qapi_project_id = v_project_id where id = v_pattern.id;
    insert into public.qapi_project_history(
      organization_id, facility_id, project_id, event_type,
      resulting_status, reason, actor_profile_id, evidence
    ) values (
      p_org, p_fac, v_project_id, 'created', 'proposed',
      'Repeated dietary or food-safety exceptions automatically fed QAPI', auth.uid(),
      jsonb_build_object('patternId', v_pattern.id, 'occurrenceCount', v_pattern.occurrence_count)
    );
  end if;
  return v_pattern.id;
end;
$function$

;

-- public.record_resident_weight
CREATE OR REPLACE FUNCTION public.record_resident_weight(p_assignment_id uuid, p_measured_at timestamp with time zone, p_weight_lbs numeric, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assignment public.weight_monitoring_assignments%rowtype;
  v_prior numeric;
  v_change numeric;
  v_review boolean;
  v_id uuid;
  v_work uuid;
begin
  select * into v_assignment from public.weight_monitoring_assignments where id = p_assignment_id and active for update;
  if not found then raise exception 'Active weight assignment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_dietary_contributor(v_assignment.organization_id, v_assignment.facility_id);
  if p_measured_at is null or p_measured_at > now() + interval '1 hour' or p_weight_lbs not between 1 and 1500 then
    raise exception 'Weight reading is invalid' using errcode = '22023';
  end if;
  select weight_lbs into v_prior from public.resident_weight_readings
  where resident_id = v_assignment.resident_id order by measured_at desc limit 1;
  v_change := case when v_prior is null then null else round(p_weight_lbs - v_prior, 2) end;
  v_review := v_change is not null and abs(v_change) >= v_assignment.change_threshold_lbs;
  insert into public.resident_weight_readings(
    organization_id, facility_id, resident_id, assignment_id, measured_at,
    weight_lbs, prior_weight_lbs, change_lbs, review_required, notes, recorded_by
  ) values (
    v_assignment.organization_id, v_assignment.facility_id, v_assignment.resident_id,
    v_assignment.id, p_measured_at, p_weight_lbs, v_prior, v_change, v_review,
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  update public.weight_monitoring_assignments set next_due_date = case frequency
    when 'daily' then public.pa_day(p_measured_at) + 1
    when 'weekly' then public.pa_day(p_measured_at) + 7
    when 'biweekly' then public.pa_day(p_measured_at) + 14
    when 'monthly' then (public.pa_day(p_measured_at) + interval '1 month')::date
    else (public.pa_day(p_measured_at) + interval '3 months')::date end,
    updated_at = now() where id = v_assignment.id;
  if v_review then
    v_work := app_private.create_automatic_work_item(
      v_assignment.organization_id, v_assignment.facility_id, 'dietary.weight_review',
      'dietary_exception', v_id, 'Review resident weight change',
      'Recorded change of ' || v_change || ' lb meets the configured review threshold.',
      'high', now() + interval '1 day'
    );
    update public.resident_weight_readings set work_item_id = v_work where id = v_id;
    perform app_private.track_dietary_exception_pattern(
      v_assignment.organization_id, v_assignment.facility_id, v_assignment.resident_id,
      'weight_review', 'resident:' || v_assignment.resident_id || ':weight', 'weight review exceptions'
    );
  end if;
  return v_id;
end;
$function$

;

-- public.start_emergency_event
CREATE OR REPLACE FUNCTION public.start_emergency_event(p_facility_id uuid, p_event_mode text, p_event_type text, p_started_at timestamp with time zone, p_summary text, p_location_description text, p_assembly_point text, p_incident_commander uuid, p_incident_id uuid DEFAULT NULL::uuid, p_inspection_event_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fac public.facilities%rowtype;
  v_plan_version uuid;
  v_id uuid;
  v_number text;
  v_local_date date;
  v_local_time time;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  select current_version_id into v_plan_version from public.emergency_plans where facility_id = v_fac.id;
  if v_plan_version is null then raise exception 'An approved emergency plan version is required' using errcode = '55000'; end if;
  if p_event_mode not in ('drill', 'actual')
     or p_event_type not in (
       'fire', 'severe_weather', 'power_outage', 'water_outage', 'hvac_outage',
       'evacuation', 'shelter_in_place', 'missing_person', 'infectious_disease',
       'transportation_disruption', 'other'
     )
     or length(btrim(coalesce(p_summary, ''))) < 5 then
    raise exception 'Emergency event declaration is incomplete' using errcode = '22023';
  end if;
  if p_incident_id is not null and not exists (
    select 1 from public.incidents i where i.id = p_incident_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked incident crosses facility scope' using errcode = '42501'; end if;
  if p_inspection_event_id is not null and not exists (
    select 1 from public.inspection_events i where i.id = p_inspection_event_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked drill crosses facility scope' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('emergency-event-number'), hashtext(v_fac.organization_id::text));
  v_number := 'EMG-' || to_char(coalesce(p_started_at, now()), 'YYYY') || '-' ||
    lpad((select (count(*) + 1)::text from public.emergency_events where organization_id = v_fac.organization_id), 4, '0');
  insert into public.emergency_events (
    organization_id, facility_id, event_number, event_mode, event_type,
    plan_version_id, incident_id, inspection_event_id, incident_commander_profile_id,
    started_at, location_description, assembly_point, summary, declared_by
  ) values (
    v_fac.organization_id, v_fac.id, v_number, p_event_mode, p_event_type,
    v_plan_version, p_incident_id, p_inspection_event_id, p_incident_commander,
    coalesce(p_started_at, now()), nullif(btrim(p_location_description), ''),
    nullif(btrim(p_assembly_point), ''), btrim(p_summary), auth.uid()
  ) returning id, public.pa_day(started_at), public.pa_clock(started_at) into v_id, v_local_date, v_local_time;

  insert into public.emergency_event_residents (
    organization_id, facility_id, emergency_event_id, resident_id,
    resident_name_snapshot, room_snapshot, assistance_level_snapshot,
    mobility_needs_snapshot, transportation_needs_snapshot,
    evacuation_method_snapshot, required_equipment_snapshot
  )
  select
    r.organization_id, r.facility_id, v_id, r.id,
    r.first_name || ' ' || r.last_name, r.room,
    coalesce(ep.assistance_level, 'full_assistance'), ep.mobility_needs,
    ep.transportation_needs, ep.evacuation_method, ep.required_equipment
  from public.residents r
  left join public.resident_evacuation_profiles ep on ep.resident_id = r.id
  where r.facility_id = v_fac.id and r.status = 'active';

  insert into public.emergency_event_staff (
    organization_id, facility_id, emergency_event_id, employee_id,
    employee_name_snapshot, job_title_snapshot, responsibility_snapshot, roster_source
  )
  select distinct on (e.id)
    e.organization_id, v_fac.id, v_id, e.id, e.first_name || ' ' || e.last_name,
    e.job_title, coalesce(esa.responsibility, 'Scheduled shift'),
    case when sa.id is not null then 'scheduled_shift' else 'emergency_assignment' end
  from public.employees e
  left join public.shift_assignments sa on sa.employee_id = e.id
    and sa.facility_id = v_fac.id
    and sa.status in ('scheduled', 'confirmed', 'completed')
    and (
      (sa.start_time <= sa.end_time and sa.shift_date = v_local_date and v_local_time between sa.start_time and sa.end_time)
      or (sa.start_time > sa.end_time and (
        (sa.shift_date = v_local_date and v_local_time >= sa.start_time)
        or (sa.shift_date = v_local_date - 1 and v_local_time <= sa.end_time)
      ))
    )
  left join public.emergency_staff_assignments esa on esa.employee_id = e.id
    and esa.facility_id = v_fac.id and esa.is_active
  where e.organization_id = v_fac.organization_id and e.status = 'active'
    and (sa.id is not null or esa.id is not null)
  order by e.id, (sa.id is not null) desc, esa.is_backup, esa.created_at;

  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type,
    occurred_at, description, metadata, recorded_by
  ) values (
    v_fac.organization_id, v_fac.id, v_id, 'declared', coalesce(p_started_at, now()),
    'Emergency event declared and accountability rosters snapshotted.',
    jsonb_build_object('eventMode', p_event_mode, 'eventType', p_event_type), auth.uid()
  );
  return v_id;
end;
$function$

;

-- public.reconcile_resident_personal_funds
CREATE OR REPLACE FUNCTION public.reconcile_resident_personal_funds(p_resident_id uuid, p_period_end date, p_counted_balance numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_resident public.residents%rowtype; v_account public.resident_personal_fund_accounts%rowtype; v_ledger numeric; v_variance numeric; v_result text; v_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts where resident_id=v_resident.id;
  if not found then raise exception 'Personal funds account is not open' using errcode = 'P0002'; end if;
  if p_period_end is null or p_counted_balance < 0 then raise exception 'Reconciliation is invalid' using errcode='22023'; end if;
  select coalesce((select balance_after from public.resident_personal_fund_transactions
    where personal_fund_account_id=v_account.id and public.pa_day(transaction_at)<=p_period_end
    order by transaction_at desc, posted_at desc, id desc limit 1),0) into v_ledger;
  v_variance := round(p_counted_balance-v_ledger,2); v_result := case when v_variance=0 then 'balanced' else 'variance' end;
  if v_result='variance' and length(btrim(coalesce(p_notes,'')))<5 then
    raise exception 'Variance reconciliation requires notes' using errcode='22023';
  end if;
  insert into public.resident_personal_fund_reconciliations(
    organization_id, facility_id, resident_id, personal_fund_account_id,
    period_end, ledger_balance, counted_balance, variance, result, notes, reconciled_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    p_period_end, v_ledger, round(p_counted_balance,2), v_variance, v_result,
    nullif(btrim(p_notes),''), auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_reconciled', v_id, 'Resident personal funds reconciled',
    jsonb_build_object('periodEnd',p_period_end,'ledgerBalance',v_ledger,
      'countedBalance',round(p_counted_balance,2),'variance',v_variance,'result',v_result), auth.uid()
  );
  return v_id;
end
$function$

;

-- public.get_my_shift_workspace
CREATE OR REPLACE FUNCTION public.get_my_shift_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_shift jsonb; v_result jsonb;
begin
  select * into v_employee from public.employees where profile_id = auth.uid() limit 1;
  if not found then return jsonb_build_object('employee', null, 'currentOrNextShift', null, 'handoffItems', '[]'::jsonb, 'residentServiceTasks', '[]'::jsonb, 'workItems', '[]'::jsonb, 'notifications', '[]'::jsonb, 'openShiftOffers', '[]'::jsonb, 'timeOffRequests', '[]'::jsonb, 'upcomingShifts', '[]'::jsonb); end if;
  select to_jsonb(s) into v_shift from (
    select sa.*, f.name as facility_name, u.name as unit_name, sd.name as shift_name
    from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id
    where sa.employee_id=v_employee.id
      and (sa.shift_date + sa.end_time + case when sa.end_time <= sa.start_time then interval '1 day' else interval '0' end) >= public.pa_now()
      and sa.status in ('scheduled','confirmed') order by sa.shift_date, sa.start_time limit 1
  ) s;
  select jsonb_build_object(
    'employee', jsonb_build_object('id', v_employee.id, 'name', btrim(v_employee.first_name || ' ' || v_employee.last_name), 'status', v_employee.status),
    'currentOrNextShift', v_shift,
    'handoffItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.created_at desc) from (select id, category, priority, narrative, requires_acknowledgement, status, created_at, linked_work_item_id from public.shift_report_entries where facility_id = coalesce((v_shift->>'facility_id')::uuid, v_employee.facility_id) and status in ('open','carried_forward') limit 20) x), '[]'::jsonb),
    'residentServiceTasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_start) from (select id, resident_id, service_name, scheduled_start, scheduled_end, status from public.resident_service_task_instances where assigned_employee_id = v_employee.id and scheduled_start >= now() - interval '4 hours' and scheduled_start < now() + interval '16 hours' and status not in ('completed','superseded') limit 20) x), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at) from (select id, title, priority, due_at, state, source_type, source_id from public.work_items where owner_profile_id = auth.uid() and state not in ('closed','canceled') order by due_at limit 20) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, notification_type, title, body, link, created_at from public.notifications where profile_id=auth.uid() and read_at is null order by created_at desc limit 10) x), '[]'::jsonb),
    'openShiftOffers', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select id, facility_id, shift_date, start_time, end_time, status from public.open_shift_opportunities where organization_id=v_employee.organization_id and status='open' and shift_date >= public.pa_today() order by shift_date, start_time limit 10) x), '[]'::jsonb),
    'timeOffRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select id, request_type, starts_at, ends_at, status, absence_category from public.workforce_time_off_requests where employee_id=v_employee.id order by starts_at desc limit 10) x), '[]'::jsonb),
    'upcomingShifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select sa.id, sa.shift_date, sa.start_time, sa.end_time, sa.status, f.name as facility_name, u.name as unit_name, sd.name as shift_name from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id where sa.employee_id=v_employee.id and sa.shift_date >= public.pa_today() order by sa.shift_date, sa.start_time limit 7) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$

;

-- public.complete_hospital_return
CREATE OR REPLACE FUNCTION public.complete_hospital_return(p_episode_id uuid, p_return_time timestamp with time zone, p_discharge_document_id uuid DEFAULT NULL::uuid, p_changed_order_ack_status text DEFAULT 'pending_review'::text, p_medication_reconciliation_status text DEFAULT 'pending'::text, p_condition_changes text DEFAULT NULL::text, p_diet_changes text DEFAULT NULL::text, p_mobility_changes text DEFAULT NULL::text, p_skin_concerns text DEFAULT NULL::text, p_dme_changes text DEFAULT NULL::text, p_assessment_review_required boolean DEFAULT true, p_support_plan_review_required boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.hospital_transfer_episodes%rowtype; v_work uuid;
begin
  select * into v from public.hospital_transfer_episodes where id=p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'out' or p_return_time < v.transfer_time then
    raise exception 'Invalid hospital return request' using errcode='22023';
  end if;

  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
  values(v.organization_id,v.facility_id,'rule_exception',v.id,'hospital-return-follow-up:'||v.id,'Complete hospital-return follow-up','Review discharge documents, order acknowledgement status, assessment/support-plan needs, services, DME, and staff notifications.','high',p_return_time+interval '24 hours','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;

  update public.hospital_transfer_episodes set
    status='returned', return_time=p_return_time, discharge_document_id=p_discharge_document_id,
    changed_order_ack_status=p_changed_order_ack_status,
    medication_reconciliation_status=p_medication_reconciliation_status,
    condition_changes=p_condition_changes, diet_changes=p_diet_changes,
    mobility_changes=p_mobility_changes, skin_concerns=p_skin_concerns, dme_changes=p_dme_changes,
    assessment_review_required=p_assessment_review_required,
    support_plan_review_required=p_support_plan_review_required,
    return_work_item_id=v_work, updated_at=now()
  where id=v.id;

  -- A boolean that nothing reads is not a requirement. When the return says a reassessment is
  -- needed, create the draft review now, linked to this episode, so it is a findable record with a
  -- template behind it rather than an intention. Pre-filled with what the return already recorded,
  -- because asking someone to retype it is how it gets skipped.
  if p_assessment_review_required and not exists (
    select 1 from public.resident_assessment_reviews r
    where r.hospital_episode_id = v.id and r.template_key = 'hospital_return_review'
  ) then
    insert into public.resident_assessment_reviews(
      organization_id, facility_id, resident_id, template_key, template_version,
      answers, hospital_episode_id, review_date, created_by
    )
    values (
      v.organization_id, v.facility_id, v.resident_id, 'hospital_return_review', 1,
      jsonb_strip_nulls(jsonb_build_object(
        'discharge_paperwork_received', p_discharge_document_id is not null,
        'new_restrictions', nullif(btrim(coalesce(p_condition_changes, '')), ''),
        'skin_findings', nullif(btrim(coalesce(p_skin_concerns, '')), ''),
        'support_plan_revision_required', p_support_plan_review_required
      )),
      v.id, public.pa_day(p_return_time), auth.uid()
    )
    -- One draft per resident per template is enforced by a partial unique index; if the resident
    -- already has an open return review from a prior stay, leave it rather than failing the return.
    on conflict do nothing;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='shift_report_entries') then
    insert into public.shift_report_entries(organization_id,facility_id,resident_id,category,priority,shift_period_start,shift_period_end,narrative,author_profile_id,follow_up_owner_profile_id,requires_acknowledgement,linked_work_item_id,idempotency_key)
    values(v.organization_id,v.facility_id,v.resident_id,'hospital_transfer_return','high',p_return_time,p_return_time + interval '8 hours','Resident returned from hospital; complete discharge follow-up before closing.',auth.uid(),auth.uid(),true,v_work,'hospital-return:'||v.id)
    on conflict do nothing;
  end if;

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'hospital_transfer_episode',v.id::text,'hospital_transfer.return_completed',
    jsonb_build_object('returnTime',p_return_time,'workItemId',v_work,'assessmentReviewRequired',p_assessment_review_required));
  return v_work;
end $function$

;

-- public.get_resident_care_delivery_analytics
CREATE OR REPLACE FUNCTION public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  -- coalesce(..., false): current_role()/current_org_id() are NULL for a deactivated profile, and
  -- `not NULL` is NULL, so without this the guard fails open for exactly that caller.
  if not coalesce(
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.is_platform_admin()
    or (public.current_org_id()=v_fac.organization_id
        and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id))),
    false
  ) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and public.pa_day(t.scheduled_start) between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and public.pa_day(t.scheduled_start) between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and public.pa_day(t.scheduled_start) between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and public.pa_day(t.scheduled_start) between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and public.pa_day(c.identified_at) between p_from and p_through),'definition','Change-of-condition events identified in the reporting period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='active' and p.review_due_date < public.pa_today()),'definition','Support plans in force with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and public.pa_day(h.return_time) between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $function$

;

-- public.queue_manager_weekly_digests
CREATE OR REPLACE FUNCTION public.queue_manager_weekly_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        and n.created_at >= public.pa_midnight(public.pa_week_start(now()))
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
      and c.expiration_date between public.pa_today() and public.pa_today() + 30;
    select count(*) into v_training from (
      select distinct on (r.employee_id, r.training_type_id) r.status
      from public.employee_training_records r
      where r.facility_id = any(v_facility_ids)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where cur.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between public.pa_today() and public.pa_today() + 6
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
      v_profile.organization_id, v_profile.id, public.pa_week_start(now()), v_items
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
$function$

;

-- public.get_staffing_optimization_snapshot
CREATE OR REPLACE FUNCTION public.get_staffing_optimization_snapshot(p_facility_id uuid, p_from date DEFAULT CURRENT_DATE, p_through date DEFAULT (CURRENT_DATE + 30))
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_schedule_id uuid;
  v_workload jsonb := '{}'::jsonb;
  v_open_shifts integer;
  v_time_off integer;
  v_pending_swaps integer;
  v_blocked integer;
begin
  v_org := app_private.assert_product_value_manager(p_facility_id);
  if p_through < p_from or p_through > p_from + 120 then
    raise exception 'Staffing forecast window is invalid' using errcode = '22023';
  end if;
  select s.id into v_schedule_id from public.schedules s
  where s.facility_id = p_facility_id and s.period_end >= p_from and s.period_start <= p_through
  order by case s.status when 'published' then 0 else 1 end, s.period_start limit 1;
  if v_schedule_id is not null then v_workload := public.get_schedule_service_workload(v_schedule_id); end if;
  select count(*) into v_open_shifts from public.open_shift_opportunities o
    where o.facility_id = p_facility_id and o.shift_date between p_from and p_through
      and o.status = 'open';
  select count(*) into v_time_off from public.workforce_time_off_requests r
    where r.facility_id = p_facility_id and r.status = 'pending'
      and public.pa_day(r.starts_at) <= p_through and public.pa_day(r.ends_at) >= p_from;
  select count(*) into v_pending_swaps from public.shift_swap_requests s
    where s.facility_id = p_facility_id and s.status = 'pending';
  select count(*) into v_blocked from public.schedule_eligibility_decisions d
    where d.facility_id = p_facility_id and d.outcome = 'blocked'
      and d.evaluated_at >= now() - interval '30 days';
  return jsonb_build_object(
    'facilityId', p_facility_id, 'from', p_from, 'through', p_through,
    'scheduleId', v_schedule_id, 'workload', v_workload,
    'openShifts', v_open_shifts, 'pendingTimeOff', v_time_off,
    'pendingSwaps', v_pending_swaps, 'recentBlockedAssignments', v_blocked,
    'recommendations', coalesce((
      select jsonb_agg(value)
      from jsonb_array_elements(jsonb_build_array(
        case when v_open_shifts > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_open_shifts, ' open shifts need qualified coverage'), 'href', '/app/schedule') end,
        case when v_time_off > 0 then jsonb_build_object('priority', 'normal', 'title', concat(v_time_off, ' time-off requests await decisions'), 'href', '/app/workforce-operations') end,
        case when v_blocked > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_blocked, ' assignment attempts were blocked by qualification rules'), 'href', '/app/workforce-operations') end
      )) value
      where value <> 'null'::jsonb
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$function$

;

-- public.generate_paged_compliance_report
CREATE OR REPLACE FUNCTION public.generate_paged_compliance_report(p_report_id text, p_facility_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_headers jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_total_employees bigint := 0;
  v_compliant bigint := 0;
  v_expired bigint := 0;
  v_due_soon bigint := 0;
  v_missing bigint := 0;
  v_other bigint := 0;
  v_score integer := 100;
  v_current_year integer := extract(year from public.pa_today())::integer;
begin
  if p_report_id is null or p_report_id not in (
    'compliance-summary', 'facility-compliance', 'survey-readiness',
    'expired-training', 'due-soon', 'medication-administration',
    'training-matrix', 'practicum-status', 'annual-practicum',
    'annual-hours', 'training-hours', 'trainer-certification',
    'new-employee-training', 'employee-transcript',
    'expiring-certifications', 'missing-documents', 'document-audit',
    'overdue-training', 'credential-status', 'incident-log',
    'incident-notification-register', 'inspection-compliance'
  ) then
    raise exception 'Unsupported report id'
      using errcode = '22023';
  end if;

  if not public.current_profile_active()
     or public.current_role() not in ('org_admin', 'facility_manager', 'auditor') then
    raise exception 'Not authorized to generate compliance reports'
      using errcode = '42501';
  end if;

  -- Because this function is SECURITY INVOKER, this lookup also proves that the
  -- caller can see the requested facility through normal facilities RLS.
  if p_facility_id is not null and not exists (
    select 1
    from public.facilities f
    where f.id = p_facility_id
      and not f.is_sandbox
  ) then
    raise exception 'Facility is outside the caller scope'
      using errcode = '42501';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'The report start date must be on or before the end date'
      using errcode = '22023';
  end if;

  if p_report_id = 'compliance-summary' then
    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'due_soon')
      into v_total, v_compliant, v_expired, v_due_soon
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;
    v_headers := '["Metric","Value"]'::jsonb;
    v_rows := jsonb_build_array(
      jsonb_build_array('Total Employees', v_total_employees::text),
      jsonb_build_array('Total Training Records', v_total::text),
      jsonb_build_array('Compliant Records', v_compliant::text),
      jsonb_build_array('Expired Records', v_expired::text),
      jsonb_build_array('Due Soon Records', v_due_soon::text),
      jsonb_build_array('Compliance Percentage', v_score::text || '%')
    );
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Employees', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Compliance', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end)
    );
    v_total := 6;

  elsif p_report_id = 'facility-compliance' then
    with scored as (
      select
        f.id,
        f.name,
        f.facility_type,
        count(r.id) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')) as total,
        count(r.id) filter (where r.status = 'compliant') as compliant,
        count(r.id) filter (where r.status = 'expired') as expired,
        count(r.id) filter (where r.status = 'due_soon') as due_soon
      from public.facilities f
      left join public.employee_training_records r
        on r.facility_id = f.id
       and (p_date_from is null or r.due_date >= p_date_from)
       and (p_date_to is null or r.due_date <= p_date_to)
      where not f.is_sandbox
        and (p_facility_id is null or f.id = p_facility_id)
      group by f.id, f.name, f.facility_type
    ), paged as (
      select *, case when total > 0 then round(compliant * 100.0 / total)::integer else 100 end as score
      from scored
      order by name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scored),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          name,
          case
            when facility_type = 'ALR' then 'ALF'
            else replace(facility_type, '_', ' ')
          end,
          total::text,
          compliant::text,
          expired::text,
          due_soon::text,
          score::text || '%'
        ) order by name, id)
        from paged
      ), '[]'::jsonb),
      coalesce((select round(avg(case when total > 0 then compliant * 100.0 / total else 100 end))::integer from scored), 100)
      into v_total, v_rows, v_score;
    v_headers := '["Facility","Type","Total Records","Compliant","Expired","Due Soon","Compliance %"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Facilities', 'value', v_total),
      jsonb_build_object('label', 'Avg Score', 'value', v_score::text || '%')
    );

  elsif p_report_id = 'survey-readiness' then
    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'missing' and r.document_required)
      into v_total, v_compliant, v_expired, v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;

    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    -- Reuse scratch counters for the remaining readiness checks:
    -- due_soon=med-admin gaps, other=trainer gaps.
    select count(*)
      into v_due_soon
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.administers_medications and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_administers_meds
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    select count(*)
      into v_other
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.trainer_status and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_trainers
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    declare
      v_pending_practicums bigint;
      v_year_practicums bigint;
      v_critical_alerts bigint;
      v_med_admin_staff bigint;
      v_passes integer := 0;
      v_readiness integer;
    begin
      select
        count(*) filter (where p.practicum_year = v_current_year),
        count(*) filter (where p.practicum_year = v_current_year and p.status <> 'compliant')
        into v_year_practicums, v_pending_practicums
      from public.practicums p
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to);

      select count(*) into v_critical_alerts
      from public.alerts a
      left join public.facilities f on f.id = a.facility_id
      where a.status = 'open' and a.severity = 'critical'
        and (a.facility_id is null or not coalesce(f.is_sandbox, false))
        and (p_facility_id is null or a.facility_id = p_facility_id);

      select count(*) into v_med_admin_staff
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);

      v_passes :=
        (case when v_score >= 90 then 1 else 0 end) +
        (case when v_expired = 0 then 1 else 0 end) +
        (case when v_due_soon = 0 then 1 else 0 end) +
        (case when v_other = 0 then 1 else 0 end) +
        (case when v_pending_practicums = 0 then 1 else 0 end) +
        (case when v_missing = 0 then 1 else 0 end) +
        (case when v_critical_alerts = 0 then 1 else 0 end);
      v_readiness := round(v_passes * 100.0 / 7)::integer;

      v_headers := '["Check","Status","Detail"]'::jsonb;
      v_rows := jsonb_build_array(
        jsonb_build_array('Overall Training Compliance', case when v_score >= 90 then 'pass' when v_score >= 75 then 'warning' else 'fail' end, v_compliant::text || ' of ' || v_total::text || ' records compliant (' || v_score::text || '%)'),
        jsonb_build_array('Expired Training Records', case when v_expired = 0 then 'pass' else 'fail' end, v_expired::text || ' expired record(s) require immediate renewal'),
        jsonb_build_array('Medication Administration Training', case when v_due_soon = 0 then 'pass' else 'fail' end, v_due_soon::text || ' med admin training record(s) are expired or missing'),
        jsonb_build_array('Trainer Certification', case when v_other = 0 then 'pass' else 'fail' end, v_other::text || ' trainer certification record(s) are expired or missing'),
        jsonb_build_array('Annual Practicum Completion', case when v_pending_practicums = 0 then 'pass' else 'warning' end, v_pending_practicums::text || ' of ' || v_year_practicums::text || ' ' || v_current_year::text || ' practicums pending'),
        jsonb_build_array('Required Documentation', case when v_missing = 0 then 'pass' else 'warning' end, v_missing::text || ' record(s) missing required documentation'),
        jsonb_build_array('Open Critical Alerts', case when v_critical_alerts = 0 then 'pass' else 'fail' end, v_critical_alerts::text || ' open critical alert(s)')
      );
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Readiness Score', 'value', v_readiness::text || '%', 'variant', case when v_readiness >= 80 then 'success' when v_readiness >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Compliance Score', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Active Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_med_admin_staff)
      );
      v_total := 7;
    end;

  elsif p_report_id in (
    'expired-training', 'due-soon', 'medication-administration',
    'trainer-certification', 'new-employee-training',
    'expiring-certifications', 'missing-documents'
  ) then
    with scoped as (
      select
        r.id,
        e.first_name,
        e.last_name,
        e.job_title,
        e.hire_date,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
        and case p_report_id
          when 'expired-training' then r.status = 'expired'
          when 'due-soon' then r.status = 'due_soon'
          when 'medication-administration' then e.status = 'active' and e.administers_medications and t.is_active and t.applies_to_administers_meds
          when 'trainer-certification' then e.status = 'active' and e.trainer_status and t.is_active and t.applies_to_trainers
          when 'new-employee-training' then e.status = 'active' and e.hire_date >= public.pa_today() - 90
          when 'expiring-certifications' then r.due_date between public.pa_today() and public.pa_today() + 90
          when 'missing-documents' then r.status = 'missing' and r.document_required
          else false
        end
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((
        select jsonb_agg(
          case when p_report_id in ('medication-administration', 'new-employee-training')
            then jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), coalesce(hire_date::text, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
            else jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_rows;

    v_headers := case when p_report_id in ('medication-administration', 'new-employee-training')
      then '["Employee","Job Title","Hire Date","Training Type","Completion","Due Date","Status"]'::jsonb
      else '["Employee","Job Title","Training Type","Completion Date","Due Date","Status"]'::jsonb
    end;
    v_summary := case p_report_id
      when 'expired-training' then jsonb_build_array(jsonb_build_object('label', 'Expired Records', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end))
      when 'due-soon' then jsonb_build_array(jsonb_build_object('label', 'Due Soon Records', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'expiring-certifications' then jsonb_build_array(jsonb_build_object('label', 'Expiring (90 days)', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'missing-documents' then jsonb_build_array(jsonb_build_object('label', 'Missing Documents', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'medication-administration' then jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.administers_medications and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      when 'trainer-certification' then jsonb_build_array(
        jsonb_build_object('label', 'Trainers', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.trainer_status and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      else jsonb_build_array(
        jsonb_build_object('label', 'New Employees', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and not e.is_synthetic and e.hire_date >= public.pa_today() - 90 and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
    end;

  elsif p_report_id = 'training-matrix' then
    with matrix_types as materialized (
      select t.id, t.name, t.applies_to_facility_type, t.sort_order
      from public.training_types t
      where t.is_active
      order by t.sort_order, t.name, t.id
    ), scoped_employees as materialized (
      select e.id, e.first_name, e.last_name, e.job_title, f.facility_type
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active'
        and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ), paged_employees as (
      select * from scoped_employees
      order by last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped_employees),
      jsonb_build_array('Employee', 'Job Title') || coalesce((
        select jsonb_agg(to_jsonb(t.name) order by t.sort_order, t.name, t.id)
        from matrix_types t
      ), '[]'::jsonb),
      coalesce((
        select jsonb_agg(
          jsonb_build_array(e.first_name || ' ' || e.last_name, coalesce(e.job_title, '')) ||
          coalesce((
            select jsonb_agg(
              to_jsonb(coalesce(
                latest.status,
                case
                  when t.applies_to_facility_type not in ('BOTH', e.facility_type) then 'not_applicable'
                  else 'no_record'
                end
              ))
              order by t.sort_order, t.name, t.id
            )
            from matrix_types t
            left join lateral (
              select r.status
              from public.employee_training_records r
              where r.employee_id = e.id
                and r.training_type_id = t.id
                and (p_facility_id is null or r.facility_id = p_facility_id)
              order by r.due_date desc nulls last, r.created_at desc, r.id desc
              limit 1
            ) latest on true
          ), '[]'::jsonb)
          order by e.last_name, e.first_name, e.id
        )
        from paged_employees e
      ), '[]'::jsonb),
      (select count(*) from matrix_types)
      into v_total, v_headers, v_rows, v_other;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Employees', 'value', v_total),
      jsonb_build_object('label', 'Training Types', 'value', v_other)
    );

  elsif p_report_id in ('practicum-status', 'annual-practicum') then
    with scoped as (
      select
        p.id,
        e.first_name,
        e.last_name,
        p.practicum_year,
        p.status,
        p.completion_date,
        p.due_date,
        p.observed_by,
        p.mar_review_completed,
        p.direct_observation_completed
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      coalesce((
        select jsonb_agg(
          case when p_report_id = 'annual-practicum'
            then jsonb_build_array(
              first_name || ' ' || last_name,
              practicum_year::text,
              status,
              coalesce(completion_date::text, ''),
              coalesce(observed_by, ''),
              case when mar_review_completed then 'Yes' else 'No' end,
              case when direct_observation_completed then 'Yes' else 'No' end
            )
            else jsonb_build_array(first_name || ' ' || last_name, practicum_year::text, status, coalesce(completion_date::text, ''))
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_rows;

    if p_report_id = 'annual-practicum' then
      v_headers := '["Employee","Year","Status","Completion Date","Observed By","MAR Review","Direct Observation"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Total Required', 'value', v_total),
        jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    else
      select count(*) into v_total_employees
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);
      v_headers := '["Employee","Year","Status","Completion Date"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    end if;

  elsif p_report_id in ('annual-hours', 'training-hours') then
    with scoped as (
      select
        b.id,
        e.first_name,
        e.last_name,
        b.bucket_type,
        b.training_year,
        b.required_hours,
        b.completed_hours,
        b.status,
        b.employee_id
      from public.employee_training_hour_buckets b
      join public.employees e on e.id = b.employee_id and not e.is_synthetic
      join public.facilities f on f.id = b.facility_id and not f.is_sandbox
      where (p_facility_id is null or b.facility_id = p_facility_id)
        and (p_date_from is null or b.training_year >= extract(year from p_date_from)::integer)
        and (p_date_to is null or b.training_year <= extract(year from p_date_to)::integer)
        and (p_report_id <> 'annual-hours' or p_date_from is not null or p_date_to is not null or b.training_year = v_current_year)
    ), paged as (
      select * from scoped
      order by training_year desc, last_name, first_name, bucket_type, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(distinct employee_id) from scoped),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          first_name || ' ' || last_name,
          case bucket_type when 'general_annual' then 'General Annual' when 'alr_dementia' then 'ALF Dementia (§2800.69)' when 'sdcu_dementia' then 'Secured Dementia Unit (§2600.236)' else bucket_type end,
          training_year::text,
          required_hours::text,
          completed_hours::text,
          greatest(0, required_hours - completed_hours)::text,
          status
        ) order by training_year desc, last_name, first_name, bucket_type, id)
        from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_total_employees, v_rows;
    v_headers := '["Employee","Bucket","Year","Required Hours","Completed Hours","Remaining","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Staff Tracked', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant Buckets', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Incomplete Buckets', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'employee-transcript' then
    if p_employee_id is null or not exists (
      select 1
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.id = p_employee_id and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ) then
      raise exception 'An employee in the caller scope is required for this report'
        using errcode = '22023';
    end if;

    with scoped as (
      select
        r.id,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status,
        r.trainer_name,
        r.hours,
        r.completion_method
      from public.employee_training_records r
      join public.training_types t on t.id = r.training_type_id
      where r.employee_id = p_employee_id
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date desc nulls last, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        training_type_name,
        coalesce(completion_date::text, ''),
        coalesce(due_date::text, ''),
        status,
        coalesce(trainer_name, ''),
        coalesce(hours::text, ''),
        replace(coalesce(completion_method, ''), '_', ' ')
      ) order by due_date desc nulls last, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_other
    from public.practicums p
    where p.employee_id = p_employee_id
      and (p_date_from is null or p.due_date >= p_date_from)
      and (p_date_to is null or p.due_date <= p_date_to);

    select jsonb_build_array(
      jsonb_build_object('label', 'Employee', 'value', e.first_name || ' ' || e.last_name),
      jsonb_build_object('label', 'Training Records', 'value', v_total),
      jsonb_build_object('label', 'Practicums', 'value', v_other)
    ) into v_summary
    from public.employees e
    where e.id = p_employee_id;
    v_headers := '["Training Type","Completion Date","Due Date","Status","Trainer","Hours","Method"]'::jsonb;

  elsif p_report_id = 'document-audit' then
    with scoped as (
      select
        d.id,
        d.file_name,
        d.document_type,
        d.created_at,
        p.first_name as uploader_first_name,
        p.last_name as uploader_last_name,
        d.uploaded_by_profile_id
      from public.training_documents d
      join public.facilities f on f.id = d.facility_id and not f.is_sandbox
      left join public.profiles p on p.id = d.uploaded_by_profile_id
      where (p_facility_id is null or d.facility_id = p_facility_id)
        and (p_date_from is null or d.created_at >= p_date_from::timestamptz)
        and (p_date_to is null or d.created_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by created_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        file_name,
        document_type,
        case when uploaded_by_profile_id is null then '' else trim(coalesce(uploader_first_name, '') || ' ' || coalesce(uploader_last_name, '')) end,
        created_at::text
      ) order by created_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status = 'missing' and r.document_required
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_headers := '["File Name","Type","Uploaded By","Created"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Documents', 'value', v_total),
      jsonb_build_object('label', 'Records Need Docs', 'value', v_missing, 'variant', case when v_missing > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'overdue-training' then
    with scoped as (
      select
        'training:' || r.id::text as row_id,
        e.first_name,
        e.last_name,
        e.job_title,
        'Training'::text as item_kind,
        t.name as item_name,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where r.status = 'expired'
        and (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
      union all
      select
        'practicum:' || p.id::text,
        e.first_name,
        e.last_name,
        e.job_title,
        'Practicum',
        'Annual Practicum ' || p.practicum_year::text,
        p.due_date,
        p.status
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where p.status = 'expired'
        and (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, row_id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        first_name || ' ' || last_name,
        coalesce(job_title, ''),
        item_kind,
        item_name,
        coalesce(due_date::text, ''),
        status
      ) order by due_date nulls last, last_name, first_name, row_id) from paged), '[]'::jsonb)
      into v_total, v_rows;
    v_headers := '["Employee","Job Title","Type","Item","Due Date","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Overdue Items', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'credential-status' then
    with scoped as (
      select
        c.id,
        e.first_name,
        e.last_name,
        c.credential_label,
        c.credential_type,
        c.credential_number,
        c.expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or c.expiration_date >= p_date_from)
        and (p_date_to is null or c.expiration_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by expiration_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        last_name || ', ' || first_name,
        coalesce(nullif(credential_label, ''), replace(credential_type, '_', ' ')),
        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No expiration'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Expiration","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Credentials', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'incident-log' then
    with scoped as (
      select i.id, i.occurred_at, f.name as facility_name, i.incident_type, i.severity, i.status
      from public.incidents i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.occurred_at >= p_date_from::timestamptz)
        and (p_date_to is null or i.occurred_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by occurred_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status <> 'closed'),
      (select count(*) from scoped where severity = 'critical'),
      coalesce((select jsonb_agg(jsonb_build_array(
        occurred_at::text,
        facility_name,
        replace(incident_type, '_', ' '),
        severity,
        status
      ) order by occurred_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_other, v_expired, v_rows;
    v_headers := '["Occurred","Facility","Type","Severity","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Incidents', 'value', v_total),
      jsonb_build_object('label', 'Open', 'value', v_other, 'variant', case when v_other > 0 then 'warning' else 'success' end),
      jsonb_build_object('label', 'Critical', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'incident-notification-register' then
    with scoped as (
      select
        n.id,
        i.occurred_at,
        i.incident_type,
        f.name as facility_name,
        n.notification_type,
        n.due_at,
        n.completed_at,
        n.notification_method,
        n.recipient,
        n.reference_number,
        n.status
      from public.incident_notifications n
      join public.incidents i on i.id = n.incident_id
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or n.due_at >= p_date_from::timestamptz)
        and (p_date_to is null or n.due_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by due_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'completed'),
      (select count(*) from scoped where status = 'overdue'),
      coalesce((select jsonb_agg(jsonb_build_array(
        replace(incident_type, '_', ' ') || ' (' || public.pa_day(occurred_at)::text || ')',
        facility_name,
        replace(notification_type, '_', ' '),
        due_at::text,
        coalesce(completed_at::text, ''),
        coalesce(notification_method, ''),
        coalesce(recipient, ''),
        coalesce(reference_number, ''),
        status
      ) order by due_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_rows;
    v_headers := '["Incident","Facility","Notification Type","Due","Completed","Method","Recipient","Reference #","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Notifications', 'value', v_total),
      jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'inspection-compliance' then
    with scoped as (
      select i.id, f.name as facility_name, i.label, i.item_type, i.next_due_date, i.status
      from public.inspection_items i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where i.is_active
        and (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.next_due_date >= p_date_from)
        and (p_date_to is null or i.next_due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by next_due_date nulls last, facility_name, label, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        facility_name,
        label,
        replace(item_type, '_', ' '),
        coalesce(next_due_date::text, '—'),
        status
      ) order by next_due_date nulls last, facility_name, label, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Facility","Item","Type","Next Due","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Items', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );
  end if;

  return jsonb_build_object(
    'headers', v_headers,
    'rows', v_rows,
    'summaryCards', v_summary,
    'totalRows', v_total,
    'pageSize', v_limit,
    'pageOffset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_rows) < v_total,
    'generatedAt', now()
  );
end;
$function$

;

-- public.get_resident_care_header
CREATE OR REPLACE FUNCTION public.get_resident_care_header(p_resident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_diet public.resident_dietary_profiles%rowtype;
  v_hospital public.hospital_transfer_episodes%rowtype;
  v_plan public.resident_support_plans%rowtype;
  v_pending public.resident_support_plans%rowtype;
  v_assessment_at date;
  v_assessment_label text;
  v_hospital_state text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident was not found or is outside caller scope' using errcode = 'P0002';
  end if;

  select * into v_facility from public.facilities where id = v_resident.facility_id;

  select * into v_diet from public.resident_dietary_profiles d
    where d.resident_id = v_resident.id
    order by d.effective_date desc, d.version desc limit 1;

  select * into v_hospital from public.hospital_transfer_episodes h
    where h.resident_id = v_resident.id and h.status <> 'canceled'
    order by h.transfer_time desc limit 1;

  select * into v_plan from public.resident_support_plans p
    where p.resident_id = v_resident.id
    order by (p.state = 'active') desc, p.version_number desc limit 1;

  -- The stalled one. The ordering above prefers the ACTIVE plan, which is right for "the plan in
  -- force" and is exactly why a newer approved-but-overdue plan was invisible on this surface.
  select * into v_pending from public.resident_support_plans p
    where p.resident_id = v_resident.id
      and p.state = 'approved'
      and p.effective_date is not null
      and p.effective_date <= public.pa_today()
    order by p.version_number desc limit 1;

  select c.completed_date,
         case c.item_type
           when 'preadmission_screening' then 'Preadmission screening'
           when 'initial_assessment_15day' then 'Initial assessment'
           when 'annual_reassessment' then 'Annual reassessment'
           when 'significant_change_reassessment' then 'Significant change reassessment'
           else c.item_type
         end
    into v_assessment_at, v_assessment_label
    from public.resident_compliance_items c
    where c.resident_id = v_resident.id
      and c.completed_date is not null
      and c.item_type in (
        'preadmission_screening', 'initial_assessment_15day',
        'annual_reassessment', 'significant_change_reassessment'
      )
    order by c.completed_date desc limit 1;

  if v_assessment_at is null then
    select public.pa_day(f.finalized_at), 'Digital ' || f.form_type || ' (' || f.reason || ')'
      into v_assessment_at, v_assessment_label
      from public.resident_assessment_forms f
      where f.resident_id = v_resident.id and f.status = 'finalized' and f.finalized_at is not null
      order by f.finalized_at desc limit 1;
  end if;

  v_hospital_state := case
    when v_hospital.id is null then 'in_facility'
    when v_hospital.status = 'out' then 'out_at_hospital'
    when v_hospital.status = 'returned'
      and v_hospital.return_time >= now() - interval '30 days'
      and (
        v_hospital.medication_reconciliation_status = 'pending'
        or v_hospital.changed_order_ack_status = 'pending_review'
      ) then 'returned_reconciliation_incomplete'
    else 'in_facility'
  end;

  return jsonb_build_object(
    'generatedAt', now(),
    'resident', jsonb_build_object(
      'id', v_resident.id,
      'firstName', v_resident.first_name,
      'lastName', v_resident.last_name,
      'preferredName', v_resident.preferred_name,
      'photoDocumentId', v_resident.photo_document_id,
      'room', v_resident.room,
      'status', v_resident.status,
      'admissionDate', v_resident.admission_date,
      'dischargeDate', v_resident.discharge_date,
      'hospice', v_resident.hospice,
      'sdcu', v_resident.sdcu
    ),
    'facility', case when v_facility.id is null then null else jsonb_build_object(
      'id', v_facility.id, 'name', v_facility.name, 'facilityType', v_facility.facility_type
    ) end,
    'care', jsonb_build_object(
      'levelOfCare', v_resident.level_of_care,
      'transferAssistance', v_resident.transfer_assistance,
      'ambulationStatus', v_resident.ambulation_status,
      'fallRisk', v_resident.fall_risk,
      'elopementRisk', v_resident.elopement_risk,
      'cognitiveStatus', v_resident.cognitive_status,
      'codeStatus', v_resident.code_status,
      'advanceDirectiveStatus', v_resident.advance_directive_status,
      'allergies', to_jsonb(v_resident.allergies),
      'foodAllergies', to_jsonb(v_resident.food_allergies),
      'mobilitySummary', v_resident.mobility_summary,
      'supervisionRequirements', v_resident.supervision_requirements,
      'asOf', v_resident.care_profile_reviewed_at
    ),
    'diet', case when v_diet.id is null then null else jsonb_build_object(
      'dietOrder', coalesce(v_diet.diet_order, v_diet.prescribed_diet),
      'textureConsistency', v_diet.texture_consistency,
      'liquidConsistency', v_diet.liquid_consistency,
      'asOf', v_diet.effective_date
    ) end,
    'hospital', jsonb_build_object(
      'state', v_hospital_state,
      'episodeId', case when v_hospital_state = 'in_facility' then null else v_hospital.id end,
      'destination', case when v_hospital_state = 'in_facility' then null else v_hospital.destination end,
      'since', case
        when v_hospital_state = 'out_at_hospital' then v_hospital.transfer_time
        when v_hospital_state = 'returned_reconciliation_incomplete' then v_hospital.return_time
        else null end,
      'expectedReturnAt', case when v_hospital_state = 'out_at_hospital' then v_hospital.expected_return_at else null end
    ),
    'lastAssessment', case when v_assessment_at is null then null else jsonb_build_object(
      'completedOn', v_assessment_at, 'label', v_assessment_label
    ) end,
    'supportPlan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'versionNumber', v_plan.version_number,
      'state', v_plan.state,
      'effectiveDate', v_plan.effective_date,
      'reviewDueDate', v_plan.review_due_date
    ) end,
    -- Null in the normal case: the scheduled promotion ran and nothing is overdue.
    'pendingActivation', case when v_pending.id is null then null else jsonb_build_object(
      'id', v_pending.id,
      'versionNumber', v_pending.version_number,
      'effectiveDate', v_pending.effective_date
    ) end
  );
end;
$function$

;

-- public.complete_hospital_return_reconciliation
CREATE OR REPLACE FUNCTION public.complete_hospital_return_reconciliation(p_episode_id uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.hospital_transfer_episodes%rowtype;
  v_outstanding text[] := array[]::text[];
  v_review_final boolean;
  v_plan_revised boolean;
begin
  select * into v from public.hospital_transfer_episodes where id = p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'returned' then
    raise exception 'Only a returned episode can be reconciled' using errcode = '22023';
  end if;

  if v.discharge_document_id is null then
    v_outstanding := v_outstanding || 'discharge paperwork';
  end if;
  if v.medication_reconciliation_status not in ('completed', 'authorized_exception', 'not_applicable') then
    v_outstanding := v_outstanding || 'medication reconciliation';
  end if;
  if v.changed_order_ack_status not in ('acknowledged', 'not_applicable') then
    v_outstanding := v_outstanding || 'physician order acknowledgement';
  end if;

  if v.assessment_review_required then
    select exists (
      select 1 from public.resident_assessment_reviews r
      where r.hospital_episode_id = v.id and r.status = 'final'
    ) into v_review_final;
    if not coalesce(v_review_final, false) then
      v_outstanding := v_outstanding || 'hospital-return assessment review';
    end if;
  end if;

  if v.support_plan_review_required then
    -- Either a plan that took effect after the return, or one still in flight being revised because
    -- of it. Requiring an *active* plan would block closure while the revision is legitimately in
    -- clinical review.
    select exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id
        and (
          (p.state = 'active' and p.effective_date >= public.pa_day(v.return_time))
          or p.state in ('draft','awaiting_clinical_review','awaiting_participation','awaiting_signature','approved')
        )
    ) into v_plan_revised;
    if not coalesce(v_plan_revised, false) then
      v_outstanding := v_outstanding || 'support-plan revision';
    end if;
  end if;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Hospital return cannot be closed while these remain outstanding: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.work_items set
    state = 'closed',
    closure_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Hospital-return reconciliation completed'), 1000),
    closed_at = now(),
    updated_at = now()
  where id = v.return_work_item_id and state not in ('closed', 'canceled');

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'hospital_transfer_episode', v.id::text,
    'hospital_transfer.reconciliation_completed',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $function$

;

