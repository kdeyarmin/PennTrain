-- Three fixes from the PR #435 review, all in the plan-of-correction / attestation work.
--
-- 1. ATTESTATION LINKS BECOME ROLE-NEUTRAL. 20260803020000 resolved the link from the recipient's
--    role at INSERT time: employee -> /me/attestations, everyone else -> /app/my-attestations.
--    Two problems, one root cause -- a link is written once and read later.
--
--    a) The `else` branch sent auditor and platform_admin to /app/my-attestations, but that route
--       initially admitted only org_admin/facility_manager/trainer. Since admin_update_profile
--       severs employees.profile_id only on an ORGANIZATION change, a profile can reach any role
--       while keeping its roster row -- so those two roles were left with exactly the unsignable,
--       endlessly-reminded attestation this work set out to fix.
--    b) Even with the route widened, a stored path goes stale when the recipient's role changes
--       between the notification being written and being clicked. A manager demoted back to
--       employee still holds a link to a page their role can no longer open.
--
--    Both disappear if the link does not encode a role. Both functions now point at
--    /attestations, which resolves against the live session at click time and sends the user to
--    whichever surface their CURRENT role can open. No role lookup here at all.
--
-- 2. THE ESCALATION SWEEP STOPS AT SUBMISSION. It included status 'poc_submitted', while the
--    templates tell the recipient to "submit the plan" -- nagging people to do work they have
--    already done. The deeper issue is the scope, not the copy: poc_due_date is the deadline to
--    SUBMIT the plan (submit_plan_of_correction sets poc_submitted_at and moves status to
--    'poc_submitted'), so once submitted that deadline is met. What remains afterwards --
--    completing corrective actions and getting verified -- is already tracked as
--    violation_corrective_action work items with their own escalation (BACKLOG.md C3). Escalating
--    on poc_due_date past submission double-counts an obligation another job already owns.
--
--    Known inconsistency, recorded rather than silently diverged: queue_manager_weekly_digests
--    still counts ('open','poc_submitted') in its digest tally, so the digest total can exceed
--    what this sweep escalates. Narrowing it means re-declaring that whole function and is left
--    for a change that can verify the digest end to end.
--
-- Rollback: CREATE OR REPLACE both notification functions from 20260803020000, and restore
-- `v.status in ('open', 'poc_submitted')` in run_plan_of_correction_escalations.

------------------------------------------------------------------------------------------------
-- 1a. Assignment notification -- role lookup removed, link is now role-neutral.
------------------------------------------------------------------------------------------------
create or replace function public.notify_policy_attestation_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_profile_id uuid; v_title text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then
    return new;
  end if;

  select pd.title into v_title
  from public.policy_attestation_campaigns c
  join public.policy_documents pd on pd.id = c.policy_document_id
  where c.id = new.campaign_id;

  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'policy_attestation_assigned',
    'Policy attestation required',
    coalesce(v_title, 'A policy document') ||
      case when new.due_date is not null then ' — due ' || to_char(new.due_date, 'Mon DD, YYYY') else '' end,
    '/attestations'
  );
  return new;
end;
$function$;

------------------------------------------------------------------------------------------------
-- 1b. Reminder sweep -- same link change. The profiles join stays: it still carries the
--     is_active check that keeps deactivated accounts out of the notified set.
------------------------------------------------------------------------------------------------
create or replace function public.send_policy_attestation_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with due as materialized (
    select pa.id, pa.organization_id, e.profile_id, pa.due_date, pd.title
    from public.policy_attestations pa
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
      '/attestations'
    from due
    returning 1
  )
  update public.policy_attestations pa
  set reminder_sent_at = now()
  where pa.id in (select due.id from due);
end;
$function$;

comment on function public.send_policy_attestation_reminders() is
  'Daily policy-attestation reminder sweep. Notifies the linked, active profile of an active '
  'employee about a pending attestation due within 7 days or already overdue, at most once '
  'every 3 days. Links to /attestations, which resolves to the right surface for the '
  'recipient''s role at click time. Stamps reminder_sent_at on exactly what it notified.';

------------------------------------------------------------------------------------------------
-- 2. Escalate only plans of correction that have not been submitted.
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
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_overdue boolean;
  v_type text;
  v_title text;
  v_body text;
  v_sent integer;
  v_count integer := 0;
begin
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  for v_violation in
    select * from public.dhs_violations v
    -- 'open' only. poc_due_date is the deadline to SUBMIT the plan, so a violation already in
    -- 'poc_submitted' has met it; what is left runs on violation_corrective_action work items
    -- with their own escalation. Escalating both would tell a manager to submit a plan they have
    -- already submitted.
    where v.status = 'open'
      and v.poc_due_date is not null
      and v.poc_due_date <= v_today + 3
      and (
        (v.poc_due_date < v_today
          and (v.poc_overdue_notified_at is null
            or v.poc_overdue_notified_at < p_now - interval '7 days'))
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

revoke all on function public.send_policy_attestation_reminders()
  from public, anon, authenticated;
revoke all on function public.notify_policy_attestation_assigned()
  from public, anon, authenticated;
revoke all on function public.run_plan_of_correction_escalations(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.run_plan_of_correction_escalations(timestamptz) to service_role;
