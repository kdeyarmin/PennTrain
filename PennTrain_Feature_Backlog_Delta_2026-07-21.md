# PennTrain feature backlog delta — 2026-07-21

**Companion report:** `PennTrain_Feature_Review_2026-07-21.md`
**Scope:** new work only. PT-001..PT-034 remain in `PennTrain_Execution_Backlog_2026-07-20.md` (the **canonical PT registry** — see the companion report's erratum), PT-035..PT-042 remain in `PennTrain_Backlog_Delta_2026-07-21.md`, and E1..E29 remain in `ENHANCEMENT_REPORT.md`. None are restated here.
**Conventions:** priorities (P0/P1/P2/P3) and effort (S/M/L) inherit the 2026-07-20 triage rules. Paths beginning with `src/` are beneath `artifacts/caremetric-carebase/`. Every item carries a `Prior art` line naming the nearest existing item and why this is not a duplicate.

---

## Section A — Promotions and status confirmations (existing IDs, no new numbers)

| ID | Confirmation / sharpened scope | Priority |
|---|---|---|
| **E1 / PT-007** — GA-promotion program | Re-confirmed as the single largest value item. `pilot/controlled-pilot.template.json` is still a blank template; `pnpm run check:pilot` still exits at usage. Nothing in this review displaces it. | P0-adjacent (program) |
| **E19** — Survey Day Mode | Sharpened: `SURVEY_DAY_MODE_SPEC.md` is implementation-ready, and a repo-wide search for `survey_day\|survey-day\|SurveyDay` matches only markdown — zero migrations, RPCs, routes, hooks, or pages. Decision due in Wave 1: schedule the build (M, per the spec's four slices) or explicitly descope the spec with a banner. The marketing Features page was checked and makes no false Survey-Day-Mode claim. | P1 decision; build M |
| **E2** — Server-side pagination adoption (+ E16 per page) | In progress (5 of 7 done). `PolicyDocuments` and `ConfidentialIncidents` use the shared `usePaginatedDomainList` config (no joins). `Complaints` and `EvidenceRoom` use the **summary-card** pattern with a dedicated join-preserving hook. Each converted summary-card page adds a SECURITY INVOKER `get_*_list_summary` RPC, pgTAP-tested against direct RLS-scoped counts: `get_complaint_list_summary` (`20260721180000`), `get_evidence_collection_list_summary` (`20260721190000`), `get_confidential_intake_list_summary` (`20260721200000`). `Documents` uses a dedicated `usePaginatedDocuments` hook that keeps the uploader-employee join plus the facility/employee/type filters (`.range()`+`count:"exact"`, Previous/Next controls). All fold in E16 (URL-persisted filters + page). Remaining: **summary-card page** `WorkQueue` (needs its own `get_*_list_summary` RPC); **joined page** `Practicums` (paginate its own domain hook to preserve the employee join). | P1, M |
| **E12** — Edge-function runtime tests | Sharpened with the DI finding: only 3 of 51 functions use the testable `handler.ts` pattern (`capture-product-event`, `report-client-error`, `run-data-lifecycle`); the CI floor is hardcoded to 3 at `scripts/check-edge-functions.mjs:92`. Promoted scope: convert the six highest-risk orchestrators — `stripe-billing-webhook`, `scim-provision`, `integration-api`, `impersonate-user`, `signup-organization`, `dispatch-notifications` — to `handler.ts` + injected deps with runtime tests, and turn the floor into a ratchet (fail CI if the tested count decreases from the last recorded value). Elevated P2→P1 for the named six. | P1, L |
| **E13** — Component/E2E coverage | Status: still 2 Playwright specs (`role-routing`, `public-smoke`) and ~2 component render tests against 84 app pages + 19 admin pages. Promoted targets, in order: billing checkout, incident lifecycle, evidence export. | P1, L |
| **E10** — Notification spend caps | **Already implemented** (stale premise). A concurrency-safe hard cap ships in `begin_notification_delivery_attempt` (`20260717015547`, advisory-locked per org, pgTAP-tested), the cost/alert triggers exist, and `set_notification_spend_policy` + the Admin → Notification Deliveries UI are wired. The only real defect was web-push being charged at the email rate in the cost ledger while the gate counts it as zero; fixed in `20260721170000` so web-push costs zero. No further enforcement work needed before fan-out expansion. | Done |
| **E8** — LTI/xAPI + adaptive paths: ship or prune | Confirmed open decision; the "ship" path is canonical PT-032 (isolated SCORM/LTI runtime gateway). | P2 decision |
| **E4** — Server-side report computation | Confirmed open; if executed, absorb PT-049's shared harness so the refactor happens once. | P2, L |
| **E27** — Organization setup checklist | Sharpened: add the Train-only-organization first-run experience. The employee sidebar always declares Shift/Schedule/Services/Work items (`src/components/layout/Sidebar.tsx:434-476`); in a Train-only org, module filtering leaves a sparse "Schedule & Courses" section with no explanatory empty state. | P2, M |

---

## Section B — New items

### PT-043 — Make the Copilot widget honest: grounded AI or labeled quick-help

**Labels:** `priority:P1`, `area:frontend`, `area:ai-governance`, `trust`
**Outcome:** no product surface presents deterministic keyword matching as AI "thinking." The floating assistant either routes through the existing governed AI boundary or is relabeled as deterministic quick navigation with the simulated latency removed.

**Prior art:** none. `ENHANCEMENT_REPORT.md` §5 fences open-ended policy Q&A chat — this item must reuse the grounded/citation shape of `compliance-copilot`, not loosen it. The E-report's AI items (E20–E22) cover different features.

**Evidence**

- `src/components/CareMetricCopilot.tsx:88-93` — `window.setTimeout(..., 350)` sets `isThinking` around a synchronous call to `answerCareMetricCopilot`, simulating model latency.
- `src/lib/caremetricCopilot.ts` and `src/lib/helpCopilot.ts` — hardcoded knowledge/intents; answers always render a "confidence" badge.
- Genuinely governed AI exists at `supabase/functions/compliance-copilot` (grounded intents, citations, immutable receipts).

**Implementation slice**

1. Product decision: AI-backed widget vs. deterministic "Quick help."
2. If AI-backed: route the widget through `compliance-copilot` with org-scoped auth, citations rendered in-widget, existing receipts and safeguards; keep the deterministic intent router as instant fallback for navigation intents.
3. If deterministic: rename the surface, remove the artificial delay and chat/"thinking" framing, drop the confidence badge, keep the intent router and its tests.

**Acceptance criteria**

- No artificial latency anywhere in the widget.
- No "AI"/"assistant is thinking" presentation on deterministic output.
- If AI-backed: every answer carries citations and runs under the existing tenant AI governance; demo tenants remain blocked per existing rules.

**Automated verification:** component tests asserting no timer-based pending state for deterministic answers; if AI-backed, contract tests against the `compliance-copilot` response shape.

**Effort:** S (deterministic path) / M (AI path).

### PT-044 — Replace raw-identifier admin inputs with entity pickers and guided forms

**Labels:** `priority:P2`, `area:frontend`, `ux`, `admin`
**Outcome:** operators select employees, facilities, and governed records via typeahead pickers instead of pasting UUIDs; raw-JSON value entry gets structured fields or schema-validated editors; long placeholder-only textarea chains get labels and inline guidance.

**Prior art:** E15 (extract shared Combobox) is the natural building block and should be executed as part of this item; no prior item covers the admin-console ergonomics themselves.

**Evidence**

- `src/pages/admin/EnterpriseFoundation.tsx:201,220` — `placeholder="Employee UUID"` / `placeholder="Optional facility UUID"` paste inputs; `:921` — raw JSON entitlement value (`placeholder='{"seatLimit":100}'`) in a 1,266-line console.
- `src/pages/app/WorkItemDetail.tsx:332-333` — "Record type, e.g. incident" / "Record UUID" free-text linking.
- `src/pages/app/QapiProjectDetail.tsx:203-417` — seven placeholder-labeled textareas (root cause, interventions, barriers, measures) with minimal validation affordance in the record that most needs rigor.

**Implementation slice**

1. Extract the shared Combobox/typeahead (E15) with server-backed search per entity type.
2. Convert EnterpriseFoundation identity/entitlement forms, then WorkItemDetail record linking, then QAPI forms.
3. Add invalid-selection and permission-scoped-search handling (org-scoped results only).

**Acceptance criteria**

- No admin/app form requires pasting a UUID for an entity that has a directory.
- Entitlement values are edited through labeled fields or schema-validated JSON with error display.
- Pickers only surface rows the caller can already read under RLS.

**Automated verification:** component tests for picker search/selection/invalid-ID rejection; a grep gate that fails on new `placeholder="..UUID"` inputs.

**Effort:** M.

### PT-045 — Consolidate app chrome: route-registry titles/breadcrumbs and single help/account IA

**Labels:** `priority:P2`, `area:frontend`, `ux`, `navigation`
**Outcome:** page titles and breadcrumbs derive from a route registry (entity-aware on detail pages) instead of URL string-munging; help/what's-new/account actions live in one surface; search dismissal is race-free.

**Prior art:** none direct; adjacent to E15/PT-044 (shared primitives).

**Evidence**

- `src/components/layout/Header.tsx:249-258` — `getPageTitle` title-cases the last URL segment and falls back a segment when it matches a UUID/number; breadcrumbs are one static level.
- Triplicated IA: header help dropdown (`Header.tsx:332-347`), avatar menu (`Header.tsx:377-388`), sidebar footer (`src/components/layout/Sidebar.tsx:742-765`) all expose the same account/announcements/what's-new destinations.
- `src/components/layout/GlobalSearch.tsx:140` — 150 ms blur `setTimeout` race vs. the header org-selector's pointer-outside pattern.

**Implementation slice**

1. Introduce a route-metadata registry (title, parent, entity resolver) consumed by Header and document titles.
2. Pick one canonical home for help/account actions; reduce the others to links.
3. Replace timed blur dismissal with pointer/focus-outside handling shared with the org selector.

**Acceptance criteria**

- Detail pages show entity names in title/breadcrumb once loaded.
- Exactly one primary help/account menu; no duplicated menu trees.
- Keyboard and touch selection in GlobalSearch never lose a click to the dismissal timer.

**Automated verification:** component tests for title resolution (list, detail, UUID segments) and search dismissal; axe pass on the header.

**Effort:** M.

### PT-046 — Decide dark mode: ship a toggle or delete the dead theme

**Labels:** `priority:P3`, `area:frontend`, `decision`, `build`
**Outcome:** either a persisted, accessible theme toggle ships, or the unreachable `.dark` token block and `dark:` variants are removed.

**Prior art:** none. Bundle-size upside aligns with PT-042 (headroom) without depending on it.

**Evidence**

- `src/index.css:120` — complete `.dark` token block.
- 126 `dark:` occurrences across `src/**/*.{ts,tsx}`; zero `ThemeProvider`/`setTheme`/`prefers-color-scheme` wiring — nothing ever applies the `.dark` class.

**Implementation slice**

1. Decision: ship or remove (S).
2. Ship path: theme provider + persisted toggle + `prefers-color-scheme` default; audit the 126 variants for contrast (M).
3. Remove path: delete the token block and variants; add a lint against reintroducing `dark:` without a provider (S).

**Acceptance criteria:** no unreachable theme code remains, or the toggle works with WCAG-AA contrast in both themes.
**Automated verification:** grep gate (`dark:` count 0, or provider present + toggle test).
**Effort:** S decision + S/M execution.

### PT-047 — Make in-app status surfaces reflect actual release state

**Labels:** `priority:P2`, `area:frontend`, `area:docs`, `trust`
**Outcome:** `/admin/roadmap` renders from a maintained source (or is removed); no in-app surface claims phases/capabilities as "implemented" independent of release state.

**Prior art:** extends E18 (superseded-doc banners) from documentation into product surfaces; complements canonical PT-007 provenance. The companion report's erratum (PT status-table drift) is recorded in the review doc, not ticketed separately.

**Evidence**

- `src/pages/admin/ImprovementRoadmap.tsx:5-87` — hardcoded `phases` array; all six entries `status: "implemented"`, timeline strings like "Code complete; pilot pending" frozen in source.

**Implementation slice**

1. Decide: retire the page, or back it with a maintained source (e.g., a platform-admin-editable table or generated from release/provenance data).
2. Either way, remove hardcoded "implemented" claims; label phase status with the same maturity vocabulary as the pilot program (code-complete / pilot / GA).

**Acceptance criteria:** the page cannot show a status that release data does not support; or the page is gone and its route redirects.
**Automated verification:** grep gate for hardcoded `status:` literals in roadmap page; unit test of the status source if kept.
**Effort:** S.

### PT-048 — Add a preventive RLS/grant lint to CI

**Labels:** `priority:P2`, `area:database`, `area:ci`, `rls`
**Outcome:** a migration that grants to `anon`/`public`, creates a table without enabling RLS + policies, or creates a `SECURITY DEFINER` function without `set search_path` fails CI before merge.

**Prior art:** complements canonical PT-015 (immutable migration history) and PT-039 (module/RLS coverage tests). Distinct: this is a generic lint on **new** migration text with a documented-exception allowlist, not a coverage test of existing policies.

**Evidence**

- 19 migrations in `supabase/migrations/` match `close_|remediate|harden|leak|lockdown|revoke` — each a post-hoc correction of a class this lint catches pre-merge (e.g., the `close_anon_execute_leak_*` series).
- CI already runs Supabase advisors post-apply; nothing gates the migration *text* at PR time.

**Implementation slice**

1. Script (Node, alongside `scripts/check-*.mjs`) parsing added migration files in the PR diff for: `grant ... to anon|public`, `create table` without matching `enable row level security`, `security definer` without `set search_path`.
2. Allowlist file for documented intentional exceptions (e.g., the public `course-videos` bucket rationale pattern).
3. Wire into `check:all` and CI; self-test fixtures.

**Acceptance criteria**

- Fixture migrations for each bad pattern fail; current HEAD passes with an explicit committed baseline/allowlist.
- Exceptions require a written rationale line to pass.

**Automated verification:** the lint's own fixture tests in CI.
**Effort:** M.

### PT-049 — Extract a shared document-generation harness for the seven PDF/export functions

**Labels:** `priority:P3`, `area:edge-functions`, `maintainability`
**Outcome:** `generate-certificate-pdf`, `generate-class-notice-pdf`, `generate-incident-report-pdf`, `generate-incident-state-form-pdf`, `generate-resident-assessment-pdf`, `generate-compliance-binder`, and `generate-poc-document` share one `_shared/` harness for auth, job claim, storage write, signed-URL return, and audit receipt — so a fix or hardening lands once.

**Prior art:** none; E4 (server-side reports) adjacent — if E4 executes first, build the harness there and migrate the seven onto it.

**Evidence:** seven sibling functions under `supabase/functions/` re-implement the cron-worker-vs-user-download split and storage-signing pattern with no shared harness tests.

**Implementation slice:** extract the harness with unit tests (fits the E12 DI pattern); migrate one generator per PR.
**Acceptance criteria:** all seven consume the harness; one test suite covers claim/auth/storage/signing behavior; no per-function drift in cron-secret handling.
**Automated verification:** harness unit tests; `check:edge-functions` count unchanged or reduced.
**Effort:** S–M.

### PT-050 — Decide the operational offline posture for field staff

**Labels:** `priority:P3`, `area:pwa`, `decision`, `mobile`
**Outcome:** a written, tested decision on what `/app/*` surfaces (if any) work offline beyond the learner course player — explicit "you're offline" messaging at minimum, cached read-only Today/shift surfaces at maximum.

**Prior art:** canonical PT-009 owns *learner* offline (identity safety, cold-start, no-data-loss) and already cites the PWA config. This item is the separate product decision for **operational** surfaces used by mobile field staff (Today, Work Queue, Emergency accountability). Sequence after PT-009; do not duplicate its slices.

**Evidence**

- `artifacts/caremetric-carebase/vite.config.ts:78` — `navigateFallback: null`: a cold offline navigation to any operational page simply fails, with no offline fallback page or messaging.
- Offline caching today is scoped exclusively to the employee course player (`src/lib/offlineCourseCache.ts`, `src/pages/employee/OfflineCourse.tsx`).

**Implementation slice:** (1) decision record; (2) minimum slice: offline fallback route + connectivity banner; (3) optional: StaleWhileRevalidate read-only caching for chosen surfaces with staleness labeling (no offline mutations without PT-009-grade sync design).
**Acceptance criteria:** offline navigation to an operational page shows an intentional state, never a browser error; any cached surface labels data freshness.
**Automated verification:** Playwright offline-mode test for the fallback; workbox config unit assertions.
**Effort:** decision S; implementation per decision.

---

## Verification

Read-only checks that keep this delta honest, all runnable at HEAD `20f75b2`:

1. **Evidence freshness** — each must hit as stated:
   - `grep -n "setTimeout" src/components/CareMetricCopilot.tsx` → line 88 (`, 350)` closes at 93)
   - `grep -n "navigateFallback" artifacts/caremetric-carebase/vite.config.ts` → 78
   - `grep -n "runtimeTestedDirectories.size < 3" scripts/check-edge-functions.mjs` → 92
   - `grep -rEo 'dark:' src --include='*.tsx' --include='*.ts' | wc -l` → 126; `grep -n "^\.dark {" src/index.css` → 120
   - `grep -rl usePaginatedDomainLists src/pages` → exactly the 5 adopter pages; the 7 unbounded pages return 0 for `usePaginated|\.range\(`
   - `ls -d supabase/functions/*/ | grep -v _shared | wc -l` → 51; `ls supabase/functions/*/handler.ts` → exactly 3
   - `ls supabase/migrations | grep -cE "close_|remediate|harden|leak|lockdown|revoke"` → 19
   - `grep -rln -i "survey_day\|survey-day\|SurveyDay" artifacts/caremetric-carebase/src supabase` → no matches
2. **Numbering integrity** — this document contains only `PT-043`..`PT-050` as new headings; every promotion references an ID resolving in the canonical 07-20 backlog (PT) or `ENHANCEMENT_REPORT.md` (E); no retro-insertion of PT-043+ into prior documents.
3. **Canonical-registry consistency** — any PT-001..042 one-liner quoted in these two documents matches `PennTrain_Execution_Backlog_2026-07-20.md` / `PennTrain_Backlog_Delta_2026-07-21.md` verbatim (the check the 07-21 review's status table failed).
4. **Fence compliance** — `eMAR`, family portal, NAB content, multilingual, multi-state, and open-ended policy chat appear in these documents only in fenced/"not proposed" context.
5. **Repo hygiene** — docs-only change: `pnpm run check:source-integrity` passes; no `src/` or `supabase/` file modified.
