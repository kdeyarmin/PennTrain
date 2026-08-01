# CareBase Activation Wave — Delivery Progress

> **Superseded as a planning source.** Open work lives in [BACKLOG.md](./BACKLOG.md). This file is kept as dated evidence of what was believed at the time -- do not plan from it, and do not update it to reflect new work.

**Branch:** `codex/carebase-wave-b-activation`  
**Base:** `codex/carebase-25-improvement-program`  
**Updated:** July 29, 2026

## Implemented

### Invitation lifecycle

- Every trusted GoTrue invite receives a durable CareBase receipt tied to the intended organization, employee, role, redirect, and invited identity.
- Pending invitations reconcile to accepted or expired status instead of disappearing into Auth.
- Provisioning compensating-deletes an invited account when its lifecycle receipt cannot be recorded.
- Invitation identity and status are classified as regulated, row-audited personnel-access evidence.

### Governed imports

- Reusable import jobs, row receipts, and event history for employees, training records, credentials, residents, contacts, rooms, assessments, and incidents.
- Original-file SHA-256, duplicate strategy, validation preview, row errors/warnings, target IDs, before snapshots, resumable chunks, finalization, and audit evidence.
- Employee CSV import is the first complete adopter with create/skip/update handling.
- Rollback is intentionally narrow: unfinalized employee creates, within 24 hours, only when the row has not changed, gained a profile, or gained dependent records.

### Employee lifecycle cases

- Durable cases wrap the existing authoritative preview/apply engine for transfer, leave, return, termination, rehire, and access suspension/restoration.
- The case preserves the manager-reviewed dependency preview, reason, effective date, target facility, and resulting immutable lifecycle event.
- Application re-runs the preview under lock so stale dependency decisions are blocked rather than silently applied.

## Validation

The stacked pull request is not merge-ready until the inherited foundation and activation changes both pass:

- source-integrity and migration-policy checks;
- application and Edge Function tests;
- production build and bundle budgets;
- clean database replay, pgTAP, lint/advisors, and generated types;
- invite/import/lifecycle browser journeys for the relevant roles.

Dedicated management panels for invitation history, import rollback/history, and lifecycle cases are intentionally separate UI slices; the durable control planes and existing invite/import entry points land first so those screens have one governed backend to call.
