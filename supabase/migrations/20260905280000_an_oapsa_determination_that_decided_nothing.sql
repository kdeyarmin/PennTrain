-- I26 (4): an OAPSA determination that decided nothing.
--
-- employee_background_check_profiles carries the two states in which 6 Pa.C.S. Ch. 5 says a
-- facility may not employ a person: a suitability determination of `not_suitable`, and a
-- provisional employment period that has run out without the clearances arriving. Both were
-- recorded, both were rendered on Survey Day views, and neither stopped anything -- no alert, no
-- work item, and nothing in evaluate_schedule_eligibility or evaluate_duty_eligibility. An
-- administrator could mark someone not suitable and the scheduler would offer them the next shift.
--
-- Three separate defects, all on the same row:
--
--   1. The provisional window was computed in the browser, in BackgroundChecks.tsx, as
--      `paResident === true ? resident(30) : nonresident(90)`. So an employee whose Pennsylvania
--      residency is UNKNOWN -- the default for a profile nobody has completed -- was given the
--      LONGER window, the one that exists for an applicant established as a non-resident and
--      awaiting an FBI check. Unknown residency now takes the shorter of the two windows until
--      somebody records which applies, and the derivation moves to a trigger, because the length
--      of a statutory employment window is not a thing a form should be deciding.
--   2. Neither eligibility gate read the profile at all.
--   3. Nothing watched the clock. A provisional period expires by the calendar passing, so with no
--      sweep there was no moment at which anything happened.
--
-- Not addressed here, and still on the BACKLOG row: the five-year clearance recertification
-- cadence. That is a new requirement with its own renewal surface rather than a gate on an
-- existing one, and inventing a due date for it from the data now on hand would be guessing.

------------------------------------------------------------------------------------------------
-- 1. The window, derived on the server
------------------------------------------------------------------------------------------------

create or replace function public.oapsa_provisional_window_days(
  p_pa_resident_two_years boolean,
  p_organization_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $function$
  -- 30 days for an applicant who has been a Pennsylvania resident for the two preceding years, 90
  -- for one who has not and is awaiting the federal check; both configurable per organization.
  -- Unknown residency is not the same as established non-residency: the longer window is an
  -- entitlement that has to be established, so until it is, the shorter one applies. `least` rather
  -- than the literal resident value, so an organization that configures the two the other way
  -- round still gets the conservative answer.
  select case
    when p_pa_resident_two_years is true then coalesce(s.oapsa_provisional_days_resident, 30)
    when p_pa_resident_two_years is false then coalesce(s.oapsa_provisional_days_nonresident, 90)
    else least(coalesce(s.oapsa_provisional_days_resident, 30),
               coalesce(s.oapsa_provisional_days_nonresident, 90))
  end
  from (
    select os.oapsa_provisional_days_resident, os.oapsa_provisional_days_nonresident
    from public.organization_settings os
    where os.organization_id = p_organization_id
    union all
    select 30, 90
    limit 1
  ) s;
$function$;

comment on function public.oapsa_provisional_window_days(boolean, uuid) is
  'Length in days of the OAPSA provisional employment window. Unknown Pennsylvania residency takes '
  'the shorter window: the longer one is an entitlement that has to be established.';

revoke all on function public.oapsa_provisional_window_days(boolean, uuid) from public, anon;
grant execute on function public.oapsa_provisional_window_days(boolean, uuid)
  to authenticated, service_role;

create or replace function public.derive_oapsa_provisional_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- The client used to send this value. It is a statutory window, so it is derived here and the
  -- submitted value is ignored: no form, and no future form, can widen it by sending a number.
  if new.provisional_start_date is null then
    new.provisional_max_days := null;
  else
    new.provisional_max_days := public.oapsa_provisional_window_days(
      new.pa_resident_two_years, new.organization_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.derive_oapsa_provisional_window() from public, anon, authenticated;

drop trigger if exists derive_oapsa_provisional_window on public.employee_background_check_profiles;
create trigger derive_oapsa_provisional_window
before insert or update on public.employee_background_check_profiles
for each row execute function public.derive_oapsa_provisional_window();

-- Existing rows were written under the browser's rule. Recompute rather than leave a mixture:
-- a profile with unknown residency is currently carrying a 90-day window it was never entitled to.
do $$
declare v_widened integer;
begin
  select count(*) into v_widened
  from public.employee_background_check_profiles p
  where p.provisional_start_date is not null
    and p.provisional_max_days is distinct from
        public.oapsa_provisional_window_days(p.pa_resident_two_years, p.organization_id);

  update public.employee_background_check_profiles p
  set provisional_max_days = case
    when p.provisional_start_date is null then null
    else public.oapsa_provisional_window_days(p.pa_resident_two_years, p.organization_id)
  end
  where p.provisional_max_days is distinct from (case
    when p.provisional_start_date is null then null
    else public.oapsa_provisional_window_days(p.pa_resident_two_years, p.organization_id)
  end);

  raise notice 'OAPSA provisional windows recomputed; % profile(s) had a window the rule does not give them.',
    v_widened;
end $$;

------------------------------------------------------------------------------------------------
-- 2. One reading of the two states, for both gates
------------------------------------------------------------------------------------------------

create or replace function public.oapsa_duty_status(
  p_employee_id uuid,
  p_as_of date default null
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  -- Returned rather than raised, and shaped the same whether or not a profile exists, so a caller
  -- can render the countdown as easily as it can read the bar. `bar` is null when the employee may
  -- work; `daysRemaining` is large-and-meaningless when no provisional period is running, which is
  -- what lets the callers test it without first testing for null.
  select jsonb_build_object(
    'bar', case
      when p.suitability_determination = 'not_suitable' then 'not_suitable'
      when p.provisional_start_date is not null
        and p.provisional_max_days is not null
        and (p.provisional_start_date + p.provisional_max_days) < coalesce(p_as_of, public.pa_today())
        then 'provisional_expired'
      else null
    end,
    'suitabilityDetermination', coalesce(p.suitability_determination, 'pending'),
    'expiresOn', case
      when p.provisional_start_date is not null and p.provisional_max_days is not null
        then p.provisional_start_date + p.provisional_max_days
      else null
    end,
    'daysRemaining', case
      when p.provisional_start_date is not null and p.provisional_max_days is not null
        then (p.provisional_start_date + p.provisional_max_days) - coalesce(p_as_of, public.pa_today())
      else 2147483647
    end
  )
  from (
    select bp.suitability_determination, bp.provisional_start_date, bp.provisional_max_days
    from public.employee_background_check_profiles bp
    where bp.employee_id = p_employee_id
    union all
    select null::text, null::date, null::integer
    limit 1
  ) p;
$function$;

comment on function public.oapsa_duty_status(uuid, date) is
  'The two OAPSA states that bar employment -- a not_suitable determination and a lapsed '
  'provisional period -- plus the countdown, read once for both eligibility gates.';

revoke all on function public.oapsa_duty_status(uuid, date) from public, anon;
grant execute on function public.oapsa_duty_status(uuid, date) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. Both gates read it
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched, not retyped.

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
  v_oapsa jsonb;
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
  -- OAPSA (6 Pa.C.S. Ch. 5). A not-suitable determination and a lapsed provisional period are the
  -- two states in which the facility may not put this person on a shift at all; before this they
  -- were recorded on the background-check profile, rendered on Survey Day views, and stopped
  -- nothing. Both are computed by public.oapsa_duty_status so the schedule and the duty gate
  -- cannot disagree about them.
  v_oapsa := public.oapsa_duty_status(p_employee_id, public.pa_day(p_starts_at));
  if v_oapsa->>'bar' = 'not_suitable' then
    v_blocks := array_append(v_blocks, 'oapsa_not_suitable');
  elsif v_oapsa->>'bar' = 'provisional_expired' then
    v_blocks := array_append(v_blocks, 'oapsa_provisional_expired');
  elsif (v_oapsa->>'daysRemaining')::integer <= 14 then
    -- The last two weeks of a provisional period are when the clearances have to arrive. A warning
    -- rather than a block: the person may still work, and the scheduler is the one who needs to
    -- know the window is closing.
    v_warnings := array_append(v_warnings, 'oapsa_provisional_expiring');
  end if;
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
    -- oapsa_not_suitable joins the non-overridable set: it is a determination somebody in this
    -- organization made and recorded, so the way to undo it is to change the determination, with
    -- the attestation trail that carries, rather than to schedule around it. A lapsed provisional
    -- period is overridable, because the commonest cause is a clearance that arrived and has not
    -- been filed yet, and an override is an auditable record of exactly that claim.
    if v_block in ('lifecycle_inactive', 'confirmed_exclusion', 'oapsa_not_suitable') then
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
    'oapsa', v_oapsa,
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
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_duty_eligibility(p_profile_id uuid, p_duty_key text, p_facility_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule public.duty_eligibility_rules%rowtype;
  v_profile public.profiles%rowtype;
  v_employee_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override public.duty_eligibility_overrides%rowtype;
  v_qualified boolean := false;
  v_oapsa jsonb;
  v_oapsa_employee_id uuid;
  v_key text;
  v_outcome text;
begin
  -- Out-of-tenant subjects get the same shape back with no facts in it: the blocks and warnings
  -- arrays are what would otherwise disclose another organisation's credential state.
  if not app_private.profile_in_caller_scope(p_profile_id) then
    return jsonb_build_object('dutyKey', p_duty_key, 'outcome', 'ineligible',
                              'blocks', jsonb_build_array('out_of_scope'),
                              'warnings', jsonb_build_array(), 'overrides', jsonb_build_array());
  end if;
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'blocked',
      'blocks', to_jsonb(array['profile_not_found']),
      'warnings', '[]'::jsonb,
      'overrideId', null
    );
  end if;

  -- Organization rule first, platform default second.
  select * into v_rule from public.duty_eligibility_rules
  where duty_key = p_duty_key and is_active
    and (organization_id = v_profile.organization_id or organization_id is null)
  order by organization_id nulls last
  limit 1;
  if not found then
    -- An unknown duty is not silently permitted; it is reported so the caller can see the rule is
    -- missing rather than assuming it passed.
    return jsonb_build_object(
      'outcome', 'warning',
      'blocks', '[]'::jsonb,
      'warnings', to_jsonb(array['no_rule_configured']),
      'overrideId', null
    );
  end if;

  if not v_profile.is_active then
    v_blocks := array_append(v_blocks, 'profile_inactive');
  end if;

  -- OAPSA, on the same two states the schedule gate reads. Resolved here from the profile rather
  -- than taken as an argument, because a duty is performed by a person and the bar attaches to the
  -- person, not to the rule. An employee record is looked up whenever the facility is known --
  -- previously that happened only when the rule listed qualifications, so a rule with none skipped
  -- the lookup entirely and there was nowhere for this to hang.
  -- Deliberately NOT keyed on employees.facility_id. That column is the person's PRIMARY facility,
  -- so a float employee performing a duty at a facility they hold through
  -- employee_facility_assignments resolved to no employee row at all and skipped the bar outright --
  -- an OAPSA `not_suitable` determination stopped nothing at their second site. profile_id is
  -- UNIQUE on employees, so the person is identified without the facility, which is the right
  -- shape: the bar attaches to the person, not to where they are standing.
  select e.id into v_oapsa_employee_id
  from public.employees e
  where e.profile_id = p_profile_id
  limit 1;
  if v_oapsa_employee_id is not null then
    v_oapsa := public.oapsa_duty_status(v_oapsa_employee_id, public.pa_day(p_at));
    if v_oapsa->>'bar' = 'not_suitable' then
      v_blocks := array_append(v_blocks, 'oapsa_not_suitable');
    elsif v_oapsa->>'bar' = 'provisional_expired' then
      v_blocks := array_append(v_blocks, 'oapsa_provisional_expired');
    elsif (v_oapsa->>'daysRemaining')::integer <= 14 then
      v_warnings := array_append(v_warnings, 'oapsa_provisional_expiring');
    end if;
  end if;

  if cardinality(v_rule.accepted_roles) > 0
     and not (v_profile.role = any(v_rule.accepted_roles) or v_profile.role = 'platform_admin') then
    v_blocks := array_append(v_blocks, 'role_not_accepted');
  end if;

  if cardinality(v_rule.accepted_qualification_keys) > 0 then
    select e.id into v_employee_id
    from public.employees e
    where e.profile_id = p_profile_id and e.facility_id = p_facility_id
    limit 1;

    if v_employee_id is null then
      -- No employee record at this facility means there is nothing to check the qualification
      -- against. Reported, never treated as a pass.
      v_warnings := array_append(v_warnings, 'no_employee_record_for_qualification_check');
    else
      foreach v_key in array v_rule.accepted_qualification_keys loop
        if public.employee_has_active_qualification(v_employee_id, v_key, p_at) then
          v_qualified := true;
          exit;
        end if;
      end loop;
      if not v_qualified then
        v_blocks := array_append(v_blocks, 'qualification_missing');
      end if;
    end if;
  end if;

  -- A rule set to 'warn' still reports what it found; it just does not stop the action. It governs
  -- the rule's own checks, though -- an organization softening its own duty rule cannot thereby
  -- soften a statutory employment bar, so the OAPSA codes are held back and put straight again.
  if v_rule.enforcement = 'warn' and cardinality(v_blocks) > 0 then
    declare v_statutory text[] := array(
      select b from unnest(v_blocks) b
      where b in ('oapsa_not_suitable', 'oapsa_provisional_expired'));
    begin
      v_warnings := v_warnings || array(
        select b from unnest(v_blocks) b
        where b not in ('oapsa_not_suitable', 'oapsa_provisional_expired'));
      v_blocks := v_statutory;
    end;
  end if;

  if cardinality(v_blocks) > 0 then
    select * into v_override from public.duty_eligibility_overrides o
    where o.profile_id = p_profile_id
      and o.duty_key = p_duty_key
      and o.facility_id = p_facility_id
      and o.revoked_at is null
      and o.granted_at <= p_at
      and o.expires_at > p_at
    order by o.expires_at desc
    limit 1;
    if found then
      -- Same reasoning: a duty override is an operational instrument, not a waiver of OAPSA.
      v_warnings := v_warnings || array(
        select b from unnest(v_blocks) b
        where b not in ('oapsa_not_suitable', 'oapsa_provisional_expired')) || array['override_applied'];
      v_blocks := array(
        select b from unnest(v_blocks) b
        where b in ('oapsa_not_suitable', 'oapsa_provisional_expired'));
    end if;
  end if;

  v_outcome := case
    when cardinality(v_blocks) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 then 'warning'
    else 'eligible'
  end;

  return jsonb_build_object(
    'outcome', v_outcome,
    'blocks', to_jsonb(array(select distinct x from unnest(v_blocks) x order by x)),
    'warnings', to_jsonb(array(select distinct x from unnest(v_warnings) x order by x)),
    'overrideId', v_override.id,
    'dutyKey', p_duty_key,
    'enforcement', v_rule.enforcement
  );
end $function$;

------------------------------------------------------------------------------------------------
-- 4. Something watches the clock
------------------------------------------------------------------------------------------------

-- schedule_eligibility_overrides already refuses to hold a row for the two block codes the
-- evaluator will not override. oapsa_not_suitable belongs in that list for the same reason: the way
-- to undo a suitability determination is to change the determination, with the attestation trail
-- that carries. Enforcing it here as well as in the evaluator means the row cannot be written at
-- all, rather than written and quietly ignored.
alter table public.schedule_eligibility_overrides
  drop constraint schedule_eligibility_overrides_block_code_check;
alter table public.schedule_eligibility_overrides
  add constraint schedule_eligibility_overrides_block_code_check check (
    block_code <> all (array['lifecycle_inactive', 'confirmed_exclusion', 'oapsa_not_suitable'])
  );

alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (
  alert_type = any (array[
    'due_90', 'due_60', 'due_30', 'due_14', 'due_7', 'overdue', 'missing_document',
    'course_assigned', 'certificate_expiring', 'external_cert_pending_review', 'competency_due',
    'training_plan_assigned', 'inservice_scheduled', 'credential_expiring',
    'incident_notification_overdue', 'corrective_action_overdue', 'inspection_due',
    'exclusion_match_found', 'resident_compliance_due_soon', 'oapsa_provisional_expiring'
  ])
);

create or replace function public.run_oapsa_provisional_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_raised integer := 0; v_escalated integer := 0; v_resolved integer := 0;
begin
  -- One alert per employee, escalated in place rather than duplicated, and resolved when the
  -- provisional period ends -- the same shape as inspection_due. A provisional period ends either
  -- because the clearances arrived (the dates are cleared) or because the person left.
  insert into public.alerts (
    organization_id, facility_id, employee_id, alert_type, title, message, severity, status
  )
  select p.organization_id, p.facility_id, p.employee_id, 'oapsa_provisional_expiring',
    'Provisional employment period ending — ' || e.first_name || ' ' || e.last_name,
    'The OAPSA provisional period ends ' || to_char(p.provisional_start_date + p.provisional_max_days, 'FMMonth FMDD, YYYY')
      || '. Without the required clearances on file by then this employee may not continue working.',
    case when (p.provisional_start_date + p.provisional_max_days) < public.pa_today()
      then 'critical' else 'warning' end,
    'open'
  from public.employee_background_check_profiles p
  join public.employees e on e.id = p.employee_id
  where p.provisional_start_date is not null
    and p.provisional_max_days is not null
    and e.status = 'active'
    and (p.provisional_start_date + p.provisional_max_days) <= public.pa_today() + 14
    and not exists (
      select 1 from public.alerts a
      where a.employee_id = p.employee_id
        and a.alert_type = 'oapsa_provisional_expiring'
        and a.status = 'open'
    );
  get diagnostics v_raised = row_count;

  -- Escalation happens in place: the alert an administrator has already seen keeps its identity.
  update public.alerts a
  set severity = 'critical', escalated_at = coalesce(a.escalated_at, now())
  from public.employee_background_check_profiles p
  where a.employee_id = p.employee_id
    and a.alert_type = 'oapsa_provisional_expiring'
    and a.status = 'open'
    and a.severity <> 'critical'
    and p.provisional_start_date is not null
    and p.provisional_max_days is not null
    and (p.provisional_start_date + p.provisional_max_days) < public.pa_today();
  get diagnostics v_escalated = row_count;

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  where a.alert_type = 'oapsa_provisional_expiring'
    and a.status = 'open'
    and not exists (
      select 1 from public.employee_background_check_profiles p
      join public.employees e on e.id = p.employee_id
      where p.employee_id = a.employee_id
        and e.status = 'active'
        and p.provisional_start_date is not null
        and p.provisional_max_days is not null
    );
  get diagnostics v_resolved = row_count;

  raise notice 'OAPSA provisional maintenance: % raised, % escalated, % resolved.',
    v_raised, v_escalated, v_resolved;
end;
$function$;

comment on function public.run_oapsa_provisional_maintenance() is
  'Daily sweep for OAPSA provisional periods ending or ended. Runs inside the '
  'compliance-requirement-maintenance job.';

revoke all on function public.run_oapsa_provisional_maintenance() from public, anon, authenticated;
grant execute on function public.run_oapsa_provisional_maintenance() to service_role;

CREATE OR REPLACE FUNCTION public.execute_registered_sql_job(p_job_key text, p_correlation_id text, p_trigger_type text DEFAULT 'scheduled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim record;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_claim
  from public.claim_system_job_execution(
    p_job_key, p_correlation_id, p_trigger_type, null
  );
  if not coalesce(v_claim.should_execute, false) then
    return jsonb_build_object('replayed', true, 'runId', v_claim.run_id);
  end if;

  begin
    case p_job_key
      when 'compliance-recalculation' then perform public.recalculate_all_compliance();
      when 'incident-notifications' then perform public.recalculate_incident_notifications();
      when 'alert-escalation' then perform public.escalate_unactioned_alerts();
      when 'monday-digest' then perform public.send_monday_digest();
      when 'policy-reminders' then perform public.send_policy_attestation_reminders();
      when 'course-status-recalculation' then perform public.recalculate_course_assignment_statuses();
      when 'course-continuation-reminders' then perform public.queue_course_continuation_reminders();
      when 'resident-compliance-recalculation' then perform public.recalculate_resident_compliance_statuses();
      when 'resident-compliance-reminders' then perform public.send_resident_compliance_reminders();
      -- The nineteen that used to be registered as their own SQL statement (BACKLOG.md I17
      -- residual). Their cron entries now call this wrapper like the rest, so the kill switch,
      -- the run ledger and the replay guard cover them too. Arguments live here rather than in
      -- the cron command, which is what makes every entry identical and reviewable at a glance.
      when 'billing-trial-expiry' then perform app_private.enqueue_trial_expiry_notices();
      when 'carebase-report-subscriptions' then perform public.process_due_report_schedules();
      when 'change-followup-escalation' then perform public.escalate_overdue_change_follow_ups();
      when 'compliance-requirement-maintenance' then
        -- Three statements in one cron command, which is why this one could not be swept
        -- mechanically: all three are the job, and running one without the others leaves the
        -- readiness forecast and the invitation lifecycle a day behind the requirements.
        perform public.run_compliance_requirement_maintenance();
        perform public.run_workforce_readiness_forecast_maintenance();
        perform public.reconcile_user_invitation_lifecycle();
        -- Fourth statement, added with the OAPSA gates: the provisional clock is a date, so
        -- nothing moves it but the calendar and nothing notices it but a sweep.
        perform public.run_oapsa_provisional_maintenance();
      when 'course-assignment-due-reminders' then perform public.queue_course_assignment_due_reminders();
      when 'fhir-integration-freshness' then perform public.run_fhir_integration_freshness_evaluator();
      when 'integration-command-inbox-drain' then perform app_private.drain_integration_command_inbox(20);
      when 'manager-weekly-digest' then perform public.queue_manager_weekly_digests();
      when 'medication-integration-freshness' then perform public.run_medication_integration_freshness_evaluator();
      when 'plan-of-correction-escalation' then perform public.run_plan_of_correction_escalations();
      when 'policy-campaign-recurrence' then perform public.spawn_due_policy_campaign_cycles();
      when 'policy-campaign-targeting' then perform public.run_policy_campaign_targeting();
      when 'public-demo-baseline-restore' then perform app_private.restore_all_demo_baselines();
      when 'resident-service-task-generation' then
        perform public.generate_resident_service_tasks(
          public.pa_today(), public.pa_today() + 14, null);
      when 'shift-handoff-escalation' then perform public.run_shift_handoff_escalations();
      when 'support-plan-activation' then perform public.activate_due_support_plans();
      when 'survey-day-session-expiry' then perform public.expire_stale_survey_day_sessions();
      when 'work-item-escalation' then perform public.escalate_overdue_work_items();
      when 'work-item-registration' then perform public.register_outstanding_work_items();
      when 'audit-integrity-reconciliation' then
        v_result := public.reconcile_audit_integrity(10000);
        if coalesce((v_result ->> 'openIssues')::integer, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'audit_integrity_issues',
            left('Audit integrity reconciliation found open issues: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      when 'phase1-synthetic-health' then
        v_result := public.run_phase1_synthetic_checks();
        if coalesce((v_result ->> 'completedAssignmentsWithoutCertificate')::bigint, 0) > 0
           or coalesce((v_result ->> 'certificatePdfJobsExhausted')::bigint, 0) > 0
           or coalesce((v_result ->> 'notificationOutcomesUnknown')::bigint, 0) > 0
           or coalesce((v_result ->> 'exclusionSourcesWithoutActiveSnapshot')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditIntegrityIssuesOpen')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditTriggerGaps')::bigint, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'synthetic_invariant_violation',
            left('Phase 1 synthetic checks found invariant violations: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      else
        raise exception 'Job is not a registered SQL worker' using errcode = '22023';
    end case;

    perform public.finish_system_job(
      v_claim.run_id, 'succeeded', 1, 1, 0, v_result, null, null
    );
    return v_result || jsonb_build_object('runId', v_claim.run_id);
  exception when others then
    perform public.finish_system_job(
      v_claim.run_id, 'failed', 1, 0, 1, v_result,
      sqlstate, left(sqlerrm, 2000)
    );
    -- Re-raising would abort the cron transaction and roll the failed run
    -- record back with it. Keep failure evidence durable for alerting/retry.
    return jsonb_build_object(
      'runId', v_claim.run_id,
      'status', 'failed',
      'errorCode', sqlstate,
      'errorMessage', left(sqlerrm, 2000)
    );
  end;
end;
$function$;

-- The sweep has never run, so every provisional period already inside its last fortnight is
-- currently silent. Raise those now rather than waiting for tonight.
select public.run_oapsa_provisional_maintenance();
