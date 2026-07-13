# CareMetric CareBase — Efficiency & Usability Review

*July 2026. A follow-up to `ROADMAP.md`'s full-codebase review — that review covered feature completeness,
correctness, and security, and its entire Tier 1–3 backlog has since shipped. This review assumes every feature
works as designed and asks a narrower question: for the person actually doing this job today, is each workflow
fast, clear, and low-friction? Produced by reading every page component, every domain hook, and the shared
layout/UI layer in full (not just grep matches), organized by functional area. The highest-stakes claims were
independently re-verified against the current code before inclusion, not taken on faith from a single pass.*

---

## Part 1 — Fix once, felt everywhere

These seven issues each showed up independently across most of the eight functional areas reviewed. None of them
require redesigning anything — they're gaps in shared plumbing that individual pages then had to work around (or
didn't), which is exactly the kind of thing worth fixing centrally instead of page by page.

### 1. List pages download the whole table, then paginate/sort in the browser

Confirmed directly: only 7 of the app's 66 data hooks use `.range()`/`.limit()`; the rest — `useEmployees.ts:19`,
`useTrainingRecords.ts:20`, `useAlerts.ts:19`, `useIncidents.ts:25`, `useViolations.ts:18`,
`useInspectionItems.ts:20`, `useResidents.ts:18`, `useOrganizations.ts:9-18`, `useProfiles.ts:13-25`,
`useSupportTickets.ts:29-41`, and `useCourseAssignments.ts` (whose own comment admits assignments "can run into
the thousands for a mid-size org") — `select("*")` with no bound. `Employees.tsx:75-139` is representative of the
workaround this forces: it hand-rolls `sortField`/`page`/`PAGE_SIZE`/`.slice()` over an array that's already been
fully downloaded, and it's one of only a handful of pages that bother to paginate at all. `Reports.tsx` and
`AuditLog.tsx` (Part 2) render everything with no slicing whatsoever.

**Fix:** move the largest tables (employees, training records, incidents, course_assignments, audit_logs,
organizations/profiles) to `.range()`-based server pagination; build one shared paginated/sortable table
primitive so new pages stop reinventing it.
**Impact: High** (gets worse every year the org's data grows) **× Effort: M–L**

### 2. No default cache policy — every revisit re-fetches everything

`lib/queryClient.ts` is one line: `new QueryClient()`, no `defaultOptions`. Only 2 of 66 hook files set a
`staleTime`. React Query's factory defaults apply everywhere: `staleTime: 0`, refetch on every mount and every
window focus. Tabbing Dashboard → Employees → Training Matrix → back to Employees, or just alt-tabbing to check
email, re-hits Supabase and re-shows a loading skeleton on every single revisit — nothing is ever treated as
still-fresh.

**Fix:** set a sane default (e.g. `staleTime: 60_000`, scope down `refetchOnWindowFocus`) once in
`queryClient.ts`; keep short/zero staleTime only where freshness genuinely matters (Alerts, NotificationDeliveries).
**Impact: High × Effort: S** (one file)

### 3. Bulk actions are almost universally missing wherever a task realistically touches many records

Independently flagged in six of the eight areas reviewed — training records, course assignments, inspection
items, shift/pattern assignment, class attendance, document upload, and notification retries all force
one-record-at-a-time workflows:

- Recording one training event against a cohort has no batch path (`TrainingMatrix.tsx:145-297`); a 15-person
  group in-service means 15 separate dialogs. `Alerts.tsx:270-289` offers bulk *Dismiss* but not bulk *Resolve*,
  even though `useBulkUpdateAlerts` is already status-agnostic.
- Course assignment takes one employee per submission (`CourseAssignments.tsx:208-242`) — assigning to 40 people
  is 40 dialogs.
- `InspectionItems.tsx` has no bulk "log inspection" — clearing 10 pieces of equipment after a walkthrough is 10
  dialogs.
- `ScheduleDetail.tsx:98-136` / `ScheduleSetup.tsx:291-426` assign shifts/patterns one employee at a time;
  `ClassDetail.tsx:609-619,727-754` has no "select all" for attendance or roster invites.
- `Documents.tsx:79-105,200-206` accepts one file per upload (no `multiple`), and delete/download are single-row
  only.
- `NotificationDeliveries.tsx:142-151` retry is per-row, with no "Retry All Failed" — despite the admin dashboard
  specifically surfacing a failed-delivery count as something to act on.

**Fix:** this is one UI pattern (checkbox column + sticky bulk-action bar), not six separate features — build it
once, apply it table by table starting with the list above.
**Impact: High × Effort: M per instance** (the underlying pattern is a one-time build)

### 4. Search coverage is inconsistent, and no page remembers its filters

Five list pages have zero text search, only dropdown filters: `Facilities.tsx`, `Residents.tsx:136-152`,
`Incidents.tsx:173-196`, `Violations.tsx:168-184`, `InspectionItems.tsx:186-210` — while `Employees.tsx:310-316`
already has the search-input pattern to copy. `Documents.tsx` wires an `employeeId` filter into its query (line
71) but never renders the control for it (lines 221-248) — dead code, and rows don't even show whose document
each one is.

Separately, wherever filters *do* exist they live in local `useState` (`Employees.tsx:72-77`, `Alerts.tsx:37-44`,
`TrainingMatrix.tsx:300-309`, `EmployeeCredentials.tsx:158-161`, plus the five pages above), never the URL —
filter Incidents to one facility, open a record, hit Back, and the filter is gone. `Violations.tsx` already uses
`useSearch()` for a one-shot `?action=add` prefill, so the wiring pattern exists in-repo; it's just not used for
persisting filters.

**Fix:** add the missing search inputs (copy `Employees.tsx`'s pattern); mirror filter state into URL query
params app-wide.
**Impact: High × Effort: S per page for search boxes; M to wire URL persistence everywhere**

### 5. Global search exists for one of six roles, and is narrow even there

`Header.tsx:185` — `{user?.role === "platform_admin" && <GlobalSearch />}`. No other role gets it, confirmed
directly in the code. org_admin, facility_manager, auditor, trainer, and employee — the people who actually use
this app daily — have no way to type a resident's or employee's name from anywhere; they have to guess which page
holds it, navigate there, and hope that page has its own search (see #4 — several don't). The sidebar's "Find a
page…" box only filters nav *labels*, not data. Where `GlobalSearch` is available, `useGlobalSearch.ts:26-35`
indexes only organizations/profiles/employees (no residents, documents, courses, training records, incidents),
fires a fresh query on every keystroke with no debounce, and has no keyboard shortcut.

**Fix:** extend `GlobalSearch` to every role (RLS already scopes results correctly per-tenant), broaden the
indexed tables, debounce ~250ms, add a `/` or Cmd/Ctrl+K shortcut.
**Impact: High × Effort: M**

### 6. Shared UI primitives are thin, so pages quietly reinvent — and drift from — their own versions

`components/ui/table.tsx` is a bare wrapper with no sort/pagination props, which is *why* #1 happens page by page.
`status-badge.tsx` requires the caller to pass a matching `type` prop by hand; get it wrong or skip it and a
status silently renders as a generic gray badge with no error. This has already drifted in practice:
`MyCourses.tsx` defines its own local `StatusBadge` that shadows the shared one by name, `MySchedule.tsx` has a
fourth independent color mapping, and `EmployeeDashboard.tsx` renders an expired practicum in the same neutral
gray as a merely-pending one. `toast.tsx`'s `toastVariants` has only `default`/`destructive` — no "success" style
— confirmed directly — so the ~65 files that call `toast()` on a successful save all render the same neutral card
as any informational message; success is conveyed by wording alone. Smaller-scale versions of the same problem:
`humanize()` is duplicated verbatim across six files, `CorrectiveActionStatusBadge` is byte-identical in two,
three different pages independently built three different corrective-action UIs against one `corrective_actions`
table, and Documents/PolicyDocuments/TemplateDocuments each reinvent list+detail UI from scratch.

**Fix:** the highest-leverage structural investment in this review — a shared-component pass (paginated
`DataTable`, semantic `StatusBadge`, a success toast variant, one `CorrectiveActionForm`, one employee-form
component) pays for itself across dozens of pages and stops future drift.
**Impact: High (compounding) × Effort: M–L**

### 7. A handful of high-blast-radius actions skip the confirm pattern the rest of the app follows

Good news first: 18 files already use the shared `AlertDialog` for destructive actions, and there is not a single
raw `window.confirm()` in the app (confirmed) — a genuinely well-followed convention, which is exactly why the
gaps stand out. `IncidentDetail.tsx:239,530` (removing a staff-involved row / uploaded evidence) and
`ResidentDetail.tsx:663` fire instantly with no confirmation, while the visually identical delete button in
`ViolationDetail.tsx:425` and `Facilities.tsx:163` does confirm. `EmployeeDetail.tsx:409-418` (removing a facility
assignment) and `EmployeeCredentials.tsx:140-144` (deleting a credential's evidence document — permanently
destroying actual compliance evidence) are the same gap. Highest blast radius: `Users.tsx` commits a role change
— including escalation to `platform_admin` — and the active/inactive toggle the instant either control is
touched, no confirmation on either, while `Packages.tsx` wraps a functionally-harmless blocked-delete in a full
`AlertDialog` a few files over.

**Fix:** extend the existing `AlertDialog` pattern to these spots; `OrganizationDetail.tsx:344-365`'s
suspend/reactivate dialog (specific, blast-radius-appropriate copy) is a good template, including for the
`Users.tsx` case.
**Impact: Med-High × Effort: S**

---

## Part 2 — Findings by workflow area

Condensed to the items not already covered in Part 1. Impact/Effort as High/Med/Low × S/M/L.

### Employee & training compliance
*Employees, EmployeeDetail, TrainingMatrix, TrainingTypes, TrainingPlans, Practicums, MedAdminRoster,
AdministratorQualification, EmployeeCredentials, BackgroundChecks, ExclusionScreening, PendingApprovals, Alerts*

| Finding | Where | Impact × Effort |
|---|---|---|
| Bulk-import CSV requires a raw `facility_id` **UUID** with no name lookup or template — the one column the whole feature depends on isn't shown anywhere else in the UI | `Employees.tsx:590-604`, `bulk-import-employees/index.ts:18` | High × S |
| "Add Employee" ignores the page's own active Facility filter, always resets to none | `Employees.tsx:150-154` | Med × S |
| Trainer name is free text on EmployeeDetail/TrainingMatrix (typos silently split one trainer's history) while Practicums already uses a proper Select for the same data | `EmployeeDetail.tsx:869-873`, `TrainingMatrix.tsx:230-232` vs `Practicums.tsx:137-139` | Med × S |
| EmployeeDetail is 11 stacked cards, no tabs/anchors — wanting one section means scrolling past all the others, every time | `EmployeeDetail.tsx:304-727` | Med × M |
| Two divergent employee-form definitions have already drifted (one has no Notes field) | `Employees.tsx:28-50` vs `EmployeeDetail.tsx:45-61` | Low-Med × S/M |
| Forms validate only on submit with one generic toast, no inline/on-blur feedback | `Employees.tsx:191-199` (representative) | Med × M |

### LMS course authoring & delivery
*Courses, CourseDetail, CourseAssignments, QuizBuilder, AiCourseWizard, AiGenerationLog, TakeCourse, TakeQuiz,
CompetencyTemplates/Records*

| Finding | Where | Impact × Effort |
|---|---|---|
| Publishing a "new version" of a course starts **completely empty** — no clone of the prior version's blocks/quiz/questions/answers (confirmed: plain `.insert()`, no clone). Fixing one typo in a published 15-block course means manually rebuilding it from zero before republishing | `CourseDetail.tsx:259-277`, `useCourses.ts:123-140` | High × M |
| No reordering for course blocks or quiz questions — append/delete only — even though the up/down `sort_order`-swap pattern already exists elsewhere and just isn't reused | `CourseDetail.tsx:850-944`, `QuizBuilder.tsx:457-469` vs `CompetencyTemplates.tsx:69-84` | Med × S |
| N+1 answer fetch in QuizBuilder — every question card independently fetches its own answers; 20 requests for a 20-question quiz, when a batched pattern already exists two lines away | `QuizBuilder.tsx:140` vs `useQuizzes.ts:322-346` | Med × S |
| Add Block / Generate Video authoring dialogs close silently on outside-click/Escape — a typed paragraph of lesson content or a script can vanish with zero warning | `CourseDetail.tsx:1028-1086,1119-1164` | Med × S |
| AI course wizard blocks the tab for up to a minute with no link to the async generation log that already tracks the job | `AiCourseWizard.tsx:117-127` vs `AiGenerationLog.tsx` | Med × S |
| TakeCourse is strictly Previous/Next — revisiting an earlier lesson from lesson 9 is 7 clicks | `TakeCourse.tsx:415-455` | Med × S-M |

### Facilities, residents, incidents, violations, inspections

| Finding | Where | Impact × Effort |
|---|---|---|
| FacilityDetail never fetches or shows that facility's residents at all; Open Incidents/Inspection cards cap at a 5-row preview with no "view all" — mid-inspection, reaching the full list means leaving the page and re-picking the facility on an unfiltered global list | `FacilityDetail.tsx:370-439` | High × S/M |
| Zero memoization in ResidentAssessmentFormEditor's item editors (0 uses of `React.memo` in `pages/app`) — every keystroke in a 22-item section re-renders the whole section; visible lag on a phone | `ResidentAssessmentFormEditor.tsx:201-309,845-944` | Med-High × S/M |
| "Resident Identifier" on the incident form is free text ("name or room number") despite a resident picker already existing and being used elsewhere — the same resident's incidents can't be rolled up | `Incidents.tsx:294-297` | Med × S |
| Fire-drill dialog requires 6+ fields and fails with one generic toast, no per-field flag — after a real drill, staff resubmit blind | `InspectionItemDetail.tsx:157-164` | Med × S |
| Incident/Violation/InspectionItem create-forms always render an empty Facility picker even when RLS has already scoped a facility_manager to exactly one site | multiple | Low-Med × S |

*(Three different corrective-action UIs on one `corrective_actions` table, and inconsistent delete-confirmation,
are covered under Part 1 #6 and #7.)*

### Documents, reports, compliance binder, audit log

| Finding | Where | Impact × Effort |
|---|---|---|
| Reports' one shared date-range filter silently means a different underlying field per report (`due_date`/`occurred_at`/`created_at`/`expiration_date`), the training-matrix report ignores it entirely, and it never resets when switching reports — an admin could hand a surveyor an "Employee Transcript" that's silently missing older records with no on-screen warning | `Reports.tsx:1053-1054` and per-report filter calls | High × S/M |
| ComplianceBinder has no facility picker for org_admin/auditor — only `facility_manager` gets auto-scoping (confirmed directly in the edge function) — and its one-sentence on-page description undersells the real 13-section PDF, which includes resident census/PII and incidents. A multi-facility org can't hand a surveyor a single-site binder without manually reviewing cross-facility data first | `ComplianceBinder.tsx:36-68`, `generate-compliance-binder/index.ts:134,168-179` | High × M |
| AuditLog is hard-capped at 300 rows with no date filter or pagination, and 23 of ~25 entity types render as a bare, unclickable UUID — on the one page whose entire purpose is trustworthy history review | `AuditLog.tsx`, `useAuditLogs.ts:18` | High × M |
| Reports.tsx fires 14 unbounded queries on mount regardless of which single report is wanted; every card's View/CSV button is gated on all 14 finishing | `Reports.tsx:1069-1113,1420,1434` | Med-High × M |
| Documents.tsx wires an employee filter into its query but never renders the control, and rows don't show whose document each one is | `Documents.tsx:56-71,221-248` | High × S |

### Scheduling & trainer/class workflows

| Finding | Where | Impact × Effort |
|---|---|---|
| ClassKiosk's employee search is org-wide, not scoped to the class's facility, and shows name + status only (no facility/job title) — at a live kiosk with a line waiting, two same-named employees can't be told apart, risking the wrong person's attendance on a regulatory record | `ClassKiosk.tsx:18,28-30` | High × S |
| Every schedule-grid cell interaction (status change, notes, unit move) requires a full modal round-trip — confirming 8 people for the week is 8 separate dialogs | `ScheduleDetail.tsx:88-136,296-324,389-446` | High × M |
| Employee pickers in Add/Edit-Shift and the Patterns panel aren't alphabetized (missing `.order()`, unlike the employee list elsewhere) | `useEmployeeFacilityAssignments.ts:19-33` | Med × S |
| "Recent Classes" on TrainerDashboard is really "all classes by date descending" — reaching today's kiosk is 2 clicks, not 1, and a future-dated class can outrank today's | `TrainerDashboard.tsx:32,177` | Med × S |
| No facility filter on TrainerClasses despite the underlying hook already supporting one — a 10-facility org must type exact facility names into free-text search | `TrainerClasses.tsx:54,322-346` | Med × S |
| No "Duplicate class" action — a recurring monthly refresher means retyping name/type/duration/location from scratch every time | `TrainerClasses.tsx:118-150,370-380` | Med × S |

*(Missing bulk shift/pattern assignment and no "select all" on attendee lists are covered under Part 1 #3.)*

### Employee self-service portal

| Finding | Where | Impact × Effort |
|---|---|---|
| The employee Dashboard has zero presence for Attestations or Schedule — an aide with 2 overdue attestations and a shift tomorrow can look at an all-green dashboard and reasonably believe she's caught up | `EmployeeDashboard.tsx:14-27,198-215` | High × M |
| 6 of 7 self-service hooks are missing the `enabled: !!employee?.id` guard that one page (MyCourses) already correctly uses — every other page double-fetches on every load (once with an undefined id, once resolved), worst on a phone/weak connection | all `/me/*` hooks except the usage in `MyCourses.tsx:47-50` | High × S |
| Dashboard's full training-record list is an unpaginated dump of 15-20 rows, unlike the Competency section 80 lines above it in the same file which already caps at 5 + "view all" | `EmployeeDashboard.tsx:303-339` vs `:58-60` | Med-High × S |
| MyTrainings is the only self-service page built as a literal `<table>` with a fixed min-width, forcing horizontal scroll on a phone — every sibling page uses a stacked-card layout | `MyTrainings.tsx:119-120` | Med × S |
| Sub-44px touch targets on packed action rows (small buttons beside a badge and a link in one tight flex row) — mis-tap risk scrolling one-handed | `MyCertificates.tsx:93-114`, `MyAttestations.tsx:122-127` | Low-Med × S |

*(Inconsistent status colors across these 7 pages are covered under Part 1 #6.)*

### Admin / platform console

| Finding | Where | Impact × Effort |
|---|---|---|
| Organizations has no status/plan filter even though the admin dashboard already surfaces "Past Due"/"Suspended" counts — no way to click through, only scan every badge in the full list | `Organizations.tsx:79-81` vs `AdminDashboard.tsx:74,134` | High × S |
| NotificationDeliveries/SupportTickets have status/channel dropdowns but no text search by organization or recipient, despite both being visible table columns | `NotificationDeliveries.tsx:39-45`, `SupportTickets.tsx:29-33` | High × S/M |
| Dashboard KPI tiles ("Failed Deliveries," "Open Support Tickets") link to the right page, but neither page reads a query param — both land on an unfiltered "all" view | `AdminDashboard.tsx:93-101,147-155` | Med-High × S |
| PlatformSettings is a flat, ungrouped list where every toggle — including Maintenance Mode, which banners every customer instantly — applies the moment it's touched, no grouping, no confirmation, unlike org-level Settings (4 grouped cards, explicit Save) | `PlatformSettings.tsx:76-84,128-161` vs `Settings.tsx:166-170` | Med-High × M |

*(Missing confirmation on Users.tsx role changes/deactivation, and per-row-only notification retry, are covered
under Part 1 #7 and #3.)*

### Shared chrome, navigation, auth

Most of what this area surfaced became the systemic Part 1 findings (#1, #2, #5, #6). What's left:

| Finding | Where | Impact × Effort |
|---|---|---|
| Header's page title is inferred by regex-parsing the URL's last segment instead of each route declaring its own — can misfire on nested/odd routes | `Header.tsx:140-159` | Low × S |
| Help Center has no contextual entry point from inside a page — it's the last item in a collapsible sidebar section a user can collapse and forget, even though each article already models a `relatedRoute` field nothing surfaces | `Header.tsx`, `Sidebar.tsx:201-206` | Med × S |
| Platform_admin's org switcher is an unpaginated, unsearchable native `<Select>` — becomes a scroll-fest past ~50-100 orgs | `Header.tsx` (`ViewingOrgSelector`), `useOrganizations.ts:9-18` | Low × S |

---

## Part 3 — Already strong (don't regress these)

- **Destructive-action confirmation** is a genuinely consistent, well-followed pattern (18 files use `AlertDialog`,
  zero raw `window.confirm`, both confirmed directly) — Part 1 #7's gaps are the exception, not the rule.
- **ResidentAssessmentFormEditor**'s autosave (1.5s debounce, flush-on-unmount), per-section incomplete-item
  flagging, and "Apply to All" bulk-fill bars turn a 22-item regulatory form into set-once-then-fix-exceptions —
  genuinely good design under real complexity.
- **Cross-linking that already exists is done well**: "Create Violation from this Finding" deep-links every field
  pre-filled from the source inspection item; TakeCourse/TakeQuiz resume logic persists progress on every
  navigation *and* on mobile tab-backgrounding, with per-answer autosave on quizzes.
- **The scheduling grid's Auto-Fill** (from each employee's typical pattern) plus a scoped, reversible "Clear
  Auto-Fill" gives a fast, undoable path to a filled schedule instead of hand-building every cell — and the
  underlying queries are properly joined server-side (no N+1) despite rendering a large employee × date grid.
- **One consistent app shell** (`MainLayout`) renders Header + Sidebar identically across `/admin`, `/app`,
  `/trainer`, and `/me`; the sidebar persists section-collapse state per user, auto-expands whichever section
  holds the active route, and its own "Find a page…" filter handles the flat-list problem well.
- **Mobile nav is real**: an off-canvas drawer reusing the same nav component, closing on route change, no
  `maximum-scale` viewport lock — the mobile-first pass already landed cleanly at the shell level (MyTrainings,
  noted above, is the one page that didn't get the memo).
- **Kiosk/check-in feedback** (big icon, plain-language message, fast auto-reset, rotating short-lived QR token)
  is fast and unambiguous for a line of people — a good model for other in-the-moment interactions.
- **Plain-language labeling** throughout the employee self-service area — no raw statuses/codes, UUIDs only as
  clearly-marked fallbacks.

---

## Part 4 — Suggested sequence

Efforts: **S** = a day or less, **M** = a few days, **L** = a week+.

**Pass 1 — cheap, high-value, no design work (all S, do together)**
Default `staleTime` in `queryClient.ts` · add the 5 missing search boxes (Facilities/Residents/Incidents/
Violations/InspectionItems) · add confirm dialogs to the ~6 spots in Part 1 #7 · fix bulk-import's `facility_id`
UX (accept a facility name, resolved server-side) · add bulk *Resolve* next to bulk *Dismiss* on Alerts · wire the
admin dashboard's KPI tiles to actually filter their target pages · fix the Documents employee-filter dead code ·
add the `enabled` guard to the 6 employee self-service hooks missing it.

**Pass 2 — the systemic fixes that need real (but mechanical) rollout (M)**
Server-side pagination on the highest-row-count tables (employees, training records, incidents,
course_assignments, audit_logs) · URL-persisted filters on the list pages that already have filter state · extend
`GlobalSearch` to every role, broaden its index, debounce it · course-assignment multi-select · batch
training-record entry for a cohort · ComplianceBinder facility picker · AuditLog pagination + date filter +
entity deep-links · Reports.tsx date-filter clarity (label the real field, reset on report switch, per-report
data fetching instead of all 14 up front).

**Pass 3 — structural, pays off longest (M–L)**
Shared paginated/sortable `DataTable` primitive · `StatusBadge` reworked to key off status semantics instead of a
caller-supplied `type` flag, plus a toast "success" variant · course-version content cloning · one shared
`CorrectiveActionForm` across Incidents/Violations/InspectionItems · consolidate the duplicated employee-form and
`humanize()`/badge helpers.

---

*Method: eight parallel reviews, one per functional area, each reading every listed page component and its
backing hooks in full. The highest-stakes claims (query-client defaults, hook pagination coverage, GlobalSearch's
role gate, bulk-import's facility_id requirement, course-version cloning, compliance-binder facility scoping,
toast/AlertDialog/window.confirm counts) were independently re-verified against the current code before
inclusion. Companion to `ROADMAP.md` (feature completeness/correctness — fully shipped) and `ARCHITECTURE.md`
(system design).*
