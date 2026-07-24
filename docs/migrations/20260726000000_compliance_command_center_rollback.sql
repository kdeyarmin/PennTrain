-- Rollback for the Compliance Command Center feature:
--   20260726000000_compliance_command_center_core.sql
--   20260726000100_compliance_command_center_rpcs.sql
--
-- Both forward migrations are additive (new tables/functions/bucket/cron + a widened notifications
-- CHECK); nothing pre-existing is altered destructively, so this reverses cleanly. Apply top-to-bottom
-- inside a single transaction. NOTE: dropping the four tables discards all compliance-requirement data;
-- export first if it must be retained.

begin;

-- 1. Stop the daily maintenance job.
select cron.unschedule('compliance-requirement-maintenance-daily');

-- 2. Drop the workflow / maintenance functions (order-independent).
drop function if exists public.run_compliance_requirement_maintenance(date);
drop function if exists public.remove_compliance_evidence(uuid);
drop function if exists public.attach_compliance_evidence(uuid, text, text, text, integer, text);
drop function if exists public.add_compliance_note(uuid, uuid, text);
drop function if exists public.assign_compliance_instance(uuid, uuid, text);
drop function if exists public.transition_compliance_instance(uuid, text, text);
drop function if exists public.copy_compliance_requirement(uuid, uuid[]);
drop function if exists public.generate_compliance_instances_now(uuid);
drop function if exists public.set_compliance_requirement_active(uuid, boolean, text);
drop function if exists public.upsert_compliance_requirement(uuid,uuid,uuid,text,text,text,text,text,uuid,text,integer,date,integer,boolean,boolean,boolean,uuid);
drop function if exists app_private.ensure_compliance_instances(uuid, date);
drop function if exists app_private.compliance_interval(text, integer);
drop function if exists app_private.assert_compliance_manager(uuid, uuid);

-- 3. Remove evidence storage policies + bucket (delete objects first so the bucket drop succeeds).
delete from storage.objects where bucket_id = 'compliance-evidence';
drop policy if exists "compliance-evidence read" on storage.objects;
drop policy if exists "compliance-evidence write" on storage.objects;
drop policy if exists "compliance-evidence delete" on storage.objects;
delete from storage.buckets where id = 'compliance-evidence';

-- 4. Drop the tables (CASCADE clears the audit/updated_at triggers and select policies with them).
drop table if exists public.compliance_requirement_documents cascade;
drop table if exists public.compliance_requirement_events cascade;
drop table if exists public.compliance_requirement_instances cascade;
drop table if exists public.compliance_requirements cascade;

-- 5. Restore the notifications type CHECK to its pre-feature list (from
--    20260724234000_trial_expiry_notices.sql) -- drops the four compliance_requirement_* types.
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
    'billing_trial_expiring'
  )
);

commit;
