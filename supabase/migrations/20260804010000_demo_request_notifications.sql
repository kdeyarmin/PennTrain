-- Platform-admin notification when a marketing-site demo request arrives (request-demo Edge
-- Function, supabase/functions/request-demo/index.ts). Previously the only signal was the
-- comment "platform admins triage new rows from the demo_requests queue" -- i.e. someone querying
-- the table by hand. This wires that queue into the existing public.notifications system instead
-- of inventing a new delivery channel (no new Slack/email-provider integration).
--
-- 1. Register the notification type. Full current list re-declared plus the new value (additive;
--    nothing removed). Mirrors 20260803000000's handling of the same constraint.
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
    'plan_of_correction_due_soon', 'plan_of_correction_overdue',
    'demo_request_received'
  )
);

-- 2. organization_id becomes nullable. Every notification type up to this one describes something
-- that happened inside a tenant, so organization_id has always been the recipient's own org. A
-- demo request has no tenant yet -- it is a prospect, not a customer -- and its natural audience
-- (role = 'platform_admin') is the one profiles.role this codebase already treats as legitimately
-- org-less: create-user only requires organization_id for non-platform_admin roles (see
-- VALID_ROLES / "organization_id is required for non-platform_admin users" in
-- supabase/functions/create-user/index.ts), and the enterprise-scope backfill in
-- 20260711200631_phase2_enterprise_scope_and_permissions.sql flags `role <> 'platform_admin' and
-- organization_id is null` as the anomaly to log -- implying the reverse (platform_admin with a
-- null organization_id) is the expected, unremarkable case. "organization_id is null" already
-- means "platform-owned, not tenant-scoped" elsewhere in this schema (governed_content,
-- work_item_templates, learning_packages all read it that way in their select policies), so this
-- extends that same convention to notifications rather than inventing a new one. Nothing reads
-- notifications.organization_id outside RLS today, and notifications_select does not reference it
-- (`profile_id = (select auth.uid())`, per 20260704240000's tightening -- a personal inbox scoped
-- to the caller regardless of role), so relaxing this is safe for every existing row and every
-- existing notify_* trigger, all of which keep supplying a real organization_id. It is also why a
-- null organization_id here is harmless for visibility: each platform_admin gets their own row
-- (profile_id = that admin's id), so they see it via the ordinary caller-match branch -- no
-- role-based bypass is involved or needed.
alter table public.notifications alter column organization_id drop not null;

-- 3. Fan-out function: one row per active platform_admin profile, the same loop shape
-- app_private.enqueue_trial_expiry_notices() uses to notify every org_admin in an org (see
-- 20260724234000_trial_expiry_notices.sql) -- just without that function's per-org grouping,
-- since platform_admin is not scoped to one organization.
--
-- Deliberately NOT a trigger on demo_requests. request-demo calls this only *after* its insert
-- into demo_requests has already returned successfully, as a separate service-role request (not
-- the same transaction), specifically so a bug in here can never roll back or fail the already-
-- saved demo request. The Edge Function wraps the call in a best-effort try/catch that only logs
-- on failure -- the same shape supabase/functions/subscribe-updates/index.ts already uses for its
-- best-effort welcome email.
--
-- Granted only to service_role, so it is reachable exclusively from a trusted Edge Function
-- holding the service-role key, never directly from a browser client -- and, matching the more
-- recent of this codebase's two service-role-only conventions (run_plan_of_correction_escalations,
-- policy_campaign_declarative_targeting, run_shift_handoff_escalations; postdates the older,
-- grant-only admin_update_profile), the function body also blocks a real end-user session as
-- defense in depth in case the grant is ever loosened by a future migration.
--
-- Deliberately in-app only for now -- no call to enqueue_preferred_notification_delivery. The
-- comment this migration replaces in request-demo/index.ts already described email/Slack dispatch
-- as later work, not this change. Calling it today would also beg a question it can't answer
-- cleanly: enqueue_preferred_notification_delivery resolves eligibility via `where id = p_profile_id
-- and organization_id = p_organization_id`, which is never true when both sides are null, so it
-- would silently no-op for exactly the org-less platform_admin profiles this notification exists
-- for. The in-app bell is the real, working signal this change delivers; off-platform delivery
-- stays a deliberate follow-up rather than a half-working add-on.
--
-- link is left null: grep of artifacts/caremetric-carebase/src turned up no admin route that
-- lists demo_requests yet (only the generated database.types.ts references the table), and
-- pointing at an unrelated existing admin page would be more misleading than no link at all.
--
-- Rollback:
--   drop function public.notify_platform_admins_of_demo_request(uuid);
--   alter table public.notifications alter column organization_id set not null;
--   then CREATE OR REPLACE notifications_notification_type_check without 'demo_request_received'
--   (only safe once no row uses that value).
create or replace function public.notify_platform_admins_of_demo_request(p_demo_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.demo_requests%rowtype;
  v_admin record;
  v_notified integer := 0;
begin
  -- Block authenticated end users; allow the no-JWT cron/service-role context (same boundary as
  -- run_plan_of_correction_escalations and the other sweeps: the grant below is the real gate).
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  select * into v_request from public.demo_requests where id = p_demo_request_id;
  if v_request.id is null then
    return 0;
  end if;

  for v_admin in
    select id, organization_id from public.profiles
    where role = 'platform_admin' and is_active
  loop
    -- Contact email leads the body: name/organization are free text with no length cap upstream,
    -- and Header.tsx renders notification bodies with line-clamp-2 and no expand affordance --
    -- there's also no demo-request detail page for this notification's (null) link to point at, so
    -- whatever falls past the clamp is unrecoverable from the app today. Leading with the one
    -- actionable field means it survives the clamp regardless of how long name/organization run;
    -- name and organization are also capped defensively, matching the existing message cap.
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_admin.organization_id, v_admin.id, 'demo_request_received',
      'New demo request',
      'Contact: ' || v_request.email || ' -- ' || left(v_request.name, 80)
        || case when v_request.organization is not null then ' (' || left(v_request.organization, 80) || ')' else '' end
        || case when v_request.message is not null then ': "' || left(v_request.message, 140) || '"' else '' end,
      null
    );
    v_notified := v_notified + 1;
  end loop;

  return v_notified;
end;
$function$;

revoke all on function public.notify_platform_admins_of_demo_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.notify_platform_admins_of_demo_request(uuid) to service_role;
