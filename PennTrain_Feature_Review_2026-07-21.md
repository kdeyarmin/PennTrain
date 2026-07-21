# PennTrain / CareMetric CareBase feature review — 2026-07-21

**Reviewed commit:** `20f75b2` on `claude/app-review-improvements-3gdfhr` (identical to `origin/main` after #229 merged).
**Baselines:** `PennTrain_Comprehensive_Review_2026-07-20.md` + `PennTrain_Execution_Backlog_2026-07-20.md` (PT-001..PT-034), `PennTrain_Comprehensive_Review_2026-07-21.md` + `PennTrain_Backlog_Delta_2026-07-21.md` (PT-035..PT-042), `ENHANCEMENT_REPORT.md` (E1..E29), `IMPLEMENTATION_PLAN.md` (29 approved improvements, 5 phases).
**Scope:** feature-level product review of the whole application surface — what exists, how mature it is, and whether the product's claims match its code. This review does not restate PT-001..042 or E1..E29 findings; prior items appear only in the prior-art ledger and status confirmations.
**Companion backlog:** `PennTrain_Feature_Backlog_Delta_2026-07-21.md` (PT-043 onward).

Paths beginning with `src/` are beneath `artifacts/caremetric-carebase/`.

## Executive summary

The platform is **feature-saturated, not feature-short**: roughly 150 routed pages across ~20 feature areas, 51 Edge Functions, 328 migrations spanning ~25 business domains, and 16+ scheduled jobs behind a genuine system-jobs control plane. Coverage runs from LMS/training through resident operations, incidents/inspections/QAPI, credentialing and exclusion screening, evidence and binders, billing with usage-based Stripe sync, and governed AI. Very few competing products of this age have this breadth; the recurring problem is not missing features.

The dominant value gap is unchanged from prior reviews: **promotion, not construction**. All 29 approved improvements are code-complete but none is GA-promoted; the controlled-pilot evidence manifest (E1 / PT-007) remains blank. Nothing in this review displaces that as the single largest value item.

What this review adds is a cross-cutting theme the prior code-level reviews did not name: **claim consistency**. Several surfaces present a more finished or more intelligent product than the code delivers:

1. The floating **"Copilot" widget is not AI** — it is a client-side keyword matcher wrapped in an artificial 350 ms "thinking" delay, while genuinely governed AI (grounded, citation-backed `compliance-copilot`) exists elsewhere in the product (`src/components/CareMetricCopilot.tsx:88-93`).
2. The **`/admin/roadmap` page is hardcoded static content** with every phase labeled `implemented` (`src/pages/admin/ImprovementRoadmap.tsx:5-87`), independent of actual release state.
3. **Survey Day Mode (E19)** has an implementation-ready spec and zero code — no migration, RPC, route, or page matches `survey_day` anywhere in `supabase/` or `src/`.
4. The **PT-019..033 status table in `PennTrain_Comprehensive_Review_2026-07-21.md` drifted from the canonical backlog** — the same IDs carry different one-liners than `PennTrain_Execution_Backlog_2026-07-20.md` defines (see Documentation integrity below).

Secondary themes: **uneven adoption of good shared primitives** (server-side pagination adopted on 5 list pages while 7 sibling pages remain unbounded; the dependency-injected, testable Edge handler pattern used by only 3 of 51 functions), **admin ergonomics** (raw-UUID paste inputs and raw-JSON textareas in the enterprise console), and **verification depth** (2 Playwright specs and ~2 component render tests against 84 app pages; the Edge runtime-test CI floor is hardcoded at 3).

**Release posture: unchanged.** This review relaxes nothing: PT-001..PT-007 remain release blockers, and the PT-035..042 billing/entitlement remainders stay in the immediate queue.

## Scope, method, and evidence

- Three parallel sweeps at HEAD `20f75b2`: (1) frontend feature inventory — full route table, page capabilities, role/module/facility-type gating, shared UX infrastructure; (2) backend/platform inventory — all Edge Functions via `supabase/config.toml`, migration domain map, integrations, cron jobs, test stack; (3) prior-art synthesis — every review/roadmap/backlog/enhancement document read first, so existing items are treated as prior art rather than findings.
- Every claim cited in this document and the companion backlog was re-verified by direct read/grep at HEAD. Sweep claims that did not survive verification were corrected or dropped; the prior-art ledger records the dropped ones with reasons.
- Limitations: static review only — no live Supabase stack, no Deno runtime, no Playwright run in this session. Counts (pages, functions, tests, migrations) are from the working tree.

## Prior-art ledger

Every exploration finding, its nearest prior item, and its disposition. Dispositions: **new ticket** (numbered in the companion backlog), **promotion** (sharpens an existing PT/E item, no new number), **confirmed** (already covered; status noted), **dropped** (did not survive verification).

| Finding | Nearest prior art | Disposition |
|---|---|---|
| Copilot widget simulates AI over a keyword matcher | none (E-report fences open-ended policy chat; fence respected) | **New — PT-043** |
| Raw-UUID/raw-JSON admin inputs (`EnterpriseFoundation`, `WorkItemDetail`) | E15 (shared Combobox) is a building block, not coverage | **New — PT-044** |
| URL-string-munged titles/breadcrumbs; triplicated help/account IA; GlobalSearch 150 ms blur race | none | **New — PT-045** |
| Complete `.dark` theme (126 `dark:` variants) with no toggle — dead code | none | **New — PT-046** |
| `/admin/roadmap` hardcoded "implemented" phases | E18 (doc banners) covers docs, not product surfaces | **New — PT-047** |
| 19 post-hoc security-remediation migrations → preventive lint missing | PT-015/PT-039 adjacent but distinct | **New — PT-048** |
| 7 near-duplicate PDF/document generator functions | E4 adjacent | **New — PT-049** |
| No offline posture for operational `/app/*` pages (`navigateFallback: null`) | PT-009 owns *learner* offline and already cites `vite.config.ts` | **New (decision) — PT-050** |
| Edge handler runtime tests 3/51, CI floor hardcoded at 3 (`scripts/check-edge-functions.mjs:92`) | **E12** | **Promotion** (named six orchestrators; ratchet) |
| ~2 render tests / 2 e2e specs vs 84 app pages | **E13** | **Promotion** (money-path targets) |
| Pagination adopted on 5 pages; 7 unbounded siblings | **E2** (+E16 per page) | **Promotion** (enumerated remainder) |
| Survey Day Mode spec-only, zero code | **E19** | **Promotion** (build-or-descope decision) |
| Sparse `/me` nav for Train-only orgs, no explanatory empty state | **E27** | **Promotion** (first-run scope added) |
| Notification spend caps unenforced before fan-out | **E10** | **Confirmed** open |
| LTI/xAPI + adaptive-path inert schema | **E8** / PT-032 | **Confirmed** open decision |
| eMAR is an ingestion boundary without a vendor adapter | PT-003 + recorded eMAR fence | **Confirmed** — intentionally fenced; no ticket |
| Web-push single-VAPID, weakest channel | PT-005/E10 adjacent | **Noted** in Notifications area; no ticket |
| Facility-type gating "fails open" on query error | — | **Dropped**: intentional and documented — `src/App.tsx:230-231`: "a query error isn't 'confirmed no', and should fail open (render the page) rather than silently bounce the user away with no explanation." Distinct from the module fail-open already ticketed as PT-038. |
| "Survey day" phrase on the marketing Features page | — | **Dropped** as an honesty violation: `src/pages/marketing/Features.tsx:45` is generic readiness copy ("…missing evidence before survey day"), delivered by existing inspection-readiness features — not a claim that Survey Day Mode exists. |
| Legacy redirects, `?action=add` coupling, `exhaustive-deps` disables | — | **Appendix nits**; no tickets |

## Feature-area maturity assessment

Maturity scale (aligned with the repo's own promotion language, not invented grades):

- **M0 Spec/scaffold** — spec or inert schema only
- **M1 Code-complete** — built and statically verified, but default-off or runtime-unproven
- **M2 Runtime-verified** — money-path covered by handler/pgTAP/e2e tests in CI
- **M3 Pilot-proven** — completed controlled-pilot evidence per `CONTROLLED_PILOT_RUNBOOK.md`
- **M4 GA-promoted** — on by default with recorded provenance

**Claims OK?** = do in-app, marketing, and doc surfaces match the actual maturity?

| Area | Maturity | Claims OK? | Blocking prior items | New/promoted items | Note |
|---|---|---|---|---|---|
| Training / LMS core (courses, quizzes, certificates, plans, classes, offline player) | M1–M2 | Yes | PT-009 (offline identity) | E13 | Deepest area; server-side grading, immutable published versions, AI authoring with mandatory review; role-routing e2e exists |
| Compliance operations (incidents, complaints, violations/POC, inspections, QAPI, work queue, shift handoffs) | M1 | Yes | PT-013 (drafts) | E2 remainder, PT-044 | Broad and real; Complaints/ConfidentialIncidents/WorkQueue unbounded lists |
| Resident & admissions operations (Resident 360, assessments, change-of-condition, dietary, finance, move-ins) | M1 | Yes | PT-010, PT-017, PT-029 | E2 remainder | PCH/ALR-gated; assessment editor is large and effect-heavy |
| Workforce & identity (credentials, background checks, exclusion screening, SCIM/SSO, scheduling) | M1–M2 | Yes | PT-001, PT-008 | E12 (scim-provision) | Exclusion screening has atomic refresh + control plane; SCIM breadth thin vs full IdP protocols |
| Evidence, binders, reports, exports | M1 | Mostly | PT-006A/B, PT-012, PT-023* (canonical: scheduled reports) | PT-049, E4 | Async binder + scheduled reports landed; export completeness still open |
| Notifications (in-app, email, SMS, push, digests) | M2 infra / M1 reach | Yes | PT-005, PT-011 partial, E10 | — | Engine, provider webhooks, consent are strong; external reach limited to a subset of types; push is single-VAPID |
| Billing & commercial modules | M1–M2 | Yes | PT-002, PT-035 remainder, PT-039 | E12 (stripe webhook) | Strongest loop in the product; webhook parser drift remains the open P0-class risk |
| Platform admin & enterprise console | M1 | **No** | PT-014, PT-018 | PT-044, PT-047 | Working control plane, but raw-UUID ergonomics and a hardcoded "implemented" roadmap page |
| AI features (compliance copilot, course wizard, document analyzer, mock inspection, HeyGen video) | M1–M2 | **No** (widget only) | PT-019* (canonical: confidential reporting) / AI-governance items from 07-21 review lineage | PT-043 | Governed AI is exemplary (Anthropic-only, grounded citations, immutable receipts, no-bypass review gates); the floating widget misrepresents itself |
| Public & guest surfaces (verify, passport, portals, confidential intake, QR check-in) | M1–M2 | Yes | PT-029, PT-030 | — | Token handling hardened (tab-scoped storage, history replace); pgTAP covers boundaries |
| Platform engineering cross-cut (CI, tests, bundle, PWA, a11y) | M1 | Yes | PT-004, PT-015, PT-016, PT-024/PT-042 (bundle), E13 | E12, PT-046, PT-048, PT-050 | Strong CI gates + 65 pgTAP files vs 3/51 edge handler tests, 2 e2e specs, 92–93% bundle caps, dead dark-mode code |

\* Starred IDs use the canonical `PennTrain_Execution_Backlog_2026-07-20.md` definitions — see Documentation integrity.

## Strengths worth preserving

Called out explicitly so hardening work does not erode them:

1. **Security rationale as documentation:** nearly every entry in `supabase/config.toml` documents its `verify_jwt` decision; `scripts/check-edge-functions.mjs` enforces config/directory parity.
2. **A real operations control plane:** `system_job_definitions`/`system_job_runs` with begin/heartbeat/finish RPCs, `get_platform_health()`, synthetic health probes 4×/hour, a watchdog test, and a manual recovery endpoint (`run-system-job`) — not bare cron.
3. **Database-enforced trust:** 65 pgTAP files covering tenant isolation, entitlements, recalc engines, and access matrices; compliance-determining fields writable only via SECURITY DEFINER RPCs.
4. **AI governance posture:** Anthropic-only with env-configurable fallbacks, grounded citation-backed answers, immutable `compliance_copilot_runs` receipts, human-confirmation safeguards, and an AI-review gate with **no platform_admin bypass** for generated course content.
5. **Mature billing loop:** hosted Checkout/Portal, signature-verified idempotent webhook, hourly server-measured quantity sync, configurable hybrid pricing — with the recent PT-035..038 hardening already applied.
6. **Good shared frontend primitives:** `usePaginatedDomainLists` + `DataTable`, `QueryState`, route-level module gating with platform-admin bypass, server-backed favorites/recents, Cmd+K global search. Adoption, not design, is the gap.

## Documentation integrity — PT numbering drift

The status table in `PennTrain_Comprehensive_Review_2026-07-21.md` assigns different one-liners to PT-019..033 than the canonical backlog defines. Verified examples:

| ID | Canonical (`PennTrain_Execution_Backlog_2026-07-20.md`) | 07-21 review status table |
|---|---|---|
| PT-019 | Confidential reporting access and recovery | "Regulated AI tenant governance" |
| PT-022 | Governed-content reviewer workspace | "Honest critical-screen error states" |
| PT-025 | Billing-state reconciliation schedule | "Edge handler runtime coverage" |
| PT-030 | Evidence-room guest questions | "Docs/release provenance" |
| PT-032 | Isolated SCORM/LTI runtime gateway | "Terminology cleanup" |

**Erratum declaration:** `PennTrain_Execution_Backlog_2026-07-20.md` is the canonical PT-001..034 registry. The drifted rows in the 07-21 review table describe real concerns but are not those PT items; where this review references such concerns it anchors them to E-items or new PT numbers instead (e.g., edge handler runtime coverage is **E12**, not PT-025). Future documents must quote canonical one-liners verbatim. This erratum is recorded here rather than ticketed; the companion backlog's verification section includes the consistency check that would have caught it.

## Sequencing summary

Full details in the companion backlog. Wave 0 is a gate, not a plan — it is unchanged from the 2026-07-20/21 backlogs and no new item may be scheduled ahead of an open P0.

- **Wave 0 (in flight):** PT-001..007 P0 blockers, PT-035..042 remainders, E1/PT-007 pilot program kickoff.
- **Wave 1 (next 30 days — honesty and cheap trust wins, all S-effort):** PT-047 (roadmap surface), PT-043 decision + deterministic slice, PT-046 decision, E19 build-or-descope decision, E10 spend caps.
- **Wave 2 (30–60 days — verification infrastructure):** E12 promotion (DI + tests on the six riskiest orchestrators, ratcheted floor), E13 money-path e2e, PT-048 RLS/grant lint, E2 pagination remainder (+E16 per page).
- **Wave 3 (60–90 days — product depth):** E19 Survey Day build (if chosen), PT-044 pickers (+E15), PT-045 chrome consolidation, E27 + Train-only first-run, E8 decision execution, E4/PT-049, PT-050 decision.

## Appendix — minor nits (not ticketed)

- Legacy redirect routes accumulating in the router (`src/App.tsx:516-521`: `/app/my-trainings`, `/app/policies`, `/app/shift-log`, `/app/work-orders/:id`).
- `src/components/layout/Sidebar.tsx:171` guided link `/app/employees?action=add` — brittle cross-page query-param coupling.
- Repeated `eslint-disable react-hooks/exhaustive-deps` in `TakeCourse.tsx` and `ResidentAssessmentFormEditor.tsx` (5× each) — hand-managed effect dependencies in the two most complex flows.
- `GlobalSearch` blur dismissal races a 150 ms `setTimeout` (`src/components/layout/GlobalSearch.tsx:140`) while the header's org selector uses pointer-outside handling — folded into PT-045.
- Web-push delivery is single-VAPID `web-push@3.6.7` with a thinner consent lifecycle than email/SMS — acceptable today; revisit if push becomes a compliance-relevant channel.
