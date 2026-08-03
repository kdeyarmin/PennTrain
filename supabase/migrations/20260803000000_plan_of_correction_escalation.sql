-- Plan-of-correction due-date escalation -- the SMS half of BACKLOG.md C4.
--
-- The digest half (20260802080000) counts plans of correction due within 7 days or already
-- overdue in the Monday manager digest. That is the right cadence for a work queue and the
-- wrong one for a deadline: a POC due Wednesday is reported once on Monday, and nothing else
-- happens until the following Monday -- by which point it is a week late and the facility has
-- an unanswered citation on file. This adds the daily half.
--
-- Two notification types, deliberately:
--
--   plan_of_correction_due_soon  in-app plus the recipient's preferred channel. A warning.
--   plan_of_correction_overdue   routed through enqueue_critical_notification_delivery, which
--                                is the email + SMS path. An escalation.
--
-- So an SMS only ever follows a warning that already went out through the ordinary channel,
-- and only for a deadline the facility has actually missed. SMS is intrusive and metered;
-- spending it on something that is merely upcoming would train people to ignore it.
--
-- Neither template interpolates notification free text (allowed_variables stays '{}', matching
-- every other global template). The in-app body carries the citation reference and the due
-- date -- what a manager needs to act -- and nothing from the violation's description field.
--
-- Rollback:
--   select cron.unschedule('escalate-plans-of-correction');
--   delete from app_private.system_job_definitions where job_key = 'plan-of-correction-escalation';
--   drop function public.run_plan_of_correction_escalations(timestamptz);
--   drop trigger rearm_poc_escalation_on_due_date_change on public.dhs_violations;
--   drop function public.rearm_poc_escalation();
--   alter table public.dhs_violations
--     drop column poc_due_soon_notified_at, drop column poc_overdue_notified_at;
--   delete from public.notification_templates
--     where organization_id is null
--       and template_key in ('plan_of_correction_due_soon', 'plan_of_correction_overdue');
--   then CREATE OR REPLACE queue_notification_delivery() without the two new entries, and
--   restore notifications_notification_type_check to its 20260726000000 list.

------------------------------------------------------------------------------------------------
-- 1. Escalation state on the violation itself.
--
-- A daily sweep with no memory re-sends the same notice every morning, which is how a real
-- deadline gets muted. These two columns are that memory. They are separate rather than one
-- "last escalated" stamp because the two stages have different repeat rules: the warning fires
-- once, the overdue escalation keeps firing weekly for as long as the POC stays unanswered.
------------------------------------------------------------------------------------------------
alter table public.dhs_violations
  add column if not exists poc_due_soon_notified_at timestamptz,
  add column if not exists poc_overdue_notified_at timestamptz;

comment on column public.dhs_violations.poc_due_soon_notified_at is
  'When the approaching-deadline warning was sent. Cleared by rearm_poc_escalation() when '
  'poc_due_date changes, so an extended deadline warns again against its new date.';
comment on column public.dhs_violations.poc_overdue_notified_at is
  'When the overdue escalation was last sent. Re-sent no more often than weekly while the '
  'plan of correction remains outstanding.';

-- Moving the due date makes both stamps describe a deadline that no longer exists. Without
-- this, extending a due date permanently silences the warning for that violation: the row is
-- already stamped, and nothing ever clears it.
create or replace function public.rearm_poc_escalation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.poc_due_date is distinct from old.poc_due_date then
    new.poc_due_soon_notified_at := null;
    new.poc_overdue_notified_at := null;
  end if;
  return new;
end;
$function$;

create trigger rearm_poc_escalation_on_due_date_change
  before update on public.dhs_violations
  for each row execute function public.rearm_poc_escalation();

------------------------------------------------------------------------------------------------
-- 2. Notification types. Full current list re-declared plus the two new values (additive;
--    nothing removed). Mirrors 20260726000000's handling of the same constraint.
------------------------------------------------------------------------------------------------
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
    'announcement_published', 'manager_weekly_digest',
    'automation_action_due', 'report_subscription_ready', 'resident_portal_request',
    'billing_trial_expiring',
    'compliance_requirement_assigned', 'compliance_requirement_due_soon',
    'compliance_requirement_overdue', 'compliance_requirement_awaiting_review',
    'plan_of_correction_due_soon', 'plan_of_correction_overdue'
  )
);

------------------------------------------------------------------------------------------------
-- 3. Global delivery templates.
--
-- assign_notification_delivery_template resolves a delivery's template by notification_type,
-- falling back to 'default'. Without these rows the escalation would still send -- wearing the
-- generic default copy, which says nothing about a regulatory deadline. The SMS body is short
-- on purpose: dispatch-notifications prefixes the subject and appends "Reply STOP to opt out."
------------------------------------------------------------------------------------------------
insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'plan_of_correction_due_soon', 'email', 1, 'active',
    'A plan of correction is due soon',
    'A DHS plan of correction is coming due at your facility. Sign in to CareMetric CareBase '
    'to review the citation and submit the plan.',
    '{}'::text[], now()),
  (null, 'plan_of_correction_due_soon', 'sms', 1, 'active',
    'CareMetric CareBase',
    'A plan of correction is coming due. Sign in to review it securely.',
    '{}'::text[], now()),
  (null, 'plan_of_correction_overdue', 'email', 1, 'active',
    'A plan of correction is overdue',
    'A DHS plan of correction is past its due date at your facility. Sign in to CareMetric '
    'CareBase to review the citation and submit the plan.',
    '{}'::text[], now()),
  (null, 'plan_of_correction_overdue', 'sms', 1, 'active',
    'CareMetric CareBase',
    'A plan of correction is past its due date. Sign in to review it securely.',
    '{}'::text[], now())
on conflict (organization_id, template_key, channel, version) do nothing;

------------------------------------------------------------------------------------------------
-- 4. Delivery routing.
--
-- Re-declared from its current definition (20260715215810) with the two new types added; the
-- existing lists and their ordering are untouched. plan_of_correction_due_soon joins the
-- always-eligible set. plan_of_correction_overdue joins it *and* the critical set, which is
-- what routes it to enqueue_critical_notification_delivery -- email and SMS independently,
-- rather than the single preferred channel. That path is gated on
-- 'notifications.critical_multichannel', which 20260802030000 set to 'global' for every
-- organization; while it is off the escalation degrades to the preferred channel rather than
-- disappearing.
------------------------------------------------------------------------------------------------
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
    'announcement_published', 'manager_weekly_digest',
    'plan_of_correction_due_soon', 'plan_of_correction_overdue'
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
    'practicum_expired', 'incident_reported', 'plan_of_correction_overdue'
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

------------------------------------------------------------------------------------------------
-- 5. The daily sweep.
------------------------------------------------------------------------------------------------
create or replace function public.run_plan_of_correction_escalations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_violation public.dhs_violations%rowtype;
  v_profile uuid;
  -- public.pa_today() expressed against the injected clock. Calling pa_today() directly would
  -- read the real wall clock and make p_now decorative, which is exactly what the tests need to
  -- move. The expression is pa_today()'s own body -- keep the two in step.
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_overdue boolean;
  v_type text;
  v_title text;
  v_body text;
  v_sent integer;
  v_count integer := 0;
begin
  -- Block authenticated end users; allow the no-JWT cron/service context. Same boundary as
  -- run_shift_handoff_escalations and the other sweeps: the grant below is the real gate.
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  for v_violation in
    select * from public.dhs_violations v
    where v.status in ('open', 'poc_submitted')
      and v.poc_due_date is not null
      and v.poc_due_date <= v_today + 3
      and (
        -- Overdue: re-escalate weekly for as long as it stays outstanding.
        (v.poc_due_date < v_today
          and (v.poc_overdue_notified_at is null
            or v.poc_overdue_notified_at < p_now - interval '7 days'))
        -- Approaching: warned once per due date. rearm_poc_escalation() clears the stamp when
        -- the date moves, so an extended deadline warns again rather than staying silent.
        or (v.poc_due_date >= v_today and v.poc_due_soon_notified_at is null)
      )
    order by v.poc_due_date
    for update skip locked
  loop
    v_overdue := v_violation.poc_due_date < v_today;
    v_type := case when v_overdue
      then 'plan_of_correction_overdue' else 'plan_of_correction_due_soon' end;
    v_title := case when v_overdue
      then 'Plan of correction overdue' else 'Plan of correction due soon' end;
    -- citation_ref is nullable, and concatenating through a NULL yields NULL -- so the coalesce
    -- drops the whole prefix rather than producing an empty body for an uncited violation.
    v_body := coalesce('Citation ' || v_violation.citation_ref || ': ', '')
      || case when v_overdue then 'the plan of correction was due '
              else 'the plan of correction is due ' end
      || to_char(v_violation.poc_due_date, 'FMMon FMDD, YYYY') || '.';

    v_sent := 0;
    for v_profile in
      select p.id from public.profiles p
      where p.organization_id = v_violation.organization_id and p.is_active
        and p.role in ('org_admin', 'facility_manager')
        and (p.role = 'org_admin' or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = p.id and fa.facility_id = v_violation.facility_id
        ))
    loop
      insert into public.notifications(
        organization_id, profile_id, notification_type, title, body, link
      ) values (
        v_violation.organization_id, v_profile, v_type, v_title, v_body, '/app/violations'
      );
      v_sent := v_sent + 1;
    end loop;

    -- Only stamp when something actually went out. An organization with no active admin or
    -- assigned manager would otherwise be recorded as notified and never escalated again --
    -- leaving it unstamped costs one row per daily sweep and escalates the moment someone
    -- exists to receive it.
    if v_sent > 0 then
      if v_overdue then
        update public.dhs_violations set poc_overdue_notified_at = p_now
        where id = v_violation.id;
      else
        update public.dhs_violations set poc_due_soon_notified_at = p_now
        where id = v_violation.id;
      end if;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

comment on function public.run_plan_of_correction_escalations(timestamptz) is
  'Daily plan-of-correction deadline sweep (BACKLOG.md C4). Warns org admins and assigned '
  'facility managers three days out, then escalates weekly through the email+SMS critical '
  'path once the due date passes.';

revoke all on function public.run_plan_of_correction_escalations(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.run_plan_of_correction_escalations(timestamptz) to service_role;

------------------------------------------------------------------------------------------------
-- 6. Schedule + control-plane registration.
--
-- 11:30 UTC is 07:30 America/New_York on EDT and 06:30 on EST -- before the morning shift in
-- either, so the notice is waiting rather than interrupting. 20260726250000 made an unwatched
-- cron job a test failure, so the definition row is part of scheduling it, not a follow-up.
------------------------------------------------------------------------------------------------
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'escalate-plans-of-correction';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'escalate-plans-of-correction',
    '30 11 * * *',
    'select public.run_plan_of_correction_escalations()'
  );
end
$$;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('plan-of-correction-escalation', 'Plan of correction escalation',
   'Warns on plans of correction coming due and escalates overdue ones by email and SMS. '
   'Silence here means a missed DHS deadline reaches nobody until the Monday digest.',
   'sql_cron', 'escalate-plans-of-correction',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs')
on conflict (job_key) do nothing;
