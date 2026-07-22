# Phase 5 Check-in Component Test Implementation Plan

Date: 2026-07-22

## Scope and rationale

The previous public-token clean-path follow-up fixed the check-in workflow code path, but verification was limited to token helper and route-registration tests. This follow-up adds direct component-level regression coverage for the CheckIn page states that changed.

## Included backlog IDs

- P4-01/public-token clean path follow-up: strengthen test coverage for the implemented check-in clean-path behavior.

## Excluded items

- No runtime behavior changes unless tests expose a defect.
- No database, RPC, RLS, or business-rule changes.
- No Playwright/Supabase live check-in automation in this environment.

## Revalidated current state

- `CheckIn.tsx` consumes `consumePublicAccessToken` during initial state creation.
- `CheckIn.tsx` now has a missing-token error state.
- Existing tests cover the token helper and route registration but not the rendered CheckIn component states.
- The repository does not include React Testing Library; component coverage can use `react-dom/server` and Vitest mocks without adding dependencies.

## Proposed changes

1. Add a focused `CheckIn.render.test.tsx` that mocks `wouter` params/link and the check-in mutation hook.
2. Assert a route token is stored and history is scrubbed during render.
3. Assert `/checkin` with a stored token renders the existing success copy instead of the missing-token message.
4. Assert `/checkin` without route or stored token renders the missing/expired token message and not success copy.

## Files likely affected

- `artifacts/caremetric-carebase/src/pages/CheckIn.render.test.tsx`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/PHASE_5_CHECKIN_COMPONENT_TEST_COMPLETION_REPORT.md`

## Acceptance criteria

- Component tests fail if the missing-token state regresses to a false success or spinner-only state.
- Component tests fail if QR route token consumption stops writing to tab-scoped storage or scrubbing history.
- No new production dependencies are added.
