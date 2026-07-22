# Post-Phase Implementation Plan — Release Hardening After Phase 5

Date: 2026-07-22
Scope: post-roadmap hardening only. The five planned phases are complete or explicitly deferred in audit documentation.

## Goal

Turn the Phase 5 mockup-sandbox production-boundary documentation into an automated source-integrity guard without changing production application behavior.

## Revalidated current state

- Phase 5 documented that `artifacts/mockup-sandbox` is non-production prototype code.
- `scripts/check-source-integrity.mjs` currently scans text files for unresolved merge-conflict markers only.
- The root `check:source-integrity` command is already part of build and broader validation gates.
- No production code should import or depend on the mockup sandbox.

## Proposed change

- Extend `scripts/check-source-integrity.mjs` to fail when production source areas reference the mockup sandbox package/path.
- Keep documentation references allowed so README/audit docs can explain the boundary.
- Update audit documents with this post-phase hardening status.

## Files likely affected

- `scripts/check-source-integrity.mjs`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/POST_PHASE_COMPLETION_REPORT.md`

## Database/API/permission/UI changes

None.

## Validation requirements

- `pnpm run check:source-integrity` must pass with current repository contents.
- `pnpm run typecheck` and `pnpm run test` must pass.
- Build validation should still pass with placeholder non-secret Vite variables.
- Document Edge Function checks that remain blocked by missing Deno.
