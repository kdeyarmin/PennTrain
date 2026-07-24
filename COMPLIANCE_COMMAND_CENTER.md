# Compliance Command Center

A generic, user-definable facility **compliance requirement register** for CareMetric CareBase —
the "compliance command center" that surrounds the pharmacy eMAR rather than duplicating it. This
document is both the feature reference and the required implementation summary.

## Why this was built

Before this change, compliance tracking in CareBase was **domain-split and hardcoded**:

| System | Scope | Limitation |
| --- | --- | --- |
| `training_types` / `employee_training_records` | Training only | Not general facility obligations |
| `resident_compliance_items` | RASP deadline chain | Fixed 5-value `item_type` enum |
| `inspection_items` | Physical plant | Fixed equipment enum |
| `compliance_profile_*` | Employee credential/training baselines | Employee-scoped, not arbitrary requirements |
| `work_items` | Remediation queue | Always derived from an upstream source event (reactive, not a proactive register) |

There was **no place for an authorized user to define an arbitrary recurring facility obligation**
(fire-drill log, required posting check, EP annual review, licensing renewal, policy review, quality
audit…) organized by facility / building / category / regulation / responsible person, with the full
requested status lifecycle, evidence, review, reminders, escalation, history, and cross-facility
templates. This feature adds exactly that, and it is not PCH/ALF-gated — it works for every facility
type.

## Data model (`20260726000000_compliance_command_center_core.sql`)

- **`compliance_requirements`** — the definition of a recurring/one-time obligation, or a reusable
  cross-facility **template** (`is_template=true`, no facility). Columns: category (13 mandated
  categories + `other`), title, description, `regulation_citation`, `regulation_chapter` (2600 / 2800
  / other), `responsible_profile_id`, `recurrence` (one_time / monthly / quarterly / semiannual /
  annual / custom), `custom_interval_days`, `anchor_date`, `warning_days`, `requires_evidence`,
  `requires_review`, `building_id`, `source_template_id`, `is_active`. CHECK constraints enforce the
  template/facility scope and the custom-interval rule.
- **`compliance_requirement_instances`** — one due occurrence per cycle, generated from a live
  requirement. Full requested status set: `not_started`, `in_progress`, `awaiting_review`,
  `complete`, `overdue`, `not_applicable`, `exception_approved`. Carries completion/review/exception
  attribution, `evidence_count` (fast "missing evidence" filter), reminder/escalation bookkeeping,
  and a `unique (requirement_id, due_date)` guard against duplicate occurrences.
- **`compliance_requirement_events`** — append-only history (created / updated / archived /
  instance_generated / status_changed / completed / reviewed / reopened / exception_approved /
  marked_not_applicable / assigned / note_added / evidence_added / evidence_removed).
- **`compliance_requirement_documents`** — supporting-evidence files in a private
  `compliance-evidence` bucket, `{org}/{facility}/…` path RLS mirroring incident/resident documents.

Every table has RLS enabled, `grant select … to authenticated`, standard org+role+assigned-facility
select policies, `audit_log_trigger`, and `set_updated_at` where applicable.

## Workflow engine (`20260726000100_compliance_command_center_rpcs.sql`)

All writes go through `SECURITY DEFINER` RPCs (the tables have **select-only** RLS, so status
transitions, history, and notifications can't be bypassed by a direct client write):

`upsert_compliance_requirement`, `set_compliance_requirement_active`,
`generate_compliance_instances_now`, `copy_compliance_requirement` (deploy a template to N
facilities), `transition_compliance_instance` (start / submit_review / complete / approve_review /
mark_not_applicable / approve_exception / reopen — enforces the review gate and evidence gate),
`assign_compliance_instance`, `add_compliance_note`, `attach_compliance_evidence`,
`remove_compliance_evidence`. Each is scoped by `app_private.assert_compliance_manager` and writes a
history event; review/assignment/reminder actions enqueue `public.notifications`.

A daily cron job `compliance-requirement-maintenance-daily` runs
`run_compliance_requirement_maintenance()` to: generate upcoming occurrences, flip past-due
occurrences to `overdue`, send one-time due-soon reminders to the responsible person (or facility
managers), and escalate overdue occurrences to org admins + assigned facility managers.

## Frontend

- **`/app/compliance-command-center`** (`ComplianceCommandCenter.tsx`) — a Dashboard tab with a
  facility **compliance score**, drill-down metric cards (Overdue / Due soon / Awaiting review /
  Missing evidence), a per-facility score strip, filters (facility, building, category, regulation
  chapter, responsible person, status, due-date range, search), a sortable occurrence table, and CSV
  export. A **Requirements** tab (create/edit/archive/generate) and a **Templates** tab (create +
  copy across facilities).
- Occurrence drill-down dialog with status actions, evidence upload/view (signed URLs), notes, and a
  history timeline.
- `useComplianceRequirements.ts` (TanStack Query hooks), `complianceCommandCenter.ts` (pure helpers:
  labels, badge tokens, cadence formatting, effective status, roll-up summary, facility score) with
  13 unit tests.

---

## Implementation summary (required report)

### 1. Repository areas reviewed
Full review of routing (`App.tsx`, `routeManifest.ts`), navigation/authorization (`appDomains.ts`,
`productModules.ts`, `productModuleAccess.tsx`, `Sidebar.tsx`), auth/roles (`auth.tsx`,
`ARCHITECTURE.md`), the RLS + migration conventions (391 existing migrations; `stamp_scope` triggers,
`SECURITY DEFINER` RPCs, `audit_log_trigger`, pg_cron patterns), the shared component/design system,
and every one of the 10 requested feature areas against the current code (assisted by four parallel
gap-analysis agents plus the maintainers' own 07-24 review/backlog docs and `ROADMAP.md`).

### 2. Existing features enhanced
This work is deliberately **additive** — no existing module was rewritten. The compliance navigation
domain (`appDomains.ts`), the Compliance product-module path set (`productModules.ts`), the router
(`App.tsx`), the role-aware sidebar (`Sidebar.tsx`), and the generated DB types
(`database.types.ts`) were extended to surface the new register alongside the existing compliance
suite (Inspection Readiness, Survey Day, Compliance Binder, Regulatory Crosswalk, Violations/POCs).

### 3. New features added
The **Compliance Command Center** (task Area 1): a generic user-definable recurring compliance
requirement register with categories, PA Ch. 2600/2800 tagging, the full 7-status lifecycle, building
dimension, responsible-person assignment, recurrence schedules, automatic reminders, supervisor
escalation, supporting-document evidence, notes/comments, completion verification, full audit history,
facility compliance score, drill-down metric views, filters, CSV export, and cross-facility
templates. This also closes several Area 5 (survey readiness) and Area 9 (drill-down) gaps within the
compliance domain.

### 4. Database migrations created
- `supabase/migrations/20260726000000_compliance_command_center_core.sql` — 4 tables, RLS, grants,
  indexes, triggers, `compliance-evidence` storage bucket + policies, notifications type extension.
- `supabase/migrations/20260726000100_compliance_command_center_rpcs.sql` — 11 workflow RPCs, the
  recurrence generator, the daily maintenance function, and the cron schedule.
- Rollback: `docs/migrations/20260726000000_compliance_command_center_rollback.sql`.

### 5. New permissions / roles added
No new roles. Access reuses the existing matrix: `org_admin` + `facility_manager` manage (create/edit
requirements, transition occurrences, upload evidence, copy templates) via
`app_private.assert_compliance_manager`; `auditor` has org-wide read; `facility_manager` is scoped to
assigned facilities; `platform_admin` and the service role (cron) bypass. Four new
`notifications.notification_type` values were added (`compliance_requirement_assigned`,
`_due_soon`, `_overdue`, `_awaiting_review`). Route/module gating: `/app/compliance-command-center`
is in the Compliance product module, visible to `REPORTS_VIEW_ROLES`.

### 6. Tests added and results
`src/lib/complianceCommandCenter.test.ts` — 13 unit tests for labels, cadence formatting, effective
status derivation, due-soon / overdue / missing-evidence predicates, the facility score, and the
roll-up summary. **Result: all 13 pass.** Full suite: **439/439 tests pass** (83 files), including the
route-contract, `appDomains`, and sitemap tests that validate the new nav wiring.

### 7. Lint, type-check, and build results
- `pnpm run typecheck` — **pass** (whole workspace).
- `pnpm run check:migration-policies` — **pass** (no anon/public grants; RLS on every new table;
  `search_path` on every SECURITY DEFINER function; no duplicate versions).
- `node scripts/check-migration-drift.mjs --self-test` — **pass**.
- `pnpm run build` — **pass** (source-integrity + typecheck + Vite build + prerender + precompress).
  The page is a lazy chunk (41 KB / 10.8 KB gzip).
- `pnpm run check:bundle` — **pass** (exit 0). Note: the repo's aggregate JS budget is pre-existingly
  tight (~98%); the new lazy route does not affect the initial shell.

### 8. Requirements that could not be completed, with the exact reason
- **Live database migration verification** — this environment has no Docker/Supabase CLI, so
  `pnpm run check:database` (local stack apply + `db lint` + advisors + type regen) could not run. The
  two migrations were authored strictly to existing conventions and pass the text-level migration
  policy lint, but were not applied to a live Postgres here. `database.types.ts` was hand-extended to
  match the new tables (codegen requires a DB).
- **Areas 2–4, 6–10** were **reviewed but intentionally not re-implemented**: the agents and the
  maintainers' own docs confirm these are already built to a high degree (RASP/resident assessment,
  incident→QAPI, executive dashboard, admissions e-sign, care-level/billing review, and the
  regulation-aware AI governance are all present). Per the task's "enhance, don't duplicate" rule, the
  one genuine net-new capability gap (a generic compliance requirement register) was prioritized and
  completed end-to-end rather than spreading shallow edits across already-built modules.

### 9. Recommended next development phase
High-value, low-risk gaps surfaced during review (verified against current code):
1. **Wire the orphaned `run_shift_handoff_escalations()` cron** (Area 6) — the function is fully
   written but has no scheduler, so overdue shift handoffs never escalate. Needs the service-role
   invocation pattern its sibling escalators use.
2. **Make executive dashboard KPI tiles clickable** (Area 9) — `Dashboard.tsx` tiles are static
   `div`s; deep-link them to filtered lists (the list pages already read `?facility/status/severity`).
3. **Incident → QAPI escalation button** (Area 4) — `create_qapi_project` already accepts
   `source_type`/`source_id`; add the button.
4. **Surface the built-but-unwired support-plan approval lifecycle** (Area 2) — `resident_support_plans`
   / `support_plan_proposals` (incl. `conflict_warnings`) and their RPCs have no UI callers.
5. **Add PDF/spreadsheet export + TOC/page numbering to the compliance binder** (Area 5), and let the
   binder pull the new Command Center register as an evidence section.
6. **Per-employee readiness verdict engine** (Area 3) — compute Ready/Conditionally Ready/Expiring
   Soon/Incomplete/Restricted/Not Eligible with a "why" explanation.

### 10. Files changed
**New:**
`supabase/migrations/20260726000000_compliance_command_center_core.sql`,
`supabase/migrations/20260726000100_compliance_command_center_rpcs.sql`,
`docs/migrations/20260726000000_compliance_command_center_rollback.sql`,
`artifacts/caremetric-carebase/src/lib/complianceCommandCenter.ts`,
`artifacts/caremetric-carebase/src/lib/complianceCommandCenter.test.ts`,
`artifacts/caremetric-carebase/src/hooks/useComplianceRequirements.ts`,
`artifacts/caremetric-carebase/src/pages/app/ComplianceCommandCenter.tsx`,
`artifacts/caremetric-carebase/src/components/compliance/RequirementEditorDialog.tsx`,
`artifacts/caremetric-carebase/src/components/compliance/InstanceDetailDialog.tsx`,
`artifacts/caremetric-carebase/src/components/compliance/CopyTemplateDialog.tsx`,
`COMPLIANCE_COMMAND_CENTER.md`.

**Modified (additive wiring only):**
`artifacts/caremetric-carebase/src/App.tsx`,
`artifacts/caremetric-carebase/src/lib/appDomains.ts`,
`artifacts/caremetric-carebase/src/lib/productModules.ts`,
`artifacts/caremetric-carebase/src/lib/database.types.ts`,
`artifacts/caremetric-carebase/src/components/layout/Sidebar.tsx`.
