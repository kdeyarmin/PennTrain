# Phase 5 Public Token Clean-path Completion Report

Date: 2026-07-22

## Executive summary

This follow-up fixed the concrete public-token route gap identified during route-registration hardening. The class check-in flow now uses the shared tab-scoped token consumer, scrubs `/checkin/:token` to `/checkin`, registers the clean path, and shows a clear missing-token error instead of an indefinite idle spinner.

## Backlog items addressed

- P4-01/public-token clean path — Implemented for the existing class check-in route.

## Features reviewed

- Public-access flow metadata in `publicAccessToken.ts`.
- Runtime check-in routes in `App.tsx`.
- Class QR check-in page in `CheckIn.tsx`.
- Route-registration coverage in `routeRegistration.test.ts`.

## Code changes

- Added `/checkin` route registration beside `/checkin/:token`.
- Updated `CheckIn.tsx` to use `consumePublicAccessToken(token, "checkin-access-token", "/checkin")`.
- Added a missing/expired token error state for clean-path visits without a stored token.
- Extended route-registration tests to include storage-backed public clean paths.

## Database/API/permission/UI changes

- Database/API: none.
- Permission/security: token handling now aligns with existing tab-scoped public-token governance for the check-in flow.
- UI: missing-token state now shows an actionable error rather than a spinner.

## Tests added or updated

- Updated `src/lib/routeRegistration.test.ts` to assert storage-backed clean paths are registered.
- Re-ran `src/lib/publicAccessToken.test.ts` to confirm existing token governance behavior remains intact.

## Validation results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm --filter @workspace/caremetric-carebase exec vitest run src/lib/routeRegistration.test.ts src/lib/publicAccessToken.test.ts` | Passed | Focused clean-path route registration and token governance tests passed. |
| `pnpm run typecheck` | Passed | Workspace typecheck completed successfully. |
| `pnpm run test` | Passed | Full workspace unit test suite passed: 71 files and 333 tests in CareBase. |
| `pnpm run check:source-integrity` | Passed | Source integrity passed during build and edge-function validation runs; 1165 source files scanned. |
| `pnpm run check:edge-functions` | Blocked | Command failed because Deno is not installed in this execution environment. |
| `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy-anon-key VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm run build` | Passed | Production build completed with placeholder non-secret Vite values; generated manual PDF was reverted afterward. |
| `pnpm run check:bundle` | Passed with warnings | Bundle budgets passed, with warnings that largest JS chunk and all JS chunks are above 90% of their budgets. |

## Remaining limitations

- The QR check-in RPC was not exercised against live Supabase in this environment.
- The authenticated redirect path for signed-out QR scans still needs browser verification.
- Non-storage public slug routes remain unchanged and still expose their slug in the URL by design.

## Manual verification required

- Scan `/checkin/:token` as a signed-in employee assigned to the class and confirm check-in/check-out succeeds.
- Confirm browser history changes to `/checkin` and clean-path reload reuses the tab-scoped token.
- Visit `/checkin` in a fresh tab with no stored token and confirm the missing/expired link message appears.
