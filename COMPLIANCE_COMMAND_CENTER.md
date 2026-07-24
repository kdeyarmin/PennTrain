# Compliance Command Center

A generic, user-definable facility **compliance requirement register** for CareMetric CareBase —
the "compliance command center" that surrounds the pharmacy eMAR rather than duplicating it. This
document is the Area 1 feature reference; the branch-wide consolidated report for all ten enhancement
areas lives in [`PLATFORM_ENHANCEMENTS.md`](./PLATFORM_ENHANCEMENTS.md).

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

The branch-wide consolidated report for all ten enhancement areas — including the required
implementation summary (repository areas reviewed, features enhanced vs. added, migrations,
permissions, tests, lint/build results, incomplete items, next phase, and files changed) — lives in
[`PLATFORM_ENHANCEMENTS.md`](./PLATFORM_ENHANCEMENTS.md).
