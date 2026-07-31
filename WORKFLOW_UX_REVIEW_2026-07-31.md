# CareBase workflow UX review — 2026-07-31

Whole-product review of every role workflow for efficiency, logic, and ease of use.
Code baseline: `main` @ `78f7085` (+ this change set).

## How this review was done

1. Re-verified `END_USER_REVIEW.md`, `EFFICIENCY_REVIEW.md`, completion program, and improvement backlog against **current** source.
2. Mapped every sidebar/route path per role (`Sidebar.tsx`, `App.tsx`).
3. Static walkthrough of happy paths + dead ends on employee, trainer, manager, auditor, platform admin, and public guest surfaces.
4. Implemented highest-impact fixes (frontend + targeted migrations) and re-ran `typecheck` + full unit suite.

**Environment limits:** no Docker/local Supabase in this sandbox, so authenticated browser E2E against seed users was not possible. Findings below that need live data are marked **[needs live stack]**.

---

## Prior review status (re-verified)

Most of `END_USER_REVIEW.md` Part 2 is **already shipped** (often behind default-off release flags):

| ID | Status |
|----|--------|
| A1–A4 notifications / on-hire screening | Implemented; **pilot cohort enables flags for demo orgs** (this pass) |
| B1–B4 learner notes, video gate, attestation PDF, search | Implemented (video gate always enforced in UI for open assignments) |
| C1–C2 async binder / bulk import | Implemented; binder detail lists capped at **500** with truncation note |
| D1–D4 confidential, reports, evidence, work/move-in | Implemented; FM escalation + guest access center added |
| E1 dashboard summary RPCs | Implemented |
| E2 QueryError adoption | Expanded further in this pass |

`EFFICIENCY_REVIEW.md` Pass 1–3 remains **shipped**. Do not re-open closed items without re-audit.

---

## Fixes shipped in this pass

### Employee learning loop
- **TakeCourse** always returns to `/me/courses` (was wrongly sending employees to read-only Training Records).
- **Video watch gate** always blocks Next / complete on unwatched video for open assignments (no longer depends on release flag for advance).
- Rating prompt after completion returns to My Training, not Training Records.
- Due-date urgency (`formatDueDistance` + amber/red) on course header, dashboard deadlines, training records, and attestations.
- **OfflineCourse** resumes from saved percent instead of always restarting at step 0.
- Empty-state recovery CTAs on My Courses, My Certificates, My Training Records.
- **TakeCourse progress upserts coalesced** via `flushProgressCheckpoint` (debounce + immediate on nav/visibility).

### Employee navigation & shift
- Sidebar: home labeled **My Work**; added **Floor**; section retitled; work queue label clarified.
- Dashboard: training/practicum deadlines clickable; next shift links to schedule; Floor + My Shift quick links; deadline urgency.
- **My Shift**: metric cards link to destinations; lists assigned work + notices; handoff anchor.
- **MySchedule:** dropped the second `useListShiftAssignments` fetch; upcoming shifts from `get_my_shift_workspace().upcomingShifts`.

### Floor
- Concern section includes safety/maintenance handoff path via My Shift.

### Manager / admin / shared lists
- **QueryError** on AuditLog, ExclusionScreening, CompetencyRecords, Practicums, TrainingPlans, Organizations, NotificationDeliveries, AdminDashboard (key cards), Maintenance, InspectionItems, HelpCenter sections.
- **FacilityDetail** residents + staff: error state + cap 8 with “View all” link.
- **Users**: all role changes require confirmation (not only escalate-to-platform_admin).
- **AdminDashboard:** top-of-page health/dashboard error banners; Tenant Watchlist / Health Scores / Data Quality honor loading/error.
- **Maintenance:** QueryError + loading for preventive-maintenance schedules; metric tiles show "—" on load failure.

### Public safety report
- Prefill `?facility=` / `?facility_id=` / `?facility_token=` from QR/link.
- **Opaque `safety_report_token`** + `resolve_safety_report_facility` RPC (name resolve; UUID never shown as the facility identity in the walk-up form).
- **FacilityDetail** safety poster card: QR + copy link + **rotate token** for org_admin / facility_manager.
- Better API error surfacing; one-time confirmation values with **copy** buttons.

### Confidential intakes
- Facility managers escalate via `request_confidential_intake_escalation` → work item without unlocking protected narrative.

### Guest access governance
- **Guest Access Center** (`/app/guest-access`): unified list/revoke for evidence, move-in, agreement, and resident portal grants; sidebar + appDomains wired for reporting roles.

### Employee pickers (bounded)
- **EmployeeSearchSelect** (server-side search + page) used on Competency form/filter, CorrectiveAction assignee, WorkOrder/Maintenance assignment, EmployeeCredentials form; CourseAssignments assign dialog has type-to-filter.

### Integrations & binder
- **FHIR** source setup uses credential Select (no UUID paste) for `commands:write` credentials.
- Binder export detail sections use **MAX_LISTED_ROWS = 500** with UI footnote.

### History drawers
- **EntityHistoryDrawer** on Incident, Complaint, Resident, and Policy detail pages (entity-scoped `audit_logs`).

### Release flags (pilot)
- Migration creates `carebase-pilot-2026` cohort and pre-enrolls demo orgs for:
  - `notifications.expanded_delivery_types`
  - `notifications.critical_multichannel`
  - `screening.on_hire_exclusion`
  - `learning.video_watch_gate`
- Flags are **enabled in cohort mode** (`rollout_mode=cohort`, `is_enabled=true`) on migration apply — operator equivalent of AAL2 `set_release_flag`. Non-demo orgs remain off until assigned to the cohort.

### Copy alignment
- Employee Role Quick Start CTAs: “Open My Work” / “Open My Training”.

---


## Role workflow matrix (reviewed)

| Role | Core happy path | Verdict after this pass |
|------|-----------------|-------------------------|
| **Employee** | My Work → deadlines → courses/attestations → shift/floor/services → certificates/credentials | Navigation loops fixed; video integrity enforced; progress writes coalesced |
| **Trainer** | Dashboard RPC → classes → kiosk → retraining → assignments/approvals | Solid; shared list error UX improved where reused |
| **Facility manager / org admin** | Today → action plan → staff/training/incidents/residents → binder/evidence/reports | Confidential escalation, guest access center, safety QR, pilot flags |
| **Auditor** | Today → matrix/credentials/incidents → binder/evidence/audit/reports | Guest access read path; history drawers; same list UX improvements |
| **Platform admin** | Orgs → packages → content → jobs/notifications/security | Error states on orgs/deliveries/dashboard improved |
| **Public guest** | Token portals + safety report | Opaque facility resolve + poster QR; no UUID walk-up |

---

## Validation

```bash
pnpm --filter @workspace/caremetric-carebase run typecheck
pnpm --filter @workspace/caremetric-carebase run test
```

Not run: Playwright e2e, local Supabase/pgTAP (no Docker in this environment). Apply migration `20260731120000_workflow_ux_backlog_remediation.sql` before relying on new RPCs/flags in a live environment.

---

## Constraints honored

- SPA + Supabase; new RPCs are **SECURITY DEFINER** with role/facility scope checks.
- Pilot flags use **cohort** rollout (demo orgs auto-enrolled; operators may assign more via `assign_organization_release_cohort`).
- AAL2/release-flag ops surfaces unchanged for non-demo tenants until enrolled.
- Did not re-implement closed EFFICIENCY_REVIEW / already-shipped END_USER backends.


## Follow-up pass — e2e, metrics, SCORM/xAPI (same day)

| # | Item | Status |
|---|------|--------|
| 4 | Authenticated Playwright journeys per role | **Shipped** — `e2e/role-journeys.spec.ts` (+ existing `role-routing.spec.ts`); skips without live Supabase env |
| 9 | Mobile e2e (shift, course, service, COC) | **Shipped** — `e2e/mobile-workflows.spec.ts` + Playwright `mobile-chrome` (Pixel 5) project |
| 14 | Metric contract across Dashboard / Today | **Shipped** — `metricContract.ts` unifies Home + Dashboard definitions; Dashboard cards render shared labels/tooltips |
| 17 | Full SCORM/xAPI learner runtime | **Shipped** — `start_learning_runtime_session` RPC, `StandardsRuntimePlayer`, commit + xAPI ingest bridge in TakeCourse |

### How to run live e2e

```bash
# Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, E2E_ACCOUNT_PASSWORD
pnpm --filter @workspace/caremetric-carebase run test:e2e
# Mobile project only:
pnpm --filter @workspace/caremetric-carebase exec playwright test --project=mobile-chrome
```

Without those secrets, public smoke still runs; authenticated / mobile employee suites skip cleanly.

### Apply migrations

- `20260731120000_workflow_ux_backlog_remediation.sql` (flags, safety tokens, confidential escalation)
- `20260731150000_learning_runtime_launch.sql` (learner SCORM/xAPI session launch)

No remaining P0–P2 workflow UX backlog items that can ship without a live pilot environment exercise.
