-- Standardize the free trial on 30 days across the platform.
--
-- The trial length is stored in two places, both of which had launched at 14
-- days while the customer-facing marketing (Landing, VideoModal, signup video)
-- already promised 30. This migration brings the data source of truth in line
-- with that promise so the granted trial matches what customers are shown:
--   * platform_settings.default_trial_days -> drives the signup-organization
--     edge function that stamps organizations.trial_ends_at.
--   * packages.trial_days -> drives the Stripe trial_period_days applied at
--     checkout for self-service subscriptions.
--
-- The contact-sales "CareMetric Portfolio" package keeps trial_days = 0 (no
-- self-service trial); only the two self-serve packages carried the 14-day
-- launch value.

update public.platform_settings
set value = '30'::jsonb,
    updated_at = now()
where key = 'default_trial_days';

update public.packages
set trial_days = 30,
    updated_at = now()
where name in ('CareMetric Train', 'CareMetric CareBase');

-- New packages created by a platform admin now default to the standard 30-day
-- trial instead of the old 14-day launch value.
alter table public.packages
  alter column trial_days set default 30;
