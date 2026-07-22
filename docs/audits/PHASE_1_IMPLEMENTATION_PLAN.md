# Phase 1 Implementation Plan — Core Feature Completion

Date: 2026-07-22

## Goals

Phase 1 strengthens existing core workflows without starting Phase 2. The highest-confidence, locally verifiable slice is the employee self-service work queue from P1-01. Other P1 items are revalidated and documented here, but they require seeded Supabase, authenticated Playwright users, or broader cross-page product decisions before completion can be claimed.

## Included backlog IDs

- P1-01: Employee-specific Work Queue mode for `/me/work`.
- P1-02: Dashboard/Today/PCH Operations metric consolidation, revalidated and deferred pending metric source contract.
- P1-03: Mobile Playwright journeys, revalidated and deferred pending seeded local Supabase/browser auth setup.
- P1-04: Visible record History drawer pattern, revalidated and partially satisfied for work items; broader domains deferred.
- P1-05: Report lifecycle e2e, revalidated and deferred pending seeded local Supabase/browser auth setup.

## Excluded items

- Phase 2, Phase 3, Phase 4, and Phase 5 roadmap work.
- New strategic features.
- Database schema changes unless a P1 workflow proves impossible without one.
- Product-rule changes to dashboard metrics without product owner approval.

## Current state by affected feature

### P1-01: Employee Work Queue

- Navigation/page access: `/me/work` and `/me/work/:id` route to the shared Work Queue and Work Item Detail pages for employees.
- Permissions: route allows `employee`; database/RPC comments indicate RLS returns only assigned rows for employees.
- Current UI: the list page already forces `scope = mine`, hides scope buttons, hides facility filter, hides owner filter, and uses employee copy in the heading. The table still shows manager-oriented columns such as facility/source/owner and the empty state says to change scope/filters even when employees cannot change scope.
- Detail page: already hides assignment/dependency management from non-managers; owners can comment, upload evidence, and change allowed status transitions. Immutable history is visible on the detail page.

### P1-02: Dashboard metric consolidation

- Current state: multiple dashboards and operating surfaces exist with overlapping summaries.
- Dependency: requires a shared metric contract and product decisions about canonical definitions.
- This work is deferred from code changes in this batch to avoid inventing business rules.

### P1-03: Mobile Playwright journeys

- Current state: Playwright exists, but authenticated mobile workflows require seeded Supabase users and local service setup.
- Dependency: local Supabase, auth seed credentials, browser execution.
- This work is deferred from code changes in this batch; manual verification remains required.

### P1-04: Visible history drawer pattern

- Current state: Work Item Detail already has an immutable history card. Other domains need a shared pattern but require domain-by-domain UI decisions.
- This batch will not add a cross-domain drawer to avoid broad UI churn; the work-item workflow will be documented as partially satisfying the history requirement.

### P1-05: Report lifecycle e2e

- Current state: report unit/render tests exist, but save/schedule/export permission e2e requires seeded Supabase/auth.
- This work is deferred from code changes in this batch; manual verification remains required.

## Proposed changes

### Batch 1 — Employee work queue usability and regression tests

- Add a small pure helper that defines the Work Queue presentation for employee versus manager/auditor contexts.
- Use the helper in `WorkQueue.tsx` to hide manager-oriented columns on `/me/work`, improve employee empty-state copy, and keep manager behavior unchanged.
- Add unit tests for employee and manager presentation rules.

## Files and modules likely affected

- `artifacts/caremetric-carebase/src/pages/app/WorkQueue.tsx`
- `artifacts/caremetric-carebase/src/lib/workItemQueue.ts`
- `artifacts/caremetric-carebase/src/lib/workItemQueue.test.ts`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_1_COMPLETION_REPORT.md`

## Database changes

None planned for Batch 1. Existing RLS/RPC behavior remains the server-side permission boundary.

## API changes

None planned. Existing `get_work_item_queue`, work item detail queries, and mutation RPCs remain unchanged.

## Permission changes

No permission widening. Employee route behavior remains scoped to `ownerProfileId = user.id`; UI changes only remove irrelevant manager columns/copy.

## UI changes

- Employee `/me/work` table will focus on work item, priority, due date, status, and actions.
- Manager/org/auditor `/app/work` table remains unchanged.
- Employee empty state will no longer tell users to change unavailable scope filters.

## Testing requirements

- Unit tests for presentation-mode helper.
- Focused Vitest run for work item queue tests.
- Typecheck.
- Full unit test suite if focused tests and typecheck pass.
- Build attempted and documented if environment variables remain unavailable.

## Dependencies

- Existing auth role resolution.
- Existing work item RLS/RPC behavior.
- Existing seeded Supabase for future e2e/manual verification.

## Risks

- Static/unit tests cannot prove server-side RLS; database/e2e validation remains required.
- Hiding columns for employees must not remove information they need to complete assigned work.
- Broader P1 items remain incomplete until seeded end-to-end validation is available.

## Recommended implementation order

1. Implement Work Queue presentation helper and tests.
2. Apply helper to `WorkQueue.tsx`.
3. Run focused tests and typecheck.
4. Update audit docs and completion report with accurate status.
5. Run full relevant validation.

## Rollback considerations

- Revert the Work Queue helper and JSX conditional column changes to restore previous shared table behavior.
- No database rollback is required because no migrations are planned.

## Acceptance criteria

- Employee `/me/work` no longer renders facility/source/owner manager columns.
- Employee `/me/work` keeps assigned-work scoping and operational status/priority/due visibility.
- Manager `/app/work` keeps existing columns and filters.
- Regression tests cover employee and non-employee queue presentation.
- Audit docs clearly identify completed, partial, deferred, and manually verified work.
