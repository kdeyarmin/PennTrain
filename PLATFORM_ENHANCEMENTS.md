# CareBase platform enhancements — consolidated report

A comprehensive enhancement of CareMetric CareBase as the compliance, resident-care, and operations
**command center** for Pennsylvania Personal Care Homes (PCH) and Assisted Living Facilities (ALF) —
the system that *surrounds* the pharmacy eMAR rather than becoming one. No eMAR / medication
administration, dispensing, or pass documentation was added; no resident or family portal was added.

A full review of the codebase (routing, navigation, auth/roles, RLS and migration conventions, the
shared design system, and all ten requested feature areas) found CareBase already covered most areas
to a high degree. Per the **"enhance, don't duplicate"** mandate, every change below is strictly
additive — it reuses and extends existing modules, data, and the role/RLS matrix rather than
rewriting or re-implementing anything. Multi-facility isolation and role-based access are preserved
throughout.

> Area 1 (Compliance Command Center) has a dedicated feature deep-dive in
> [`COMPLIANCE_COMMAND_CENTER.md`](./COMPLIANCE_COMMAND_CENTER.md). This document is the branch-wide
> consolidated report.

## The ten areas

| # | Area | Disposition | What shipped |
| --- | --- | --- | --- |
| 1 | Compliance Command Center | **Net-new** | User-definable recurring facility compliance register (4 tables, 11 RPCs, daily cron, page, 3 dialogs, hooks, lib) |
| 2 | RASP / resident-assessment automation | Enhanced | Support-plan approval lifecycle + proposals with `conflict_warnings` surfaced on the resident record |
| 3 | Employee readiness / credential matrix | Enhanced | Per-employee readiness verdict engine with a plain-language "why" on the employee page |
| 4 | Incident / investigation / QAPI | Enhanced | "Escalate to QAPI" action that dedups on `source_type`/`source_id` |
| 5 | Survey readiness center | Enhanced | Compliance binder cover, table of contents, and "Page X of Y" footers |
| 6 | Shift operations | Enhanced | Wired the orphaned overdue shift-handoff escalation to a 15-minute cron |
| 7 | Digital admissions / move-in | Enhanced | Tour scheduling datetime + lost/declined-reason capture in the admissions funnel |
| 8 | Care-level / billing review | Enhanced | Facility-wide worklist flagging residents whose billed level of care may not match their assessment |
| 9 | Multi-facility executive dashboard | Enhanced | KPI stat tiles are clickable drill-downs into pre-filtered lists |
| 10 | Regulation-aware AI | Enhanced | Immutable human accept / reject / needs-review disposition on every copilot answer |

## Area detail

### 1 — Compliance Command Center (net-new)
The one genuine capability gap. Existing compliance tracking was domain-split and hardcoded
(`training_types`, the fixed `resident_compliance_items` enum, `inspection_items`,
`compliance_profile_*`, and the reactive `work_items` queue); nothing let staff define an **arbitrary
recurring facility obligation** (fire-drill logs, required postings, EP annual reviews, licensing
renewals, policy reviews) organized by facility / building / category / regulation / responsible
person with a full status lifecycle, evidence, review, reminders, escalation, history, and
cross-facility templates. Delivered end-to-end: 4 tables with select-only RLS, 11 `SECURITY DEFINER`
workflow RPCs, a daily maintenance cron, a private evidence bucket, a scored dashboard with drill-down
metric cards + filters + CSV export, requirement/template management, and 13 unit tests. See the deep-dive doc.

### 2 — Resident support-plan approval lifecycle
`resident_support_plans` / `support_plan_proposals` and their RPCs (including assessment-derived
`conflict_warnings`) existed but had **no UI callers**. Added `useResidentSupportPlans` /
proposals / submit / approve / review hooks and a `ResidentSupportPlanSection` on the resident record:
version list with the active indicator, create/submit/approve, and a proposal review dialog that shows
conflict warnings and can generate a proposal from the latest assessment.

### 3 — Per-employee readiness verdict engine
`employeeReadiness.ts` (+ 11 tests) aggregates an employee's credentials, training, unsupervised-duty
clearance, employment status, and active restrictions into a single worst-case-wins verdict — Ready /
Conditionally Ready / Expiring Soon / Incomplete / Restricted / Not Eligible — each with an ordered,
plain-language reason list, surfaced as a badge on the employee page. Blocking employment statuses are
an explicit set so an unknown status never silently flips an employee to Not Eligible.

### 4 — Incident → QAPI escalation
`create_qapi_project` already accepted `source_type`/`source_id` but nothing invoked it from an
incident. Added an "Escalate to QAPI" button + dialog (`IncidentQapiEscalation`) that dedups on the
incident source and links back to the created project; PCH/ALF-gated on the incident detail header.

### 5 — Compliance binder cover / TOC / page numbers
The `generate-compliance-binder` edge function's PDF writer now reserves and renders a cover page and a
table of contents (headings record their page as they are drawn), stamps "Page X of Y" footers, and
saves defensively. Written conservatively because this function is `@ts-nocheck` and not executed by CI.

### 6 — Shift-handoff overdue escalation (dead plumbing wired)
`run_shift_handoff_escalations()` was fully written but never scheduled and never called, so
`escalation_level` stayed 0 forever and no manager was notified. Its extra "service role required"
guard (which a direct-`select` cron trips) was relaxed to match the sibling escalators, and it is now
scheduled every 15 minutes (`escalate-shift-handoffs`).

### 7 — Digital admissions tour + lost-reason capture
`AdmissionOperations` now captures a tour **scheduled-for** datetime for tour activity types (passed as
`scheduledFor`) and a structured **lost/declined reason** when a lead moves to a declined/lost stage
(passed as `lostLeadReason`), closing gaps the admission RPCs already accepted but the UI never supplied.

### 8 — Care-level / billing review (migration-free)
Nothing bridged a resident's assessed acuity to their billed level of care. `careLevelReview.ts`
(+ 13 tests) joins each active resident's operative (highest-version) rate agreement with their latest
assessment across sources (RASP/ASP forms + clinical assessments) and flags: no rate on file / no
assessment on file (action needed), assessment recorded after the current rate / assessment stale past
the annual cadence (review due), and a $0 level-of-care charge (verify). Surfaced as a facility-wide
worklist on the finance page with severity filters, CSV export, and row-click to open the resident's
record. Purely derived read-only signals — it never asserts a mis-bill, only prompts review — so it
needs **no migration** (all three sources are already readable facility-wide under existing RLS).

### 9 — Executive-dashboard KPI drill-downs
The 6 KPI stat cards and 3 overview sub-tiles on `/app` were static. Each now links to the matching
pre-filtered list using params those pages already read (training-matrix status/due-window/trainer,
employees/alerts status, documents, med-admin-roster or credentials by facility type). Tooltip triggers
became spans so each whole tile is a single focusable link (no button-in-anchor).

### 10 — Regulation-aware AI answer disposition
The citation-backed copilot writes an immutable receipt of every answer, but nothing recorded what the
reviewer **decided** about it. Added `compliance_copilot_run_dispositions` — an append-only record
(accepted / rejected / needs_review) joined to the run receipt by a **real foreign key** — plus a
manager-only `record_copilot_run_disposition` `SECURITY DEFINER` RPC (org/facility derived from the
run; a note required to reject or flag). Accept / Needs review / Reject controls appear on the fresh
answer and per run in the immutable-history tab. The edge function is untouched (the client already
receives the run id).

---

## Implementation summary (required report)

### 1. Repository areas reviewed
Routing (`App.tsx`, route manifest/contract tests), navigation & authorization (`appDomains.ts`,
`productModules.ts`, `Sidebar.tsx`), auth/roles and the RLS + migration conventions (`stamp_scope`
triggers, `SECURITY DEFINER` RPCs, `audit_log_trigger`, `set_updated_at`, pg_cron patterns, the
`app_private` helper layer), the shared component/design system, and all ten requested feature areas —
assisted by parallel gap-analysis agents that verified what already exists vs. what was incomplete vs.
genuinely missing before any code was changed.

### 2. Existing features enhanced
Areas 2, 3, 4, 5, 6, 7, 8, 9, and 10 — each extends an existing module, hook, page, edge function, or
cron rather than introducing a parallel one. Navigation/module/router/type wiring was extended (not
rewritten) to surface the one new register alongside the existing compliance suite.

### 3. New features added
Area 1, the **Compliance Command Center** (a net-new recurring compliance requirement register). Area
10 adds a net-new append-only disposition table, but as an enhancement to the existing copilot rather
than a new surface.

### 4. Database migrations created
Four forward migrations (additive only — new tables/functions/bucket/cron + widened CHECKs; nothing
pre-existing altered destructively), each with rollback coverage:
- `20260726000000_compliance_command_center_core.sql` — 4 tables, RLS, grants, indexes, triggers,
  `compliance-evidence` storage bucket + policies, `notifications` type extension.
- `20260726000100_compliance_command_center_rpcs.sql` — 11 workflow RPCs, recurrence generator, daily
  maintenance function, `compliance-requirement-maintenance-daily` cron.
- `20260726000200_wire_shift_handoff_escalation_cron.sql` — relaxes the escalator's guard and schedules
  `escalate-shift-handoffs` (every 15 minutes).
- `20260726000300_copilot_run_disposition_audit.sql` — the disposition table + immutability trigger +
  RLS + `record_copilot_run_disposition` RPC.
- Rollbacks: `docs/migrations/20260726000000_compliance_command_center_rollback.sql`,
  `docs/migrations/20260726000300_copilot_run_disposition_rollback.sql` (the cron-wiring migration is
  reversed by unscheduling; Area 8 needs no migration).
- `database.types.ts` was hand-extended to match the new tables/RPCs in exact codegen positions
  (byte-for-byte, validated by CI's `supabase gen types` diff).

### 5. New permissions / roles added
No new roles. Access reuses the existing matrix: `org_admin` + `facility_manager` write (scoped by
`app_private.assert_compliance_manager` / the copilot reviewer check / `assert_admission_manager`),
`auditor` reads org-wide, `facility_manager` is scoped to assigned facilities, and `platform_admin` +
the service role (cron) bypass. New tables use select-only RLS with all writes via `SECURITY DEFINER`
RPCs. Four `notifications.notification_type` values were added for the compliance register; one private
storage bucket (`compliance-evidence`) with `{org}/{facility}/…` path RLS was added.

### 6. Tests added and results
Four new pure-logic unit-test files — `complianceCommandCenter.test.ts` (13), `employeeReadiness.test.ts`
(11), `copilotDisposition.test.ts` (7), `careLevelReview.test.ts` (13) = **44 new tests**. Full suite:
**470/470 tests pass across 86 files**, including the route-contract, `appDomains`, and sitemap tests
that validate the new nav wiring.

### 7. Lint, type-check, and build results
- `pnpm run typecheck` — **pass** (whole workspace).
- `pnpm run check:migration-policies` — **pass** (no anon/public grants; RLS on every new table;
  `search_path` on every `SECURITY DEFINER` function; no duplicate versions).
- `pnpm run build` — **pass** (manual gen + Vite build + prerender + precompress).
- `pnpm run check:bundle` — **pass** (exit 0; aggregate JS ~98.9% of budget — the new surfaces are lazy
  chunks and do not affect the initial shell).
- `pnpm run check:dependencies` — **pass** (the pre-existing HIGH `postcss` advisory was patched via a
  pinned `pnpm` override).

### 8. Requirements that could not be completed, with the exact reason
- **Live database migration verification** — this environment has no Docker / Supabase CLI, so the local
  stack apply + `db lint` + advisors + type regen could not run here. Migrations were authored strictly
  to existing conventions, pass the text-level policy lint, and are validated by CI's `database` job
  (real Supabase stack + `supabase gen types` byte-match).
- **Compliance binder edge function (Area 5)** — `generate-compliance-binder` is `@ts-nocheck` and not
  executed by CI, so its changes are unvalidatable locally; they were written defensively (try/catch).
- Everything requested across the ten areas is delivered; the items below are net-new *next-phase* ideas,
  not unfinished work.

### 9. Recommended next development phase
1. Compliance binder **spreadsheet/CSV export** and pulling the new Command Center register in as a
   binder evidence section (Area 5) — needs a binder-export format column + RPC change.
2. Seed an actual **PA Chapter 2600/2800 governed rule pack** for the copilot (Area 10) — the governance
   engine exists but ships empty for PA; content/legal-heavy.
3. **Care-level review → rate-agreement deep-link** prefill and an optional acuity→tier suggestion (Area
   8), once a care-tier taxonomy is defined.
4. **Waitlist priority scoring** and occupancy/conversion export in admissions (Area 7).

### 10. Files changed
40 files (23 added, 17 modified). Highlights:

**Backend / migrations (new):** the four `supabase/migrations/2026072600030{0}` files above, plus the two
`docs/migrations/*_rollback.sql`.

**Frontend libraries (new, all unit-tested):** `complianceCommandCenter.ts`, `employeeReadiness.ts`,
`copilotDisposition.ts`, `careLevelReview.ts` (+ their `.test.ts`).

**Frontend hooks (new):** `useComplianceRequirements.ts`, `useCareLevelReview.ts`.
**Frontend pages/components (new):** `ComplianceCommandCenter.tsx`, three `components/compliance/*Dialog.tsx`,
`IncidentQapiEscalation.tsx`, `components/residents/ResidentSupportPlanSection.tsx`.

**Modified (additive wiring / enhancement):** `App.tsx`, `Sidebar.tsx`, `appDomains.ts`,
`productModules.ts`, `database.types.ts`, `useComplianceCopilot.ts`, `useResidentCareDelivery.ts`,
`Dashboard.tsx`, `EmployeeDetail.tsx`, `IncidentDetail.tsx`, `ResidentDetail.tsx`, `RegulatoryCopilot.tsx`,
`AdmissionOperations.tsx`, `ResidentFinancialOperations.tsx`,
`supabase/functions/generate-compliance-binder/index.ts`, and `pnpm-workspace.yaml` / `pnpm-lock.yaml`
(the postcss security override).

## Verification commands
```
pnpm run typecheck
pnpm test                       # 470 passing
pnpm run build
pnpm run check:bundle
pnpm run check:migration-policies
pnpm run check:dependencies
```
Live migration apply + type-drift byte-match run in CI's `database` job (a local Supabase stack is not
available in this environment).
