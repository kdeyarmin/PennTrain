-- Send policy-attestation notifications to a page the recipient can actually open.
--
-- Both attestation notifications hard-coded '/me/attestations'. That is the employee portal, and
-- ProtectedRoute restricts it to allowedRoles=["employee"] -- so for any other role the link is
-- not merely cosmetic, it is a redirect to /app with no explanation.
--
-- That state is reachable through the most ordinary flow there is. A profile keeps its employees
-- row across a role change: admin_update_profile severs employees.profile_id only when the
-- ORGANIZATION changes (`e.organization_id is distinct from v_row.organization_id`), not the
-- role, and apply_scim_change links an IdP-mapped role to an employee row with no role
-- constraint. So an aide promoted to shift supervisor is a facility_manager who is still on the
-- roster -- still holds credentials, still takes training, and still has to sign policies.
--
-- Assign that person a policy attestation today and they cannot satisfy it through any UI. It
-- stays 'pending' forever, the campaign reports them outstanding forever, and
-- send_policy_attestation_reminders re-notifies them every three days. 20260803010000 made that
-- more visible rather than less: their employee row is active and their profile is active, so the
-- corrected sweep keeps reminding them about an obligation they have no way to discharge.
--
-- /app/my-attestations (added in the same change) renders the same page for rostered non-employee
-- roles. This makes the link follow the recipient rather than assume one.
--
-- Both functions resolve the link the same way, from the recipient's own profile role, so the
-- rule lives in one shape in two places rather than diverging.
--
-- Rollback: CREATE OR REPLACE both bodies with the literal '/me/attestations' restored --
-- notify_policy_attestation_assigned from 20260705152437, send_policy_attestation_reminders from
-- 20260803010000.

------------------------------------------------------------------------------------------------
-- 1. Assignment notification.
------------------------------------------------------------------------------------------------
create or replace function public.notify_policy_attestation_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Body copied from the live definition with ONE substitution: the '/me/attestations' literal
-- becomes the role-resolved link, and v_role is declared and selected to support it. Title and
-- body text, the null-profile early return, and the due-date suffix are untouched.
declare v_profile_id uuid; v_title text; v_role text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then
    return new;
  end if;

  select role into v_role from public.profiles where id = v_profile_id;

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
    case when v_role = 'employee' then '/me/attestations' else '/app/my-attestations' end
  );
  return new;
end;
$function$;

------------------------------------------------------------------------------------------------
-- 2. Reminder sweep. Structure unchanged from 20260803010000 -- the set is still computed once in
--    a materialized CTE that both the insert and the stamp read. The profiles join it already
--    carries for the is_active check now also supplies the role.
------------------------------------------------------------------------------------------------
create or replace function public.send_policy_attestation_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with due as materialized (
    select pa.id, pa.organization_id, e.profile_id, p.role, pa.due_date, pd.title
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
      case when due.role = 'employee' then '/me/attestations' else '/app/my-attestations' end
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
  'every 3 days, linking to whichever attestation surface that recipient''s role can open. '
  'Stamps reminder_sent_at on exactly the attestations it notified.';

revoke all on function public.send_policy_attestation_reminders()
  from public, anon, authenticated;
revoke all on function public.notify_policy_attestation_assigned()
  from public, anon, authenticated;
