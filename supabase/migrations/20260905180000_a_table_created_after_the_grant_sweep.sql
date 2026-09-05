-- A table created one migration too late to be swept (I18, found by the invariants).
--
-- 20260904100000 revoked the write grants the hosted image's default privileges hand to `anon` and
-- `authenticated` on every table in `public`. Those default privileges are still in force, so a
-- table created by a LATER migration is granted them again at CREATE TABLE time and has to revoke
-- them itself. `incident_notification_rules` (20260905080000) did not: it granted SELECT to
-- `authenticated` and stopped there, leaving both browser roles holding INSERT, UPDATE and DELETE.
--
-- Row-level security denies those writes -- the table has one SELECT policy and nothing else, and
-- no policy means no permission -- so nothing was exploitable. It is a lock left open rather than
-- a door left open, and two invariants already say so out loud: go_live_readiness_repairs.test.sql
-- ("no browser role holds a write grant that row-level security already denies") and
-- incident_deadline_anchor.test.sql's own last assertion, which states the rule this table exists
-- to enforce -- that changing a reporting deadline is a reviewed migration, not a form submission.
--
-- Restating the intended grant alongside the revoke, rather than revoking the three verbs, so the
-- table's whole API-side access is one readable statement.
revoke all on table public.incident_notification_rules from anon, authenticated;
grant select on table public.incident_notification_rules to authenticated;
