-- A paying-customer organization can be created with no trial deadline, and then never expires.
--
-- THE FINDING. `enforce_trial_expiry_entitlements` (20260724180000) revokes entitlements only
-- when the trial has actually lapsed:
--
--     and o.trial_ends_at is not null
--     and o.trial_ends_at <= p_as_of
--
-- which is correct as written -- you cannot expire a deadline that does not exist. The gap is
-- upstream: nothing guarantees the deadline exists. `organizations.trial_ends_at` is nullable with
-- no default, `record_organization_signup` takes it as a parameter and writes whatever it is
-- given, and every other creation path (the demo provisioner, seed.sql, a support-side insert, a
-- future importer) sets no trial at all.
--
-- So `subscription_status = 'trial'` with `trial_ends_at = null` is reachable, and it means
-- permanent full entitlement with no subscription and no expiry -- indistinguishable, in the data,
-- from a deliberate internal grant. Production holds exactly one such row today: the single
-- non-demo organization, created 2026-07-04, status 'trial', trial_ends_at null, no BAA stamp,
-- and no billing_subscriptions row.
--
-- THE FIX IS FORWARD-ONLY, AND THAT IS DELIBERATE. A BEFORE INSERT trigger stamps a deadline on
-- any new non-demo organization that arrives on a trial without one, using the operator-controlled
-- `default_trial_days` platform setting (30) and falling back to 30 if the setting is missing or
-- malformed. Demo organizations are exempt: they are supposed to run indefinitely, and
-- `organizations.is_demo` already carries that meaning everywhere else.
--
-- BEFORE, NOT AFTER, and a review caught the difference before this shipped. An AFTER INSERT
-- trigger has to UPDATE the row it just observed, and on this table that second write is not
-- free: it re-fires `set_updated_at`, the UPDATE-only guards `protect_subscription_fields` and
-- `protect_baa_fields`, and the audit trigger -- so every newly created organization would gain a
-- spurious audit_logs 'update' entry moments after its own creation, and 20260725000000's header
-- comment that "record_organization_signup INSERTs (the trigger is UPDATE-only)" would stop being
-- true. Worse for correctness: an AFTER trigger's write is invisible to the triggering statement,
-- so any creation path doing `insert ... returning trial_ends_at` would read NULL and could
-- re-stamp or mis-report the deadline. Assigning `new.trial_ends_at` BEFORE the insert is one
-- write, no extra audit row, and correct under RETURNING.
--
-- IT DOES NOT BACKFILL THE EXISTING ROW, and that omission is the safest part of this migration.
-- Stamping a deadline on the one existing non-demo organization would start a clock on what is
-- most likely the owner-operator's own tenant -- the one holding both platform_admin identities --
-- and expiring it would revoke entitlements from the account used to administer the platform. That
-- is a product decision about what that organization IS (internal tenant, or first customer), it
-- is recorded in BACKLOG.md, and it needs a person rather than a migration. What this migration
-- guarantees is only that the next organization cannot land in the same undefined state.
--
-- BLAST RADIUS. One BEFORE INSERT trigger on public.organizations, firing only for rows where
-- is_demo is false, subscription_status is 'trial', and trial_ends_at is null. No existing row is
-- read or written. Every trial that already carries a deadline is untouched, and a caller that
-- passes an explicit trial_ends_at (which record_organization_signup does) keeps it exactly.
--
-- Rollback: drop the trigger and function.

create or replace function app_private.ensure_trial_has_an_end_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if coalesce(new.is_demo, false)
     or new.trial_ends_at is not null
     or coalesce(new.subscription_status, '') is distinct from 'trial' then
    return new;
  end if;

  -- Operator-controlled, with a fallback: a missing or non-numeric setting must not leave the
  -- organization in the very state this trigger exists to prevent.
  select case
           when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer
           else null
         end
    into v_days
  from public.platform_settings s
  where s.key = 'default_trial_days';

  if v_days is null or v_days <= 0 then
    v_days := 30;
  end if;

  new.trial_ends_at := now() + make_interval(days => v_days);
  return new;
end;
$$;

revoke all on function app_private.ensure_trial_has_an_end_date() from public, anon, authenticated;

comment on function app_private.ensure_trial_has_an_end_date() is
  'Gives every new non-demo organization created on a trial an actual deadline. Without one, enforce_trial_expiry_entitlements has nothing to compare against and the organization keeps full entitlements forever with no subscription -- which is indistinguishable in the data from a deliberate internal grant. Forward-only by design; see 20260904070000 for why the one existing null is left to a person.';

drop trigger if exists ensure_trial_has_an_end_date on public.organizations;
create trigger ensure_trial_has_an_end_date
before insert on public.organizations
for each row execute function app_private.ensure_trial_has_an_end_date();
