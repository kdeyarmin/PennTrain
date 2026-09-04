-- Every organization gets a notification-settings row, including the ones that predate the fix.
--
-- THE FINDING. On production, `public.organizations` holds two rows and
-- `public.organization_settings` holds zero. `public.notification_deliveries` has never held a
-- row -- not one delivery attempt in the life of the project.
--
-- Those two facts are the same fact. `organization_settings.email_notifications_enabled` and
-- `sms_notifications_enabled` both DEFAULT FALSE (20260704045925), and the delivery path reads
-- the settings row to decide whether a channel is on. 20260706175854 hardened that read so a
-- MISSING row degrades to "not assigned" instead of raising `record ... is not assigned` -- which
-- was the right call for robustness and is exactly what makes this silent: an organization with
-- no settings row is indistinguishable, from the outside, from one that has deliberately turned
-- every channel off.
--
-- 20260802040000 fixed the forward case. `record_organization_signup` now inserts a settings row
-- with email and SMS enabled, so an organization that signs up today can receive mail. It did not
-- backfill, and nothing else creates the row, so every organization that existed before that
-- migration -- both of the ones that exist -- is permanently unable to receive any notification,
-- with no error anywhere to say so.
--
-- This is the same shape as the gap SG-1's closure was written to remove. That closure's own
-- argument was that a real signup "got no email, no SMS, and no error until someone remembered to
-- enroll it by hand". The pilot-cohort gate is gone; this one survived it, and it is the one that
-- applies to the owner's own organization.
--
-- THE FIX IS THE BACKFILL, AND ONLY THE BACKFILL. One settings row per organization that has
-- none, with email and SMS enabled -- the same values `record_organization_signup` writes, so an
-- organization that predates that migration ends up in the state a new one is created in.
-- web_push stays at its default: unlike mail and SMS it needs a per-device subscription before it
-- can deliver anything, so enabling it here would assert a capability no browser has granted.
--
-- Demo tenants are backfilled too, deliberately. Their delivery suppression is a separate,
-- purpose-built trigger on the delivery path, not an accident of missing configuration, and
-- leaving demo organizations in the silent state would keep reproducing this bug in exactly the
-- tenant people test against.
--
-- WHAT THIS MIGRATION DELIBERATELY NO LONGER DOES, AND WHY THAT MATTERS MORE THAN THE BACKFILL.
-- The first draft also added an AFTER INSERT trigger on public.organizations, so the row could
-- never be missing again -- closing the class rather than the instance, which is normally the
-- right instinct. It was wrong here, and the pgTAP suite proved it in a way that is worth
-- recording rather than quietly deleting:
--
--   * `record_organization_signup` inserts the organizations row and then inserts its OWN
--     organization_settings row with a plain INSERT. The trigger got there first, so the
--     function's insert hit `organization_settings_organization_id_key` and raised. The trigger's
--     own `on conflict do nothing` does not help: the conflict is in the CALLER's statement.
--     **Self-service signup would have failed outright on every attempt** -- caught by
--     org_baa_gated_ai.test.sql ("the signup RPC creates an organization as service_role") and
--     signup_rollback_and_checkout_completion.test.sql, not by review.
--   * Seven further suites broke the same way, each creating an organization and then inserting
--     settings for it. They are not doing anything exotic; they are exercising the documented
--     contract of a table with a unique key, and the trigger silently made that contract
--     "insert only with ON CONFLICT".
--
-- Two lessons, both recorded because they generalise. First, a trigger that writes to a second
-- table changes the write contract of that table for every caller, including ones this repository
-- cannot see. Second, an earlier draft of this same trigger had already been corrected once (it
-- enabled two channels and rewrote the premise of trial_expiry_notice_enqueue.test.sql); a
-- mechanism that needs correcting twice, in two unrelated ways, before it can coexist with the
-- suite is telling you it is the wrong mechanism, not that it needs a third fix.
--
-- SO THE STRUCTURAL GAP IS NOT CLOSED BY ENFORCEMENT, and it is not left unwatched either. Every
-- in-repo path that creates an organization for a real tenant already creates its settings row
-- (`record_organization_signup`), the one that does not is seed.sql's local-only demo baseline,
-- and org_baa_gated_ai.test.sql already asserts the signup path's behaviour. What remains -- a
-- future creation path forgetting -- is an invariant to observe rather than a write to block, and
-- it is recorded in BACKLOG.md as such.
--
-- WHAT THIS DOES NOT DO. It does not make a delivery succeed. `dispatch-notifications` still needs
-- SENDGRID_API_KEY / NOTIFICATION_FROM_EMAIL and the Twilio credentials set as Edge Function
-- secrets, and without them attempts are recorded `skipped` with `provider_not_configured` rather
-- than sent. That is ops (BACKLOG H9/H4), and it is now the only thing left between a
-- due-training reminder and someone's inbox.
--
-- BLAST RADIUS. Inserts at most one row per organization; on production that is 2 rows, one real
-- and one demo. No existing settings row is modified, so an organization that deliberately
-- switched a channel off keeps that choice -- the backfill only touches organizations with NO row
-- at all. No trigger, no function, no change to any write path.
--
-- Rollback: delete the settings rows created here (they are the ones whose organization has no
-- other configuration history).

insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
)
select o.id, true, true
from public.organizations o
where not exists (
  select 1 from public.organization_settings s where s.organization_id = o.id
)
on conflict (organization_id) do nothing;
