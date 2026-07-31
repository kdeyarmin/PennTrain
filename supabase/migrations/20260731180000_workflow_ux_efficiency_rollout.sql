-- Workflow UX efficiency rollout (2026-07-31)
--
-- Complements the frontend IA / Report Event / Trainer Gaps / purpose-label work by:
-- 1) Expanding the pilot cohort feature set with learning.video_watch_gate
-- 2) Documenting operator enablement for deskless notification reach
--
-- Flags stay default-off (global). Demo orgs already enrolled in carebase-pilot-2026
-- receive cohort membership so operators can flip rollout_mode=cohort + is_enabled
-- without per-tenant assignment for these capabilities.

insert into public.release_cohorts (cohort_key, name, description, is_active)
values (
  'carebase-pilot-2026',
  'CareBase pilot 2026',
  'Pilot tenants receive expanded notification delivery, critical multichannel fan-out, on-hire exclusion screening, and video watch gate when those flags are enabled in cohort mode.',
  true
)
on conflict (cohort_key) do update
set is_active = true,
    name = excluded.name,
    description = excluded.description,
    updated_at = now();

insert into public.organization_release_cohorts (
  organization_id, cohort_id, feature_key, assigned_by, reason
)
select
  o.id,
  c.id,
  f.feature_key,
  null,
  'Auto-enrolled demo/pilot organization for CareBase workflow UX efficiency rollout'
from public.organizations o
cross join public.release_cohorts c
cross join (
  values
    ('notifications.expanded_delivery_types'),
    ('notifications.critical_multichannel'),
    ('screening.on_hire_exclusion'),
    ('learning.video_watch_gate')
) as f(feature_key)
where c.cohort_key = 'carebase-pilot-2026'
  and o.is_demo is true
on conflict (organization_id, cohort_id, feature_key) do update
set reason = excluded.reason;

-- Ensure feature definitions exist (idempotent) for operator visibility in Platform Settings.
insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values
  (
    'notifications.expanded_delivery_types',
    'Expanded notification delivery types',
    'Email/SMS for credential/certificate/practicum expiry, course assigned, attestation assigned, and incident reported',
    'boolean', 'false'::jsonb
  ),
  (
    'notifications.critical_multichannel',
    'Critical multi-channel delivery',
    'Send critical alerts on both email and SMS when consented',
    'boolean', 'false'::jsonb
  ),
  (
    'screening.on_hire_exclusion',
    'On-hire exclusion screening',
    'Queue exclusion screening when a new employee is hired mid-cycle',
    'boolean', 'false'::jsonb
  ),
  (
    'learning.video_watch_gate',
    'Video minimum-watch gate',
    'Require training video blocks to be watched through before the learner can advance',
    'boolean', 'false'::jsonb
  )
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values
  ('notifications.expanded_delivery_types', 'off', false, 'notifications', 'Workflow UX efficiency rollout registration'),
  ('notifications.critical_multichannel', 'off', false, 'notifications', 'Workflow UX efficiency rollout registration'),
  ('screening.on_hire_exclusion', 'off', false, 'screening', 'Workflow UX efficiency rollout registration'),
  ('learning.video_watch_gate', 'off', false, 'learning', 'Workflow UX efficiency rollout registration')
on conflict (feature_key) do nothing;
