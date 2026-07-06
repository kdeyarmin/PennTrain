-- Personal, per-profile notification feed (course assignments, quiz results,
-- certificates, competency evaluations, training due/expired) across every
-- role. This is deliberately separate from `alerts`, which its own comment
-- documents as "internal ops tool: admin/facility roles only, no employee
-- self-access" -- notifications is the opposite: every profile sees only
-- their own rows, and it exists specifically to serve employee/trainer roles
-- that alerts does not.
--
-- Rows are written exclusively by SECURITY DEFINER trigger functions (same
-- pattern as audit_log_trigger): there is no INSERT/UPDATE/DELETE policy for
-- ordinary clients, and marking a notification read goes through the two
-- RPCs below rather than a direct table UPDATE.

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null
                      constraint notifications_notification_type_check
                      check (notification_type in (
                        'course_assigned', 'quiz_graded', 'certificate_issued',
                        'training_due_soon', 'training_expired', 'competency_recorded'
                      )),
  title             text not null,
  body              text,
  link              text,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
)