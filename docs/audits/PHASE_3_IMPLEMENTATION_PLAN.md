# Phase 3 Implementation Plan — Reporting, Automation, and Integrations

Date: 2026-07-22
Scope: Phase 3 only. Phase 4 strategic features and Phase 5 enterprise scaling work are explicitly excluded.

## Phase 3 goals

1. Strengthen existing reporting, survey-readiness, automation, and integration workflows without inventing new business rules.
2. Revalidate Phase 3 roadmap items against the current code before implementation.
3. Implement only a safe, locally testable vertical slice where the repository already has a working workflow and data contract.
4. Document any Phase 3 items that require credentials, external systems, product decisions, or local Supabase/RLS validation before they can be completed.

## Included roadmap/backlog items

| Item | Revalidated current state | Phase 3 decision |
| --- | --- | --- |
| P2-01 integration credential wizard | Medication integration can save a source bound to a credential ID, and integration API credentials exist in database tests/functions, but the app does not expose a full safe credential issuance/selection/test-connection wizard. | Deferred. Completing this requires secret/credential UX decisions, integration endpoint contract validation, and Supabase/RLS execution. |
| P2-02 Survey Evidence Packet builder | Survey Day already pins/downloads a single-facility compliance binder and binder jobs include status, checksum, facility scope, requester, correlation ID, and storage metadata. The UI does not summarize that audit/access metadata for survey handoff. | Partially implement as a packet manifest/readiness slice on the existing pinned-binder workflow. Do not create a new report generator or selection model in this batch. |
| Phase 0 report/job automation follow-ups | System job readiness and stale-job UI were added earlier; failed webhook/job work-item automation needs database trigger/RPC and operational policy review. | Deferred unless existing code exposes a locally safe client-only validation target. |

## Excluded items

- New strategic Phase 4 features such as staffing optimizer, resident timeline, copilot approval workflow, or vendor portal.
- New database tables or destructive migration work.
- Credential issuance, secret display, or live test-connection calls without product/security approval.
- New evidence-selection/report-generation semantics beyond the existing binder export job.

## Proposed implementation batch

### Batch 1: Survey Day packet manifest/readiness for pinned binders

Current workflow:

1. User opens `/app/survey-day`.
2. App loads active Survey Day session and workspace.
3. `BinderSection` fetches the pinned `binder_export_jobs` row.
4. User can download the completed binder through the existing `generate-compliance-binder` function.

Planned change:

- Add a pure helper that derives a `SurveyEvidencePacketManifest` from a binder export job row.
- Surface the manifest in `SurveyDay` for pinned binders, including status, generation time, checksum status, facility scope, byte size, retry/error status, correlation ID, and access-control note.
- Add unit tests for ready, stale, processing, and failed/errored binder states.
- Keep existing download behavior unchanged.

## Files and modules likely affected

- `artifacts/caremetric-carebase/src/lib/surveyEvidencePacket.ts`
- `artifacts/caremetric-carebase/src/lib/surveyEvidencePacket.test.ts`
- `artifacts/caremetric-carebase/src/pages/app/SurveyDay.tsx`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_3_COMPLETION_REPORT.md`

## Database changes

None planned. The slice reads existing `binder_export_jobs` fields only.

## API changes

None planned. The slice continues to use existing `useGetBinderExport`, `useBinderDownloadUrl`, and `BinderExportButton` behavior.

## Permission changes

None planned. Visibility remains governed by existing `binder_export_jobs` RLS and protected `/app/survey-day` route access.

## UI changes

- Add a compact packet manifest card inside Survey Day's Compliance Binder section when a pinned binder exists.
- Show clear readiness state and why a packet is or is not ready for handoff.
- Show operational metadata that helps survey/audit users verify they are using the right artifact.

## Testing requirements

- Unit test manifest derivation for succeeded/current, succeeded/stale, processing, and failed binder jobs.
- Run focused Vitest for the new helper.
- Run workspace typecheck.
- Run full unit tests.
- Run source-integrity and build validation.
- Document any Edge Function/database checks that cannot run because local tools or credentials are unavailable.

## Dependencies and risks

- This slice does not prove PDF contents; it only exposes metadata already recorded for the pinned binder job.
- A full selected-evidence packet builder still requires product-approved evidence-selection semantics and report-generation changes.
- Authenticated browser verification is required to confirm the manifest renders correctly under seeded roles.

## Rollback considerations

- Revert the helper, test, and Survey Day UI insertion. No data rollback is needed.

## Acceptance criteria

- Survey Day displays a packet manifest/readiness summary for pinned binder jobs.
- Manifest distinguishes ready/current, stale, processing, and failed states.
- Manifest includes access/audit metadata already present on the job row.
- Existing binder generation/download behavior is preserved.
- Automated tests, typecheck, and unit tests pass.
