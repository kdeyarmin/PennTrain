-- Gives default_trial_days (platform_settings) a real column to write to, instead of being a
-- setting that influences nothing -- signup-organization stamps this at self-service signup time.
-- No auto-suspend/expiry job is added here (that's real billing automation, deliberately deferred
-- along with Stripe per the ROADMAP); this is purely the informational "when does this trial end"
-- record surfaced in the admin org detail view.
alter table public.organizations add column trial_ends_at timestamptz;
