# CareBase workflow UX review — 2026-07-31

Whole-product review of every role workflow for efficiency, logic, and ease of use.
Code baseline: `main` @ `78f7085` (+ this change set).

## How this review was done

1. Re-verified `END_USER_REVIEW.md`, `EFFICIENCY_REVIEW.md`, completion program, and improvement backlog against **current** source.
2. Mapped every sidebar/route path per role (`Sidebar.tsx`, `App.tsx`).
3. Static walkthrough of happy paths + dead ends on employee, trainer, manager, auditor, platform admin, and public guest surfaces.
4. Implemented highest-impact, safe frontend fixes and re-ran `typecheck` + full unit suite (1040 tests).

**Environment limits:** no Docker/local Supabase in this sandbox, so authenticated browser E2E against seed users was not possible. Findings below that need live data are marked **[needs live stack]**.

---

## Prior review status (re-verified)

Most of `END_USER_REVIEW.md` Part 2 is **already shipped** (often behind default-off release flags):

| ID | Status |
|----|--------|
| A1–A4 notifications / on-hire screening | Implemented; flags often default-off |
| B1–B4 learner notes, video gate, attestation PDF, search | Implemented (video gate now **always enforced** in UI for open assignments) |
| C1–C2 async binder / bulk import | Implemented |
| D1–D4 confidential, reports, evidence, work/move-in | Implemented |
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

### Employee navigation & shift
- Sidebar: home labeled **My Work**; added **Floor**; section retitled; work queue label clarified.
- Dashboard: training/practicum deadlines clickable; next shift links to schedule; Floor + My Shift quick links; deadline urgency.
- **My Shift**: metric cards link to destinations; lists assigned work + notices; handoff anchor.

### Floor
- Concern section includes safety/maintenance handoff path via My Shift.

### Manager / admin / shared lists
- **QueryError** on AuditLog, ExclusionScreening, CompetencyRecords, Practicums, TrainingPlans, Organizations, NotificationDeliveries, AdminDashboard (key cards), Maintenance, InspectionItems, HelpCenter sections.
- **FacilityDetail** residents: error state + cap 8 with “View all” link.
- **Users**: all role changes require confirmation (not only escalate-to-platform_admin).

### Public safety report
- Prefill `?facility=` / `?facility_id=` from QR/link.
- UUID validation + clearer copy.
- Better API error surfacing.
- One-time confirmation values with **copy** buttons and save guidance.

### Copy alignment
- Employee Role Quick Start CTAs: “Open My Work” / “Open My Training”.

---



### Follow-up pass (same day, continued)

- **MySchedule:** dropped the second `useListShiftAssignments` fetch; upcoming shifts now come from `get_my_shift_workspace().upcomingShifts` already loaded for open offers / time-off.
- **Maintenance:** QueryError + loading for preventive-maintenance schedules; metric tiles show "—" on load failure.
- **FacilityDetail staff:** QueryError + cap 8 with "View all staff" (mirrors residents card).
- **AdminDashboard:** top-of-page health/dashboard error banners; Tenant Watchlist, Tenant Health Scores, and Data Quality Center honor loading/error states instead of empty zeros.
- **CompetencyRecords:** type-to-filter employee search on list filter + evaluation form (client-side; full server-side paginated RPC still open as #8).

## Remaining prioritized backlog

### P0 — product/ops (flags & live verification)
| # | Item | Why | Effort |
|---|------|-----|--------|
| 1 | Enable `notifications.expanded_delivery_types` (and templates) for pilot tenants | Deskless reach is still flag-gated | S–M + ops |
| 2 | Enable `notifications.critical_multichannel` for critical types | Critical alerts single-channel otherwise | S + ops |
| 3 | Enable `screening.on_hire_exclusion` | Mid-month hires otherwise wait for monthly job | S + ops |
| 4 | **[needs live stack]** Authenticated Playwright journeys per role (seed logins) | Code review ≠ runtime proof | M |

### P1 — workflow UX still open
| # | Item | Notes | Effort |
|---|------|-------|--------|
| 5 | Public facility **name** lookup / QR that never shows raw UUID | Prefill helps; walk-up without QR still hard | M (public RPC + FE) |
| 6 | facility_manager confidential-detail escalation path | List OK; protected narrative is org_admin/auditor | M |
| 7 | Guest-grant governance center (list/revoke all external tokens) | Evidence, move-in, agreement, resident portal | L |
| 8 | Unbounded employee pickers → search/paginated RPC | Competency form/filter has client search; server-side paginated RPC still needed | M |
| 9 | Mobile e2e: shift, course, service task, COC | Pilot readiness | M |
| 10 | Remaining QueryError / empty-state polish on secondary widgets | **Shipped this pass** for Maintenance PM, AdminDashboard side panels, FacilityDetail staff | S ongoing |

### P2 — efficiency & depth
| # | Item | Effort |
|---|------|--------|
| 11 | Binder section truncation beyond 200 rows (multi-part or higher cap with warning) | M |
| 12 | MySchedule: drop double-fetch of shifts vs workspace if shapes align | **Shipped** — uses workspace `upcomingShifts` |
| 13 | TakeCourse: coalesce progress upserts (video/notes/step) | S–M |
| 14 | Metric contract: Dashboard / Today / PCH ops single definitions | L |
| 15 | Integration credential wizard (no UUID paste) | L |
| 16 | History drawers on incidents/complaints/residents/policies | L |
| 17 | Full SCORM/xAPI runtime for learners (beyond governed metrics) | L |

---

## Role workflow matrix (reviewed)

| Role | Core happy path | Verdict after this pass |
|------|-----------------|-------------------------|
| **Employee** | My Work → deadlines → courses/attestations → shift/floor/services → certificates/credentials | Navigation loops fixed; video integrity enforced; shift/floor discoverable |
| **Trainer** | Dashboard RPC → classes → kiosk → retraining → assignments/approvals | Solid; shared list error UX improved where reused |
| **Facility manager / org admin** | Today → action plan → staff/training/incidents/residents → binder/evidence/reports | Strong surface; flags & confidential detail still product gaps |
| **Auditor** | Today → matrix/credentials/incidents → binder/evidence/audit/reports | Read path coherent; same list UX improvements apply |
| **Platform admin** | Orgs → packages → content → jobs/notifications/security | Error states on orgs/deliveries/dashboard improved |
| **Public guest** | Token portals + safety report | Safety report walk-up UX improved; full facility directory still needed |

---

## Validation

```bash
pnpm --filter @workspace/caremetric-carebase run typecheck   # pass
pnpm --filter @workspace/caremetric-carebase run test        # 114 files / 1040 tests pass
```

Not run: `pnpm run build` full monorepo, Playwright e2e, local Supabase/pgTAP (no Docker in this environment).

---

## Constraints honored

- No schema/RLS changes; frontend-only workflow UX + copy.
- Existing architecture (SPA + Supabase, SECURITY DEFINER paths untouched).
- Did not re-implement closed EFFICIENCY_REVIEW / already-shipped END_USER backends.
