# Phase 5 Implementation Plan — Scaling, Optimization, and Enterprise Readiness

Date: 2026-07-22
Scope: Phase 5 only.

## Phase 5 goals

1. Improve enterprise-readiness clarity without changing production behavior or inventing unresolved legal/retention rules.
2. Revalidate Phase 5 backlog items against the current repository before implementation.
3. Implement only low-risk readiness work with clear acceptance criteria in this environment.
4. Document blocked/deferred enterprise items that require legal policy, production telemetry, route-manifest refactoring, or bundle-budget design.

## Included backlog items

| ID | Revalidated current state | Phase 5 decision |
| --- | --- | --- |
| P3-04 | Data lifecycle functions exist, but a retention/legal-hold console requires customer-specific legal policy and immutable hold semantics. | Deferred. Do not implement a console without legal/product decisions. |
| P4-01 | Route metadata exists in `App.tsx` and supporting domain helpers, but a manifest-driven refactor would touch routing, navigation, search, and module gates. | Deferred. Requires dedicated behavior-preserving refactor and route contract expansion. |
| P4-02 | The mockup sandbox is present as a workspace package, but root documentation does not make the non-production boundary prominent enough for enterprise/audit readers. | Implement documentation-only clarification. |
| P4-03 | Bundle budget checks exist for aggregate bundle sizes, but route-level budgets require stable route/chunk ownership and CI threshold decisions. | Deferred. |

## Excluded items

- Data retention/legal hold product behavior or migrations.
- Route-manifest refactor.
- Route-level budget enforcement.
- Production telemetry, SSO/SCIM changes, backup/restore procedures, or SLA commitments.

## Proposed implementation batch

### Batch 1: Mockup sandbox production-exclusion documentation

- Add a root README section explicitly stating that `artifacts/mockup-sandbox` is a non-production prototype workspace.
- Add a sandbox-local README explaining its purpose, allowed uses, validation commands, and production-exclusion rules.
- Update audit docs to mark P4-02 implemented and defer the remaining Phase 5 items with dependencies.

## Files likely affected

- `README.md`
- `artifacts/mockup-sandbox/README.md`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_5_COMPLETION_REPORT.md`

## Database changes

None.

## API changes

None.

## Permission changes

None.

## Testing requirements

- Run workspace typecheck.
- Run full unit test suite.
- Run source-integrity/build validation.
- Document Edge Function/database checks blocked by missing local tools or credentials.

## Acceptance criteria

- Root README states the mockup sandbox is not production app code and must not be used as evidence of implemented CareBase behavior.
- Sandbox README documents allowed/prohibited use and validation commands.
- Audit backlog records P4-02 as implemented and remaining Phase 5 items as deferred with reasons.
