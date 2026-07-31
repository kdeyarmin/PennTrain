# CareBase completion program — 2026-07-31

This is the authoritative completion register. Older audit inventories remain
historical evidence and are superseded when they conflict with this file.

## Baseline and repository verification

- Requested upstream: `kdeyarmin/PennTrain`, latest `main`.
- Verified local baseline: `f88c9d1100415b95b1fd5f960c2071904e87f1af`.
- The supplied checkout has no Git remote configured and no GitHub CLI, so an
  upstream fetch and open/merged pull-request review could not be performed in
  this environment. The limitation is recorded rather than treating the local
  checkout as proven current upstream state.
- Implementation branch: `work`.

## Current-state register

Classifications describe verified implementation, not roadmap intent. “Partial”
does not mean absent; it means the complete acceptance lifecycle in the program
has not yet been demonstrated end to end.

| Wave | Feature | Verified state | Primary current surface / system of record | Remaining acceptance criteria |
| --- | --- | --- | --- | --- |
| 1 | Import and data migration center | Partial; employee processor active, seven canonical templates have no processor | `/app/data-imports`; `data_import_jobs`, `data_import_rows`; `bulk-import-employees` | Durable stored-file worker, mapping definitions, pagination/filtering, reasoned finalize/rollback previews, and processors/tests for seven domains |
| 1 | Invitation lifecycle dashboard | Backend exists but management UI is missing | `user_invitation_lifecycle` | Paginated dashboard, repair actions, bulk invite, role/RLS and browser journeys |
| 1 | Employee lifecycle case console | Backend exists but management UI is missing | `employee_lifecycle_cases` and preview/apply RPCs | List, wizard, dependency resolution, locked re-preview UX, report and journeys |
| 1 | Readiness action planner | Strong but missing last-mile functionality | Existing readiness forecast pages/RPCs | Direct governed remediation actions and workforce-impact projections |
| 2 | Credential renewal inbox | Partial | Existing employee credentials and document workflows | Separate governed renewal states, reviewer inbox, independent approval, reminders and history |
| 2 | Assessor/supervisor qualification enforcement | Partial | Competency/practicum/observation database paths | Common server-enforced qualification rules, delegation/exception evidence and denial tests |
| 2 | Retraining-to-class loop | Partial | Existing retraining, course, class and waitlist records | Unified governed case through effectiveness review and closure |
| 2 | Interval scheduling | Strong but missing last-mile functionality | Existing schedule overlap protections | Split/overnight shifts, travel/rest/hours warnings, overrides and concurrent pgTAP coverage |
| 3 | Request-specific survey evidence packets | Partial | Survey Day, evidence/binder and response-room features | Request ledger, immutable versioned manifest/package and packet-only guest access |
| 3 | Survey rehearsal/random sampling | Missing | No `survey_rehearsal` system of record found | Complete rehearsal workflow and report |
| 3 | Plan of correction lifecycle | Partial | Existing plan-of-correction records | Full immutable submitted-version lifecycle, approvals, effectiveness gate and packet |
| 3 | QAPI meetings/outcomes | Partial | Existing QAPI projects and quality surfaces | Meeting governance, carry-forward commitments and print packet |
| 3 | Policy campaign center | Partial | Existing policy/acknowledgment capabilities | Version-pinned campaign lifecycle, targeting, escalation, knowledge checks and evidence packet |
| 3 | Governed AI artifacts | Partial | Existing draft-support features | Common provenance, source snapshot, generated/edited diff, review/disposition and expiry enforcement |
| 3 | Incident/complaint recurrence intelligence | Partial | Existing incident, complaint and trend paths | Explainable contributing-factor analysis and human-only recommendation disposition |
| 4 | Mobile offline field mode | Partial | Existing PWA/Floor experience | Encrypted user/device draft store, sync/media recovery, conflict resolution, purge and journeys |
| 4 | Emergency drill/accountability | Partial | Existing emergency-related records | Mobile drill lifecycle, offline accountability, after-action work and evidence |
| 4 | Restricted vendor maintenance collaboration | Partial | Existing maintenance/work-order system | One-work-order expiring external grant, vendor submissions and manager acceptance |
| 4 | Integration setup/health center | Partial | Existing API/webhook/FHIR/SCIM/SSO integration records | Consolidated setup, mappings, health, quarantine/replay, rotation/kill switch and audit UX |
| 4 | Capability bundles/delegation | Missing | Six primary roles remain authoritative | Scoped, approved, expiring capabilities enforced in RLS/RPCs |
| 4 | Governed configuration releases | Missing | Configuration remains distributed across current settings/rules | Shared release envelope, simulation, approval, activation and rollback receipts |
| 4 | Care-level/rate-agreement review | Partial | Existing assessment, finance and rate-agreement records | Governed review/approval/signature/implementation/verification lifecycle |

## Implemented slice: honest import-domain availability

The import center now has a single typed availability contract. Employees are
the only active upload processor; training records, credentials, residents,
resident contacts, rooms, assessments, and incidents are explicitly labelled
**Template only**. Template downloads remain available for planning, but the UI
does not imply that downloading a schema activates preview or apply behavior.
The employee card also discloses that its present batching is browser
coordinated, avoiding an unsupported durability claim.

### Objects, security, and operational configuration

- No migration, RPC, Edge Function, route, grant, or RLS policy was added in
  this slice.
- Existing caller-scoped employee import authorization remains unchanged.
- No external configuration is required.
- Commit/PR: recorded by the delivery system for this branch.

### Tests and next acceptance slice

- Unit coverage asserts that all eight templates exist while only employees are
  upload-enabled.
- Next: store the original source once, introduce immutable mapping/checksum job
  inputs, and move processing to a resumable server-side worker before enabling
  any additional domain.
