# CareMetric CareBase Feature and Functionality Enhancement Report

Date: July 16, 2026
Reviewed baseline: `kdeyarmin/penntrain` at `113748e` (`main`)

## Executive summary

CareBase now has broad, connected product coverage: training, competency, staffing, resident operations, inspection readiness, evidence rooms, work management, incident intake, scheduled reporting, offline learning, notifications, and governed automation all have real frontend and Supabase implementations. The highest-value work is no longer adding isolated modules. It is making those modules behave like one dependable operating system under real role, facility, failure, and scale conditions.

The first enhancement set in this branch improves the two newest command-center surfaces:

- **Today** now supports portfolio/facility scope, reports the full due-work count instead of the eight-row preview count, distinguishes overdue work, keeps its seven-day query key stable, exposes manual refresh state, and keeps auditor actions on auditor-accessible routes.
- **Value Center** now reports failures from facilities, value metrics, saved reports, staffing, and admissions instead of silently rendering zero/empty success states. Staffing no longer claims there are no exceptions when no facility has been selected.
- **Value baseline editing** now loads the organization's complete saved baseline, preserves dirty edits during refresh, resets safely, validates the server limits in the client, and confirms before creating or replacing the baseline. The tenant-scoped RPC now returns the missing hourly cost and a stable baseline version.
- **Operational report subscriptions** now support editable audience roles, in-app or email-link delivery, timezone-aware hour/day configuration, a server-calculated next-run preview, pause/resume, and per-schedule run history with queued and skipped delivery counts.

## Review method

The review traced the route/role matrix, sidebar destinations, the React Query hooks behind major workflows, the latest product-value migration, notification migrations, background export jobs, and representative admin, manager, trainer, auditor, and employee pages. It also reconciled the existing `END_USER_REVIEW.md` against current `main` so completed recommendations were not presented as new gaps.

Static coverage checks found 83 app pages that call domain hooks; 40 of those pages do not contain an explicit `QueryError` or `isError` branch. That is a prioritization signal, not proof that all 40 are broken, and each page should be verified before modification.

## What has improved since the prior end-user review

The earlier report is now a useful historical record, but many of its highest-priority findings are already complete:

- External delivery now covers assignment, credential, certificate, practicum, policy, incident, and due-reminder events, including critical multi-channel delivery.
- Users can manage contact information, SMS consent, preferred channel, and web push in Notification Settings.
- Assignment-due reminders and on-hire exclusion screening exist.
- Employee search, video watch gating/resume, server-synchronized learning responses, and offline learning exist.
- Confidential incident review, work queues, evidence rooms, saved reports, report schedules, and move-in workspaces have UI surfaces.
- Compliance binder creation is asynchronous and durable.
- The organization dashboard uses a server-side summary RPC instead of downloading six full tables.

## Prioritized current opportunities

| Priority | Opportunity | Current impact | Recommended next move | Status |
| --- | --- | --- | --- | --- |
| P0 | Make Today accurate and role-safe | Due-work counts were capped at eight; auditors were sent to manager-only Value Center, schedule, and handoff routes; facility scope was implicit | Add explicit portfolio/facility scope, uncapped summaries, overdue detail, refresh, and role-safe destinations | **Implemented here** |
| P0 | Make Value Center partial failures visible | Only the main workspace query had an error state. Failed value, staffing, admissions, or saved-report queries appeared as zero activity or healthy empty states | Give each secondary dataset loading/error/retry behavior and avoid success copy when the query is disabled | **Implemented here** |
| P1 | Load and preserve the current customer value baseline | The edit form starts from hardcoded sample values; the dashboard response does not expose `hourly_admin_cost`, so saving can overwrite a customer's established assumptions | Return the complete editable baseline from the RPC, hydrate once, show dirty state, and require confirmation before replacing it | **Implemented here** |
| P1 | Make report schedules operationally configurable | The UI fixed delivery to in-app, audience to managers, and cadence to three hardcoded times | Add audience, channel, delivery time/day, next-run preview, and per-schedule delivery history | **Implemented here** |
| P1 | Replace trainer dashboard fetch-all aggregation | `TrainerDashboard.tsx` downloads employees, facilities, classes, attendance counts, and a year of practicums, then aggregates in the browser | Add a trainer-scoped summary RPC plus bounded recent/attention lists, following `get_org_dashboard_summary` | Next |
| P1 | Finish failure-state adoption on high-risk pages | Many manager pages can still turn a failed query into an empty list or zero | Start with Alerts, Inspection Readiness, Reports, Policies, Background Checks, and Emergency Operations; add retry and accessible failure messaging | Next |
| P1 | Provide complete binder data beyond the PDF preview | Async binder generation is fixed, but each PDF section is intentionally capped at 200 rows | Attach a machine-readable CSV/JSON manifest or paginated appendix and show inclusion counts in the export UI | Next |
| P2 | Replace `Record<string, any>` in command-center contracts | New daily/product-value hooks have broad untyped payloads; schema drift can compile and surface as missing labels or false zeroes | Define exact RPC response interfaces, add runtime parsing at the boundary, and contract-test representative payloads | Next |
| P2 | Make major workspaces deep-linkable | Value Center tab and facility state are local only, so a user cannot bookmark or share the exact operating view | Store tab/facility in the URL and restore it on load, while validating access against visible facilities | Next |
| P2 | Add portfolio-to-facility drill-down consistency | Today now supports it, but Value Center defaults to the first facility and mixes organization-wide and facility-specific metrics | Add a clear portfolio option and label which cards are organization-wide versus facility-scoped | Next |

## Recommended implementation sequence

1. Build `get_trainer_dashboard_summary` and preserve only bounded recent class/attention lists in the client. This removes the most obvious remaining dashboard scale issue.
2. Adopt `QueryError` on the six high-risk pages listed above, with focused tests that distinguish true empty data from failed data.
3. Add binder manifest export so a PDF remains readable without becoming the only representation of a large compliance dataset.
4. Finish exact typing for the remaining daily/product-value RPC response fields and add runtime boundary parsing.
5. Make Value Center state URL-addressable before expanding more automation actions.

## Product guardrails

- Preserve the modular Supabase architecture, RLS-enforced tenant/facility scope, and server-authorized compliance mutations.
- Keep auditors read-only in both navigation and visible actions; do not depend on a route redirect or rejected mutation as the user experience.
- Never present a failed or disabled query as “zero,” “none,” compliant, or healthy.
- Keep automation allowlisted and human-approved where it can create operational or compliance records.
- Treat generated PDFs as readable summaries; provide a complete structured export when regulated records can exceed presentation limits.

## Verification completed for this enhancement set

- Workspace TypeScript checks pass.
- All 55 app test files pass (271 assertions), including focused Today, customer-value baseline, and report-schedule tests.
- A fresh isolated Supabase reset and all 57 pgTAP files pass (1,796 assertions), including baseline and report-schedule save/read/delivery round-trips.
- Database error-level lint and security/performance advisors pass with no error findings; generated database types match the isolated reset schema.
- The production build and bundle-budget check pass. Total JavaScript is at 90.9% of its budget, so bundle headroom should be addressed before expanding the Value Center further.
