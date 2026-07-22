# Phase 5 Follow-up Implementation Plan — Route-Level Bundle Budgets

Date: 2026-07-22
Scope: Phase 5 follow-up for P4-03 only.

## Goal

Promote the existing aggregate bundle budget check into a route-level regression guard for the audited high-touch route chunks without changing application runtime behavior.

## Revalidated current state

- `scripts/check-bundle-budget.mjs` already enforces aggregate JavaScript, CSS, initial shell, and largest chunk budgets after a production build.
- The latest production build emits named lazy-route chunks such as `ResidentDetail-*`, `HelpCenter-*`, `SurveyDay-*`, `SystemJobs-*`, and `WorkQueue-*`.
- P4-03 remained deferred because route/chunk ownership and thresholds needed definition.

## Proposed change

- Add explicit route chunk budgets for Resident Detail, Help Center, Survey Day, System Jobs, and Work Queue.
- Fail if an expected route chunk is missing or exceeds its budget.
- Keep existing aggregate bundle budget behavior unchanged.
- Update audit docs to mark P4-03 partially implemented for high-touch audited route chunks.

## Files likely affected

- `scripts/check-bundle-budget.mjs`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_5_FOLLOWUP_COMPLETION_REPORT.md`

## Database/API/permission/UI changes

None.

## Validation requirements

- Rebuild with placeholder non-secret Vite variables so route chunks exist.
- Run `pnpm run check:bundle` and confirm route budget measurements are reported.
- Run source integrity, typecheck, and unit tests.
