# Phase 4 Implementation Plan — Strategic Differentiators

Date: 2026-07-22
Scope: Phase 4 only. Phase 5 enterprise scaling work is explicitly excluded.

## Phase 4 goals

1. Advance strategic differentiators only where the current repository already has a usable data contract.
2. Avoid speculative workflow expansion, new external roles, or AI approval behavior without product/security decisions.
3. Revalidate P3-01, P3-02, P3-03, and P3-05 against current code before implementation.
4. Implement a small, testable Resident 360 timeline improvement that strengthens an existing workflow without schema/API changes.

## Included backlog items

| ID | Revalidated current state | Phase 4 decision |
| --- | --- | --- |
| P3-01 | Qualification-aware scheduling/eligibility foundations and tests exist, but optimizer suggestions require explainability, staffing policy, and high data quality. | Deferred. Do not implement optimizer suggestions without product-approved optimization rules and DB validation. |
| P3-02 | `Resident360Summary` already calls `get_resident_360_snapshot` and `get_resident_timeline`, but the timeline renders raw events without source coverage, filters, or normalization helpers. | Partially implement by adding timeline normalization, source coverage, search/type filtering, and empty states to the existing Resident 360 component. |
| P3-03 | Compliance copilot and crosswalk functions exist, but approval workflow needs AI governance, human-review rules, and audit requirements. | Deferred. |
| P3-05 | Maintenance workflows exist, but vendor portal requires a new external role/access model and record scoping. | Deferred. |

## Excluded items

- Phase 5 route manifest/bundle/retention enterprise work.
- New database migrations or RLS policy changes.
- Staffing optimization, AI approval, or vendor portal role creation.
- New resident timeline event sources beyond what `get_resident_timeline` already returns.

## Proposed implementation batch

### Batch 1: Resident 360 timeline usability and reconciliation metadata

Current workflow:

1. User opens a resident detail page.
2. `Resident360Summary` loads snapshot metrics and calls `useResidentTimeline`.
3. The component renders newest linked events as a simple list.

Planned change:

- Add a pure timeline helper that sorts events newest-first, groups source event types, creates filter options, searches titles/details/statuses, and summarizes source coverage.
- Update `Resident360Summary` with source coverage badges, a search input, event-type filter buttons, and a clearer no-results empty state.
- Preserve existing `get_resident_timeline` RPC and route-link behavior.
- Add unit tests for sorting, source coverage, filtering, and search.

## Files and modules likely affected

- `artifacts/caremetric-carebase/src/lib/residentTimeline.ts`
- `artifacts/caremetric-carebase/src/lib/residentTimeline.test.ts`
- `artifacts/caremetric-carebase/src/components/residents/Resident360Summary.tsx`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_4_COMPLETION_REPORT.md`

## Database changes

None planned. This slice uses existing `get_resident_timeline` output only.

## API changes

None planned. The existing `useResidentTimeline` hook and RPC remain unchanged.

## Permission changes

None planned. Resident detail route guards and `get_resident_timeline` authorization remain the source of access control.

## UI changes

- Add timeline source coverage badges.
- Add search and event-type filters for resident-linked timeline entries.
- Add a no-results empty state that distinguishes no events from filtered-out events.

## Testing requirements

- Unit tests for normalization and filtering behavior.
- Focused Vitest for the new helper.
- Workspace typecheck.
- Full unit test suite.
- Source-integrity/build validation.
- Document checks blocked by missing local Supabase/Deno/external services.

## Dependencies and risks

- This slice improves presentation and client-side reconciliation only; it does not prove the RPC includes every desired source module.
- Full Resident 360 completion still requires product-approved event-source coverage and RLS/e2e validation against seeded data.

## Acceptance criteria

- Resident 360 timeline displays source coverage and supports type/search filtering.
- Filtering is deterministic and tested.
- Existing timeline links and RPC usage are preserved.
- No Phase 5 or unrelated strategic work is started.
