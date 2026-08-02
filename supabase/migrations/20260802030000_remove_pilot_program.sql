-- Remove the CareBase pilot program (2026-08-02)
--
-- The 'carebase-pilot-2026' release cohort gated four features behind manual per-org
-- enrollment through the Pilot Cohort Console: a real (non-demo) organization got no
-- email, no SMS, and no error until a platform admin explicitly enrolled it (see the
-- retired docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md row A6). That gate and its console are
-- retired -- organizations should get full functionality the moment they sign up, like
-- any other customer, with feedback gathered the ordinary way rather than through a
-- formal pilot-enrollment step.
--
-- The general release-flag / cohort / kill-switch mechanism itself is untouched: other
-- already-shipped features (communications.announcements, training.portable_passport,
-- analytics.cross_tenant_benchmarks) already rely on the same tables in 'global' or 'off'
-- mode, so only the pilot-specific data and its console-only RPC are removed here.

update public.release_flags
set rollout_mode = 'global',
    is_enabled = true,
    change_reason = 'Pilot program retired; feature fully released to all organizations'
where feature_key in (
  'notifications.expanded_delivery_types',
  'notifications.critical_multichannel',
  'screening.on_hire_exclusion',
  'learning.video_watch_gate'
);

-- Cascade-deletes the matching organization_release_cohorts membership rows
-- (organization_release_cohorts.cohort_id references release_cohorts(id) on delete cascade).
delete from public.release_cohorts where cohort_key = 'carebase-pilot-2026';

-- Pilot Cohort Console support (added by 20260731210000_pilot_cohort_console.sql). The
-- console is deleted and no other caller exists; list_audit_legal_holds from that same
-- migration is unrelated (used by the data-lifecycle legal-hold UI) and stays.
drop function if exists public.unassign_organization_release_cohort(uuid, uuid, text, text);
