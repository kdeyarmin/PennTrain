# Phase 5 Public Token Clean-path Implementation Plan

Date: 2026-07-22

## Scope and rationale

This follow-up addresses the concrete route-governance gap discovered during the prior P4-01 registration work: sensitive public token flows claim tab-scoped storage and clean-path support, but the class check-in flow had only `/checkin/:token` registered and the page read only the URL token. Refreshing or landing on the scrubbed clean path could not complete the workflow.

## Included backlog IDs

- P4-01: Route metadata consistency — further partial implementation for public token clean-path coverage.
- P0/P1 residual security/UX hardening: keep sensitive tokenized routes out of browser history while preserving workflow completion after cleanup.

## Excluded items

- No new public access product feature.
- No database, RPC, RLS, or check-in business-rule changes.
- No changes to evidence/move-in/resident-agreement guest portal behavior beyond route contract coverage.
- No Phase 2+ strategic feature work.

## Revalidated current state

- `PUBLIC_ACCESS_FLOWS` lists maintenance/check-in with `tokenPath: /checkin/:token`, `cleanPath: /checkin`, and tab-scoped storage.
- `App.tsx` registers `/checkin/:token` but not `/checkin`.
- `CheckIn.tsx` reads only the URL token and leaves the page in an idle/loading state when no token is present.
- `consumePublicAccessToken` already implements tab-scoped token storage and history scrubbing for other guest-token flows.

## Proposed changes

1. Register `/checkin` to the existing `CheckIn` page so the scrubbed URL remains routable.
2. Update `CheckIn.tsx` to consume the route token into tab-scoped storage and use the stored token on clean-path reloads.
3. Show a clear missing-token error instead of an indefinite spinner when no route or stored token exists.
4. Extend route-registration coverage to include clean paths for sensitive storage-backed public token flows.
5. Add focused tests for the public-token clean-path registration contract.

## Files likely affected

- `artifacts/caremetric-carebase/src/App.tsx`
- `artifacts/caremetric-carebase/src/pages/CheckIn.tsx`
- `artifacts/caremetric-carebase/src/lib/routeRegistration.test.ts`
- `docs/audits/*` follow-up docs/backlog/roadmap/inventory

## Risks and rollback

- Risk: changing check-in URL cleanup could affect kiosk/class attendance QR flows. Mitigation: preserve the same RPC hook and only change token sourcing/history cleanup.
- Rollback: remove the `/checkin` route and restore direct `useParams` token usage in `CheckIn.tsx`; no database rollback required.

## Acceptance criteria

- `/checkin/:token` still runs the existing check-in RPC.
- Route token is stored in tab-scoped session storage and browser history is scrubbed to `/checkin`.
- `/checkin` is routable and can reuse a stored token after reload.
- Missing token state shows an actionable error instead of an infinite spinner.
- Route registration tests include storage-backed clean paths.
