-- Register the first-party CareMetric Support Hub as an operational release rather than a package
-- entitlement. The UI keeps CareBase's existing help articles, Copilot, tickets, and course routes
-- in place; this flag adds an external entry point only after an intentional rollout decision.
-- It starts dark so a migration cannot expose an integration before the live Hub is verified.

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values (
  'support.central_hub',
  'Central CareMetric support hub',
  'Shared CareMetric help, learning, and support entry point while CareBase help and tickets remain available',
  'boolean', 'false'::jsonb
)
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values (
  'support.central_hub', 'off', false, 'support',
  'Initial registration; default off for phased rollout with CareBase help retained as the fallback'
)
on conflict (feature_key) do nothing;
