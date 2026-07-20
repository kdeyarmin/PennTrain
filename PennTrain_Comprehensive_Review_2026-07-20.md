# PennTrain / CareMetric CareBase comprehensive review

**Repository:** [kdeyarmin/PennTrain](https://github.com/kdeyarmin/PennTrain)<br>
**Reviewed branch and commit:** `main` at `e027aef3a1fbafc4c6449a1d7dbe8358f8e4dc74`<br>
**Review date:** July 20, 2026<br>
**Scope:** product, UX, application architecture, frontend, Supabase/Postgres, Edge Functions, privacy/security boundaries, testing, CI/CD, release readiness, and feature opportunities.

## Executive assessment

PennTrain is no longer a small training tracker. The repository contains a broad assisted-living and personal-care operating system: learning and competencies, staffing, resident operations, incident and complaint workflows, inspection readiness, evidence rooms, reporting, notifications, integrations, compliance automation, billing/SSO/SCIM foundations, and role-specific experiences.

The architecture is unusually disciplined for the breadth of the product. It has strong tenant-aware RLS patterns, substantial database tests, generated database types, lazy-loaded frontend routes, PWA/offline learning support, audit/evidence concepts, guarded regulatory automation, build budgets, and a serious CI pipeline.

The main risk is now **feature surface outrunning operational proof and product cohesion**. The highest-value next move is not another disconnected module. It is to make the existing system demonstrably safe, dependable, understandable, and easy to operate at real tenant scale.

The first actions I would take are:

1. Fix the dependency scanner, which currently skips most lockfile entries while CI treats it as the vulnerability gate.
2. Prevent free-form shift-handoff narratives from reaching email, SMS, or push notifications.
3. Repair the organization-export workflow before describing it as complete or seven-day-expiring.
4. Correct the export worker's cron-secret mismatch and fail closed when the secret is unavailable.
5. Execute the repository's controlled-pilot process and record evidence before promoting default-off capabilities.
6. Add a shared organization/facility scope control so pages cannot silently act on the first accessible facility.
7. Make confidential reporting usable through facility-bound links/QR codes and a recovery portal.
8. Expose learner transcripts and add real captions.
9. Test the production Node server and deploy the exact artifact that passed CI.
10. Preserve bundle headroom and add honest error states before expanding the application shell.

**Second-pass correction:** a deeper latest-state and connected-workflow audit found three additional release blockers that should move ahead of feature expansion: close the administrator-qualification cross-tenant write path, align the Stripe webhook parser with the documented API version, and make the medication/eMAR command contract reachable through the Edge integration gateway. The detailed addendum below also adds offline data-loss, portal-inbox, Realtime, reporting, billing, and migration-provenance findings.

## Review method and limitations

The review combined:

- Static inspection of the current `main` tree.
- Repository and GitHub activity review, including recent pull requests, issues, and releases.
- Product-flow inspection across all major roles.
- Focused architecture, backend, RLS, data-lifecycle, notification, AI, and export reviews.
- Local install, type checking, unit tests, Edge Function checks, production build, source-integrity checks, and bundle-budget checks.
- Comparison with the repository's existing implementation plans, enhancement reports, pilot runbook, and feature specifications to avoid recommending work that has already shipped.

This was not a production audit. I did not have production data, provider credentials, telemetry, a running Supabase stack, or representative end users. A local Supabase reset, pgTAP execution, and the full browser suite were therefore not run in this workspace. The repository's CI does define those stages.

## Repository and delivery snapshot

| Area | Current snapshot |
|---|---:|
| Frontend page source files | 144 |
| Deployable Edge Functions | 50 |
| Database migrations | 326 |
| Database test files | 64 |
| Frontend unit-test files | 59 |
| Frontend unit tests | 287 passing |
| Recent pull-request sample | 97 merged, 2 closed unmerged, 1 open draft among the latest 100 |
| Public GitHub issues at review time | 0 open |
| GitHub releases at review time | None |

The high merge velocity is a strength, but it also increases the need for release provenance, focused stabilization periods, and independent human review of changes involving resident data, regulatory logic, notifications, identity, and tenant boundaries. Recent sampled pull requests had extensive automated review; high-risk changes should also have explicit human domain/security/compliance sign-off.

If GitHub is intended to be the engineering system of record, the empty [issue tracker](https://github.com/kdeyarmin/PennTrain/issues) and empty [release history](https://github.com/kdeyarmin/PennTrain/releases) should be replaced with a curated backlog, milestones, tagged releases, and release notes. If planning intentionally lives elsewhere, the README should say so.

## What is already strong

### Product and UX foundations

- Six differentiated roles have real application surfaces rather than placeholder dashboards.
- The app covers training, competencies, credentials, schedules, resident operations, incidents, inspections, evidence, reporting, notifications, integrations, and enterprise administration.
- Route-level lazy loading, server-side pagination on several high-volume surfaces, realtime alerts/notifications, and PWA/offline learner support are already present.
- The application has thoughtful compliance concepts: governed sources, receipts, evidence IDs, human review, rule-version lifecycle, corrective actions, and audit trails.
- Recent work has already delivered several items that older reports still describe as future work, including alerts/reports scaling, realtime alert behavior, role demo sandboxes, setup guidance, and citation-backed Plan of Correction drafting.

### Security and backend foundations

- Tenant isolation is strong across most of the latest migration state, but the second pass found one confirmed cross-tenant integrity exception in administrator-qualification self-service. That correction is documented in the addendum below.
- Tenant and role helpers generally require active profiles and explicit organization/facility access.
- Sensitive identity operations perform caller-scoped authorization before service-role work and require recent AAL2 in important paths.
- Webhook signing, replay controls, provider-error sanitization, SSRF defenses, DNS pinning, guest-token reauthorization, and URL token scrubbing are strong patterns.
- Regulatory and AI features have global kill switches, default-off behavior, human-review constraints, and grounded receipts.

### Engineering foundations

- GitHub Actions are pinned, installs are frozen, and CI includes application checks, clean database reset, pgTAP, database lint/advisors, generated-type drift, browser/accessibility journeys, and secret scanning.
- The modular-monolith architecture is appropriate for this stage of the product.
- The app has error boundaries, query caching, build-time environment validation, PWA generation, prerendering, precompression, and explicit bundle budgets.
- Source-integrity checks found no placeholder/TODO-style implementation stubs in the application source.

## Validation results

| Check | Result | Notes |
|---|---|---|
| Dependency installation | Passed | Used the repository-pinned pnpm 11.13.0 and a compatible Node 24 runtime. |
| Source integrity | Passed | Repository check scanned 1,082 source files. |
| TypeScript | Passed | All three checked workspace projects passed. |
| Frontend unit tests | Passed | 59 files, 287 tests. |
| Edge Function checks | Passed with a coverage caveat | All 50 deployable functions were checked; only 3 have handler-level runtime tests, plus shared runtime tests. |
| Production build | Passed | 2,691 modules transformed; PWA, prerendering, and precompression completed. |
| Bundle budget | Passed narrowly | Largest JS chunk 470.6 KiB (92.3% of cap); all JS 3,371.0 KiB (91.1%); CSS 87.2%; initial shell 89.6%. |
| Dependency advisory command | Misleading pass | It reported no vulnerabilities among 225 parsed packages, but the lockfile contains 619 package entries and the parser omits 393 unquoted entries. |
| Local database reset / pgTAP | Not run locally | Requires the Supabase/Docker environment; covered by repository CI configuration. |
| Full Playwright journeys | Not run locally | CI is configured for them, but it currently targets Vite preview rather than the production Node server. |

The build initially stopped only because documented build-time environment values were absent; it passed with non-secret validation placeholders. That is expected build-contract behavior, not a product defect.

## Prioritized technical and operational findings

Priority meanings:

- **P0:** fix before a broader production pilot or GA promotion.
- **P1:** next release cycle; material reliability, privacy, or scale risk.
- **P2:** important architecture and maintainability work that can be staged.

### P0-1 — The dependency vulnerability gate skips most lockfile entries

**Evidence:** `scripts/check-dependencies.mjs:35` matches only quoted pnpm lockfile keys. The current `packages:` section has 619 entries: 226 quoted and 393 unquoted. CI invokes this check at `.github/workflows/ci.yml:37-38`. Skipped examples include `esbuild`, `react`, `vite`, and `vitest` at `pnpm-lock.yaml:2307`, `:2995`, `:3414`, and `:3454`.

**Impact:** CI can report a clean dependency audit even when an omitted package has a high- or critical-severity advisory. The current result, “No vulnerabilities found,” applies only to the subset the parser recognized.

**Recommendation:** parse the YAML structurally with the pnpm lockfile/YAML parser instead of regex. Add fixtures for quoted and unquoted scoped/unscoped packages, assert the expected package count, and fail the check when parser coverage unexpectedly drops.

**Effort:** small.

### P0-2 — Shift-handoff narratives can leave the platform through external notifications

**Evidence:** shift reports can contain resident-linked condition changes, falls, treatment concerns, behavior, and skin concerns (`20260714093000_daily_facility_operations_workforce.sql:33-49`). Assignment and escalation notifications copy up to 500 characters of the note/narrative (`20260714202956_shift_handoff_lifecycle.sql:104-107,248-250`). These notification types are externally eligible (`20260715215810_complete_product_experience_roadmap.sql:1512-1523`). The external renderer sanitizes only three named notification types and otherwise falls back to the original title/body (`supabase/functions/_shared/notificationDelivery.ts:155-184`), which the dispatcher sends to email, SMS, or push providers.

**Impact:** free-form operational or clinical content may be disclosed through channels with weaker privacy controls, lock-screen previews, shared inboxes, or vendor processing.

**Recommendation:** make external content generic by default and allowlist only reviewed, non-sensitive templates. Keep detail inside authenticated CareBase. Add a test that enumerates every externally eligible notification type and proves no free-form narrative is rendered.

**Effort:** small to medium.

### P0-3 — The organization export does not yet meet its “complete” and expiring contract

This is one product promise with several connected implementation gaps:

- Export jobs record a seven-day `expires_at`, but the Storage select policy checks bucket, role, and tenant folder without checking the associated job's expiry (`20260715215810_complete_product_experience_roadmap.sql:534-614`). No scheduled object deletion path was found.
- Table discovery includes only tables with a direct `organization_id` column (`:764-784`). Tenant-owned child tables such as `course_progress`, `quiz_attempt_answers`, `training_plan_items`, `training_class_attendees`, and `facility_assignments` are therefore omitted.
- Documents are represented by one-hour signed URLs rather than included binaries (`process-organization-export-jobs/index.ts:120-146`), while the archive is advertised for seven days.
- Rows and ZIP byte arrays are accumulated in memory and synchronously compressed (`:149-185`). Offset pagination is performed across separate requests without a consistent snapshot (`20260715215810_complete_product_experience_roadmap.sql:787-829`). Large or actively changing organizations can produce incomplete, duplicated, or failed archives.

**Impact:** the archive may omit tenant data, remain retrievable after its represented expiry, contain document links that expire long before the archive, and fail at larger tenant sizes.

**Recommendation:** temporarily label this as a beta/partial export. Build a versioned tenant export graph, schema-coverage tests, keyset pagination, an export watermark or consistent snapshot, embedded document binaries, manifest checksums, streamed/chunked archive construction, expiry-aware authorization, and scheduled deletion. The evidence center should display schema version, table/document counts, checksum, expiry, deletion status, and retries. Validate the worker design against current [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits).

**Effort:** medium to large.

### P0-4 — The automatic export worker likely authenticates with the wrong secret

**Evidence:** deployment instructions create the Vault secret `cron_shared_secret` (`DEPLOYMENT.md:79-82`), and hardened cron jobs use that lowercase name. The export cron queries uppercase `CRON_SHARED_SECRET` and falls back to the literal `local-development-cron-secret` (`20260715215810_complete_product_experience_roadmap.sql:1763-1776`). The Edge worker validates against its `CRON_SHARED_SECRET` environment value (`supabase/functions/_shared/cronAuth.ts:41-55`).

**Impact:** a correctly configured deployment is likely to receive 401 responses for automatic export processing. Matching production to the fallback would weaken the control.

**Recommendation:** use the documented Vault secret name, remove the development fallback from production SQL, fail closed when the secret is missing, and add a deployment smoke test that creates, claims, and completes one export job.

**Effort:** small.

### P0-5 — Code completeness has not been converted into pilot evidence

**Evidence:** `CONTROLLED_PILOT_RUNBOOK.md` states that capabilities remain pilot-only until a complete evidence manifest exists. `pilot/controlled-pilot.template.json` is still a blank template whose checks have placeholder `failed` status and no evidence. Several meaningful capabilities remain behind default-off flags, including expanded notification delivery, on-hire exclusion screening, video watch gating, critical multichannel delivery, and cross-tenant benchmarks.

This does **not** prove that production has failed those checks; it means the repository contains no completed pilot artifact proving they passed.

**Recommendation:** run a 14–30 day controlled pilot with representative PCH/ALF tenants and retain the signed manifest outside the repository if it contains sensitive evidence. Promote flags by exit criteria, not by code-complete status. Track notification delivery, false-positive/false-negative compliance results, evidence-export reconciliation, backup restore, tenant boundary checks, support volume, and workflow completion.

**Effort:** operational, cross-functional.

### P1-1 — Regulated AI needs tenant-level governance before activation

**Evidence:** Compliance Copilot can collect resident names/rooms and employee names/job titles and send grounded prompts to Anthropic (`compliance-copilot/index.ts:162-177,232-240,296-305,415-430`). Resident assessment summaries serialize substantial assessment content before provider submission (`generate-resident-assessment-summary/index.ts:203-214,318-328`). Current controls are global platform flags rather than organization-specific consent. The migration introducing wellness summaries explicitly notes that a vendor BAA was not yet confirmed.

**Existing strengths:** these features default off, are role/RLS guarded, have kill switches, human-review constraints, and receipt/checksum concepts.

**Recommendation:** require tenant-admin opt-in with BAA/DPA attestation, define data-residency/provider settings, minimize or pseudonymize names, rooms, and IDs, create feature-specific disclosure policies, and add redaction tests before activation.

**Effort:** medium to large.

### P1-2 — Retention archiving can defeat the declared maximum retention period

**Evidence:** lifecycle work copies complete source payloads into `app_private.retained_records_archive` (`20260715183831_platform_intelligence_web_push_and_lifecycle.sql:1450-1468`). Product events are described as having a 13-month maximum (`:1495-1506`), but no purge path for archived payloads was found. The lifecycle function's held-record counter is initialized but never updated (`:1524-1531,1607-1611`).

**Recommendation:** define archive-specific TTLs, purge or partition archived payloads after the true maximum while honoring legal holds, calculate held counts correctly, and add end-to-end tests for expiry, hold, release, and purge.

**Effort:** medium.

### P1-3 — Notification dispatch can exceed the Edge execution window

**Evidence:** the dispatcher claims batches of 100, permits a 15-second provider timeout, and awaits each delivery sequentially (`dispatch-notifications/index.ts:31-33,449-540`). A small run of provider timeouts can consume the function's available request time.

**Existing strengths:** durable attempts, concurrency-safe claims, stale-lease recovery, bounded retries, cancellation checks, and quarantine for ambiguous provider outcomes are already present.

**Recommendation:** give every invocation a time budget, use smaller batches or bounded provider-specific concurrency, stop claiming new work near the deadline, release unstarted claims, and add an all-provider-timeout test.

**Effort:** medium.

### P1-4 — CI does not exercise the production server or deploy the tested artifact

**Evidence:** the app distinguishes Vite preview from its custom Node production server in `artifacts/caremetric-carebase/package.json:9-10`, but Playwright starts `pnpm run serve` (`playwright.config.ts:22-26`). The custom server's security headers, compression negotiation, base path, stale-asset recovery, health response, and 404 behavior are therefore outside the browser suite. CI uploads an immutable dist artifact (`.github/workflows/ci.yml:43-49`), while Railway independently rebuilds from source (`railway.json:3-5`).

**Recommendation:** add production-server contract tests and a small Playwright project running `pnpm start`. Promote the exact SHA-addressed artifact that passed application, database, and secret checks. Include the release SHA in `/health` and the platform-status surface.

**Effort:** medium.

### P1-5 — Several critical screens can look healthy when their queries fail

**Evidence:** `TrainerDashboard.tsx:33-39` loads facilities, employees, classes, attendee counts, and current-year practicums, then aggregates in the browser. Most query errors are not rendered; when the data is absent, the page can display “All facilities are compliant” (`:265-270`). `InspectionReadiness.tsx:62-79` combines many queries but only exposes limited loading state and can render “No prioritized readiness gaps.” `PolicyDocuments.tsx:84-109`, `BackgroundChecks.tsx:69-72`, and `SystemJobs.tsx:63-72` also have important query paths without a corresponding visible failure state.

**Impact:** a transient authorization, network, or database failure can be mistaken for no risk, no work, or healthy status.

**Recommendation:** introduce a shared aggregate-query state that distinguishes loading, partial, stale, empty, and failed. Add retry and telemetry. Move trainer summary aggregation into a bounded, authorization-checked RPC such as `get_trainer_dashboard_summary`, and paginate/drill into detail rather than loading complete organization lists.

**Effort:** medium.

### P1-6 — Compliance binder PDFs intentionally truncate data at 200 rows

**Evidence:** `generate-compliance-binder/index.ts:25` defines `MAX_LISTED_ROWS = 200`; multiple sections slice to that cap at lines 619, 653, 681, 703, 731, 762, 789, 818, 840, and 864.

**Impact:** the PDF remains readable, but a large tenant's binder is not a complete itemized export. That distinction matters during audits and discovery.

**Recommendation:** keep the readable PDF summary, but attach a complete machine-readable CSV/JSON manifest or paginated appendix. Show included/total counts, generation time, source watermark, and checksum in the UI. Never label the PDF itself as complete when rows are omitted.

**Effort:** small to medium.

### P1-7 — Bundle budgets pass with little room for another shell-level feature

**Evidence:** the largest JS chunk is 470.6 KiB, 92.3% of its 510 KiB cap; aggregate JS is 91.1% of cap; the initial shell is 89.6%; CSS is 87.2%. The global `CareMetricCopilot` is statically imported into `MainLayout.tsx:14,161`, even though its engine is a sizeable feature used on demand.

**Recommendation:** analyze the entry composition, defer the assistant and other optional shell features, split heavy report/editing surfaces, and add route-level loading budgets based on the actual build graph. Do not solve this by merely raising caps.

**Effort:** medium.

### P1-8 — Runtime tests cover only 3 of 50 Edge handlers

**Evidence:** `scripts/check-edge-functions.mjs:84-96` enforces a minimum of three handler-level runtime tests. Shared helpers and type checks add value, but most deployed HTTP boundaries are not executed as handlers.

**Recommendation:** prioritize auth/user provisioning, cron authentication, Stripe/SendGrid/Twilio webhooks, notification dispatch, organization export, and integration API handlers. Update the existing enhancement item rather than creating a duplicate roadmap entry.

**Effort:** large and incremental.

### P2 findings

| Finding | Evidence and action |
|---|---|
| Admin identity updates can partially succeed | `admin-update-user/index.ts:117-138` mutates Auth before the profile RPC. Preflight invariants and implement an idempotent saga/reconciliation path with injected-failure tests. |
| Public JSON endpoints parse unbounded bodies | `signup-organization`, `request-demo`, and `submit-confidential-intake` parse JSON before bot/rate controls. Reuse a bounded JSON parser with content-type, declared-length, and actual-byte checks. |
| Type contracts are weakest at important data boundaries | A raw search found 163 broad `any`/cast patterns across app and functions. Prioritize exact RPC/Edge response schemas in `useDailyOperations.ts`, `useProductValueOperatingSystem.ts`, `DietaryOperations.tsx`, and `compliance-copilot/index.ts`; do not mechanically eliminate legitimate library-boundary casts. |
| Route and role facts are duplicated | Router, navigation, search, and permissions are repeated across `App.tsx`, `Sidebar.tsx`, and `appDomains.ts`. Create one typed route registry and keep legacy redirects separate. |
| Several core files are too large | `ResidentAssessmentFormEditor.tsx` is about 2,346 lines, `CourseDetail.tsx` about 1,790, and `EnterpriseFoundation.tsx` about 1,261. Split state machines, queries, forms, and renderers into tested domain units. |
| Edge HTTP plumbing is repeated | 43 of 50 functions define local CORS/response handling. Add a small shared request wrapper for methods, body limits, correlation IDs, safe errors, and structured logging while retaining handler-specific authorization. |
| Static quality rules are permissive | No linter is configured; several strict TypeScript checks are disabled and app tests are excluded from its primary tsconfig. Add Biome/ESLint and tighten flags gradually. |
| CI failure diagnosis is weaker than its test breadth | Playwright retains traces/screenshots/video, but CI does not upload them. Add artifact upload, workflow concurrency cancellation, job timeouts, dependency caching, and a small WebKit/iPhone learner/PWA smoke project. |
| Toolchain docs disagree | `package.json` and `AGENTS.md` pin pnpm 11.13.0, while `README.md:45` and `.devcontainer/Dockerfile:11` still reference pnpm 10.28.1. Align the dev container and documentation. |

## Second-pass addendum: connected workflows and latest-state controls

The second pass traced features across their complete path: route to hook, Edge gateway, RPC/table, background job, and return workflow. It also checked route reachability, migration history, offline restart behavior, enterprise permissions, billing, portal operations, Realtime freshness, print/export behavior, and mobile/accessibility details. These are new findings; they do not repeat the first-pass list above.

### SP-P0-1 — Administrator qualification self-service permits cross-tenant writes

**Evidence:** the self-service insert policy allows a row whenever `profile_id = auth.uid()` without requiring the row's `organization_id` to equal the caller's organization (`20260705162010_administrator_qualification_rls.sql:14-18`). The update policy has the same issue in both `USING` and `WITH CHECK` (`:20-28`), so an owner can also move their row. The table has independent profile and organization foreign keys but no consistency constraint (`20260705161957_administrator_qualification_core.sql:4-7`). A victim organization's administrators and auditors then see the poisoned row through the organization branch of the select policy (`20260705162010_administrator_qualification_rls.sql:8-12`). The document bucket's self-service branch checks only the second path segment against the caller profile, not the first organization segment (`20260705162022_administrator_documents_storage_bucket.sql:7-38`). No later migration replaces these policies or adds the missing invariant.

**Impact:** any authenticated user who knows another organization UUID can create or move their own administrator-qualification record into that tenant and upload a document beneath that tenant's prefix. This is a cross-tenant integrity/data-poisoning flaw, not a confirmed read disclosure, but it can corrupt compliance evidence and consume another tenant's storage.

**Recommendation:** ship a corrective migration that binds self-service rows to the active profile's actual organization, enforces profile/organization consistency in a trigger or composite relationship, and validates both storage path segments. Add pgTAP tests proving an ordinary employee cannot insert, move, or upload into another tenant.

**Effort:** small. **Release posture:** P0.

### SP-P0-2 — The documented Stripe API version and webhook parser disagree

**Evidence:** billing requests pin `2026-02-25.clover` (`supabase/functions/_shared/phase2Billing.ts:1,92-104`), and the operations guide documents that version (`PHASE2_OPERATIONS.md:174-177`). The SQL webhook processor still reads subscription periods from top-level `current_period_start` and `current_period_end` (`20260711200648_phase2_billing_and_entitlements.sql:964-967`) and the subscription ID from top-level `invoice.subscription` (`:1043-1047`). Stripe removed the subscription-level period fields in favor of `items.data[].current_period_*` and moved invoice subscription provenance under `parent.subscription_details.subscription` beginning with `2025-03-31.basil`; those breaking changes precede and carry into the documented Clover version. The database tests use the old payload shape (`phase2_billing_integration.test.sql:162-174,225-230`) rather than a fixture from the pinned API version. See Stripe's official [subscription-period change](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) and [invoice parent-field change](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects).

**Impact:** under the documented/current event shape, subscription periods are stored as null and invoices can lose their subscription relationship. Billing and entitlement reconciliation can then show incomplete or incorrect state. In addition, the event receipt and canonical processing occur in one database transaction (`:809-858`); an exception rolls back the receipt even though the table models `failed` and `processing_error` states (`:337-350`), leaving failure evidence dependent on Edge logs.

Live impact depends on the API version configured on the Stripe webhook endpoint; the handler currently neither records nor validates `event.api_version` (`stripe-billing-webhook/index.ts:33-44`). That uncertainty is itself a deployment-contract gap.

**Recommendation:** make webhook endpoint version an explicit deployment contract; parse the documented shape; use versioned, captured Stripe fixtures; assert periods and invoice linkage; and persist receipt/verification before a retryable processing stage. Do not enable paid cohorts until reconciliation passes with live Stripe test-mode events.

**Effort:** medium. **Release posture:** P0 for billing activation.

### SP-P0-3 — The medication/eMAR import contract cannot pass through its Edge gateway

**Evidence:** the generic integration gateway requires `commands:write` for every command and accepts only schema version `2026-07-11` (`supabase/functions/integration-api/index.ts:35-42,96-104`; `_shared/phase2Integration.ts:1`). The later medication boundary intentionally defines `medication.snapshot.import` version `2026-07-14` and the least-privilege `medications:write` scope (`20260714210309_medication_integration_boundary.sql:6-15,19-49`). The database command RPC accepts that new version/scope, but a correctly scoped request is rejected by the Edge function before the RPC is reached.

**Impact:** the UI can configure an eMAR source and request a `medications:write` credential, but no conforming external snapshot can enter through the documented integration endpoint. Medication freshness and exception workflows therefore cannot operate end to end.

**Recommendation:** resolve schema and required scope from the registered command definition after credential authentication, or explicitly route command types to version/scope contracts. Add handler tests for the medication-only credential, wrong version, replay, tenant mismatch, and successful snapshot processing.

**Effort:** small to medium. **Release posture:** P0 for eMAR rollout.

### SP-P1-1 — SCIM deprovisioning does not reliably reach the login profile

**Evidence:** `scim_subject_links.profile_id` is nullable (`20260711200637_phase2_regulatory_rules_and_identity.sql:365-383`). SCIM create inserts an employee and link without a profile ID (`:2107-2122`), and no production path was found that later binds the link when an Auth/profile identity appears. Suspend/deprovision revokes sessions and deactivates the account only when that nullable field is already populated (`:2195-2219`). The database test manually patches both the employee and SCIM link to a profile before testing revocation (`phase2_rules_identity.test.sql:569-576`), masking the missing lifecycle step.

**Impact:** a SCIM-managed person who later receives or JIT-creates a login can be terminated as an employee while their CareBase profile/session remains active.

**Recommendation:** add an audited, tenant-and-email-verified binding step during invitation/JIT/profile creation, make ambiguity fail closed, reconcile existing unbound subjects, and test create to login binding to suspend/deprovision to session revocation without manual SQL.

**Effort:** medium.

### SP-P1-2 — Offline learning does not meet its identity, availability, or no-data-loss contract

Several related defects make the current “downloaded for offline use” promise unreliable:

- `shouldWipeOfflineData` correctly detects logout, inactive status, and user/tenant/role changes (`offlineLearning.ts:47-49`), but it is used only by a unit test. Sign-out and forced account shutdown clear React Query and CacheStorage, not the offline IndexedDB database (`auth.tsx:270-318,337-353`). Bundle titles, assignment IDs, and timestamps remain plaintext (`offlineCourseCache.ts:10-20,111-115`), and the next employee's library lists all bundles without validating stored identity (`useOfflineLearning.ts:12-18`). Encryption still prevents cross-identity content decryption; the confirmed leak is metadata and retained ciphertext/key material.
- A cold PWA restart still requires a live profile read (`auth.tsx:232-245`), and any profile query error—including a network failure—triggers sign-out (`:270-284`). The downloaded course route is protected and lazy-loaded (`App.tsx:155,841-842`), the lazy chunk is cached only after being visited, and the download action does not prefetch it (`vite.config.ts:76-120`; `useOfflineLearning.ts:84-112`). A learner can download a course, restart without connectivity, and be unable to reach it.
- Remove and wipe actions offer no confirmation or unsynced-progress check (`MyCourses.tsx:134-136`). Removal deletes both the bundle and checkpoint (`offlineCourseCache.ts:131-139`); global wipe clears every store (`:65-71,185-187`). The wipe mutation also aborts before local deletion if remote revocation fails (`useOfflineLearning.ts:124-135`), so “wipe this device” cannot work while offline.
- Videos remain streamed-only, PDFs/SCORM are absent, and quizzes are review-only (`OfflineCourse.tsx:124-130`), but every incomplete course receives the same download action and success message (`MyCourses.tsx:194`).

**Recommendation:** introduce a minimal device-bound offline authorization state; distinguish network errors from confirmed invalid/inactive accounts; validate identity before listing metadata; prefetch the offline player and shell during download; make local wipe unconditional with remote revocation queued; show pending-sync counts and “sync then remove”; and display per-course offline coverage before download. Add production-PWA tests for cold restart, never-before-opened route chunks, account switching, revocation, reconnect, and destructive actions with unsynced progress.

**Effort:** medium to large.

### SP-P1-3 — Designated-person portal intake has no staff completion workflow

**Evidence:** guests can submit schedule responses and routine requests (`ResidentDesignatedPersonPortal.tsx:102,110`). The schema includes status, assignee, facility response, responder, timestamps, and queue indexes (`20260716160000_product_value_operating_system.sql:1262-1292`), but authenticated users receive only select access (`:1800-1819`); no staff response/update RPC or update policy exists. The management hook fetches grants, messages, shared documents, and resident documents only (`useResidentPortal.ts:74-94`), and `ResidentPortalWorkspace.tsx:159-177` has no request/schedule inbox. Notifications deep-link only to the resident detail (`20260716160000_product_value_operating_system.sql:1337-1342`), while Value Center merely counts requests.

**Impact:** the public side promises routine requests and facility responses that staff cannot acknowledge, assign, resolve, or answer through the product. Schedule-change replies are stored but not operationally routed.

**Recommendation:** add a facility-scoped inbox with exact deep links, assignee, SLA/due time, state transitions, response, schedule reconciliation, unread/overdue counts, and an append-only response history. Close the loop in the guest portal and notification system.

**Effort:** medium.

### SP-P1-4 — Realtime freshness is configured in the database but incomplete in the app

**Evidence:** migrations add `notifications` to `supabase_realtime` (`20260717015547_enforce_notification_operations_and_realtime.sql:8-20`), and `useNotifications.ts:27-29` calls Realtime the primary freshness path. The hook actually uses only five-minute polling (`:15-44`); no notification channel exists. Alerts do have a subscription (`useAlerts.ts:77-100`), but it is mounted only on the Alerts page (`Alerts.tsx:82`). The Today command center reads alerts without polling or its own subscription (`Today.tsx:61-68`), so its critical count can remain stale until refresh or tab focus.

**Recommendation:** mount one organization/profile-scoped subscription in the authenticated layout, invalidate notification and alert summaries centrally, expose connection health, and retain focus/polling fallback. Test insert-to-badge/Today latency and reconnect recovery.

**Effort:** small.

### SP-P1-5 — Reporting output has three independent correctness/safety gaps

1. **Print is only the current page.** A viewed report requests 100 rows (`Reports.tsx:608-615`), and `ReportViewer` prints the current DOM via `window.print()` (`ReportViewer.tsx:49-51,129-212`). The action is labeled simply “Print,” so a 5,000-row report can silently produce 100 rows. Rename it “Print this page” immediately, then add an all-pages server-generated print/PDF.
2. **Multi-page CSV is not a snapshot.** CSV loops through 1,000-row offset pages (`Reports.tsx:635-664`). `generate_paged_compliance_report` accepts limit/offset but no as-of watermark or snapshot token (`20260717024529_generate_paged_compliance_reports.sql:67-88`), and each page is a separate request. Concurrent inserts/updates can cause omissions, duplicates, and per-page `generatedAt` drift. Use a server export job or stable cursor plus an as-of receipt, final count, and checksum.
3. **Frontend CSV formula defense is inconsistent.** Eight frontend modules create CSV; seven have no formula neutralization and Dashboard handles only a formula character in column one, not leading whitespace. User-controlled names, job titles, purposes, notes, and report values can be interpreted as spreadsheet formulas. The organization export already has the stronger pattern (`process-organization-export-jobs/index.ts:31-44`). Centralize one tested cell encoder and use it in `dataTable.ts:85-103`, `Organizations.tsx:31-49`, `Reports.tsx:374-392`, `TrainingMatrix.tsx:854-871`, `ResidentFinancialOperations.tsx:111`, `RegulatoryCrosswalk.tsx:92-105`, and the PCH/ALF evidence export.

**Effort:** small for labeling/CSV safety; medium for snapshot exports.

### SP-P1-6 — Enterprise permissions and billing capabilities are disconnected from the UI

**Evidence:** the database has effective-dated permission and entitlement evaluation, with extensive server enforcement, but the application has no frontend capability bootstrap or call to `has_effective_permission`/`get_effective_entitlements` outside generated types. Routes and navigation remain hard-coded to base roles (`App.tsx`, `Sidebar.tsx`, `appDomains.ts`). For example, the billing Edge function permits a non-org-admin holding `billing.account.manage` (`create-billing-session/index.ts:82-95`), while `/app/enterprise` is restricted to org admins (`App.tsx:738-740`).

The checkout UI also asks for raw organization/package UUIDs and always sends `seatQuantity: 1` (`EnterpriseFoundation.tsx:857-915`), although the server enforces configurable minimum/maximum seat quantities (`create-billing-session/index.ts:132-143`). Return URLs add `?billing=success` or `?billing=cancelled`, but no component consumes those values.

**Recommendation:** return one server-derived capability/scope document at bootstrap and derive route, navigation, and action visibility from it while retaining server authorization. Replace the raw billing command with package/price selection, bounded seat quantity, current subscription/invoice state, webhook-pending reconciliation, and explicit success/cancel feedback.

**Effort:** medium.

### SP-P1-7 — Applied migration history is mutable without a checksum gate

**Evidence:** CI resets a fresh database (`.github/workflows/ci.yml:78-87`), and the source-integrity check only scans merge-conflict markers (`scripts/check-source-integrity.mjs:15-36`). Git history contains edits to already-added migration versions; for example commit `9c033bc` changed eight lines in `20260717031000_paged_domain_lists_and_realtime.sql` after that version had already landed. A hosted database records that the version ran, so later edits do not replay even while clean-reset CI passes.

**Impact:** repository schema and an upgraded long-lived environment can silently diverge. This is especially risky given the rapid migration cadence and exact regulatory/security behavior encoded in SQL.

**Recommendation:** maintain a checked-in SHA-256 manifest for released migrations, fail CI when an immutable version changes, require corrective migrations, and add an upgrade-path test from the previous release in addition to clean reset.

**Effort:** small to medium.

### Additional second-pass backlog

| Priority | Finding | Evidence and first action |
|---|---|---|
| P1 | Incident and complaint drafts are discarded without warning | Complaint close resets high-stakes fields (`CreateComplaintDialog.tsx:62-66,99-126`); incident reopen/close resets the form (`Incidents.tsx:188-194,385-386,535-539`). Add dirty-state confirmation, local recovery, and periodic autosave. |
| P1 | Resident statements cannot be consumed | Statements retain a transaction snapshot, but the UI lists only metadata/hash and has no view, print, PDF, download, delivery, or portal-share action (`ResidentFinancialOperations.tsx:97,105`; portal summary at `ResidentDesignatedPersonPortal.tsx:104`). Productize the immutable snapshot. |
| P1 | Report cards contain nested interactive controls | A keyboard-focusable card with `role="button"` wraps View/CSV buttons (`Reports.tsx:1072-1084,1111-1143`). Remove the parent button semantics or use a dedicated selection control and add a keyboard regression test. |
| P1 | Environment-specific cron URLs are embedded in migrations | Sixteen cron invocations reference the same concrete Supabase project URL, including integration delivery (`20260711200651_phase2_signed_integration_hub.sql:1290-1308`). A restored non-production environment can call production workers if secrets and schedules are restored. Resolve the project URL from environment/Vault configuration and disable jobs during restore drills. |
| P1-P2 | Customer Value undercounts report usage | The value dashboard counts `report_exported`, but generic compliance CSV export never emits it (`20260716160000_product_value_operating_system.sql:975-989`; `Reports.tsx:635-664`). Emit a server-verifiable export receipt and test that ROI metrics change. |
| P2 | Scheduled reports are hidden in a different product area | Scheduling is complete in `ReportScheduleManager`, but it is reachable only in Value Center, not alongside saved Reports (`Reports.tsx:963-1004`; `ValueCenter.tsx:165-170,209`). Reuse the manager in a Scheduled tab and add “Schedule” beside saved views. |
| P2 | New operational tables regress on mobile | Work Queue, Complaints, and Admissions use 980/1050/900-pixel scroll tables (`WorkQueue.tsx:282-330`; `Complaints.tsx:67-76`; `AdmissionOperations.tsx:337-343`). Reuse Training Matrix's mobile-card/desktop-table pattern. |
| P2 | Governed review data is dormant behind a raw UUID command | The UI exposes metrics and asks for a revision UUID (`GovernedLearning.tsx:20-32`), while threaded review comments and policy-version links have no normal product surface (`20260712023821_phase4_governed_content_and_policy.sql:71-82,115-125,235-250`). Build a reviewer inbox, preview/diff, assignments, comments/resolution, and evidence lineage. |
| P2 | Seed entrypoint is not tested | CI and `check:database` use `--no-seed`; `seed.sql` creates six Auth identities and a demo baseline. Add a separate seed smoke reset and assert identities, roles, and repeatable restore. |
| P2 | Correlation IDs are not end-to-end | client error reporting creates a new UUID after failure (`clientErrorReporting.ts:47-62`), while Edge endpoints generate/accept different IDs and the frontend invoke path does not propagate them. Add one shared invoke wrapper and expose the same safe support reference across client, Edge, audit, and jobs. |
| P2 | Runtime/dependency contracts drift | Production is Node 24 but `@types/node` resolves to 25; 49 Edge functions pin `supabase-js` 2.48.1 while the browser uses 2.110.1, and Deno/JSR dependencies are outside the pnpm advisory gate. Pin Node 24 typings, centralize Edge imports, inventory/advisory-check Deno dependencies, and upgrade behind handler tests. |
| P1-P2 | Expired manual comps can leave canonical access state stale | `reconcile_billing_states` is not scheduled or called outside tests (`20260711200648_phase2_billing_and_entitlements.sql:1145-1163`); entitlement calculation handles expired comps, but `organizations.subscription_status` can remain `comped`. Schedule reconciliation and explicitly fall back to provider state on comp expiry. |
| P2 | Audit archive is a planner, not a completed archive pipeline | The schema models planned/exported/verified/failed batches, but the only production function writes `planned`; no exporter, archive bucket, verifier, or transition path was found (`20260711162509_phase1_operational_recovery.sql:145-167,294-353,500-510`). Implement export, immutable retention, checksum verification, retry/dead letter, and restore tests before relying on it. |
| P2 | Disaster recovery lacks an executable runbook | The pilot runbook gives only a short isolated-restore instruction, while CI validates fresh migrations and discards local state. Document RPO/RTO, PITR, Auth/Storage/Vault restore order, job neutralization, reconciliation, and recurring restore evidence. |
| P2 | Identity schema advertises OIDC and per-connection AAL2 without runtime support | The connection schema permits SAML/OIDC and stores `require_aal2`, but provisioning/UI are SAML-only and AAL2 is enforced through a separate policy (`20260711200637_phase2_regulatory_rules_and_identity.sql:203-223,441-450,829-863`; `EnterpriseFoundation.tsx:681-721`). Remove unsupported contract fields or implement and test them. |

### Second-pass strengths

- All 144 page modules are imported by `App.tsx`; no page source file is stranded.
- All 107 literal Sidebar destinations resolve to application routes, and the route metadata has no orphan destination. Contextual setup/detail paths and legacy redirects explain the small intentional navigation differences.
- The migration directory has 326 timestamped files with no duplicate 14-digit version names.
- Password and SSO flows preserve protected deep links, mobile navigation is a real closing off-canvas sheet, and Training Matrix already provides a good responsive card/table pattern.
- Offline content encryption, identity-bound additional authenticated data, and the exclusion of resident/incident/credential domains are sound foundations; the defects above are lifecycle and reachability gaps, not a break of the AES-GCM content boundary.

## Ranked product and UX roadmap

These are ranked by user and business value after the P0 controls above. “Partial” means the repository already contains useful primitives; the recommendation is to finish and connect them rather than rebuild them.

| Rank | Improvement | Current state | Recommended first slice | Success measure |
|---:|---|---|---|---|
| 1 | Complete the designated-person portal workflow | Guest side shipped; staff side absent | Facility inbox for requests and schedule responses with exact deep links, assignee, SLA, response, history, and guest-visible resolution | Acknowledgement time, overdue rate, resolution time, guest follow-up volume |
| 2 | Make offline learning dependable | Partial and fragile | Cold-restart access, player prefetch, identity-safe wipe, pending-sync protection, reconnect handling, and per-course coverage preview | Cold-offline success, sync recovery, zero silent progress loss, useful-content coverage |
| 3 | Facility-bound confidential reporting and recovery | Partial | Rotatable, non-enumerable facility link/QR; facility name resolved server-side; “Report a concern” from My Shift; resume/status page using intake number + secret | Submission completion, correct facility routing, resume success, lower abandoned reports |
| 4 | Learner-visible transcripts and real captions | Partial | Show stored transcript/script under every video and include it offline; then support WebVTT `<track kind="captions">` | 100% of published video lessons have learner-visible equivalent content; accessibility journey passes |
| 5 | Shared organization/facility/resident scope bar | Absent app-wide | URL-persisted, access-validated scope in the header; explicit “All facilities” read mode; never default a mutation silently | No mutation occurs without visible scope; fewer wrong-site corrections; consistent deep links |
| 6 | Task-oriented enterprise workspaces instead of UUID consoles | Partial | Replace pasted IDs with pending-work queues, scoped search/pickers, record preview, capability-aware actions, and dependency explanations | Faster task completion, fewer invalid submissions, fewer support tickets requiring IDs |
| 7 | Usable resident statements | Snapshot only | Human-readable statement detail, print/PDF, delivery receipt, and permission-scoped portal sharing | Statement delivery rate, fewer billing calls, payment-link conversion |
| 8 | One assistant shell with explicit provenance | Fragmented | Merge the two static help engines into “Workflow Guide”; retain a separate “Regulatory Evidence” mode with citations and a “Data used” panel | Higher resolved-question rate; fewer misleading-assistant reports; clear support handoff |
| 9 | Digital governed forms and checklists | Static/printable | Versioned system templates organizations can clone; digital submission, assignee, due date, signature, attachment, autosave, and linked work item/evidence | Reduced paper workflows; searchable completion evidence; failed checklist-to-work-item conversion |
| 10 | Productize instructor-led capacity and waitlists | Backend-rich, UI-light | Connect `training_session_registrations` and its capacity/waitlist RPCs to trainer classes; bulk-enroll expiring staff from Retraining Monitor | Waitlist conversion, capacity utilization, time from identified expiry to enrollment |
| 11 | Regulatory-change impact routing | Detection/draft exists | From each detected source change, show impacted requirements, courses, policies, reports, and tenants; create reviewed work items with owners/deadlines | Time from detected change to assigned remediation and approved rule activation |
| 12 | Complete SPA navigation accessibility | Partial | On real route transitions, update title, announce destination, and focus main/heading without stealing focus for filters/modals; remove nested controls | Automated screen-reader/focus journey passes across sidebar, reports, and global search |
| 13 | Role-specific guided demo missions | Absent | Dismissible missions against seeded records: close a training gap, resolve an uncovered shift, assemble survey evidence | Mission completion and demo-to-request conversion |

### Product evidence behind the top recommendations

#### Confidential reporting

`pages/public/SafetyReport.tsx:20,88,148-150` requires the reporter to type a raw facility UUID. The form always submits `reporter_mode: "anonymous"` and one fixed report type (`:89-94`). It returns a resume secret once (`:132-143`), but no page or Edge Function calls the existing `resume_confidential_incident_intake` RPC. The route exists at `/report-safety`, yet ordinary application and marketing navigation do not surface it.

A facility-bound token must not become a public facility directory. Issue rotatable opaque tokens, resolve scope only on the server, rate-limit and protect attachments, and permit an identified/contact-consent path only when the reporter chooses it.

#### Learner transcripts and captions

Course authoring stores transcript text (`CourseDetail.tsx:592-599,1555-1560`), and publication readiness treats transcript/script presence as sufficient (`:334-338`). The player renders a bare `<video>` without a caption track (`CourseVideoPlayer.tsx:142-144`). `TakeCourse.tsx:854-866` does not render the transcript, and the offline course type drops the transcript semantics.

The immediate transcript accordion is a small, high-value fix. WebVTT authoring/upload and captions should follow. Publication readiness should verify that equivalent content is available in the learner experience, not just hidden in authoring JSON.

#### Shared scope

Several pages silently choose `facilities?.[0]`, including Inspection Readiness, Schedule, Schedule Setup, Shift Handoff Inbox, Regulatory Copilot, Medication Integration, Resident Care Delivery, Value Center, and PCH/ALF Operations. Some then write using that scope. A persistent, visible, access-validated scope is both a UX improvement and a safety control.

#### Enterprise usability

`EnterpriseFoundation.tsx`, `QualifiedWorkforce.tsx`, `GovernedLearning.tsx`, `WorkItemDetail.tsx`, and `MedicationIntegration.tsx` expose important backend capabilities through raw organization, facility, employee, profile, revision, record, or credential IDs. Keep raw identifiers in an Advanced/support panel, but make the default interaction a queue, human-readable picker, preview, and guarded task flow.

#### Assistant trust

The app currently has three overlapping experiences:

1. Global CareMetric Copilot, a local route/keyword scorer (`caremetricCopilot.ts:287-382`).
2. Help Copilot, another local route/keyword knowledge base (`helpCopilot.ts:362-410`).
3. Citation-Backed Regulatory Copilot, which uses governed sources, facility evidence, receipts, and draft-only actions.

The first should be labeled “Workflow Guide” unless it becomes live-data-aware. One shell can host both modes, but it should always disclose whether it used only the current route/help content or regulated facility evidence.

## Existing roadmap items: retain, update, or close

The repository contains multiple enhancement documents written only days apart, so some backlog items are already stale. Maintain one canonical backlog and mark each item as shipped, partial, pilot-only, or not started.

| Item | Current assessment | Disposition |
|---|---|---|
| Survey Day Mode | `SURVEY_DAY_MODE_SPEC.md` exists; no corresponding route/workspace was found | Retain as an existing planned feature. Implement after shared scope and pilot hardening, not as a new duplicate proposal. |
| Historical training-record migration | Employee CSV import and historical state-form OCR exist, but no dedicated training-record CSV/OCR import was found | Retain existing backlog; prioritize for onboarding-heavy pilots. |
| Subscribed calendars | Trainer classes have a one-time ICS export (`TrainerClasses.tsx:196-205`) | Retain secure, revocable feed subscriptions for shifts, classes, and expirations as an expansion—not a brand-new capability. |
| Training capacity/waitlists | Database tables/RPCs exist; trainer class UI still uses the older attendee flow | Reclassify as frontend productization/integration work. |
| Regulatory source polling | Detection and draft rule versions exist | Reclassify remaining work as reviewed downstream impact routing. |
| AI Plan of Correction | Citation-backed draft intent is implemented | Close stale “build AI POC” backlog entries; pilot and validate instead. |
| Organization setup checklist | Guided setup is implemented in Enterprise Foundation/Value Center | Close stale setup-checklist backlog entries; measure completion and polish. |
| Alerts/reports pagination and Realtime freshness | Core alert-page Realtime and report pagination are implemented; notifications and the Today summary remain incomplete | Close the core pagination item, retain notification/layout subscription work, and add latency/reconnect regression tests. |

## Recommended execution sequence

### Days 0–14: eliminate false trust signals

- Close the administrator-qualification table and Storage cross-tenant write paths, with negative tenant tests.
- Align the Stripe parser/fixtures with the configured webhook version and make failed receipts durable.
- Make the `medication.snapshot.import` version and least-privilege scope reachable through the Edge gateway.
- Fix the lockfile scanner and add coverage fixtures.
- Make external notification copy generic by default.
- Correct the export cron secret and remove the production fallback.
- Re-label organization export and binder output wherever completeness is not guaranteed.
- Protect unsynced offline progress and wipe IndexedDB on logout/account/tenant changes.
- Add learner-visible transcripts, critical query-error states, Playwright failure artifacts, and production-server smoke tests.
- Align Node/pnpm documentation and the dev container.

**Exit criteria:** cross-tenant administrator writes fail; current-version Stripe fixtures reconcile; one medication snapshot succeeds through Edge with `medications:write`; the dependency audit covers the full lockfile; sensitive narrative cannot leave the authenticated app; one export job completes with the documented secret; failed critical queries cannot render a healthy/empty message; unsynced offline progress cannot be silently destroyed.

### Days 15–45: prove the system and improve everyday safety

- Run the controlled pilot and record evidence/approvals.
- Add tenant-level AI governance before enabling regulated AI.
- Build the shared scope bar and migrate mutation-heavy pages first.
- Add facility-bound confidential intake and the recovery portal.
- Add the staff request/schedule-response inbox that completes the designated-person portal workflow.
- Make notifications and Today alert summaries genuinely Realtime with reconnect fallback.
- Repair organization export expiry, manifest coverage, and deletion.
- Add time-budgeted notification dispatch and prioritized Edge handler tests.
- Add immutable migration checksums and an upgrade-path test.

**Exit criteria:** signed pilot manifest, explicit flag promotion decisions, no silent mutation scope, resumable facility-scoped reports, export manifest reconciliation, and tested timeout behavior.

### Days 46–90: productize the breadth already built

- Replace raw-UUID panels with queues and pickers.
- Connect instructor-led registration/capacity/waitlists to the trainer experience.
- Consolidate assistant modes and provenance.
- Route regulatory changes into reviewed impact work.
- Start governed digital forms/checklists.
- Add captions, SPA focus announcements, and role-guided demo missions.
- Decompose the largest files, centralize route metadata/Edge HTTP plumbing, and tighten static analysis incrementally.

**Exit criteria:** measurable completion-time reduction for enterprise tasks, training-demand-to-enrollment loop, auditable regulatory impact workflow, accessible video and navigation journeys, and improved initial-load headroom.

## Suggested backlog structure

Create one milestone for each outcome rather than one issue per repository document:

1. **Pilot safety and release provenance** — P0 findings, controlled pilot, exact-artifact deployment.
2. **Tenant data protection** — external notifications, AI governance, retention, legal holds, export expiry.
3. **Multi-facility correctness** — shared scope, server summaries, honest failure states.
4. **Accessible learning** — transcripts, captions, offline equivalent content, mobile/WebKit smoke tests.
5. **Confidential reporting** — facility tokens, resume/status, attachments, identified consent.
6. **Operational productization** — UUID-to-workspace conversion, training session UX, regulatory impact routing.
7. **Scale and maintainability** — bundles, handler tests, typed contracts, route registry, file decomposition.

Every feature issue should include:

- Persona and workflow outcome.
- Tenant/role and data-classification impact.
- Empty/loading/error/partial/offline behavior.
- Audit/evidence expectations.
- Feature-flag and rollback plan.
- Unit, database, handler, and browser acceptance tests as applicable.
- Product metric and pilot exit criterion.

## What I would deliberately avoid

- Another standalone assistant or static knowledge engine.
- Raising bundle budgets to accommodate more shell-level code.
- Calling a PDF or tenant archive “complete” without reconciled counts and checksums.
- Sending free-form resident or employee narratives through external notification providers.
- A public facility directory for confidential intake; use opaque, rotatable facility links.
- Expanding into a full eMAR/EHR or broad family-engagement suite before the current operating system is proven in pilots.
- Treating code-complete, default-off functionality as generally available without evidence and an explicit promotion decision.

## Third-pass addendum: execution-ready backlog and contract boundaries

The third pass converted the findings into a dependency-aware, GitHub-issue-ready companion: [PennTrain execution backlog](PennTrain_Execution_Backlog_2026-07-20.md). It contains rollout decisions, implementation slices, acceptance criteria, automated-test matrices, dependencies, effort bands, success measures, milestone/label suggestions, and a standard completion checklist. No GitHub issues were created.

The most important sequencing refinement is to split Stripe remediation into two mergeable controls: first persist every verified event and its failure state outside the canonical billing mutation transaction; then normalize explicitly supported API versions into an internal billing DTO. Durable ingest must land first so failures introduced or exposed by the parser change remain observable and safely replayable.

The exploitability/activation boundary for the leading findings is now explicit:

| Finding | What is proven | Exposure condition | Release decision |
|---|---|---|---|
| Administrator qualification/evidence | Cross-tenant write and data-poisoning path | Any active account, direct API access, and a known/guessed organization UUID | Universal pilot blocker |
| Stripe webhook | Current documented API shape and parser disagree; failed receipt can roll back | Paid billing endpoint uses the documented Basil-or-later/Clover shape | Billing activation blocker |
| Medication integration | The only Edge gateway rejects the registered version and least-privilege scope | eMAR vendor submits through the documented gateway | eMAR rollout blocker |
| External handoff notification | Free-form narrative reaches the provider renderer's fallback | Expanded email/SMS/push delivery is enabled for those types | External-delivery blocker |
| SCIM deprovisioning | Provisioning leaves no authoritative profile binding and tests patch it manually | Tenant combines SCIM with SSO/login access | Enterprise identity rollout blocker |
| Offline learning | Identity wipe and pending-progress protections are missing; route reachability is not warmed | Installed PWA is restarted offline, switched between users, or removes unsynced work | Dependable-offline claim blocker; confirm cold start in production-PWA test |

The pass also found four additional backend/product contracts worth tracking:

- **Move-in guest uploads are a definite incomplete workflow.** Guest tasks display “Document requested,” grant configuration includes document tasks, the audit enum models upload, and the admission dashboard promises family uploads, but the guest surface exposes only signing and no latest-state guest upload/finalize boundary exists. Add a token/task-scoped quarantine, scan, staff-review, and acceptance flow before treating family uploads as shipped.
- **Evidence-room guest comments are a feature opportunity.** The schema has `evidence_guest_comments` and a `comment` access-event type, but the guest room lists/downloads artifacts only and no submission/response path was found. A scoped surveyor-question workflow would make evidence rooms more collaborative without becoming general chat.
- **HRIS import transport is a conditional rollout deliverable, not a demonstrated repository defect.** The database has a strong resumable engine, while `PHASE3_OPERATIONS.md` explicitly places the vendor adapter in an approved external runtime. If no such deployed adapter exists, the UI's raw run-ID validate/resume console cannot initiate a normal import.
- **SCORM/LTI processing is likewise an external-runtime gate.** `PHASE4_OPERATIONS.md` requires an isolated hostile-package processor, separate serving origin, sandbox bridge, and limited LTI 1.3 validation. No such runtime is in this repository. Keep the capability unavailable unless a separately deployed implementation has conformance and hostile-package evidence.
- **Edge runtime configuration needs one typed deployment contract.** Static inventory found 168 direct environment reads across 48 TypeScript files and 35 literal configuration names; 16 of those names are absent from `DEPLOYMENT.md`. Some are intentionally optional, but that distinction currently lives inside individual handlers. Add a required/optional/secret/format manifest, static read-to-manifest drift check, and redacted target-environment preflight so missing Stripe, notification, rate-control, or integration settings fail before promotion.

The first planning session should create the M0 issues from the execution backlog, confirm which conditional surfaces are actually enabled, assign one owner and one independent reviewer to each release blocker, and bind every pilot promotion to an exact build artifact, migration checksum manifest, deployment configuration, and signed evidence decision.

## Bottom line

PennTrain has enough functionality to be compelling now. Its next competitive advantage should be **trustworthy connected workflows**: the right facility is always visible, failed data never looks healthy, regulated data stays inside intended boundaries, exports and binders state exactly what they contain, AI discloses its sources and governance, and every major feature has pilot evidence.

After the release blockers and pilot gap are addressed, the strongest product investments are completing the designated-person portal, making offline learning dependable, confidential reporting, accessible video learning, shared multi-facility scope, usable resident statements, task-oriented enterprise workspaces, and digital governed forms. Those improvements make the existing breadth feel like one dependable product rather than a collection of powerful modules.
