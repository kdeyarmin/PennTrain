-- Who the policy-attestation reminder sweep is actually for.
--
-- send_policy_attestation_reminders() has run daily since 20260711162509 and had no test
-- coverage, which is how three targeting defects survived. All three come from the same shape:
-- the sweep was written as an INSERT and a separate UPDATE that were supposed to describe the
-- same set of attestations, and did not.
--
--   1. STAMPED WITHOUT SENDING. The UPDATE's predicate was strictly broader than the INSERT's --
--      it omitted the employees join and the `e.profile_id is not null` filter entirely. An
--      attestation belonging to an employee with no linked profile (a roster row imported from
--      CSV before that person is invited, which is the normal state for days or weeks) was
--      marked reminded while no reminder was sent. Because the stamp then re-applies every three
--      days forever, the first real reminder after that employee is finally linked arrives up to
--      three days late -- on a deadline that may already have passed.
--
--   2. REMINDED TERMINATED STAFF. Nothing filtered employees.status. Someone who left the
--      facility kept accruing "your policy attestation is overdue" every three days,
--      indefinitely. Whether that also emailed them depended on how they were offboarded:
--      apply_employee_lifecycle_transition deactivates the linked profile (so the delivery layer
--      drops it), but editing an employee's status to 'terminated' directly does not, and then
--      policy_attestation_due_soon is on queue_notification_delivery's always-eligible list and
--      the mail goes out. `e.status = 'active'` is the filter every other sweep in this schema
--      already uses.
--
--   3. NOTIFIED DEACTIVATED PROFILES. No profiles.is_active check, so a deactivated account
--      still accumulated notification rows. Those produce no delivery (the enqueue functions
--      check is_active), so this one was noise rather than mail -- but it is noise that makes an
--      abandoned account look like an active obligation.
--
-- The fix is structural rather than three added predicates. The set of attestations to remind is
-- computed once, in a materialized CTE, and both the insert and the stamp read that same set. It
-- is no longer possible for the two to disagree, which is the actual defect -- the three missing
-- filters were just what the disagreement let through.
--
-- Not changed here: the 7-day window, the 3-day re-reminder interval, the copy, the
-- '/me/attestations' link, and the absence of row locking (the job is scheduled daily and cannot
-- overlap itself). PA-day correctness was already fixed by 20260727010100.
--
-- Rollback: CREATE OR REPLACE the previous body from
-- 20260705152437_policy_attestation_notifications_and_reminders.sql, with `current_date`
-- replaced by `public.pa_today()` as 20260727010100 left it.

create or replace function public.send_policy_attestation_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- MATERIALIZED is load-bearing, not decoration. The insert and the update below must act on
  -- exactly the same rows; materializing evaluates the set once and hands both the same result,
  -- rather than leaving that guarantee to the planner's inlining choices.
  with due as materialized (
    select pa.id, pa.organization_id, e.profile_id, pa.due_date, pd.title
    from public.policy_attestations pa
    -- Inner joins, deliberately: an attestation whose employee has no linked profile has no one
    -- to notify, and must not be stamped as though it did.
    join public.employees e on e.id = pa.employee_id
    join public.profiles p on p.id = e.profile_id
    join public.policy_attestation_campaigns c on c.id = pa.campaign_id
    join public.policy_documents pd on pd.id = c.policy_document_id
    where pa.status = 'pending'
      and e.status = 'active'
      and p.is_active
      and pa.due_date is not null
      and pa.due_date <= public.pa_today() + 7
      and (pa.reminder_sent_at is null or pa.reminder_sent_at < now() - interval '3 days')
  ),
  sent as (
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    )
    select
      due.organization_id, due.profile_id, 'policy_attestation_due_soon',
      case when due.due_date < public.pa_today()
        then 'Policy attestation overdue' else 'Policy attestation due soon' end,
      due.title || case
        when due.due_date < public.pa_today()
          then ' was due ' || to_char(due.due_date, 'Mon DD, YYYY') || ' and is now overdue.'
        else ' is due ' || to_char(due.due_date, 'Mon DD, YYYY') || '.'
      end,
      '/me/attestations'
    from due
    returning 1
  )
  -- `sent` is not referenced below on purpose: a data-modifying CTE runs exactly once and to
  -- completion whether or not the primary query reads it.
  update public.policy_attestations pa
  set reminder_sent_at = now()
  where pa.id in (select due.id from due);
end;
$function$;

comment on function public.send_policy_attestation_reminders() is
  'Daily policy-attestation reminder sweep. Notifies the linked, active profile of an active '
  'employee about a pending attestation due within 7 days or already overdue, at most once '
  'every 3 days. Stamps reminder_sent_at on exactly the attestations it notified.';

-- Access boundary unchanged (idempotent re-assert): cron executes it as the job owner.
revoke all on function public.send_policy_attestation_reminders()
  from public, anon, authenticated;
