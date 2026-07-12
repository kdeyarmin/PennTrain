# Phase 3 qualified-workforce operations

Phase 3 connects workforce intake, qualification evidence, credential renewal,
instructor-led training, and schedule eligibility. The database is the authority;
the Qualified Workforce page is an operator console, not a separate policy engine.

## Trust boundaries

- HRIS adapters may create a run and stage normalized rows, but cannot silently
  merge duplicate identities. A tenant administrator must explicitly link, create,
  skip, or reject every candidate row before apply.
- Source payloads and adapter secrets stay outside the browser. Store provider
  credentials in the approved secret manager, not `adapter_config`.
- Credential extraction is service-role only and advisory. Malware scanning must
  be clean, and a different authenticated human must confirm issuer and expiration
  before compliance changes.
- Qualification approvals require an active assessor qualification for the exact
  certification definition. Lifecycle evidence is append-only; revocation cannot
  be reopened.
- The schedule eligibility engine is shared by direct assignments, open-shift
  claims, and swaps. Inactive employment and confirmed exclusions are never
  overridable. Other overrides require a named authority, reason, narrow scope,
  and expiration no more than 30 days away.

## HRIS adapter contract

1. Register a source in `hris_source_systems` with a versioned field mapping,
   `delta` or `full` import mode, and the scheduler expression used by the approved
   adapter runtime.
2. On each scheduled or manual execution, call `create_hris_import_run` with a
   stable request ID and source checksum. Replays return the canonical run.
3. Normalize and checksum each source row, then call `stage_hris_import_row`.
   Replays with the same row checksum are harmless; divergent replays are rejected.
4. Call `validate_hris_import_run`, resolve every open exception with
   `set_hris_import_row_decision`, and apply in bounded batches with
   `apply_hris_import_batch`. Continue until the run is complete.
5. Alert on failed runs, open blocking exceptions, source cursor stagnation, or a
   run that remains in a nonterminal state beyond the adapter's service level.

The repository intentionally does not embed provider credentials or vendor-specific
network clients. The pilot adapter must be deployed in the approved integration
runtime and use the signed tenant API/service boundary established in Phase 2.

## Credential processor contract

The processor reads only the employee-owned document referenced by a renewal
submission. It validates MIME type and size, runs malware scanning, and records
the provider/model, extraction, confidence, and scan evidence through
`record_credential_renewal_extraction`. It never writes `employee_credentials`.
Operators decide through `review_credential_renewal_submission`; submitters cannot
approve their own renewal.

## Instructor-led completion

Before scheduling, grant the instructor an active `trainer.<training-code>`
qualification. Registrations enforce class capacity and move overflow learners to
the waitlist. Attendance requires signed evidence with source checksum. Completion
approval creates one receipt and one training record per attendee; retrying the
approval cannot double-credit a learner.

## Pilot and rollback gate

Pilot one facility and one HRIS source first. General availability requires:

- two successful full imports followed by seven days of replay-safe deltas;
- zero unresolved ambiguous identities and a documented exception owner;
- credential scan/extraction accuracy sampled by two independent reviewers;
- qualified-instructor, capacity, waitlist, and exactly-once completion exercises;
- shadow eligibility comparison against the published schedule with every
  difference explained and approved;
- open-shift and swap drills proving conflict, hours, qualification, credential,
  training, and exclusion blocks;
- audit export confirming actor, scope, reason, source snapshot, and checksum.

To stop rollout, pause the HRIS source and credential processor, close open-shift
opportunities, and disable the Phase 3 routes through the deployment feature gate.
Do not delete evidence or bypass eligibility triggers. Resume from the canonical
import run or submission after correcting the external dependency.
