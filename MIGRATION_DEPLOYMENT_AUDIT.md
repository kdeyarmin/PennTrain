# Migration deployment audit

**Date:** 2026-07-23
**Project audited:** `xsqobvvreaovwibxwyvv` (Supabase, region `us-west-2`, Postgres 17) — the
project referenced by `supabase/config.toml` (`project_id`) and `DEPLOYMENT.md`.
**Question answered:** Is every migration in `supabase/migrations/` actually applied to the
remote database?

## Summary

| Metric | Count |
| --- | --- |
| Local migration files (`supabase/migrations/*.sql`) | 341 |
| Versions applied on the remote database | 270 |
| **Committed but NOT deployed (pending)** | **71** |
| Applied on remote with no local file (orphans) | 0 |

**Finding:** 71 migrations are committed to the repository (and present on `main`) but have
never been applied to the remote database. There are no orphan versions — every applied
migration still has a matching local file, so there is no reverse drift to reconcile.

## How the audit was done

1. Enumerated local migration versions from the 14-digit filename prefixes under
   `supabase/migrations/`.
2. Read the applied versions from the remote project's
   `supabase_migrations.schema_migrations` table (via the Supabase Management API — the same
   channel the Supabase CLI's `db push` and the MCP tools use).
3. Diffed the two sets in both directions.

This diff is now reproducible on demand — see [Preventing recurrence](#preventing-recurrence).

## Why the gap is non-contiguous (and why that is safe)

The 71 pending migrations are **not** simply "everything after a cutoff date." Four *later*
migrations were applied to the remote ahead of the 71 that precede them in filename order:

| Applied out of order | Domain |
| --- | --- |
| `20260713233707_state_form_document_analyzer` | Document analyzer |
| `20260713235042_document_analyzer_arg_defaults` | Document analyzer |
| `20260714012155_document_analyzer_hardening` | Document analyzer |
| `20260723120000_regulatory_updates_and_newsletter` | Regulatory updates / newsletter |

This is consistent with migrations having been applied piecemeal during development (e.g. a
single feature's migration applied directly to the remote) while the bulk deploy fell behind.

Two properties make backfilling the 71 safe despite the interleaving:

- **No object collisions.** The four out-of-order migrations create objects in isolated
  domains (`document_analyzer_jobs`, `regulatory_updates`, `newsletter_subscribers` and their
  functions/policies). None of the 71 pending migrations reference or recreate any of those
  objects, so applying the 71 cannot collide with what is already deployed.
- **No hidden back-dependency.** Because those four already applied cleanly, they did not
  depend on any of the 71. Applying the 71 therefore only *adds* to the schema — the result is
  a superset of today's state, not a conflicting one.

## Risk assessment of deploying the 71

- **Additive only.** No `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` in any of the 71. The nine
  `DELETE FROM` statements are domain-scoped reconciliation/backfill logic inside functions and
  triggers, not blanket data wipes.
- **Chain is CI-validated.** Every push to `main` runs the CI `database` job, which reapplies
  the *entire* migration chain from scratch (`supabase db reset --no-seed`) and then runs the
  RLS tests, `db lint`, and security/performance advisors. `main` is green, so the 71 apply
  cleanly on a fresh database and pass every gate.
- **Small live dataset.** The remote is lightly populated (2 organizations, 8 profiles, 16
  employees, 1 resident — demo/training data), so the usual "works on an empty DB but fails on
  populated data" risk (e.g. a new constraint that existing rows violate) is minimal.
- **Applied atomically per migration.** Each migration's DDL is applied together with its
  `schema_migrations` version record in a single transaction, so a failure rolls back cleanly
  and never leaves a half-applied, unrecorded migration.

## Deployment procedure

Deployment records each migration under its **exact filename version** so the history matches
the repo and future `supabase db push` runs treat them as already applied.

**Preferred (documented) path — Supabase CLI**, once linked to the project:

```bash
supabase link --project-ref xsqobvvreaovwibxwyvv
supabase db push --include-all   # --include-all applies pending versions that sort
                                 # before an already-applied one (the interleaving above)
```

A plain `supabase db push` can refuse here because the pending migrations sort *before* the
already-applied `20260723120000`; `--include-all` is what forces the out-of-order backfill.

**Equivalent path used for this audit — Management API**, when only a personal access token is
available (no database password / direct connection): each pending file is applied in filename
order through the project's `database/query` endpoint, followed by an insert into
`supabase_migrations.schema_migrations (version, name)` in the same transaction.

## Pending migrations (filename order)

 1. `20260713163602_environmental_work_orders.sql`
 2. `20260713183435_resident_administrative_master.sql`
 3. `20260713191708_resident_agreements_external_signatures.sql`
 4. `20260713220000_dietary_nutrition_food_safety_operations.sql`
 5. `20260713220001_emergency_operations.sql`
 6. `20260713221000_qualification_aware_scheduling.sql`
 7. `20260713230000_resident_services_calendar.sql`
 8. `20260713233413_operations_command_center_snapshot.sql`
 9. `20260713234406_incident_state_form_pdf_storage.sql`
10. `20260714000000_resident_financial_operations.sql`
11. `20260714000302_portfolio_operations_command_center.sql`
12. `20260714010000_citation_backed_regulatory_copilot.sql`
13. `20260714015500_signup_attempts_legal_versions.sql`
14. `20260714090000_platform_usability_search_foundation.sql`
15. `20260714090100_platform_usability_bulk_alerts.sql`
16. `20260714093000_daily_facility_operations_workforce.sql`
17. `20260714100000_resident_care_admission_transition.sql`
18. `20260714110000_enterprise_management_platform_operations.sql`
19. `20260714120000_personal_fund_backdate_guard.sql`
20. `20260714180000_repair_caremetric_epic_sql.sql`
21. `20260714202515_carebase_integrity_foundation.sql`
22. `20260714202956_shift_handoff_lifecycle.sql`
23. `20260714203000_atomic_employee_invite_provisioning.sql`
24. `20260714203840_workforce_self_service.sql`
25. `20260714204734_resident_360_timeline.sql`
26. `20260714205323_facility_license_lifecycle.sql`
27. `20260714210309_medication_integration_boundary.sql`
28. `20260714210311_designated_person_portal.sql`
29. `20260714214435_remediate_p1_authorization_findings.sql`
30. `20260714233041_remediate_p2_security_findings.sql`
31. `20260715032000_restore_authenticated_policy_command_grants.sql`
32. `20260715183831_platform_intelligence_web_push_and_lifecycle.sql`
33. `20260715195556_complete_platform_roadmap.sql`
34. `20260715201800_refresh_help_center_healthcare_language.sql`
35. `20260715210000_individual_course_compliance_credits.sql`
36. `20260715211000_seed_individual_dhs_annual_courses.sql`
37. `20260715212000_comprehensive_course_content_standard.sql`
38. `20260715213000_full_pch_alr_individual_courses.sql`
39. `20260715214000_full_chapter_6400_individual_courses.sql`
40. `20260715215000_full_clinical_individual_courses.sql`
41. `20260715215810_complete_product_experience_roadmap.sql`
42. `20260715216000_monotonic_course_progress.sql`
43. `20260715217000_course_catalog_activation_permission.sql`
44. `20260715224500_align_qr_checkin_with_training_lifecycle.sql`
45. `20260716160000_product_value_operating_system.sql`
46. `20260716221235_remediate_policy_attestation_security.sql`
47. `20260716224753_close_remaining_security_boundaries.sql`
48. `20260716230000_demo_requests.sql`
49. `20260717014501_expose_customer_value_baseline.sql`
50. `20260717015547_enforce_notification_operations_and_realtime.sql`
51. `20260717021844_operational_report_schedules.sql`
52. `20260717024529_generate_paged_compliance_reports.sql`
53. `20260717031000_paged_domain_lists_and_realtime.sql`
54. `20260717155120_resolve_alert_list_link_targets.sql`
55. `20260717160155_optimize_rls_policy_plans.sql`
56. `20260717163659_demo_playground_seed_and_reset.sql`
57. `20260717180514_preserve_facility_manager_org_alert_visibility.sql`
58. `20260720193217_modular_product_entitlements.sql`
59. `20260720205629_configurable_hybrid_subscription_pricing.sql`
60. `20260721031500_tenant_bind_administrator_qualification.sql`
61. `20260721120000_atomic_resident_monthly_charge_posting.sql`
62. `20260721120001_resident_representative_payee_profiles.sql`
63. `20260721160000_survey_day_mode.sql`
64. `20260721170000_align_web_push_notification_spend_cost.sql`
65. `20260721180000_complaint_list_summary.sql`
66. `20260721190000_evidence_collection_list_summary.sql`
67. `20260721200000_confidential_intake_list_summary.sql`
68. `20260721210000_work_item_queue_and_summary.sql`
69. `20260721220000_org_feature_enabled.sql`
70. `20260721230000_survey_day_binder_autopin.sql`
71. `20260723010000_savings_model_requests.sql`

## Deployment status

**Resolved — all 71 pending migrations deployed on 2026-07-23.**

- Applied all 71 in filename order via the Supabase Management API `database/query` endpoint,
  each migration's DDL committed atomically with its `schema_migrations` version record.
- Remote applied-version count: **270 → 341**, matching the 341 local migration files exactly.
- `pnpm run check:migration-drift` now reports **in sync** (341 local, 341 applied, 0 pending,
  0 orphan).
- Post-deploy security advisors: **0 error-level** findings. The remaining advisories are
  WARN/INFO — the same `security definer` executable-function and `rls_enabled_no_policy`
  advisories the full chain produces on a fresh database, which CI already accepts via
  `db advisors --fail-on error`. No new error-level issues were introduced.

## Root cause

CI proves migrations are *internally consistent* (it reapplies the whole chain on a throwaway
local stack) but nothing checks that they are *deployed*. Remote deployment is a manual step
(`supabase db push`, or the Supabase GitHub integration) with no gate that fails when the repo
is ahead of the remote — so migrations accumulated in the repo for ~10 days without being
applied, and nothing surfaced it.

## Preventing recurrence

`scripts/check-migration-drift.mjs` (npm script `check:migration-drift`) reproduces this audit
on demand. It compares local migration versions against the remote
`schema_migrations` table and exits non-zero when the repo is ahead of (or behind) the remote:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... pnpm run check:migration-drift
```

Run it after every deploy, or wire it into the deploy pipeline (it needs a Supabase access
token, so it belongs in a credentialed deploy step rather than untrusted PR CI). A green run is
the proof that "every migration is deployed."
