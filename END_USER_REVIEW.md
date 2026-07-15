# CareMetric CareBase — End-User Experience Review

*July 2026. A whole-codebase review asking one question: what would most improve this app for the
people who use it — org admins, facility managers, trainers, employees taking training, and
auditors? Produced from three parallel deep reads (the React frontend, the Supabase backend and
notification rails, and the prior review documents), with every load-bearing claim re-verified
against the current code before inclusion. Companion PR: the "quick wins" in Part 1 are
implemented alongside this document; Parts 2–3 are the recommended follow-on work.*

---

## How this review relates to the three prior reviews

This repository has already been reviewed three times; this document deliberately covers **new
ground** and does not restate their findings.

| Prior review | Status | What this means here |
|---|---|---|
| `ROADMAP.md` (feature/correctness/security review) | Entire Tier 1–3 backlog **shipped** | Historical record only. |
| `IMPLEMENTATION_PLAN.md` (29 approved improvements, Phases 1–5) | **All code-complete** in this tree (migrations dated 2026-07-11/12); pending GA exit gates (CI + pilots) | Nothing below recommends re-building any of the 29. Several findings instead recommend **exposing** Phase 4/5 backends that have no UI yet. |
| `EFFICIENCY_REVIEW.md` (~40 usability findings, Pass 1–3 backlog) | **Partially implemented** since it was written — e.g. React Query now has default `staleTime`/`refetchOnWindowFocus` policy (`src/lib/queryClient.ts`), and `Employees.tsx` uses real server pagination (`useListEmployeesPaginated`) | Its remaining backlog (server pagination on other high-row tables, bulk actions, broader GlobalSearch, shared DataTable, course-version cloning, etc.) is still the right list; it is referenced, not restated. |

All paths below are relative to `artifacts/caremetric-carebase/src/` unless they start with
`supabase/`.

---

## Part 1 — Fixed in the companion PR (quick wins)

Small, verified, low-risk fixes shipped with this review:

1. **Fetch failures no longer masquerade as empty states on the employee surface.**
   Hooks throw on error, but `isError` was handled in only 3 of ~90 pages — a failed load rendered
   as "No courses assigned yet" / "No credentials on file yet" with no hint anything went wrong and
   no retry. A new shared `components/QueryState.tsx` (`QueryError`: destructive Alert +
   "Try again" refetch button, announced to screen readers via `role="alert"`) is now used by
   `MyCourses`, `MyTrainings`, `MyCertificates`, `MyCredentials`, `MySchedule`, `MyAttestations`,
   the `EmployeeDashboard` deadline/records cards, and the org `Employees` table.
2. **A broken page no longer blanks the whole app.** The single root `ErrorBoundary` offered only
   a full reload. It now supports a `"page"` variant with in-place "Try again" and
   reset-on-navigation, and `MainLayout` wraps routed content in a `RouteErrorBoundary`
   (`components/ErrorBoundary.tsx`, `components/layout/MainLayout.tsx`) — sidebar and header stay
   alive, and navigating away clears the error.
3. **Toasts stopped eating each other.** `hooks/use-toast.ts` had `TOAST_LIMIT = 1` (a second
   error silently replaced the first — bad during bulk operations) and a ~16-minute removal delay
   that kept dismissed toasts in memory. Now 3 stacked toasts, 5-second removal.
4. **Due dates carry urgency.** `lib/dateUtils.ts` gains `daysUntil()` and `formatDueDistance()`
   (unit-tested; local-calendar-day math so "due today" flips at local midnight). `MyCourses` rows
   now read "Due Jul 15, 2026 · in 3 days" with amber ≤7 days and red when overdue, muted for
   completed courses.
5. **Timezone-safe dates on regulated records.** `MyCredentials` printed the raw ISO date and
   `MyCertificates` used `toLocaleDateString()` on date-only values (off-by-one across time
   zones); both now use the existing `formatDateForDisplay`.
6. **Two double-fetches removed.** `MyCredentials` and `EmployeeDashboard`'s course-assignments
   query were missing the `{ enabled: !!employee?.id }` gate their own hooks document as required;
   both fired once unscoped and again once the employee row resolved, on every load.
7. **Certificate PDFs flip to "Download" on their own.** Certificate PDFs render on a background
   job queue, but `MyCertificates` required a manual re-click to notice. The list now polls every
   15 s only while a PDF is `pending`/`processing`, and a successful on-demand generation
   invalidates the list (`hooks/useCertificates.ts`).

Verified: `tsc --noEmit` clean, all 93 unit tests pass (including 6 new date tests), the exact
Railway build path (`vite build` + precompress) succeeds, and the production server serves
`/health`, `/`, and SPA routes.

---

## Part 2 — Verified findings, not yet implemented

### A. Deskless-staff notifications — the highest-impact gap in the product

The delivery rail (outbox, SendGrid email, Twilio SMS, retries, quiet hours, consent, STOP
handling, delivery evidence) is genuinely strong. What's missing is **reach**:

**A1. Only 6 of 22+ notification types ever leave the in-app feed.** The fan-out trigger
`queue_notification_delivery()`
(`supabase/migrations/20260711164439_notification_operations_completion.sql:756-760`) enqueues
email/SMS for exactly: `training_due_soon`, `training_expired`, `policy_attestation_due_soon`,
`course_continuation_reminder`, `resident_compliance_due`, `support_ticket_update`. Everything
else is in-app only — including `credential_expiring`, `certificate_expiring`,
`practicum_due_soon`/`practicum_expired`, `course_assigned`, `policy_attestation_assigned`, and
`incident_reported`. For a product whose thesis is reaching aides who rarely sit at a computer, an
expiring clearance or a newly assigned course that never pushes to a phone is a core-value miss.
*Fix shape:* extend the trigger allowlist + templates for the expiry/assignment types; follows the
expand/dual-compat playbook with a default-off kill switch.

**A2. Employees cannot manage their own contact info or SMS consent.** The RPC
`update_profile_contact_preferences` (same migration, lines 438-521) permits self-edit, but the
only caller is the admin `pages/app/Users.tsx`. TCPA SMS consent therefore depends on an admin
typing in each aide's phone number and opt-in — the bottleneck that throttles the entire SMS
investment. There is no "My notification settings" page under `pages/employee/`.
*Fix shape:* an employee settings page (phone, preferred channel, SMS consent checkbox) calling
the existing RPC; the backend needs nothing new.

**A3. One channel per user, even for critical alerts.** `enqueue_preferred_notification_delivery`
picks a single `preferred_notification_channel` (lines 736-745); email+SMS together isn't possible
for anything.

**A4. Reminder gaps.** (a) A never-started assignment with an approaching `due_date` gets no push —
`course-continuation-reminders-daily` only covers courses already begun. (b) Exclusion screening
runs monthly (12th, 05:00 — `supabase/migrations/20260711162509_phase1_operational_recovery.sql:1389-1408`),
so a mid-month hire can work up to a month unscreened; there is no on-hire screening trigger.

### B. Employee learning experience

The course player (`pages/employee/TakeCourse.tsx`) is the strongest part of the app — resume, a
course map with locked/visited states, quiz gating, checkpointing on `visibilitychange`, keyboard
shortcuts, notes, a review queue. Remaining gaps:

**B1. Learner notes and confidence ratings are trapped on one device.** They live in
`localStorage` only (`TakeCourse.tsx:175-213`; the UI even says "Notes stay on this device").
Switch phones and they're gone; trainers can't see where learners struggle. `lib/offlineLearning.ts`
already exists as scaffolding for syncing.

**B2. Video blocks are a bare `<video>` tag** (`TakeCourse.tsx:705-713`). A learner can click
"Next" past a 20-minute mandated-training video instantly — nothing records watch time — and
closing mid-video loses the playback position (only the block index is saved). For compliance
training, a minimum-watch gate plus in-video resume is an integrity feature, not a nicety.

**B3. Attestation review leaves the page.** The "read before you sign" dialog links the policy PDF
out to a new tab (`pages/employee/MyAttestations.tsx`) rather than embedding it — weaker
signature UX and easy to skip.

**B4. Employees have no search.** `GlobalSearch` is hidden for the employee role
(`components/layout/Header.tsx`, `hooks/useGlobalSearch.ts` returns nothing for employees).

### C. Long-running operations give no feedback

**C1. The compliance binder is fully synchronous.**
`supabase/functions/generate-compliance-binder/index.ts` (783 lines) queries the entire org and
builds the PDF in-request, returning a signed URL at the end — no progress, edge-timeout risk on
large orgs, and it silently truncates any section at `MAX_LISTED_ROWS = 200` (line 20). The async
pattern to copy already exists next door: `certificate_pdf_jobs` + a 5-minute cron.

**C2. Bulk employee import is a synchronous per-row loop** — up to 1,000 rows, one insert
round-trip each, nothing returned until the very end
(`supabase/functions/bulk-import-employees/index.ts:87,112-171`). A timeout mid-way leaves the
admin with no per-row results.

### D. Shipped backend with no UI — the biggest untapped value

Phase 4/5 table families exist with RLS and generated types but **no hook and no page** (they
appear only in `lib/database.types.ts`). In rough order of end-user value:

1. **Confidential-incident review console.** The public anonymous intake is live
   (`pages/public/SafetyReport.tsx` → `submit-confidential-intake`), but there is no
   admin/investigator UI over `confidential_incident_intakes`/`details`/`access_events` — reports
   currently land somewhere no one can see. (Migration `20260712035922`.)
2. **Saved & scheduled reports + historical trends** (`saved_report_definitions`,
   `report_schedules`, `report_snapshots`, `historical_metric_snapshots` — `20260712035925`).
   Point-in-time-only reporting is the classic incumbent complaint the roadmap called out.
3. **Auditor evidence room** (`evidence_collections`, `evidence_guest_grants` — same migration):
   immutable snapshot collections with revocable guest access for surveyors.
4. **Work items and move-in workspaces** (`work_items` + templates/dependencies/evidence,
   `move_in_workspaces` + tasks/guest grants — `20260712035922`).
5. **SCORM/xAPI/LTI runtime, adaptive learning paths, offline mode** (`20260712023821/23`).

Each of these is "build the frontend for a finished backend" — high leverage, no schema work.

### E. Scale

**E1. Dashboards download entire org tables to compute stats.** The org `pages/app/Dashboard.tsx`
pulls full unbounded employee/training-record/practicum/document/alert lists client-side;
`pages/trainer/TrainerDashboard.tsx` does the same. Contrast with the paginated pattern already
proven in `Employees.tsx`. Needs a server-side summary RPC or view. (Complements — does not
duplicate — `EFFICIENCY_REVIEW.md` Part 1 item 1, which covers list pages.)

**E2. Error-state adoption beyond the employee surface.** Part 1 established the `QueryError`
pattern on the employee pages and `Employees.tsx`; the remaining ~80 pages still render failures
as empty states. Mechanical adoption, a few pages at a time, using the same component.

---

## Part 3 — Prioritized recommendations

| # | Recommendation | Finding | Impact | Effort |
|---|---|---|---|---|
| 1 | Extend email/SMS fan-out to credential/certificate/practicum expiry, `course_assigned`, `policy_attestation_assigned`, `incident_reported` | A1 | Very high | S–M |
| 2 | Employee "My notification settings" page (phone, channel, SMS consent) | A2 | Very high | M |
| 3 | Confidential-incident review console (intake is live; review is not) | D1 | High | M |
| 4 | Assignment-due-soon push for never-started courses; on-hire exclusion screening | A4 | High | S–M |
| 5 | Video minimum-watch gate + in-video resume | B2 | High (compliance integrity) | M |
| 6 | Server-side learner notes/confidence (sync `localStorage` up) | B1 | Med–High | M |
| 7 | Async compliance binder on the `certificate_pdf_jobs` pattern; async bulk import with per-row progress | C1, C2 | Med–High | M |
| 8 | Dashboard summary RPC to replace client-side fetch-all | E1 | Med–High | M |
| 9 | Saved/scheduled reports UI, then evidence room UI | D2, D3 | High | M–L each |
| 10 | Multi-channel (email+SMS) for critical alerts | A3 | Med | S |
| 11 | Inline attestation PDF preview; employee search; `QueryError` adoption across org/admin pages | B3, B4, E2 | Med | S each |
| 12 | Work items / move-in workspaces UI; SCORM/LTI/offline exposure | D4, D5 | Med–High | L |
| — | Plus: the remaining `EFFICIENCY_REVIEW.md` Pass 1–3 backlog (bulk actions, broader GlobalSearch, shared DataTable, course-version cloning…) | — | High | S–L |

## Constraints for implementers

Per `ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md`, all of the above must stay inside the existing
shape: Supabase modular monolith (no new API server), RLS-enforced RBAC with server-stamped tenant
scoping, compliance-determining writes only via `SECURITY DEFINER` RPCs or Edge Functions,
schema changes via the expand → backfill → switch → contract playbook behind default-off kill
switches, and customer-facing copy says "Assisted Living Facility (ALF)" (see `CLAUDE.md`).
