# Improvement Backlog

## P0: Critical defects, security, or data-integrity risks

| ID | Recommendation | Category | Severity | User value | Business value | Complexity | Affected files/modules | Dependencies | Acceptance criteria | Order |
|---|---|---|---|---|---|---|---|---|---|---:|
| P0-01 | Move `/trainer/classes/:id/kiosk` before `/trainer/classes/:id` and add route test. | Functional | High | Trainers can run kiosks reliably | Prevents live class failure | Low | `src/App.tsx`, route tests | none | Kiosk route renders ClassKiosk and test fails if order regresses | 1 |
| P0-02 | Add public-token governance tests for evidence, move-in, agreement, check-in, passport, certificate flows. | Security | High | Safer guest access | Reduces regulated data exposure risk | Medium | public pages, token libs, Edge Functions | seeded tokens | Expired/bad/revoked token cases covered in e2e and audited | 2 |
| P0-03 | Create environment readiness checks for required Supabase/Stripe/SendGrid/Twilio/VAPID/Turnstile/cron secrets. | Reliability/Security | High | Fewer silent failures | Safer production rollout | Medium | admin system/security, scripts, functions | environment metadata | Admin sees pass/fail last verified status without exposing secrets | 3 |
| P0-04 | Add DB transactional tests for scheduling eligibility, expired credentials, time-off overlap, and override audit trail. | Data integrity | High | Safer staffing decisions | Avoids compliance gaps | Medium | scheduling/qualification migrations/tests | local Supabase | pgTAP proves invalid assignments rejected | 4 |
| P0-05 | Add background-job watchdog UI/SLO for notification dispatch, lifecycle, reports, exports, polling, mock inspections. | Reliability | High | Operators know when automation stops | Prevents missed compliance work | Medium | `/admin/system-jobs`, job tables/functions | cron config | Stale job state raises visible critical alert | 5 |

## P1: Essential functionality and serious workflow problems

| ID | Recommendation | Category | Severity | User value | Business value | Complexity | Affected files/modules | Dependencies | Acceptance criteria | Order |
|---|---|---|---|---|---|---|---|---|---|---:|
| P1-01 | Build employee-specific Work Queue mode for `/me/work`. | UX/RBAC | High | Employees see only actionable work | Reduces training/support burden | Medium | `WorkQueue`, `WorkItemDetail`, hooks | RLS review | No manager-only filters/actions in employee mode; e2e covered | 6 |
| P1-02 | Consolidate Dashboard/Today/PCH Operations summary metrics into one source-of-truth metric contract. | UX/Architecture | High | Managers trust priorities | Improves demo coherence | Medium | dashboard pages/hooks | metric definitions | Every metric drills to exact filtered records | 7 |
| P1-03 | Add mobile Playwright journeys for employee shift, course, service task, and change-of-condition flows. | QA/UX | High | Floor staff can use phones | Pilot readiness | Medium | e2e, employee pages | local Supabase seed | Mobile viewport tests pass with keyboard navigation | 8 |
| P1-04 | Add visible record History drawer pattern to incidents, complaints, residents, work items, policies. | Compliance | Medium | Easier audits/corrections | Better regulatory defensibility | Medium | domain detail pages | history data availability | Users can see author/time/change summary | 9 |
| P1-05 | Add report lifecycle e2e for save, schedule, export, permission denied. | QA | Medium | Reports dependable | Customer deliverable confidence | Medium | Reports, saved report hooks | seeded data | Admin/auditor role assertions pass | 10 |

## P2: High-value improvements

| ID | Recommendation | Category | Severity | User value | Business value | Complexity | Affected files/modules | Dependencies | Acceptance criteria | Order |
|---|---|---|---|---|---|---|---|---|---|---:|
| P2-01 | Build integration credential wizard with test connection and masked secrets. | Integrations | Medium | Easier eMAR/API setup | Higher attach rate | High | MedicationIntegration, integration API | secret storage | Admin can create/test/select credential without UUID paste | 11 |
| P2-02 | Add Survey Evidence Packet builder from binder, evidence room, violations, work items, policies. | Compliance | Medium | Faster survey response | Strong differentiator | High | SurveyDay, EvidenceRoom, Binder | report generation | Packet includes selected evidence and access log | 12 |
| P2-03 | Add role onboarding checklist and guided first-run tasks. | UX | Medium | Faster adoption | Better activation | Medium | dashboards/help/onboarding tables | content | New org completes setup milestones | 13 |
| P2-04 | Add staff readiness forecast 30/60/90 days. | Analytics | Medium | Prevents staffing gaps | Reduces compliance risk | Medium | credentials/training/scheduling | data quality | Forecast identifies future blockers by facility | 14 |
| P2-05 | Add guest grant governance center. | Security/UX | Medium | Manage external access | Reduces exposure/support | Medium | evidence/resident portal/agreement grants | token audit | Admin can list/revoke/expire all guest links | 15 |

## P3: Strategic new features

| ID | Recommendation | Category | Severity | User value | Business value | Complexity | Affected files/modules | Dependencies | Acceptance criteria | Order |
|---|---|---|---|---|---|---|---|---|---|---:|
| P3-01 | Qualification-aware staffing optimizer. | Strategic | Medium | Better rosters | Competitive differentiation | High | scheduling/credentials/training | strong data integrity | Suggested roster respects qualifications and time-off | 16 |
| P3-02 | Resident 360 timeline. | Strategic | Medium | Complete resident context | Better care coordination | High | resident modules | event normalization | Timeline merges service, incidents, changes, appointments, agreements | 17 |
| P3-03 | Compliance copilot approval workflow with evidence citations. | AI/Compliance | Medium | Faster POC/evidence drafting | Differentiation | High | copilot/evidence/violations | AI governance | Draft cannot be final without human approval/audit | 18 |
| P3-04 | Data retention/legal hold console. | Enterprise | Medium | Admin governance | Enterprise readiness | High | lifecycle/export/storage | legal policy | Configured retention is visible and auditable | 19 |
| P3-05 | Vendor/maintenance external portal. | Workflow | Low | Vendor coordination | Optional market expansion | High | maintenance/public roles | access model | Vendors see only assigned work orders | 20 |

## P4: Optional polish and technical debt

| ID | Recommendation | Category | Severity | User value | Business value | Complexity | Affected files/modules | Dependencies | Acceptance criteria | Order |
|---|---|---|---|---|---|---|---|---|---|---:|
| P4-01 | Split route metadata from `App.tsx` into typed manifests. | Maintainability | Medium | Fewer nav bugs | Developer velocity | Medium | `src/App.tsx`, sidebar/search | route contract tests | Routes, nav, modules generated from one manifest | 21 |
| P4-02 | Document mockup sandbox exclusion. | Maintainability | Low | Less confusion | Audit clarity | Low | README/docs | none | Docs state sandbox is non-production | 22 |
| P4-03 | Add route-level bundle budgets. | Performance | Low | Faster app | Better UX at scale | Medium | build scripts | bundle stats | CI fails on route chunk budget regressions | 23 |
| P4-04 | Add consistent empty/loading/error component usage audit. | UX | Low | More polished screens | Support reduction | Medium | pages/components | design system | Top 20 list pages use common QueryState | 24 |
| P4-05 | Add terminology glossary in app help. | UX | Low | Less confusion | Training aid | Low | HelpCenter/docs | content | Terms like work item/task/alert/violation standardized | 25 |

## Phase 0 implementation status — 2026-07-22

| ID | Status | Files changed | Tests added/updated | Validation commands | Remaining risks / manual verification |
|---|---|---|---|---|---|
| P0-01 | Complete | `artifacts/caremetric-carebase/src/App.tsx` | `artifacts/caremetric-carebase/src/lib/routeOrder.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/routeOrder.test.ts` | Run authenticated Playwright class-kiosk smoke against seeded Supabase before release. |
| P0-02 | Partially complete | `artifacts/caremetric-carebase/src/lib/publicAccessToken.ts` | `artifacts/caremetric-carebase/src/lib/publicAccessToken.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/publicAccessToken.test.ts` | Backend expiry/revocation/audit behavior still requires local Supabase and public-token e2e journeys; do not mark fully complete until those pass. |
| P0-03 | Partially complete | `artifacts/caremetric-carebase/src/lib/deploymentReadiness.ts`, `artifacts/caremetric-carebase/src/pages/admin/SystemJobs.tsx` | `artifacts/caremetric-carebase/src/lib/deploymentReadiness.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/deploymentReadiness.test.ts` | Browser code can verify Vite env and job health only. Server-side secrets must be verified through Supabase/deployment controls without exposing secret values. |
| P0-04 | Not completed in this work unit | Existing `supabase/tests/database/qualification_aware_scheduling.test.sql` was revalidated by inspection. | None added | Not run | Current pgTAP covers missing qualification, overlaps, rest, unavailable overrides, and assignment decision evidence; additional expired-credential/time-off/concurrent-update tests still need a running Supabase database. |
| P0-05 | Partially complete | `artifacts/caremetric-carebase/src/pages/admin/SystemJobs.tsx`, `artifacts/caremetric-carebase/src/lib/deploymentReadiness.ts` | `artifacts/caremetric-carebase/src/lib/deploymentReadiness.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/deploymentReadiness.test.ts` | UI now surfaces failing job freshness as critical readiness; full stale-job alert delivery still depends on the existing database watchdog test and local Supabase execution. |

## Phase 1 implementation status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P1-01 | Partially implemented | 2026-07-22 | Revalidated `/me/work`; existing backend/RLS scoping and detail-page controls were preserved, and the employee list view now uses an explicit self-service presentation that hides facility/source/owner manager columns and provides employee-appropriate empty-state copy. | `artifacts/caremetric-carebase/src/pages/app/WorkQueue.tsx`, `artifacts/caremetric-carebase/src/lib/workItemQueue.ts` | `artifacts/caremetric-carebase/src/lib/workItemQueue.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/workItemQueue.test.ts` | Not marked complete because authenticated Playwright and RLS/database verification were not available in this environment. | Run employee `/me/work` and `/me/work/:id` e2e against seeded Supabase; add permission-denied tests for cross-record URL attempts. |
| P1-02 | Deferred | 2026-07-22 | Revalidated overlapping dashboard surfaces; no code change made because metric consolidation requires an agreed source-of-truth contract and product decisions. | None | None | Static inspection | Risk of inconsistent metric definitions remains. | Define metric contract and implement one metric-to-filter drilldown at a time. |
| P1-03 | Blocked | 2026-07-22 | Revalidated need for mobile employee journeys. | None | None | Static inspection | Requires seeded Supabase/auth users and Playwright browser execution. | Add mobile e2e for shift, course, service task, and change-of-condition once local stack is available. |
| P1-04 | Partially verified | 2026-07-22 | Work Item Detail already exposes immutable history; broader domain history drawers were not added to avoid cross-domain UI churn in this batch. | None for history UI | None | Static inspection | Incidents, complaints, residents, and policies still need standardized visible history patterns. | Implement per-domain history drawer slices with data-source tests. |
| P1-05 | Blocked | 2026-07-22 | Revalidated need for report lifecycle e2e. | None | None | Static inspection | Requires seeded Supabase/auth and report export runtime. | Add org admin/auditor/employee report lifecycle e2e once local stack is available. |

## Phase 2 implementation status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P2-03 | Deferred | 2026-07-22 | Revalidated existing role quick-start cards and employee onboarding hooks. Actual new-tenant checklist completion was not implemented because milestone definitions and persistence rules are not approved. | None | None | Static inspection; existing `roleQuickStart.test.ts` remains applicable | Existing quick starts are static navigation cards and do not prove setup completion. | Define setup milestones, storage model, completion rules, and tenant/admin permission model before implementation. |
| P2-04 | Deferred | 2026-07-22 | Revalidated credential, training, and scheduling modules. No forecast was implemented because the 30/60/90 readiness definition requires product-approved rules and live data quality validation. | None | None | Static inspection | Forecast could mislead operators if expired credentials, course status, schedule eligibility, and facility assignments are not reconciled. | Approve forecasting contract and add DB/RLS-backed tests against seeded Supabase data. |
| P2-05 | Deferred | 2026-07-22 | Revalidated public-access governance helpers from Phase 0. Guest grant center was not implemented because list/revoke/expire behavior requires a confirmed grant persistence contract and RLS validation. | None | None | Static inspection; existing `publicAccessToken.test.ts` remains applicable | Admins still need a first-class operational screen to list and revoke external grants. | Define grant tables/RPCs, revocation semantics, audit events, and cross-tenant permission tests. |
| P4-04 | Deferred | 2026-07-22 | Revalidated shared loading/empty/error components and list-page patterns. Broad top-20 page rollout was deferred to avoid unrelated churn during this focused Phase 2 slice. | None | None | Static inspection | Inconsistent list-state presentation remains across some pages. | Create page-by-page inventory and migrate one domain at a time to shared `QueryState`/table states. |
| P4-05 | Implemented | 2026-07-22 | Added a Help Center Glossary tab backed by typed glossary content and searchable by term, definition, category, and related route. | `artifacts/caremetric-carebase/src/lib/carebaseGlossary.ts`, `artifacts/caremetric-carebase/src/pages/app/HelpCenter.tsx` | `artifacts/caremetric-carebase/src/lib/carebaseGlossary.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/carebaseGlossary.test.ts`; `pnpm run typecheck` | Static glossary content needs product-owner review to prevent terminology drift. | Add content ownership workflow if glossary terms become customer-specific or regulated policy text. |

## Phase 3 implementation status — 2026-07-22

| ID / roadmap item | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P2-01 | Deferred | 2026-07-22 | Revalidated Medication Integration and integration API credential foundations. No credential wizard was implemented because safe credential issuance/selection/test-connection needs product/security decisions, secret UX rules, and Supabase/RLS execution. | None | None | Static inspection | Source setup still asks for a credential identifier instead of a guided credential selection/test flow. | Define credential issuance UI, masked one-time-secret handling, test-connection RPC/Edge contract, and permission tests. |
| P2-02 | Partially implemented | 2026-07-22 | Added Survey Day packet manifest/readiness metadata for the existing pinned single-facility binder workflow, including readiness state, facility scope, checksum, size, attempts, storage path, correlation ID, access-control note, and audit-trail note. | `artifacts/caremetric-carebase/src/lib/surveyEvidencePacket.ts`, `artifacts/caremetric-carebase/src/pages/app/SurveyDay.tsx` | `artifacts/caremetric-carebase/src/lib/surveyEvidencePacket.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/surveyEvidencePacket.test.ts`; `pnpm run typecheck` | This is not a full selected-evidence packet builder; it exposes existing binder job metadata only. | Define evidence-selection/report-generation requirements and add e2e download/audit verification against seeded Supabase. |
| Phase 0 job/report automation follow-ups | Deferred | 2026-07-22 | Revalidated current job readiness UI and binder async workflow. No failed webhook/job-to-work-item automation was added because it requires DB trigger/RPC design and operational policy. | None | None | Static inspection | Failed jobs may still require manual triage outside a generated work item, depending on job type. | Define actionable failure taxonomy, work-item ownership rules, retry/idempotency semantics, and DB tests. |

## Phase 4 implementation status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P3-01 | Deferred | 2026-07-22 | Revalidated qualification-aware scheduling foundations. No optimizer was implemented because suggestions require product-approved optimization rules, explainability, and high-confidence data validation. | None | None | Static inspection | Scheduling suggestions could create unsafe coverage recommendations if qualification/time-off/rule data is incomplete. | Define optimization objective, hard constraints, soft constraints, explanation format, and DB tests. |
| P3-02 | Partially implemented | 2026-07-22 | Strengthened existing Resident 360 timeline by adding deterministic normalization, source coverage summary, event-type filtering, search, and no-results empty state. | `artifacts/caremetric-carebase/src/lib/residentTimeline.ts`, `artifacts/caremetric-carebase/src/components/residents/Resident360Summary.tsx` | `artifacts/caremetric-carebase/src/lib/residentTimeline.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/residentTimeline.test.ts`; `pnpm run typecheck` | This improves client-side reconciliation only; it does not prove the timeline RPC includes every desired source module or that all role/RLS cases pass. | Validate `get_resident_timeline` with seeded incidents, changes, services, appointments, agreements, and permissions. |
| P3-03 | Deferred | 2026-07-22 | Revalidated compliance copilot/crosswalk foundations. No approval workflow was implemented because AI governance and human-review audit requirements are not finalized. | None | None | Static inspection | AI drafts still should not be treated as final regulatory artifacts without approval controls. | Define draft lifecycle, citation requirements, approval permissions, and immutable audit events. |
| P3-05 | Deferred | 2026-07-22 | Revalidated maintenance workflows. No vendor portal was implemented because it needs an external vendor role/access model and assigned-work-order scoping. | None | None | Static inspection | Vendor coordination remains internal-only. | Define vendor identity, invitation, assignment, file/comment visibility, and direct-object-access tests. |

## Phase 5 implementation status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P3-04 | Deferred | 2026-07-22 | Revalidated lifecycle/export/storage areas. No retention/legal-hold console was implemented because legal policy, hold immutability, retention periods, and deletion authority are customer- and jurisdiction-specific. | None | None | Static inspection | Retention/legal-hold governance remains a product/legal decision. | Define policy templates, hold authority, audit events, storage deletion behavior, and rollback/recovery requirements. |
| P4-01 | Deferred | 2026-07-22 | Revalidated routing and route contract tests. No route-manifest refactor was implemented because it would be a broad behavior-preserving architecture change touching routing, navigation, search, and module gates. | None | None | Static inspection | Route metadata remains distributed. | Plan a dedicated route-manifest refactor with generated route-order/navigation/search tests. |
| P4-02 | Implemented | 2026-07-22 | Documented the mockup sandbox as non-production prototype code and clarified that it must not be used as shipped CareBase evidence. | `README.md`, `artifacts/mockup-sandbox/README.md` | None | Documentation review plus root validation commands | Documentation prevents confusion but does not enforce the boundary automatically in CI. | Consider a source-integrity rule if sandbox files are repeatedly confused with production code. |
| P4-03 | Deferred | 2026-07-22 | Revalidated existing aggregate bundle budget script. No route-level budget enforcement was added because route/chunk ownership and failing thresholds need design before CI enforcement. | None | None | `pnpm run check:bundle` | Aggregate budgets exist; route-level budgets remain undefined. | Define route groups, budget baselines, threshold policy, and CI reporting format. |

## Post-phase hardening status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P4-02 follow-up | Implemented | 2026-07-22 | Added an automated source-integrity guard that fails if production source areas reference `artifacts/mockup-sandbox` or the mockup sandbox workspace package. Documentation references remain allowed. | `scripts/check-source-integrity.mjs` | None | `pnpm run check:source-integrity` | The guard prevents direct production-source references but does not judge screenshots or human-written release notes outside the repo. | Keep the boundary rule aligned if production source roots change. |

## Phase 5 follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added | Validation performed | Remaining limitations | Follow-up work |
|---|---|---|---|---|---|---|---|---|
| P4-03 | Partially implemented | 2026-07-22 | Added route-level bundle budgets for audited high-touch lazy chunks: Resident Detail, Help Center, Survey Day, System Jobs, and Work Queue. The check fails when one of those chunks is missing or exceeds its budget. | `scripts/check-bundle-budget.mjs` | None | `pnpm run check:bundle` | Only selected audited routes have explicit budgets; route/chunk names depend on Vite output naming. | Expand route budgets as route-manifest ownership is defined and tune budgets from main-branch baselines. |

## Phase 5 route-manifest follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added/updated | Validation performed | Remaining limitations | Follow-up work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P4-01 | Partially implemented | 2026-07-22 | Added a typed route-order manifest for routes that must be declared before dynamic siblings and moved the route-order regression test to consume that manifest. This reduces duplicated route-order knowledge without changing runtime route declarations. | `artifacts/caremetric-carebase/src/lib/routeManifest.ts`, `artifacts/caremetric-carebase/src/lib/routeOrder.test.ts` | `artifacts/caremetric-carebase/src/lib/routeOrder.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/routeOrder.test.ts`; full validation commands recorded in completion report | Full P4-01 is not complete: `App.tsx`, navigation, search, product modules, and permission routing are not generated from one manifest. | Design a full route metadata model and migrate routes/navigation/search one domain at a time with authenticated e2e coverage. |

## Phase 5 route-registration follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added/updated | Validation performed | Remaining limitations | Follow-up work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P4-01 | Partially implemented | 2026-07-22 | Added route-registration coverage helpers and tests that compare existing route metadata sources (`APP_PAGES`, `MARKETING_NAV`, `LEGACY_ROUTE_REDIRECTS`, and `PUBLIC_ACCESS_FLOWS` token routes) against actual `App.tsx` route declarations. | `artifacts/caremetric-carebase/src/lib/routeManifest.ts`, `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts` | `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/routeRegistration.test.ts src/lib/routeOrder.test.ts`; full validation commands recorded in completion report | This still does not generate runtime routing/navigation from a unified manifest. Public clean-path coverage is intentionally deferred because `/checkin` is currently a non-routable cleanup path and changing that flow requires product/security review. | Define clean-path routing policy for public token flows, then expand manifest coverage to full route ownership, roles, redirects, search, and bundle budgets. |

## Phase 5 public-token clean-path follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added/updated | Validation performed | Remaining limitations | Follow-up work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P4-01 / public-token clean path | Implemented | 2026-07-22 | Registered the `/checkin` clean path, updated the check-in page to consume/store the QR token with existing tab-scoped token handling, and added route-registration coverage for storage-backed public clean paths. | `artifacts/caremetric-carebase/src/App.tsx`, `artifacts/caremetric-carebase/src/pages/CheckIn.tsx`, `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts` | `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/routeRegistration.test.ts src/lib/publicAccessToken.test.ts`; full validation commands recorded in completion report | Live QR scan/check-in still requires authenticated browser verification against Supabase RPC and seeded class data. | Add Playwright QR check-in smoke once local Supabase/seed data is available in CI. |

## Phase 5 check-in component-test follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added/updated | Validation performed | Remaining limitations | Follow-up work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P4-01 / public-token clean path test coverage | Implemented | 2026-07-22 | Added direct CheckIn component regression coverage for route-token storage/history scrubbing, stored clean-path token presentation, and missing-token messaging. | `artifacts/caremetric-carebase/src/pages/CheckIn.render.test.tsx` | `artifacts/caremetric-carebase/src/pages/CheckIn.render.test.tsx` | `pnpm --filter @workspace/caremetric-carebase exec vitest run src/pages/CheckIn.render.test.tsx` | Server-rendered component tests do not execute `useEffect`, so live RPC invocation still requires browser/e2e coverage. | Add Playwright coverage against seeded Supabase for the full QR check-in/check-out workflow. |

## Remaining phased-plan validation follow-up status — 2026-07-22

| ID | Status | Date addressed | Summary of implementation | Files changed | Tests added/updated | Validation performed | Remaining limitations | Follow-up work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Edge Function validation gap | Implemented | 2026-07-22 | Installed the documented Deno 2.5.6 toolchain through `scripts/setup-codex-cloud.sh` and reran the Edge Function validation suite successfully. This resolves the repeated environment-only Deno blocker in prior completion reports for this workspace. | None | None | `bash scripts/setup-codex-cloud.sh`; `export PATH="$HOME/.local/bin:$HOME/.deno/bin:$PATH"; pnpm run check:edge-functions`; `pnpm run check:source-integrity` | This validates TypeScript/runtime tests locally, not live Supabase credentials, deployed secrets, webhooks, or production scheduled invocations. | Keep Deno available in CI/Codex images and add live Supabase/deployment validation when credentials are configured. |
