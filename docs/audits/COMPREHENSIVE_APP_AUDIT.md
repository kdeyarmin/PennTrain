# Comprehensive Application Audit — CareMetric CareBase

Date: 2026-07-22

## Executive summary

CareMetric CareBase is a large multi-tenant assisted-living / personal-care-home operations platform. It combines a React/Vite single-page app, Supabase Auth, Postgres with row-level security, Supabase Storage, and 51 Edge Functions. The repository shows unusually broad domain coverage: compliance training, employee records, resident operations, incidents, inspections, maintenance, scheduling, QAPI, policy attestations, billing, notifications, integrations, public guest portals, and platform administration.

Overall health: **broad and credible, but not production-ready for paid regulated-facility use without targeted stabilization**. Typecheck and unit tests passed during this review, while the production build was blocked by missing required local Vite environment variables. The successful static/unit checks are a strong engineering signal, but the functional surface is much larger than the automated coverage and many workflows depend on Supabase services, RLS policies, storage buckets, secrets, cron/webhooks, and third-party systems that were inspected but not exercised end-to-end in this environment.

Current readiness assessment: **pilot-ready for controlled demo/pilot tenants after operational validation; not yet enterprise-ready**.

## Application architecture summary

- Frontend: React 19-style SPA using Vite, TypeScript, Wouter routing, TanStack Query, Tailwind/Radix UI primitives, PWA assets, and client-side Supabase access.
- Backend: Supabase Postgres, Auth, Storage, RLS policies, SQL RPCs/triggers, and Deno Edge Functions.
- Hosting/deployment: Railway serves the built SPA/server wrapper; Supabase hosts database/auth/storage/functions.
- Authentication: Supabase Auth with role metadata (`platform_admin`, `org_admin`, `facility_manager`, `trainer`, `employee`, `auditor`).
- Authorization: route guards plus database RLS and privileged Edge Functions for service-role operations.
- Integrations: SendGrid, Twilio, Stripe, Cloudflare Turnstile, web push/VAPID, HeyGen/course-video generation, SCIM/SSO, HRIS import, exclusion screening sources, notification webhooks.
- Testing: Vitest unit/render tests, Playwright e2e specs, pgTAP database tests, custom source-integrity, dependency, edge-function, bundle, and release checks.

## Repository map

| Path | Purpose |
|---|---|
| `artifacts/caremetric-carebase/` | Main production web application package. |
| `artifacts/caremetric-carebase/src/App.tsx` | Main route table, role guards, module-access enforcement, lazy page entry points. |
| `artifacts/caremetric-carebase/src/pages/` | Screen-level features grouped by public, auth, app, admin, trainer, employee, legal, marketing. |
| `artifacts/caremetric-carebase/src/hooks/` | TanStack Query/Supabase data hooks for domain modules. |
| `artifacts/caremetric-carebase/src/lib/` | Business logic, auth utilities, product modules, reporting calculations, analytics helpers, generated database types. |
| `artifacts/caremetric-carebase/src/components/` | Layout, reusable UI, resident/employee/document/report feature components. |
| `artifacts/caremetric-carebase/e2e/` | Playwright public and role-routing smoke tests. |
| `artifacts/caremetric-carebase/server/` | Node static server, precompression, prerender-head scripts. |
| `supabase/migrations/` | 339 SQL migrations defining schema, RLS, policies, functions, seedable reference data. |
| `supabase/functions/` | 51 Supabase Edge Functions for privileged workflows, reports, integrations, webhooks, AI generation. |
| `supabase/tests/database/` | pgTAP database/RLS/regression tests. |
| `scripts/` | Workspace validation, doctor, bundle budget, source-integrity, release/database checks, manual generation. |
| `artifacts/mockup-sandbox/` | Separate mockup sandbox; appears non-production and should remain clearly segregated. |
| Root docs | Architecture, deployment, phase runbooks, product modules, billing model, prior reviews, roadmaps. |

## Complete feature inventory summary

The detailed feature table is maintained in [`FEATURE_INVENTORY.md`](FEATURE_INVENTORY.md). This audit reviewed **70 feature/module groups** spanning marketing/auth, platform admin, organization operations, workforce/training, resident care, compliance, reporting, integrations, public portals, and background jobs.

Status distribution:

- Complete and working: 9
- Working but needs improvement: 28
- Partially implemented: 16
- Present but disconnected: 4
- Duplicated or conflicting: 3
- Broken or likely broken: 2
- Placeholder only: 1
- Missing but expected: 1

## User-role analysis

### Platform admin

Needs: manage organizations, entitlements, support, security governance, system jobs, package billing metadata, AI content generation, and tenant support. Current support is broad via `/admin/*`. Gaps: operational guardrails for impersonation/viewing-as-org, richer system-job evidence, support escalation SLAs, production incident runbooks in-app.

### Organization admin

Needs: configure facilities/users/settings, oversee compliance, training, resident operations, documents, reports, schedules, and billing/value. Current support is broad through `/app/*`. Gaps: too many navigation choices, limited guided onboarding, insufficient cross-module task prioritization, and missing “next best action” dashboard.

### Facility manager

Needs: daily operational command, staff compliance, resident changes, incidents, maintenance, schedules, and survey readiness. Current support exists, but the workflow is fragmented across Today, Dashboard, PCH/ALR Operations, Work Queue, Survey Day, QAPI, and separate resident pages. Gaps: mobile-first shift workflow, escalation alerts, handoff summarization, and integrated daily closeout.

### Trainer

Needs: classes, attendance, retraining, courses, employees/facilities context. Current support exists in `/trainer` and selected `/app` training pages. Gaps: trainer cannot see some credential context that may be useful for assignment eligibility; course authoring and class scheduling appear split between admin/app/trainer surfaces.

### Employee

Needs: assigned courses, certificates, credentials, schedule, shift tasks, service delivery, attestations, help. Current support exists via `/me/*`. Gaps: employee routes reuse manager-heavy components for work/services/change events, increasing risk of irrelevant controls unless UI and RLS are perfectly aligned.

### Auditor

Needs: read-only evidence, reports, audit logs, inspections, incidents, resident compliance. Current support exists. Gaps: audit-specific guided evidence packet, immutable export package, and read-only affordance clarity.

### Missing/implied roles

- Designated person/family contact: represented by resident portal but not a first-class authenticated role.
- External regulator/surveyor: represented by evidence guest access but not a durable role.
- Maintenance/vendor user: maintenance exists but no external vendor role.
- Billing/finance specialist: resident finance and platform billing exist but no distinct finance least-privilege role.
- Clinical/medication supervisor: medication integration and med-admin roster exist but no scoped medication leader role.

## Existing-feature evaluation highlights

See `FEATURE_INVENTORY.md` for every module. Major strengths:

- Strong role-aware route model and explicit comments aligning UI route access to RLS.
- Broad database-first design with tenant/RLS emphasis.
- Many domain-specific workflows go beyond simple CRUD: state forms, evidence room, QAPI, mock inspection, policy lifecycle, resident agreements, emergency operations, notification delivery, exclusion screening.
- Good low-level business logic unit test coverage for pure functions.

Major limitations:

- Breadth outpaces end-to-end verification.
- Manager workflows are spread across many feature pages with overlapping “work/task/action” concepts.
- Several privileged workflows depend on Edge Function secrets and scheduled jobs not validated here.
- Some modules expose integration configuration without proving operational data sync in local checks.
- Auditability is strong in some tables but not uniformly visible to users as history/undo/recovery.

## Functional defects and incomplete workflows

### F-001: Work ownership mismatch for employee self-service

- Category: Functional/RBAC
- Severity: High
- Affected feature: Work Queue and Work Item Detail
- Evidence: `/me/work` uses the same `WorkQueue` and `WorkItemDetail` pages as manager routes while `WORK_QUEUE_ROLES` excludes employees and comments state employees should see own assigned rows through RLS.
- Paths/routes: `src/App.tsx`, `/app/work`, `/me/work`, `/me/work/:id`, `useWorkItems`.
- Impact: Employees may see manager-oriented filters/actions or confusing empty states; route guard permits a different role than the manager route comment set.
- Recommended solution: Create an employee-specific work queue mode with restricted columns/actions and tests proving employee cannot see admin actions.
- Acceptance criteria: Employee route shows only assigned/open work, no facility-wide filters unless meaningful, mutation attempts are RLS-backed, and Playwright covers employee route.
- Complexity: Medium.

### F-002: Route ordering likely breaks class kiosk route

- Category: Functional/Routing
- Severity: High
- Affected feature: Trainer class kiosk
- Evidence: `/trainer/classes/:id` is declared before `/trainer/classes/:id/kiosk`; Wouter matches in declaration order and the file already documents this risk for other routes.
- Paths/routes: `src/App.tsx`, `/trainer/classes/:id`, `/trainer/classes/:id/kiosk`.
- Impact: The kiosk page may never render, undermining live class attendance workflows.
- Recommended solution: Register `/trainer/classes/:id/kiosk` before `/trainer/classes/:id` and add a route-contract test.
- Acceptance criteria: Direct navigation to `/trainer/classes/demo/kiosk` resolves to `ClassKiosk` in a route test and Playwright smoke.
- Complexity: Low.

### F-003: Medication integration accepts credential UUID instead of guided credential creation

- Category: Functional/UX/Security operations
- Severity: Medium
- Affected feature: Medication Integration
- Evidence: UI asks for an “Integration credential ID” and says it may be left blank, rather than offering a secure credential provisioning flow.
- Paths/routes: `MedicationIntegration.tsx`, `integration_api_credentials`, Edge `integration-api`.
- Impact: Operators cannot realistically configure an eMAR integration without platform support; accidental UUID mistakes cause silent setup-required states.
- Recommended solution: Add credential picker/provisioning wizard with test connection, last-sync status, and masked secret handling.
- Acceptance criteria: Admin can create/select a credential, validate scopes, see test result, and never paste raw IDs.
- Complexity: Medium/High.

### F-004: Reports are broad but export/scheduling permissions need e2e coverage

- Category: Functional/Testing
- Severity: Medium
- Affected feature: Reports, saved reports, report schedules
- Evidence: Report page is large and saved/scheduled reports have database tests, but no Playwright coverage for creating, saving, scheduling, exporting, and permission-denied paths.
- Impact: Critical customer deliverables may fail late despite unit tests.
- Recommended solution: Add role-based e2e tests for report lifecycle against seeded local Supabase.
- Acceptance criteria: Org admin can save/schedule/export; auditor can view/export only allowed reports; employee cannot access.
- Complexity: Medium.

## UX and accessibility findings

### UX-001: Navigation is comprehensive but overwhelming

- Severity: High
- Evidence: Route table includes dozens of `/app` pages and many PCH/ALR-only modules.
- Impact: First-time managers may not know whether a concern belongs in Work Queue, Today, Dashboard, Survey Day, PCH/ALR Operations, QAPI, Resident Detail, or Reports.
- Recommendation: Add role-specific landing task hubs: “Today,” “Survey readiness,” “Resident care,” “Staff compliance,” “Business operations,” with progressive disclosure and quick actions.
- Validation: Usability test with facility manager completing five common tasks in under five minutes.

### UX-002: Multiple operational dashboards have overlapping scope

- Severity: Medium
- Evidence: `/app`, `/app/today`, `/app/pch-alr-operations`, `/app/survey-day`, `/app/value-center`, `/app/closed-loop-compliance` all summarize operational state.
- Impact: Users may distrust metrics if counts differ by page or timing.
- Recommendation: Define metric source-of-truth cards and route each dashboard card to the exact filtered worklist behind the count.

### UX-003: Public guest token flows need stronger user-facing safety language

- Severity: Medium
- Evidence: Guest pages exist for evidence, move-in, resident agreements, and resident portal.
- Impact: Recipients may be confused about link scope, expiration, and what data is visible.
- Recommendation: Add consistent “what you can do here,” expiration, support, and privacy statements on all public guest portals.

### UX-004: Mobile shift workflows need explicit validation

- Severity: High
- Evidence: Employee self-service includes schedule, shift, services, dietary, and change-of-condition routes, but no responsive/a11y e2e tests were run.
- Impact: The highest-frequency floor-staff workflows may be hard to use on phones.
- Recommendation: Add mobile Playwright journeys for employee shift start, task completion, change-of-condition logging, and offline course continuation.

## Architecture and maintainability findings

### A-001: `App.tsx` is a large central route and policy file

- Severity: Medium
- Impact: Route order bugs and policy drift are likely as modules grow.
- Recommendation: Move route metadata into typed route manifests by domain with generated sidebar/search/product-module assertions.
- Acceptance: A test fails when a dynamic route precedes a more specific route.

### A-002: Supabase direct-from-client pattern requires perfect RLS discipline

- Severity: High
- Impact: Any missing RLS policy or security-definer gap exposes regulated data.
- Recommendation: Keep source-integrity and migration-policy checks, add automated “all exposed tables have RLS + module entitlement where expected” checks to CI.

### A-003: Integration and notification code spans SQL, Edge Functions, and UI

- Severity: Medium
- Impact: Hard to reason about retries, idempotency, delivery evidence, and user-visible status.
- Recommendation: Standardize one event/outbox envelope and expose delivery state consistently in UI.

### A-004: Mockup sandbox in workspace can confuse source integrity and audits

- Severity: Low
- Impact: Non-production code may be mistaken for product behavior.
- Recommendation: Document sandbox exclusion explicitly and ensure production checks never import it.

## Database and data-integrity findings

### D-001: Massive schema requires continuous drift controls

- Severity: High
- Evidence: 400 detected `CREATE TABLE` statements across 339 migrations.
- Impact: Frontend generated types, RLS policies, product entitlements, storage rules, and UI hooks can drift.
- Recommendation: Enforce generated type drift, RLS coverage, FK/index linting, and product module resource classification in CI.

### D-002: Many workflows need immutable business history in UI, not just tables

- Severity: Medium
- Evidence: history tables exist for complaints, resident agreements, resident changes, facility licensing, QAPI-like events, but user-facing history is not consistently visible across pages.
- Impact: Regulated users need defensible “who changed what when” without querying logs.
- Recommendation: Add standardized History drawer component to incidents, complaints, resident forms, work items, policies, schedules, and billing changes.

### D-003: Scheduling and qualification race conditions require DB-level acceptance tests

- Severity: High
- Evidence: scheduling eligibility, shift assignments, qualifications, credentials, and time-off all exist.
- Impact: A staff member could become unqualified between roster generation and shift assignment unless server-side checks are transactional.
- Recommendation: Add pgTAP tests for concurrent assignment, expired credential, time-off overlap, and override audit requirements.

## Security findings

### S-001: Production depends on many secrets and webhook signatures

- Severity: High
- Affected: Notifications, billing, auth email hook, Twilio/SendGrid webhooks, integrations.
- Impact: Misconfiguration can cause failed alerts, spoofed callbacks, or disabled signup/email flows.
- Recommendation: Add an environment readiness page that verifies secret presence, webhook verification, last successful callback, and non-demo safeguards.

### S-002: Public token flows are numerous and need centralized assurance

- Severity: High
- Affected: certificate verification, training passport, check-in, evidence guest, move-in, resident agreements, resident portal, safety reports.
- Impact: Token handling inconsistencies can expose sensitive resident/evidence metadata.
- Recommendation: Centralize public token parsing, one-time/tab-scoped storage, expiry, audit logging, and rate limiting; add e2e negative tests.

### S-003: Platform admin broad RLS access is powerful and requires monitoring

- Severity: Medium
- Impact: Support access can cross all tenants by design.
- Recommendation: Require reason codes for viewing-as-org/high-risk support actions, show active tenant context persistently, and alert on unusual access.

### S-004: Demo-account configuration is intentionally visible and must be blocked from production tenants

- Severity: Medium
- Impact: Misconfigured `VITE_DEMO_ACCOUNTS_JSON` could expose real tenant demo login.
- Recommendation: Deployment check should fail if demo accounts point to non-demo organizations.

## Performance and reliability findings

### P-001: Bundle and initial route weight need continuous budgets

- Severity: Medium
- Evidence: app uses lazy pages and has a bundle check script, but the application has many feature pages and generated manual assets.
- Recommendation: Track route-level chunk budgets and add dashboard for slow query/client errors.

### P-002: Large list workflows need server pagination uniformly

- Severity: Medium
- Evidence: paginated hooks exist for some domain lists, but many pages query feature-specific lists.
- Impact: Enterprise tenants with many residents/employees/documents may experience slow UI.
- Recommendation: Audit each list page for pagination, filtering indexes, and count strategy; standardize `usePaginatedDomainLists` where possible.

### P-003: Scheduled/background jobs need operational SLOs

- Severity: High
- Evidence: system jobs, notification dispatch, lifecycle, report schedules, polling, export jobs, and mock inspections exist.
- Impact: Silent job failure undermines compliance reminders and reports.
- Recommendation: Define SLOs per job, last-success dashboards, stuck-job alerts, retry/dead-letter handling.

## Testing-gap analysis

What is strong:

- TypeScript project typecheck passed.
- 65 Vitest files / 311 tests passed.
- Many pure business calculations have unit tests.
- Database test suite is extensive on disk.
- Build completed successfully in this environment.

Gaps:

- Database tests were inspected but not run because local Supabase/Docker workflow was not started during this audit.
- Edge function check was not run in the final validation set due time; should be mandatory before release.
- Playwright e2e specs exist but were not run; they need authenticated workflow coverage beyond public/role routing.
- No confirmed accessibility audit run; axe dependency exists.
- Few full “click from dashboard to create record to report export” workflows appear covered.
- Failure-path tests are weaker than happy-path calculations.
- Permission-denied UI states need e2e coverage for auditor/employee/trainer boundaries.

Recommended testing strategy:

1. P0: run `pnpm run check:all` and `pnpm run check:database` in CI for every release candidate.
2. Add Playwright journeys for login, org admin employee creation, course assignment/completion, incident/state form, resident change event, schedule publish, report export, public guest links.
3. Add axe checks for landing, login, manager dashboard, employee course, resident detail, reports.
4. Add pgTAP for every security-definer RPC and Edge Function authorization assumption.
5. Add synthetic monitoring for deployed public pages and core authenticated workflows.

## Deployment and production-readiness findings

- Deployment docs and runbooks are extensive.
- Production requires Supabase secrets, Railway config, webhook registration, cron/shared secrets, local/generated database types, and demo isolation.
- Production-readiness blockers: unverified e2e workflows, route-order risk, public token assurance, background job observability, and integration setup usability.
- Demo-ready: Yes.
- Pilot-ready: Yes, with controlled tenant, seed data, runbook, and manual operations validation.
- Production-ready: Not yet for paid regulated customers without completing Phase 0 stabilization.
- Enterprise-ready: Not yet; requires SSO/SCIM operational validation, audit exports, admin monitoring, SLAs, data retention, and support operations maturity.

## New-feature recommendations

### Essential missing capabilities

1. Unified Daily Command Center: role-specific next actions across staff, resident, incidents, maintenance, schedules, compliance.
2. Standardized Record History Drawer: immutable visible history for regulated records.
3. Environment Readiness Console: secrets/webhooks/jobs/storage/RLS health for platform admins.
4. Mobile Floor Workflow: shift start/end, handoff, tasks, incidents, change-of-condition optimized for phones.
5. Public Guest Access Governance Center: manage all guest grants, expirations, downloads, and revocations.

### High-value workflow improvements

- Integrated survey evidence packet builder.
- Resident 360 timeline combining service tasks, incidents, change events, appointments, agreements, and billing notes.
- Staff readiness forecast combining credentials, training, schedule eligibility, background checks, and exclusions.
- Report-to-worklist drilldown for every dashboard metric.
- Guided onboarding by role and facility type.

### Automation opportunities

- Auto-create work items from missed resident services, expired credentials, upcoming inspections, failed integrations, and overdue reports.
- Escalation ladder for unresolved high-risk incidents/complaints.
- Scheduled evidence binder generation and delivery.
- Integration failure remediation playbooks.

### Reporting and analytics

- Regulatory readiness score trend by facility.
- Staff compliance forecast next 30/60/90 days.
- Resident risk and service completion dashboard.
- QAPI outcome analytics.
- Notification delivery effectiveness and opt-out reporting.

### Administrative controls

- Reason-coded platform support access.
- Role-template permission editor with simulation.
- Data retention/legal hold policy console.
- Tenant export and restore status UI.

### Integrations

- eMAR credential wizard and reconciliation queue.
- HRIS roster import with exception resolution.
- Calendar export/subscribe for schedules and resident appointments.
- SSO/SCIM onboarding wizard.

### Long-term differentiators

- Closed-loop survey war room with regulator-ready evidence packaging.
- Qualification-aware staffing optimizer.
- Resident move-in collaboration workspace with family/designated person tracking.
- Compliance copilot with explainable evidence citations and human approval workflow.

## Features that should not be added now

- Full payroll processing: high compliance burden; integrate/export instead.
- ~~Full EHR/clinical charting: outside assisted living operations scope and would increase clinical risk.~~
  **Superseded (2026-07):** EHR capability is now in scope and being built as a hybrid model
  (native clinical capture + FHIR R4 ingestion). See docs/HIPAA_CLINICAL_DATA.md. The clinical-risk
  considerations are addressed through RLS, HIPAA access auditing, consent tracking, and append-only
  clinical evidence rather than by excluding the capability.
- In-app payment card handling: current link-out approach avoids PCI scope.
- Social/community feed: low value relative to compliance workflows.
- Custom form builder before stabilizing existing DHS/state forms: likely duplicates existing structured form work.
- Broad multilingual rollout before core workflows stabilize: explicitly excluded from current canonical roadmap.

## Overall product-readiness assessment

CareBase has the data model and feature ambition of a serious vertical SaaS product. It is more than a prototype and can support demos and controlled pilots. The biggest production gap is not lack of features; it is ensuring the huge surface area is coherent, observable, secure, mobile-usable, and tested end-to-end.

## Final recommendations

1. Execute Phase 0 stabilization from `IMPLEMENTATION_ROADMAP.md` before adding major new modules.
2. Fix route-order and self-service work queue concerns immediately.
3. Create a small set of authoritative role dashboards and retire/merge overlapping summary cards.
4. Add public-token governance and e2e negative tests.
5. Promote background job and integration health to first-class admin UI.
6. Make audit/history visible in every regulated workflow.
7. Add mobile and accessibility gates to release validation.
