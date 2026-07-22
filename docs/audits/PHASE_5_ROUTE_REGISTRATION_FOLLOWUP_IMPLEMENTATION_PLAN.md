# Phase 5 Route Registration Follow-up Implementation Plan

Date: 2026-07-22

## Scope and rationale

The documented roadmap has already reached Phase 5, so this follow-up continues P4-01 in a small, behavior-preserving batch. The prior route-manifest slice centralized declaration-order invariants. This batch adds registration-coverage checks that compare existing route metadata sources with the actual `App.tsx` route declarations.

## Included backlog IDs

- P4-01: Split route metadata from `App.tsx` into typed manifests — further partial implementation through coverage tests for existing metadata sources.

## Excluded items

- No runtime route generation from a manifest.
- No navigation/sidebar/search redesign.
- No database, API, permission, or UI behavior changes.
- No Phase 1–4 feature work and no speculative Phase 6 features.

## Revalidated current state

- `App.tsx` remains the authoritative route declaration file.
- `appDomains.ts` contains role-aware navigation/search metadata for authenticated routes.
- `publicPaths.ts` contains marketing/public navigation metadata.
- `routeContracts.ts` contains canonical and legacy redirect paths.
- `publicAccessToken.ts` contains public token-flow route metadata.
- Existing tests verify some of those contracts, but not that each metadata route is actually registered in `App.tsx`.

## Proposed changes

1. Extend `routeManifest.ts` with reusable route-registration coverage helpers.
2. Add a focused route-registration test that verifies:
   - every `APP_PAGES` path is declared in `App.tsx`;
   - every marketing nav path is declared in `App.tsx`;
   - every legacy redirect source/destination is declared in `App.tsx`;
   - every public-access token path is declared in `App.tsx`; clean paths are documented as follow-up because the current check-in flow has a non-routable cleanup path and changing it would be a behavior decision.
3. Update audit docs to record P4-01 as still partial, now with route-order and route-registration guardrails.

## Files and modules likely affected

- `artifacts/caremetric-carebase/src/lib/routeManifest.ts`
- `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_5_ROUTE_REGISTRATION_FOLLOWUP_COMPLETION_REPORT.md`

## Testing requirements

- Focused route registration test must pass.
- Route-order test should still pass.
- Typecheck and full unit tests should pass.
- Build/source/bundle checks should be rerun where possible.

## Risks and rollback

- Risk: test may reveal unregistered metadata. If found, stop and document rather than silently changing product routing.
- Rollback: remove the coverage helper and route-registration test; no runtime migration required.

## Acceptance criteria

- Existing metadata route paths are checked against `App.tsx` declarations.
- Missing route metadata issues produce actionable messages naming the metadata source and missing path.
- No production behavior changes are introduced.
