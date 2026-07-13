-- Assignment due-date reminders for never-started training + on-hire exclusion screening.
--
-- Two coverage gaps from END_USER_REVIEW.md recommendation #4:
--
-- 1. course-continuation-reminders-daily only nudges employees who already STARTED
--    training (status='in_progress' with a stale course_progress row). An assignment that
--    was never opened gets no reminder before its due date -- the employee's first push
--    after "course_assigned" is the overdue flip. A new daily job now queues a
--    'course_assignment_due_soon' notification for assignments still in 'assigned'
--    whose due date falls within the next 7 days. In-app always; email/SMS delivery
--    rides the existing default-off 'notifications.expanded_delivery_types' flag.
--
-- 2. Exclusion screening runs monthly (the 12th), so a mid-month hire could work up to
--    a month unscreened. The OIG LEIE snapshot is a complete local copy, so a single
--    new hire can be matched in SQL with no external call. A new AFTER INSERT trigger
--    on employees screens each new active hire against every active exclusion snapshot,
--    gated behind the new default-off release flag 'screening.on_hire_exclusion'
--    (kill-switchable via feature_kill_switches like every flagged capability).
--    Matches land in the same pending_review queue + critical alert the monthly job
--    uses -- a human review signal, never an automatic block.

-- ---------------------------------------------------------------------------
-- New notification type
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
  'course_assigned', 'quiz_graded', 'certificate_issued',
  'training_due_soon', 'training_expired', 'competency_recorded',
  'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
  'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
  'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
  'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
  'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
  'qualification_changed', 'course_assignment_due_soon'
));

-- Add the new type to the flag-gated provider fan-out (legacy six unchanged; the
-- release gate is still never evaluated for them).
create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update'
  ) then
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  elsif new.notification_type in (
    'credential_expiring', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'course_assigned', 'policy_attestation_assigned',
    'incident_reported', 'course_assignment_due_soon'
  ) and app_private.is_feature_release_active(
    new.organization_id, 'notifications.expanded_delivery_types'
  ) then
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_notification_delivery()
  from public, anon, authenticated;

insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'course_assignment_due_soon', 'email', 1, 'active',
   'Your assigned training is due soon',
   'A training course assigned to you is due soon and has not been started. Sign in to CareMetric CareBase to begin it before the due date.',
   '{}'::text[], now());

-- ---------------------------------------------------------------------------
-- Daily reminder for never-started assignments approaching their due date
-- ---------------------------------------------------------------------------

-- Sibling of queue_course_continuation_reminders(), which deliberately covers only
-- in-progress work: this one covers status='assigned' (no course_progress row exists
-- yet by definition of start_course_assignment). Same one-nudge-per-assignment dedup
-- convention -- an exact type+link match, not a time window. Past-due assignments are
-- excluded here; the nightly status recalculation flips them to 'overdue' instead.
create or replace function public.queue_course_assignment_due_reminders()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  select
    ca.organization_id, e.profile_id, 'course_assignment_due_soon',
    'Start your course',
    coalesce(co.title, 'A course') || ' is due ' || to_char(ca.due_date, 'Mon DD, YYYY')
      || ' and has not been started.',
    '/me/courses/' || ca.id
  from public.course_assignments ca
  join public.employees e on e.id = ca.employee_id
  join public.courses co on co.id = ca.course_id
  where ca.status = 'assigned'
    and e.profile_id is not null
    and ca.due_date is not null
    and ca.due_date >= current_date
    and ca.due_date <= current_date + 7
    and not exists (
      select 1 from public.notifications n
      where n.notification_type = 'course_assignment_due_soon'
        and n.link = '/me/courses/' || ca.id
    );
end;
$function$;
revoke all on function public.queue_course_assignment_due_reminders()
  from public, anon, authenticated;

select cron.schedule(
  'course-assignment-due-reminders-daily',
  '30 14 * * *',
  $$ select public.queue_course_assignment_due_reminders(); $$
);

insert into app_private.system_job_definitions (
  job_key,
  display_name,
  description,
  execution_kind,
  cron_job_name,
  expected_interval,
  freshness_sla,
  is_critical,
  retry_mode,
  operator_route
) values (
  'course-assignment-due-reminders',
  'Training assignment due reminders',
  'Queues start reminders for unstarted training assignments approaching their due date',
  'sql_cron',
  'course-assignment-due-reminders-daily',
  interval '1 day',
  interval '30 hours',
  false,
  'manual',
  '/admin/system-jobs'
);

-- ---------------------------------------------------------------------------
-- On-hire exclusion screening (default-off release flag)
-- ---------------------------------------------------------------------------

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values (
  'screening.on_hire_exclusion',
  'On-hire exclusion screening',
  'Screen newly hired employees against the active local exclusion snapshots at insert time instead of waiting for the monthly run',
  'boolean', 'false'::jsonb
)
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values (
  'screening.on_hire_exclusion', 'off', false, 'screening',
  'Initial registration; default off per the phased delivery contract'
)
on conflict (feature_key) do nothing;

-- Per-employee variant of match_exclusion_list_against_roster_core(): identical trigram
-- thresholds and pending_review/alert semantics, restricted to one employee, matched
-- against every source that currently has an active snapshot. Purely local -- no HTTP.
-- For OIG LEIE the active snapshot is a full copy of the federal list; for SAM.gov it
-- only holds roster-derived entries from the last monthly run, so real-time SAM
-- coverage still arrives with the next scheduled refresh.
create or replace function app_private.screen_employee_against_active_exclusions(
  p_employee_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    least(extensions.similarity(upper(e.last_name), upper(l.last_name)),
          extensions.similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.active_snapshot_id is not null
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = s.source
    and extensions.similarity(upper(e.last_name), upper(l.last_name)) > 0.6
    and extensions.similarity(upper(e.first_name), upper(l.first_name)) > 0.5
  where e.id = p_employee_id
    and e.status = 'active'
  on conflict do nothing;

  insert into public.alerts (
    organization_id, facility_id, employee_id, exclusion_screening_match_id,
    alert_type, title, message, severity
  )
  select m.organization_id, m.facility_id, m.employee_id, m.id, 'exclusion_match_found',
    'Possible exclusion-list match — ' || e.first_name || ' ' || e.last_name,
    'A ' || (case when m.source = 'oig_leie' then 'OIG LEIE' else 'SAM.gov' end)
      || ' exclusion-list entry closely matches this employee''s name. Review in the exclusion screening queue.',
    'critical'
  from public.exclusion_screening_matches m
  join public.employees e on e.id = m.employee_id
  where m.employee_id = p_employee_id
    and m.status = 'pending_review'
    and not exists (
      select 1 from public.alerts a where a.exclusion_screening_match_id = m.id
    );
end;
$function$;
revoke all on function app_private.screen_employee_against_active_exclusions(uuid)
  from public, anon, authenticated, service_role;

-- Fires on INSERT only: rehires/reactivations flow through the monthly run as before.
-- The flag check costs 2-3 indexed probes per hire; the trigram scan runs only when
-- the flag is on for the org.
create or replace function public.screen_new_employee_for_exclusions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.status = 'active' and app_private.is_feature_release_active(
    new.organization_id, 'screening.on_hire_exclusion'
  ) then
    perform app_private.screen_employee_against_active_exclusions(new.id);
  end if;
  return new;
end;
$function$;
revoke all on function public.screen_new_employee_for_exclusions()
  from public, anon, authenticated;

create trigger screen_new_employee_exclusions
  after insert on public.employees
  for each row execute function public.screen_new_employee_for_exclusions();
