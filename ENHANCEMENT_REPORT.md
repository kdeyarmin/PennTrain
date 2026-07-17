# CareMetric CareBase — Feature & Functionality Enhancement Report

**Date:** 2026-07-17 · **Reviewed at:** `main` @ `113748e` · **Scope:** full workspace
(frontend `artifacts/caremetric-carebase`, Supabase migrations/functions, CI, docs)

---

## 1. Executive summary

CareMetric CareBase is in an unusual position for a review: it is **not short on
features**. All 29 approved improvements from `IMPLEMENTATION_PLAN.md` are
code-complete in this tree, the frontend has ~140 route pages with no stubs, no
TODO/FIXME debt, and no mock data, and the backend has 50 Edge Functions, ~350
tables, and 56 pgTAP suites. Much of the older written backlog
(`END_USER_REVIEW.md`, `EFFICIENCY_REVIEW.md`) has *already been implemented*
since those documents were written — this report verified each claim against
current code before repeating it (see §2).

The highest-value enhancements are therefore not new features. They are:

1. **Ship what is already built.** The single biggest value gap is that
   finished capability sits behind default-off release flags and un-run pilot
   gates (e.g. critical multi-channel notifications). That is a program
   problem, not a code problem — but it dwarfs everything else in this report.
2. **Remove the client-side scaling ceiling.** Every major list page downloads
   its entire table and paginates/searches in the browser, while a
   purpose-built server-side pagination hook sits in the tree **unused**. The
   Reports engine computes 23 reports in-browser from unbounded queries.
3. **Make the UI feel live.** There are zero Supabase Realtime subscriptions
   and zero optimistic updates in the entire frontend; time-sensitive surfaces
   (alerts, the notification bell) are timer-polled and lag every user action
   by a full round trip.
4. **Finish or prune the Phase 4 learning scaffolding.** The LTI 1.3 and
   adaptive-learning-path tables have no writers and no UI — they are inert
   schema increasing RLS/advisor surface.
5. **Close operational gaps** that pilots will hit: an undeclared Edge
   Function in `config.toml`, unenforced notification spend caps, no
   per-cron-worker "last successful run" watchdog, and no runtime tests for
   the 50 Edge Functions in CI.
6. **Add the missing test layer.** Frontend logic is well-tested (52 suites)
   but there are **zero component render tests** and a single E2E spec —
   pages, forms, and list behavior have no automated coverage.

Section 4 lists 18 concrete recommendations (E1–E18) with priority, effort,
and file-level evidence. Section 5 restates what this report deliberately does
**not** propose, honoring the product's documented "hard no" decisions.
Section 7 adds a second tier (E19–E29): new product capability built on
primitives the codebase already has.

---

## 2. Currency audit — what the existing review docs get wrong today

This review started from the prior docs and verified their open items against
the current tree. Many are now **stale** — implemented after those docs were
written (largely by the `PRODUCT_VALUE_OPERATING_SYSTEM.md` wave, migrations
dated 2026-07-12 through 2026-07-16). Anyone planning from those docs today
would re-build existing functionality:

| Claim still listed as open | Actual current state |
| --- | --- |
| Video blocks are a bare `<video>` with no watch gate (END_USER_REVIEW) | **Fixed.** `components/CourseVideoPlayer.tsx` implements resume, a no-skip high-water mark with seek clamping, and completion tracking. |
| Employees can't self-manage contact info / SMS consent | **Fixed.** `pages/auth/NotificationSettings.tsx` provides phone, SMS opt-in, and preferred-channel self-service with consent validation. |
| One channel per user even for critical alerts | **Built, default-off.** `20260712190000_critical_multichannel_delivery.sql` fans critical types out to email+SMS behind the `notifications.critical_multichannel` release flag. Needs GA promotion, not code. |
| No on-hire exclusion screening; no due-soon reminders for never-started assignments | **Fixed.** `20260712120000_assignment_due_reminders_and_on_hire_screening.sql`. |
| Learner notes/confidence trapped in localStorage | **Fixed.** `pages/employee/TakeCourse.tsx` syncs to the server; localStorage is only a fallback. |
| Compliance binder is fully synchronous | **Fixed.** `generate-compliance-binder` now runs as an async cron worker. |
| GlobalSearch covers 1 of 6 roles, client-side, 3 tables | **Fixed.** `hooks/useGlobalSearch.ts` calls a server-side `search_workspace` RPC returning items/orgs/profiles/employees/residents/courses. |
| Course "new version" starts empty (no clone) | **Fixed.** `useCloneCourseVersion` is wired into `pages/app/CourseDetail.tsx`. |
| Filters never persisted to URL | **Partially fixed.** Employees, Users, Maintenance, Violations, InspectionItemDetail use URL params; most other list pages still don't. |
| Phase 5 backends (work items, confidential review console, move-in workspace, evidence room, value center) have no UI | **Mostly fixed.** `WorkQueue`, `ConfidentialIncidents(+Detail)`, `AdmissionOperations`/`MoveInWorkspaceDetail`, `EvidenceRoom(+Detail)`, `ValueCenter` pages all exist. The remaining true no-UI items are LTI/xAPI runtime and adaptive paths (see E10). |

**Recommendation E18 (doc hygiene)** covers marking these documents as
superseded so they stop functioning as a false backlog.

---

## 3. Where the product stands

- **Frontend:** React 19 + Vite + wouter + TanStack Query over raw
  `supabase-js`; ~380 source files, ~140 lazy-loaded routes across five role
  domains (`/admin`, `/app`, `/trainer`, `/me`, public/guest), centralized
  role- and facility-type-gated routing in `src/App.tsx`. Accessibility and
  responsive practice are generally strong.
- **Backend:** 50 Edge Functions (identity, billing, notifications with real
  SendGrid/Twilio/web-push delivery and signed provider webhooks, integrations
  with HMAC webhooks and rate-limited tenant API, compliance AI, PDF
  generation, screening, data lifecycle/export), ~25 `pg_cron` jobs, 317
  migrations, RLS everywhere, 56 pgTAP suites in CI.
- **Program state:** All 29 plan items code-complete; none GA-promoted — each
  owes a clean CI run, a 14–30-day pilot, and a phase exit gate. Several
  capabilities (critical multi-channel, others) are additionally behind
  default-off release flags.

The product's wedge — owning both staff-compliance operations *and* embedded
training for Pennsylvania personal care homes and Assisted Living Facilities
(ALFs) — is intact and well-defended in code. Nothing below proposes widening
that scope.

---

## 4. Recommendations

Priorities: **P1** = do first (high value, unblocks or de-risks pilots);
**P2** = next quarter; **P3** = opportunistic. Effort: S (≤1 day),
M (days), L (week+).

### Theme A — Ship the value that's already built

**E1 · P1 · effort: program, not code — Run the GA-promotion pipeline.**
The pilot/exit-gate machinery exists (`CONTROLLED_PILOT_RUNBOOK.md`,
`pilot/controlled-pilot.template.json`, `check:pilot`), but no phase has been
promoted. Every other recommendation is worth less than turning on what's
finished — starting with `notifications.critical_multichannel`
(`20260712190000_critical_multichannel_delivery.sql`), which directly serves
the product's stated core reach problem (deskless aides). Suggested order:
Phase 1 (platform trust) → the notification flags → Phase 5 evidence surfaces.

### Theme B — Remove the client-side scaling ceiling

**E2 · P1 · M — Adopt the existing server-side pagination hook on the big
list pages.** `hooks/usePaginatedDomainLists.ts` implements `.range()`, exact
counts, and server-side `ilike` search for the major domains — and is
**imported nowhere**. Meanwhile Alerts (`hooks/useAlerts.ts:19`,
`pages/app/Alerts.tsx:20,192`), Incidents (`pages/app/Incidents.tsx:24,178`),
and Residents (`pages/app/Residents.tsx:21,137`) fetch entire tables and
slice/filter in the browser, so search silently misses anything not yet
downloaded and every mount re-downloads the world. Wiring the hook in fixes
correctness (search), latency, and egress in one move. Roll out one page at a
time; Alerts first (it is also the most time-sensitive surface).

**E3 · P1 · M — Stop the satellite full-table lookups.** The Alerts page
fires four extra unbounded queries on mount just to resolve deep-link targets
(all incident notifications, corrective actions, inspection events, resident
compliance items — `pages/app/Alerts.tsx:70-76`); Incidents and Residents do
the same for joins. Replace with a single RPC that returns alerts with their
link targets pre-joined, or lazy per-row lookups.

**E4 · P2 · L — Move report computation server-side.**
`pages/app/Reports.tsx:1249-1256` pulls whole tables and computes all 23
reports in-browser; `ctx.organizations` is hardcoded to `[]` (line 429), and
the shared date-range filter maps to different fields per report. The backend
already has `report_snapshots`, `saved_report_definitions`, and a scheduled
reporting worker — build the report engine as SQL/RPCs on that foundation and
make the UI a renderer. This also makes reports auditable ("as-of" snapshots)
— a survey-readiness selling point, not just a performance fix.

### Theme C — Make the UI feel live

**E5 · P1 · M — Add Supabase Realtime to the alert and notification
surfaces.** There are zero realtime channels in the app (grep confirms only
auth + web-push usage). Alerts poll on window focus (`useAlerts.ts:31-32`);
the notification bell polls every 60s (`useNotifications.ts:41`), so a badge
can be a minute stale and another user's resolution never appears until
refocus. Subscribe to `postgres_changes` on `notifications` and `alerts`
scoped to the signed-in profile/org, falling back to the existing polling.
Time-sensitive compliance alerting is the product's heart — it should not run
on a timer.

**E6 · P2 · M — Introduce optimistic updates for high-frequency mutations.**
`onMutate` appears in zero files; every action (resolve alert, mark
notification read — `useAlerts.ts:44`, `useNotifications.ts:56`,
`Header.tsx:146`) waits a full server round trip then refetches. Add
optimistic cache updates with rollback for the handful of hot mutations:
notification mark-read/mark-all, alert resolve/acknowledge, checklist item
toggles. Small library-level change to the shared mutation helpers; large
perceived-speed win.

**E7 · P1 · S — Give "Today" a facility picker.** `pages/app/Today.tsx:21`
hardcodes `facilities.data?.[0]?.id`, so a facility manager covering multiple
buildings can only ever see their first facility's command center. Add the
same facility selector used elsewhere and persist the choice.

### Theme D — Finish or prune the Phase 4 learning scaffolding

**E8 · P2 · decision + M/L — LTI 1.3: ship the launch endpoint or drop the
tables.** `lti_tool_registrations` and `lti_launch_receipts`
(`20260712023823_phase4_standards_adaptive_offline.sql`) have schema + RLS but
**no writer and no consumer anywhere** — the LTI launch flow was never
implemented. Either build the Edge Function endpoint and a registration UI, or
remove the tables to shrink the RLS/advisor surface. Same decision for
`learning_packages` / `learning_path_definitions`, which are read by
`get_governed_learning_control_plane` but never written: SCORM/xAPI package
import and adaptive-path authoring (plan items #28/#15) are effectively
backend scaffolding with no product surface. If customer demand isn't proven,
pruning is the honest move; carrying inert compliance-adjacent schema has real
audit cost.

### Theme E — Operational hardening before pilots

**E9 · P1 · S — Declare `generate-incident-state-form-pdf` in
`supabase/config.toml`.** Every other function is explicitly declared; this
one silently relies on the `verify_jwt=true` default while its sibling
`generate-incident-report-pdf` is declared. Safe today, but it is exactly the
kind of drift the `check:edge-functions` gate exists to catch — add the block
and extend `scripts/check-edge-functions.mjs` to fail on undeclared functions.

**E10 · P1 · M — Enforce (or explicitly wire) notification spend caps.**
`notification_spend_policies` and `notification_spend_alerts` exist in schema
(`20260712190000_critical_multichannel_delivery.sql` era) but no writer or
enforcement path was found — meaning Twilio/SendGrid spend is unbounded at
exactly the moment multi-channel fan-out (E1) turns on. Wire the policy check
into `dispatch-notifications` before promoting that flag, and surface spend
in `/admin/notification-deliveries`.

**E11 · P2 · M — Add a cron-worker watchdog.** ~25 `pg_cron` jobs invoke
Edge Functions via fire-and-forget `net.http_post`
(`20260709113000_harden_cron_edge_function_invocation.sql`). A synthetic
heartbeat exists, but if the HTTP call for `dispatch-notifications`,
`screen-exclusions`, or `dispatch-integration-webhooks` never lands, nothing
alerts. Record a "last successful run" per registered job and render
staleness prominently in `pages/admin/SystemJobs.tsx`, with an alert when a
worker misses its expected cadence. For a compliance product, "the reminder
cron silently died" is the nightmare scenario — make it impossible to miss.

**E12 · P2 · L — Test Edge Functions end-to-end in CI.** CI runs pgTAP, db
lint/advisors, type-drift, and Playwright — but the 50 Edge Functions only get
`deno check` plus unit tests on `_shared`. Webhook signature verification,
cron-secret gating, and auth matrices in handlers are unverified end-to-end.
Add a CI stage that serves selected functions locally (`supabase functions
serve`) and exercises the security-critical paths (Stripe/Twilio/SendGrid
signature rejection, unauthorized-role rejection, cron-secret enforcement).

### Theme F — Quality and consistency

**E13 · P2 · L — Add component and E2E coverage for the money paths.** 52
frontend test suites exist but all are `lib/`/`hooks/` logic — **zero
`*.test.tsx`**, and one Playwright spec (role routing). Start with render +
interaction tests for: TakeCourse/TakeQuiz (compliance integrity), Alerts
resolve flow, employee CSV import, and the incident intake forms; grow the
Playwright journeys to cover one full happy path per role. This is the safety
net every other recommendation (E2, E5, E6) needs to land safely.

**E14 · P2 · M — Finish `QueryError` adoption.** The shared error/empty
state component (`components/QueryState.tsx`) is used in only ~47 of ~130 app
pages; elsewhere a failed query renders as a silent empty list — a compliance
operator can't distinguish "no expiring credentials 🎉" from "the query
failed." A codemod-style sweep plus a lint rule (e.g. forbid `useQuery`
destructuring without `error` handling in `pages/`) closes it durably.

**E15 · P3 · M — Extract the shared Combobox.** `Header.tsx:32-38` itself
documents that the org picker, GlobalSearch, and the Sidebar "Find a page"
each hand-roll the same input-plus-results pattern. Extract one accessible
Combobox primitive (or adopt shadcn's `Command`) and delete three
implementations. While in there: delete the never-imported
`hooks/use-mobile.tsx` or start using it.

### Theme G — Small, high-leverage UX wins

**E16 · P3 · M — URL-persist filters on the remaining list pages.**
Employees/Users/Maintenance/Violations already do this; Alerts, Incidents,
Residents, TrainingMatrix, and CourseAssignments don't — so shared links and
browser-back lose state. Do it as part of the E2 page-by-page migration since
the same pages are being touched.

### Theme H — Repository and documentation hygiene

**E17 · P3 · S — Remove the dead legacy artifacts.** `artifacts/pa-medtrack`
(pre-rename app remnant) and `artifacts/caremetric-train` (a lone `public/`
dir) are still workspace packages matched by `pnpm-workspace.yaml`'s
`artifacts/*` glob. Delete or archive them; they confuse tooling, onboarding,
and `pnpm -r` runs.

**E18 · P2 · S — Mark superseded review docs.** Add a status banner to
`END_USER_REVIEW.md` and `EFFICIENCY_REVIEW.md` (as ROADMAP.md already has)
noting which findings are implemented, citing §2 of this report — otherwise
they will keep functioning as a false backlog and burn future planning cycles
(this review spent real effort re-verifying them).

---

## 5. Deliberately not recommended

Honoring decisions already documented in `ROADMAP.md` / `IMPLEMENTATION_PLAN.md`:

- **eMAR / resident clinical records** — hard no; stay on the staff-compliance
  side of the line.
- **Family/resident engagement portal, activity calendars** — hard no; bloat
  for 5–50-bed operators.
- **In-house NAB-accredited content** — partner/resell instead.
- **Multilingual experience (#29)** — explicitly excluded from the program by
  request; not re-proposed here (though it remains the most competitively
  validated deferred item if that decision is ever revisited).
- **Multi-state rule packs** — defer until the PA pack is GA-proven; the rule
  engine already keys by state so packs stay additive data.
- **Open-ended policy Q&A chat** — the grounded, citation-backed
  `compliance-copilot` is the right shape; don't loosen it.

---

## 6. Suggested sequencing

| Horizon | Items | Rationale |
| --- | --- | --- |
| **Now (this sprint)** | E9 (config.toml, 1 line), E7 (Today picker), E17 (dead artifacts), E18 (doc banners) | Trivial-effort, removes drift and false backlog. |
| **Next 30 days** | E1 kickoff (Phase 1 pilot → notification flags), E10 (spend caps before fan-out), E2 (Alerts → Incidents → Residents pagination), E5 (realtime on alerts/bell) | The value-shipping path plus the two changes that protect it (spend caps, live alerts). |
| **Next quarter** | E3, E6, E11, E12, E13, E14, E4 | Server-side aggregation, optimistic UX, cron watchdog, function CI, test layer. |
| **Decision needed** | E8 (LTI/adaptive: ship or prune) | Product call; either outcome is better than inert schema. |
| **Opportunistic** | E15, E16 | Fold into pages already being touched by E2. |
| **Second tier (product decisions)** | E19–E29 (§7) | Sequence after the P1 hardening items; E19 (survey-day mode) and E22 (paper-record backfill) are the strongest value/effort candidates. |

---

## 7. Next list — second-tier product and feature opportunities (E19–E29)

Where E1–E18 harden what exists, this tier proposes **new product capability**.
Every item is grounded in a primitive the codebase already has, and none
crosses the documented hard-no boundaries (no eMAR, no family portal, no
in-house accredited content, no multilingual). Each was checked against the
current tree so it does not duplicate an existing feature — e.g. workforce
turnover analytics was considered and dropped because
`get_workforce_retention_metrics` already powers a Reports panel.

**E19 · P1 · M — "Survey day" mode.** One tap when the licensing
representative walks in: a single screen pinning the entrance-conference
checklist, the latest compliance binder, the staff roster with live
compliance flags, and evidence-room quick links — with the activation itself
audit-logged. Every ingredient exists (`entrance_conference_items`, the
binder worker, evidence collections, `InspectionReadiness.tsx`); this
composes them into the moment the product's whole pitch ("inspection-ready
every day") is about. Likely the highest demo-value item on this list.

**E20 · P2 · M — AI plan-of-correction drafter.** `generate-poc-document`
renders POCs from manually written text today, while violations and
corrective actions are already structured data. Draft the POC narrative from
the citation + evidence using the proven grounded-AI pattern
(`compliance-copilot`'s citation grounding plus the course wizard's
DB-enforced mandatory human review). POC writing is one of the most stressful
tasks an administrator faces post-inspection.

**E21 · P2 · S/M — AI incident-narrative assist.**
`generate-incident-state-form-pdf` already prefills the DHS reportable-incident
form's structured fields; add a grounded draft of the narrative section from
the incident record, reviewed and edited before filing. Same guardrail
pattern as E20.

**E22 · P2 · M — Historical paper-record backfill via the Document
Analyzer.** The biggest switching cost for a new customer is years of paper
training logs and certificates. The pipeline for "scan → AI extraction →
human confirmation" already exists twice (`analyze-state-form`, credential
OCR intake) — point it at legacy training documents to produce draft
`employee_training_records` for bulk confirmation. Directly monetizable as
an onboarding accelerator.

**E23 · P3 · S — Training-history CSV import.** `bulk-import-employees`
imports people but not their training history; the HRIS pipeline has
dry-run/merge machinery to reuse. Add mapped import templates (including
common competitor-export shapes) for training records.

**E24 · P2 · S — ICS calendar feeds.** No `text/calendar` surface exists
anywhere. Tokenized, revocable ICS feeds for an employee's published shifts
(`/me/schedule`), a trainer's classes, and a manager's upcoming
expirations/classes put CareBase into the phone calendar deskless staff
already live in — cheap reach that complements the notification rail.

**E25 · P2 · S/M — Close the retraining → class loop.** The Retraining
Monitor identifies expiring staff; instructor-led classes have
capacity/waitlist (plan #19). Connect them: "enroll everyone expiring within
60 days into this class" as one action, and suggest creating a class when
expiring-staff demand exceeds scheduled capacity.

**E26 · P2 · M — Regulatory change → tenant impact routing.**
`poll-regulatory-updates` already fetches and diffs official regulation pages
into change proposals — the hard half of the "regulatory update feed"
ROADMAP once deferred. Finish the last mile: when a proposal is approved,
identify which tenant policies, courses, and crosswalk entries cite the
changed section and open work items (the plan-#7 engine) for their review.

**E27 · P2 · M — Organization setup checklist.** After self-service signup a
new org lands in an empty app; no org-level guided setup flow was found (the
onboarding fast-track covers new *hires*, not new *organizations*). A
work-item-template-driven checklist — create facility → choose compliance
profile → import employees → assign training — would compress
time-to-first-value, the metric the Value Center exists to prove.

**E28 · P3 · discovery — Shared-device learner access for aides without
email.** QR check-in already handles instructor-led classes, but self-paced
courses require an email-based account — a real adoption barrier for
deskless aides. Explore a facility kiosk mode with per-employee PIN/QR
course access on shared devices, preserving the server-side
compliance-integrity guarantees (quiz grading, session locking — note the
existing idle-session-lock machinery). Discovery first: the auth design is
the hard part, not the UI.

**E29 · P3 · S — Wallet passes for certificates.** Training passports
already have public verification slugs; issuing Apple/Google Wallet passes
for current certificates (with expiry) gives staff a portable credential and
the product free visibility every time one is shown.

---

## 8. Evidence index

Key files cited in this report:

- `artifacts/caremetric-carebase/src/hooks/usePaginatedDomainLists.ts` — unused server-side pagination hook (E2)
- `artifacts/caremetric-carebase/src/hooks/useAlerts.ts`, `src/pages/app/Alerts.tsx` — unbounded fetch, client slice, satellite lookups (E2/E3/E5)
- `artifacts/caremetric-carebase/src/pages/app/Reports.tsx` — in-browser report engine (E4)
- `artifacts/caremetric-carebase/src/hooks/useNotifications.ts`, `src/components/layout/Header.tsx` — 60s badge poll, no optimistic mark-read (E5/E6)
- `artifacts/caremetric-carebase/src/pages/app/Today.tsx:21` — hardcoded first facility (E7)
- `supabase/migrations/20260712023823_phase4_standards_adaptive_offline.sql` — inert LTI/adaptive tables (E8)
- `supabase/config.toml` — missing `generate-incident-state-form-pdf` declaration (E9)
- `supabase/migrations/20260712190000_critical_multichannel_delivery.sql` — critical multi-channel flag + spend-policy tables (E1/E10)
- `supabase/migrations/20260709113000_harden_cron_edge_function_invocation.sql` — fire-and-forget cron invocation (E11)
- `.github/workflows/ci.yml`, `scripts/check-edge-functions.mjs` — no function runtime tests (E12)
- `artifacts/caremetric-carebase/src/components/QueryState.tsx` — partial error-state adoption (E14)
- `artifacts/pa-medtrack/`, `artifacts/caremetric-train/` — dead workspace packages (E17)
