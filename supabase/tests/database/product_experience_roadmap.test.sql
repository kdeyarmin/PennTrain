begin;
select plan(36);

select has_table('public', 'org_announcements', 'organization announcements exist');
select has_table('public', 'org_announcement_receipts', 'announcement read receipts exist');
select has_table('public', 'training_passports', 'portable training passports exist');
select has_table('public', 'organization_export_jobs', 'organization export jobs exist');
select has_table('public', 'navigation_preferences', 'durable navigation preferences exist');
select has_table('public', 'session_lock_events', 'idle-session audit events exist');
select has_table('public', 'product_changelog_reads', 'product changelog read state exists');
select has_table('public', 'manager_digest_snapshots', 'manager digest snapshots exist');

select has_column('public', 'organization_settings', 'idle_timeout_minutes', 'standard idle timeout is configurable');
select has_column('public', 'organization_settings', 'kiosk_idle_timeout_minutes', 'kiosk idle timeout is configurable');
select has_column('public', 'organization_settings', 'hidden_navigation_sections', 'navigation modules can be hidden');
select has_column('public', 'facilities', 'is_sandbox', 'facilities can be marked as sandbox');
select has_column('public', 'facilities', 'sandbox_seed_version', 'sandbox seed version is tracked');
select has_column('public', 'facilities', 'sandbox_reset_at', 'sandbox reset time is tracked');
select has_column('public', 'employees', 'is_synthetic', 'synthetic employees are marked');
select has_column('public', 'residents', 'is_synthetic', 'synthetic residents are marked');

select has_function('public', 'publish_org_announcement', array['text','text','text[]','uuid[]','timestamp with time zone'], 'announcements publish through a scoped command');
select has_function('public', 'mark_org_announcement_seen', array['uuid'], 'announcement receipts are recorded through a command');
select has_function('public', 'get_announcement_read_summary', array['uuid'], 'announcement read summaries are available');
select has_function('public', 'enable_my_training_passport', array['boolean'], 'employees can enable their passport');
select has_function('public', 'revoke_my_training_passport', array[]::text[], 'employees can revoke their passport');
select has_function('public', 'verify_training_passport', array['text'], 'public passport verification exists');
select has_function('public', 'request_organization_export', array[]::text[], 'organization admins can request exports');
select has_function('public', 'record_navigation_visit', array['text','text'], 'navigation visits persist server-side');
select has_function('public', 'get_my_mfa_policy', array[]::text[], 'callers can resolve their MFA policy');
select has_function('public', 'unpublish_course', array['uuid','text'], 'course unpublishing uses an audited command');
select has_function('public', 'queue_manager_weekly_digests', array[]::text[], 'weekly manager digest queueing exists');
select has_function('public', 'get_product_changelog', array['integer'], 'caller-scoped product changelog exists');
select ok(
  pg_get_functiondef('public.generate_class_checkin_token(uuid,boolean)'::regprocedure)
    like '%status not in (%scheduled%, %in_progress%)%',
  'QR tokens follow the scheduled and in-progress class lifecycle'
);
select ok(
  pg_get_functiondef('public.checkin_via_token(text)'::regprocedure)
    like '%status not in (%scheduled%, %in_progress%)%',
  'QR attendance follows the scheduled and in-progress class lifecycle'
);

select is((select count(*)::bigint from public.release_flags where feature_key in (
  'communications.announcements','training.portable_passport','exports.organization_data',
  'navigation.workspace','sandbox.training_facility','notifications.manager_digest','product.changelog'
)), 7::bigint, 'all new product surfaces are registered in release control');
select is((select count(*)::bigint from cron.job where jobname in ('process-organization-export-jobs','manager-weekly-digest')), 2::bigint, 'export and digest workers are scheduled');
select is((select count(*)::bigint from app_private.system_job_definitions where job_key in ('organization-data-export','manager-weekly-digest')), 2::bigint, 'export and digest workers are operator-visible');
select ok(exists(select 1 from storage.buckets where id = 'organization-exports' and not public), 'organization exports use a private bucket');
select is((select count(*)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in (
  'org_announcements','org_announcement_receipts','training_passports','organization_export_jobs',
  'navigation_preferences','session_lock_events','product_changelog_reads','manager_digest_snapshots'
) and c.relrowsecurity), 8::bigint, 'every new caller-facing table has RLS enabled');
select ok(exists(
  select 1 from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and pg_get_constraintdef(c.oid) like '%manager_weekly_digest%'
    and pg_get_constraintdef(c.oid) like '%announcement_published%'
), 'notifications admit announcement and manager-digest events');

select * from finish();
rollback;
