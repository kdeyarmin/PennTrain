-- A closed incident file that could still be rewritten, a bed a cancelled reservation never
-- released, a retraining action lost to a unique index, alerts for people who no longer work here,
-- and no way to stop the email.
--
-- BACKLOG J63, J64, J58, J72, J79, and the reserved-bed half of J3.
--
-- J64. Investigation findings, root cause and the final-report date are written on blur through a
-- plain table UPDATE. `incidents_update` carries no status condition, and
-- `protect_incident_workflow_columns` guards approval, reportability and reopening only -- so a
-- closed, administrator-approved incident file could be rewritten afterwards, silently, by any
-- facility manager. That is a regulated investigation record: the whole point of closing it is
-- that what it says stops changing. Making the inputs read-only in the page is the affordance;
-- this is the rule.
--
-- The reserved-bed half of J3. `transition_resident_census` releases a bed only
-- `where id = v.bed_id and occupied_by_resident_id = v.id`. A RESERVED bed has
-- `occupied_by_resident_id` null and `reserved_for_prospect_id` set, so cancelling a reserved
-- resident left the bed reserved for somebody who is never arriving, and nothing in the product
-- could release it.
--
-- J58. `create_violation_retraining_action` bare-inserts a `course_assignments` row. The
-- one-open-assignment index added by 20260905060000 refuses that whenever the employee already
-- holds the course open -- and retraining after a citation is nearly always the annual course
-- everybody already has. The call raises 23505, the corrective action is never written, and the
-- manager sees the raw constraint name.
--
-- J72. The nightly recalculation walks every practicum, training record and credential belonging
-- to a TERMINATED employee, expires them and files critical alerts against them. Nobody can clear
-- those: the person has left. Meanwhile the compliance matrix and the organization dashboard both
-- filter to active staff, so three surfaces disagree about the same facility.
--
-- J79. `profiles.email_opt_out` is honoured by the whole delivery pipeline and written by exactly
-- one thing: the SendGrid consent webhook, which only fires if SendGrid injects an unsubscribe
-- link that the payload never asks for. An employee who wants the product to stop emailing them
-- has no control at all. `p_email_opt_out` gives the preferences RPC the writer it never had.
--
-- J63. `create_complaint` resolves the resident row and then inserts the incident with the name as
-- a STRING and no `resident_id`, so the incident loses its resident-linked stages, falls-by-
-- resident trend attribution, and the DOB and room the state form prints.

-- ---------------------------------------------------------------------------
-- J64 -- a closed investigation record stops changing
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'protect_incident_workflow_columns';
  if v_def is null then raise exception 'public.protect_incident_workflow_columns is missing'; end if;

  v_old := '    -- Reopening is legitimate';
  -- Dollar-quoted rather than single-quoted so the RAISE inside reads as a RAISE to
  -- check-raise-arity.mjs, which scans this file as text: doubled quotes around a message
  -- make its format-string regex run past the end of the literal.
  v_new := $patch$    -- BACKLOG J64. A closed incident's content is the record. The page writes findings, root
    -- cause and the final-report date on blur through a plain table UPDATE, RLS carries no status
    -- condition, and this trigger guarded only approval, reportability and reopening -- so a
    -- closed, approved investigation could be rewritten afterwards by any facility manager, with
    -- no trace beyond the audit row. Reopen it first if it genuinely needs to change; that is an
    -- administrator's decision and it is visible.
    if old.status = 'closed' and new.status = 'closed'
       and (new.investigation_findings is distinct from old.investigation_findings
         or new.root_cause is distinct from old.root_cause
         or new.root_cause_method is distinct from old.root_cause_method
         or new.narrative is distinct from old.narrative
         or new.immediate_response is distinct from old.immediate_response
         or new.severity is distinct from old.severity
         or new.incident_type is distinct from old.incident_type
         or new.occurred_at is distinct from old.occurred_at
         or new.resident_id is distinct from old.resident_id
         or new.final_report_submitted_at is distinct from old.final_report_submitted_at) then
      raise exception 'A closed incident file cannot be edited. An organization administrator can reopen it if it has to change.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Reopening is legitimate$patch$;
  if position(v_old in v_def) = 0 then
    raise exception 'protect_incident_workflow_columns no longer contains the reopening comment this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

comment on function public.protect_incident_workflow_columns() is
  'Keeps the incident workflow columns in the hands of the RPCs that own them, and freezes a '
  'closed incident''s content: findings, root cause, narrative, immediate response, severity, '
  'type, time, resident and final-report date cannot change while status is closed (BACKLOG J64). '
  'Reopening remains an organization administrator''s decision, and is the way a closed file '
  'legitimately changes.';

-- ---------------------------------------------------------------------------
-- J3 (reserved-bed half) -- cancelling a reservation gives the bed back
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'transition_resident_census';
  if v_def is null then raise exception 'public.transition_resident_census is missing'; end if;

  v_old := '    where id = v.bed_id and occupied_by_resident_id = v.id;';
  v_new := '    where id = v.bed_id
      -- BACKLOG J3. `occupied_by_resident_id = v.id` alone never matched a RESERVED bed, whose
      -- occupant column is null and whose hold is in reserved_for_prospect_id. Cancelling a
      -- reserved resident therefore left the bed reserved for somebody who is not coming, and
      -- nothing in the product could release it.
      and (occupied_by_resident_id = v.id
        or (occupied_by_resident_id is null and reserved_for_prospect_id = v.id));';
  if position(v_old in v_def) = 0 then
    raise exception 'transition_resident_census no longer contains the bed-release predicate this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '    update public.facility_beds set status = ''available'', occupied_by_resident_id = null,
      expected_vacancy_date = null, updated_at = now()';
  v_new := '    update public.facility_beds set status = ''available'', occupied_by_resident_id = null,
      reserved_for_prospect_id = null, expected_vacancy_date = null, updated_at = now()';
  if position(v_old in v_def) = 0 then
    raise exception 'transition_resident_census no longer contains the bed-release update this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

-- ---------------------------------------------------------------------------
-- J58 -- retraining reuses the assignment the employee already has
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_violation_retraining_action';
  if v_def is null then raise exception 'public.create_violation_retraining_action is missing'; end if;

  if position('v_existing_assignment' in v_def) > 0 then
    raise notice 'create_violation_retraining_action already reuses an open assignment';
  else
    v_old := '  insert into public.course_assignments';
    v_new := '  -- BACKLOG J58. 20260905060000 added a partial unique index that allows one OPEN assignment
  -- per (employee, course). Retraining after a citation is almost always the annual course the
  -- aide already holds, so this bare insert raised 23505, the corrective action was never
  -- written, and the manager saw the raw constraint name. Reuse the open assignment instead --
  -- pulling its due date forward if the citation''s is sooner, because that is what the plan of
  -- correction commits the facility to -- and insert only when there is none.
  select id into v_existing_assignment
  from public.course_assignments
  where employee_id = p_employee_id
    and course_id = p_course_id
    -- Exactly the states course_assignments_one_open_per_course_idx treats as open.
    and status = any(array[''assigned'', ''in_progress'', ''overdue'', ''paused''])
  order by created_at desc
  limit 1;

  if v_existing_assignment is not null then
    update public.course_assignments
    set due_date = least(due_date, p_due_date), updated_at = now()
    where id = v_existing_assignment;
    v_assignment_id := v_existing_assignment;
  else
  insert into public.course_assignments';
    if position(v_old in v_def) = 0 then
      raise exception 'create_violation_retraining_action no longer contains the assignment insert this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- Close the else-branch, and declare the variable.
    v_old := 'returning id into v_assignment_id;';
    v_new := 'returning id into v_assignment_id;
  end if;';
    if position(v_old in v_def) = 0 then
      raise exception 'create_violation_retraining_action no longer returns the assignment id this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    v_old := 'declare';
    v_new := 'declare
  v_existing_assignment uuid;';
    if position(v_old in v_def) = 0 then
      raise exception 'create_violation_retraining_action has no declare block';
    end if;
    v_def := overlay(v_def placing v_new from position(v_old in v_def) for length(v_old));

    execute v_def;
  end if;
end;
$do$;

comment on function public.create_violation_retraining_action(uuid, uuid, uuid, uuid, date, text) is
  'Assigns retraining for a citation and writes the corrective action that tracks it, in one '
  'transaction. Reuses the employee''s open assignment for the course when there is one -- pulling '
  'its due date forward to the citation''s if that is sooner -- rather than inserting a second '
  'one, which the one-open-assignment index refuses. Before BACKLOG J58 that refusal raised 23505 '
  'and the corrective action was lost with it.';

-- ---------------------------------------------------------------------------
-- J72 -- compliance stops chasing people who have left
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_count integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'recalculate_all_compliance';
  if v_def is null then raise exception 'public.recalculate_all_compliance is missing'; end if;

  -- Every alert-producing select in this function joins employees as `e`; none of them looks at
  -- the employee's status, so a terminated aide's expired credentials keep filing critical alerts
  -- nobody can clear. The predicate goes on the join, once per occurrence.
  select count(*) into v_count
  from regexp_matches(v_def, 'join public\.employees e on e\.id = ([a-z_]+)\.employee_id', 'g');
  if v_count = 0 then
    raise exception 'recalculate_all_compliance no longer joins employees the way this migration patches';
  end if;

  v_def := regexp_replace(
    v_def,
    'join public\.employees e on e\.id = ([a-z_]+)\.employee_id',
    'join public.employees e on e.id = \1.employee_id and e.status = ''active''',
    'g'
  );
  execute v_def;
  raise notice 'recalculate_all_compliance: % employee join(s) scoped to active staff', v_count;
end;
$do$;

comment on function public.recalculate_all_compliance() is
  'Nightly recalculation of practicum, training and credential compliance. Every employee join is '
  'scoped to active staff: a terminated employee''s records were being expired and turned into '
  'critical alerts nobody could clear, while the compliance matrix and the organization dashboard '
  'both counted active staff only -- three surfaces disagreeing about one facility (BACKLOG J72).';

-- Resolve the alerts the sweep has already filed against people who have left.
update public.alerts a
set status = 'resolved',
    resolved_at = coalesce(a.resolved_at, now())
from public.employees e
where e.id = a.employee_id
  and e.status <> 'active'
  and a.status = 'open';

-- ---------------------------------------------------------------------------
-- J79 -- somebody can finally turn the email off
-- ---------------------------------------------------------------------------

drop function if exists public.update_profile_contact_preferences(uuid, text, text, text, boolean, text);

create or replace function public.update_profile_contact_preferences(
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sms_opt_in boolean,
  p_preferred_notification_channel text,
  p_email_opt_out boolean default null
)
returns setof public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
  v_email_opt_out boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not coalesce((
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ), false) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  -- Consent to be texted has to come from the person who will be texted. Before this, an org
  -- admin or a scoped facility manager could set p_sms_opt_in on somebody else's profile and the
  -- statement below stamped sms_consent_at = now() as though the recipient had given it -- a
  -- fabricated consent record on the exact column a TCPA complaint asks about, produced by an
  -- ordinary "tidy up the roster" edit. The refusal is scoped to the transition, not the caller:
  -- an administrator may still fix a name, correct a phone number, and turn texting OFF (which is
  -- an opt-out, and never needs the recipient's permission). What they may not do is create a
  -- state that would stamp a new consent -- exactly the condition the CASE below tests.
  if auth.uid() <> v_target.id
     and p_sms_opt_in
     and (
       not v_target.sms_opt_in
       or public.notification_phone_key(v_target.phone)
         is distinct from public.notification_phone_key(v_phone)
     ) then
    raise exception 'Text-message consent has to come from the recipient. They can turn text messages on from their own notification preferences; you can turn them off.'
      using errcode = '42501';
  end if;

  -- BACKLOG J79. `email_opt_out` is honoured by the whole delivery pipeline and, until now, was
  -- written only by the SendGrid consent webhook -- which fires only if SendGrid injects an
  -- unsubscribe link the payload never asks for. So the column existed, the pipeline read it, and
  -- nobody could set it. Null means "leave it as it is", which is what every existing caller
  -- sends.
  --
  -- The consent asymmetry is the same one the SMS rule above applies, in the same direction:
  -- turning email OFF is an opt-out and needs nobody's permission, so an administrator may do it
  -- for somebody. Turning it back ON is consent to be emailed again, and has to come from the
  -- person themselves.
  --
  -- Deliberately NOT validated against the preferred channel. `email` as the preferred channel
  -- while opted out delivers in-app only, which is a coherent state and is exactly what an
  -- administrator's unrelated edit (fixing a surname on a profile that opted out months ago)
  -- would otherwise be refused for. The notification settings page keeps the two in step for the
  -- person themselves.
  v_email_opt_out := coalesce(p_email_opt_out, v_target.email_opt_out, false);
  if auth.uid() <> v_target.id
     and coalesce(v_target.email_opt_out, false)
     and not v_email_opt_out then
    raise exception 'Only the recipient can turn product email back on for their own account.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms', 'web_push')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null))
     or (p_preferred_notification_channel = 'web_push'
       and v_target.preferred_notification_channel is distinct from 'web_push'
       and not exists (
         select 1 from public.push_subscriptions s
         where s.profile_id = v_target.id and s.organization_id = v_target.organization_id
           and s.disabled_at is null
           and (s.expiration_time is null or s.expiration_time > now())
       )) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      email_opt_out = v_email_opt_out,
      email_opt_out_at = case
        when v_email_opt_out and not coalesce(v_target.email_opt_out, false) then now()
        when not v_email_opt_out then null
        else v_target.email_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$;

comment on function public.update_profile_contact_preferences(uuid, text, text, text, boolean, text, boolean) is
  'The profile owner''s contact and notification preferences, and the only writer of '
  'profiles.email_opt_out that a person can reach: before BACKLOG J79 the whole delivery pipeline '
  'honoured that column while the SendGrid consent webhook was the only thing that could set it, '
  'so nobody could ask the product to stop emailing them. Turning email or texting OFF needs '
  'nobody''s permission; turning either back ON has to come from the recipient.';

revoke all on function public.update_profile_contact_preferences(uuid, text, text, text, boolean, text, boolean)
  from public, anon;
grant execute on function public.update_profile_contact_preferences(uuid, text, text, text, boolean, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- J63 -- the complaint's incident knows which resident it is about
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_complaint';
  if v_def is null then raise exception 'public.create_complaint is missing'; end if;

  v_old := '    insert into public.incidents (
      organization_id, facility_id, incident_type, occurred_at,
      reported_by_profile_id, resident_identifier, narrative, severity
    ) values (';
  v_new := '    -- BACKLOG J63. The resident row is resolved above and then thrown away: the incident got a
    -- NAME STRING and no resident_id, so its assessment-review and support-plan stages read
    -- not-applicable, falls-by-resident trends missed it entirely, and the DHS state form printed
    -- a name with no date of birth and no room number.
    insert into public.incidents (
      organization_id, facility_id, incident_type, occurred_at,
      reported_by_profile_id, resident_id, resident_identifier, narrative, severity
    ) values (';
  if position(v_old in v_def) = 0 then
    raise exception 'create_complaint no longer contains the incident insert this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      auth.uid(), case when p_resident_id is null then null else v_resident.first_name || '' '' || v_resident.last_name end,';
  v_new := '      auth.uid(), p_resident_id,
      case when p_resident_id is null then null else v_resident.first_name || '' '' || v_resident.last_name end,';
  if position(v_old in v_def) = 0 then
    raise exception 'create_complaint no longer contains the resident identifier expression this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;
