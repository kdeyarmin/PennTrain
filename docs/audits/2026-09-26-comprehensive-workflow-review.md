# Comprehensive workflow review — September 26, 2026

This is dated review evidence for `790555ffaf2d6097e82567af32b377b7640d7c66` plus the accompanying fixes. `BACKLOG.md` remains the planning register. A reviewed workflow is not a claim that every possible input, physical device or live provider has been tested.

## Scope and method

The review covers the CareBase and standalone Train entry points, six application roles, public and guest entry points, shared data hooks, server routes, Supabase handlers, and the voice gateway. It combines source tracing, existing database and browser journeys, contract and reachability checks, targeted regression tests, and build validation. Changes preserve the existing server authorization model and product boundaries.

The [route inventory](2026-09-26-route-inventory.csv) records all 279 route declarations across the two entry points, representing 217 distinct paths, with components, declared role gates and facility gates. The repository checks also enumerate 1,017 exported hooks, 682 functions granted to authenticated callers, and 1,040 public database functions. Hook reachability has no allowlisted orphan hooks. Those checks verify wiring and contract consistency; they do not replace behavioral tests.

## Workflow coverage

| Area | Review evidence |
| --- | --- |
| Landing, product/features, pricing/savings, security, FAQ, regulatory references, privacy/terms and signup agreement | Public routes, navigation, page metadata, conversion links, responsive layout and existing public accessibility/keyboard journeys. Regulatory text was not treated as a fresh legal determination. |
| Signup, invitations, sign-in, SSO, password recovery and reset | Form validation, failure handling, role-aware destinations, URL sanitization, recovery isolation and abandoned-session handling. Reset form now binds to its original recovery account and rechecks identity before submission. |
| MFA, SMS/TOTP, idle lock, suspension, impersonation and sign-out | Session gates, current verification requirements, return paths, cache cleanup and preservation of unsaved work; existing shared handler and UI tests. Live SMS delivery and enterprise IdP interaction require provider acceptance testing. |
| Navigation, command actions, favorites/recents, module entitlements and facility types | Both entry points, role registry, sidebar controls and redirect termination; route-link, reachability, query invalidation and all-role navigation checks. |
| Dashboard, Today, alerts, operational work and help | Scope selection, actionable destinations, pending/error/empty states, overdue behavior, bulk actions and saved-support-ticket attachment recovery. |
| Facilities, residents, admissions, agreements and designated-person/guest portals | [Care workflow evidence](2026-09-26-care-workflows-review.md). |
| Resident assessments, clinical chart, service delivery, changes of condition, dietary/services calendar and resident finance | [Care workflow evidence](2026-09-26-care-workflows-review.md); assessment queries now bind form identity to the resident in the route. |
| Incidents, complaints, confidential reports, inspections, violations, QAPI, compliance evidence and survey workflows | [Care workflow evidence](2026-09-26-care-workflows-review.md), shared permission and route checks, and resident lifecycle/browser journeys. |
| Maintenance, work orders, emergency operations and medication sources | [Care workflow evidence](2026-09-26-care-workflows-review.md); complete work-order retrieval, editable inventory and source lifecycle controls. |
| Staff, credentials, background/administrator qualifications, competencies, practicums and med-admin rosters | [Training/workforce evidence](2026-09-26-training-workforce-review.md). |
| Courses, governed content, quizzes, assignments, yearly plans, live classes, learner completion and offline learning | [Training/workforce evidence](2026-09-26-training-workforce-review.md), including attempt history and honest failure states. |
| Scheduling, setup, shift workflows, self-service and training reports/certificates/passports | [Training/workforce evidence](2026-09-26-training-workforce-review.md), plus public verification failure-state review. |
| Organization/platform administration, users, packages/billing, imports/exports, audit/security, feature releases and background jobs | [Administration/integration evidence](2026-09-26-admin-integrations-review.md). |
| Policy documents, immutable publication, campaigns/targeting, knowledge checks, reminders, personal attestations and supersession | [Administration/integration evidence](2026-09-26-admin-integrations-review.md); complete metadata, assignment recovery, explicit reader restrictions and asynchronous review identity. |
| Documents, notification preferences/delivery, AI assistants, provider integrations, webhooks and voice service | [Administration/integration evidence](2026-09-26-admin-integrations-review.md), shared handler tests and data-contract checks. |

## Reset regression coverage

Ten targeted page tests exercise successful invitation completion, a forged/expired invite-looking URL with an unrelated existing session, cross-tab account changes, delayed cross-tab events at submission, recovery termination followed by another recovery, replacement-session preservation at unmount, local abandonment of the original recovery, retry after a rejected password update, invitation event ordering and stale initial-read failures. Twelve additional grant-identity tests require the actual URL token to match before the Auth provider marks an initial invite/recovery session. The form clears typed passwords and becomes invalid on a session identity change.

Supabase's [updateUser contract](https://supabase.com/docs/reference/javascript/auth-updateuser) updates the currently logged-in user. The form therefore checks the current recovery identity immediately before invoking it; the URL's `type` value alone no longer establishes recovery ownership. The existing server-side Auth checks remain authoritative.

## Resource identity and state

A final cross-review traced retained local state across resource navigation: employee A's edit fields could be saved against B, schedule and quiz actions could retain an old assignment/question target, and confidential reports, evidence collections and move-in workspaces could retain protected content or guest links from the preceding record. Authenticated page components now remount when the normalized pathname, reviewer identity/organization/role, or platform administrator's viewed organization changes. Only the page component is keyed; the application shell stays mounted, and query/hash changes on the same path preserve page state. Nine boundary tests verify these distinctions, and the real role journey opens an unsaved employee draft before navigating within the app to another employee and checking its editor.

Confidential reports, evidence collections and move-in workspaces also have independent resource/reviewer boundaries, with tests proving that late responses cannot populate the replacement record. Policy review uses request identity within one page: signed-document, knowledge-check and signing callbacks cannot affect a newer policy dialog. Historical practicum names resolve the employee IDs on the current page, including inactive staff, while new-record and observer selections retain their active-staff scope.

The public passport lives outside the authenticated boundary. Its QR renderer is keyed to the passport slug and cancels obsolete generation callbacks; tests cover both immediate switching and delayed results. A visible verification link remains available while the QR loads or if it cannot be generated.

Visual inspection of the employee browser journey also found raw credential codes in readiness warnings. These now use the existing clearance names shared with My Credentials; matching, eligibility and custom labels remain unchanged, with three focused regressions.

## Execution evidence

Validation results and the initial integrated CI link are recorded in the matching `BACKLOG.md` review entry. The final branch's complete gate is attached to [PR #576](https://github.com/kdeyarmin/PennTrain/pull/576/checks). Local Docker's engine did not respond, so database-backed and authenticated browser checks use CI's disposable Supabase stack rather than a production tenant. Build-only fixtures use the same non-production keys as the existing CI application lane.

The local public browser suite passed all 28 desktop/mobile cases, including accessibility and keyboard navigation. Its first run exposed a native-scroll test race: the test reversed ArrowRight at the first animation frame instead of waiting for scrolling to finish. The revised test observes `scrollend` in both directions and retains both directional assertions and focus/tab-order checks. Three isolated repetitions also passed before that synchronization change; the full corrected run passed with two workers.

The dependency audit reports no high or critical advisories and two moderate entries for one unresolved development-tool advisory, [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), affecting `vitest` and `@vitest/mocker` 3.2.7. Repository inspection found no affected public `mockerPlugin`/`interceptorPlugin`, Vitest browser mode, or programmatic Vitest server. Both test suites use `vitest run`; application browser journeys use Playwright, and production starts application servers. This is not a fixed dependency vulnerability, but the reviewed configuration has no matching application exposure path. The fix requires a separately validated major test-tool upgrade to Vitest 4.1.11 or newer; track that maintenance in `BACKLOG.md` and reassess before introducing mocker plugins into a reachable development server.

The review does not send real customer messages, charge cards, alter production records, apply production migrations or deploy the branch. Real provider delivery, physical-device behavior, assisted user acceptance, and operational/legal decisions already tracked in the backlog remain separate acceptance work.
