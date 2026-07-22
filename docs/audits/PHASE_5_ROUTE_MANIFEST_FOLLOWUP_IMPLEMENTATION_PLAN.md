# Phase 5 Route Manifest Follow-up Implementation Plan

Date: 2026-07-22

## Scope and rationale

The main roadmap already reached Phase 5. This follow-up addresses a bounded, behavior-preserving slice of P4-01: move the route-order invariants that protect Wouter specific-before-dynamic routes out of ad hoc test literals and into a typed route manifest helper. This does not attempt the full route/navigation/search/module manifest refactor because that would be broad and higher risk.

## Included backlog IDs

- P4-01: Split route metadata from `App.tsx` into typed manifests — partially implemented only for route-order invariants.

## Excluded items

- Phase 1–4 feature work.
- Full replacement of `App.tsx` route declarations.
- Navigation/sidebar/search generation from a manifest.
- Database, API, permission, and UI changes.

## Revalidated current state

- `App.tsx` still contains the authoritative route declarations.
- `routeOrder.test.ts` verifies several route-order contracts but stores the route pairs directly in the test.
- `routeContracts.test.ts` and `appDomains.ts` already cover some canonical route/navigation contracts, but not Wouter declaration-order invariants as reusable metadata.
- P4-01 remains incomplete as a full architecture refactor; this plan only reduces regression risk for route-order-sensitive paths.

## Proposed changes

1. Add a typed `routeManifest` helper containing route-order invariants and a reusable detector for missing or misordered route declarations.
2. Update the existing route-order test to consume the manifest instead of embedding separate route-pair literals.
3. Document the partial P4-01 implementation and remaining full-manifest risks.

## Files and modules likely affected

- `artifacts/caremetric-carebase/src/lib/routeManifest.ts`
- `artifacts/caremetric-carebase/src/lib/routeOrder.test.ts`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_5_ROUTE_MANIFEST_FOLLOWUP_COMPLETION_REPORT.md`

## Database/API/permission/UI changes

None. This is a testability and maintainability change only.

## Testing requirements

- Focused Vitest route-order test must pass.
- Typecheck must pass.
- Full unit tests should pass.
- Existing source-integrity, bundle, edge-function, and build checks should be rerun where possible.

## Risks and rollback

- Risk: manifest paths drift from `App.tsx`; mitigated by tests that fail on missing route declarations.
- Rollback: remove `routeManifest.ts` and restore route pairs in `routeOrder.test.ts`; no runtime behavior changes need migration.

## Acceptance criteria

- Route-order invariants live in a typed source module.
- Route-order tests fail on both missing routes and ordering regressions.
- Audit/backlog docs state P4-01 is still only partially implemented.
