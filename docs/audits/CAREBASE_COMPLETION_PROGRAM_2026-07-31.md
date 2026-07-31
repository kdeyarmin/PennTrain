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
| 1 | Import and data migration center | Partial; employee processor active, seven canonical templates have no processor; history now paginated/filterable with finalize/rollback previews | `/app/data-imports`; `data_import_jobs`, `data_import_rows`; `bulk-import-employees` | Durable stored-file worker, mapping definitions, and processors/tests for seven domains |
| 1 | Invitation lifecycle dashboard | Strong; management UI + revoke RPC + resend edge function + bulk invite | `/app/invitations`; `user_invitation_lifecycle`; `revoke_user_invitation`; `resend-invitation` | Role/browser journeys against seeded tenants; optional ban/delete of unconfirmed auth users on revoke |
| 1 | Employee lifecycle case console | Strong; list/wizard/preview-lock/apply/cancel/report UI on existing RPCs | `/app/employee-lifecycle`; `employee_lifecycle_cases` and preview/apply RPCs | Authenticated browser journeys and multi-facility transfer matrix coverage |
| 1 | Readiness action planner | Strong; workforce-impact projections + on-demand remediation routing | Forecast panel; `route_workforce_readiness_remediation`; work queue | Journey coverage that proves routed work items reopen/close with forecast maintenance |
| 2 | Credential renewal inbox | Strong; reviewer inbox + independent approve/reject on existing RPCs | `/app/workforce-operations` Renewals tab; `credential_renewal_submissions`; `review_credential_renewal_submission` | Reminder/SLA queue UI; OCR edge worker; superseding credential history chain |
| 2 | Assessor/supervisor qualification enforcement | Stronger; practicum observation/verification now duty-gated | `duty_eligibility_rules.practicum_observer`; practicum trigger; certification assessor path | Shared delegation/exception matrix UI across duty keys |
| 2 | Retraining-to-class loop | Partial; cohort enroll shipped | `/trainer/retraining` enroll dialog; `register_for_training_session` | Effectiveness review gate and durable case closure still open |
| 2 | Interval scheduling | Stronger; same-day split shifts allowed under overlap trigger | `shift_assignments` without one-per-day unique; interval overlap authority | Travel warnings and concurrent pgTAP race coverage |

| 3 | Request-specific survey evidence packets | Partial | Survey Day, evidence/binder and response-room features | Request ledger, immutable versioned manifest/package and packet-only guest access |
| 3 | Survey rehearsal/random sampling | Partial; SoR + UI shipped | `/app/survey-rehearsals`; `survey_rehearsals` / items + create/sample/record/complete RPCs | Guest packet export and deeper domain coverage still open |
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

## Implemented slice: Wave 1 management surfaces (2026-07-31)

### Invitation lifecycle dashboard

- New `/app/invitations` console: paginated list, status/role/search filters, resend, revoke, bulk CSV invite.
- `revoke_user_invitation(uuid, text)` for org managers (facility managers limited to trainer/employee invites).
- `record_user_invitation_resent(uuid)` (service role) plus `resend-invitation` Edge Function that regenerates an invite link, sends via SendGrid, and updates the durable receipt.
- Navigation entry, command palette action, and Users-page deep link.

### Employee lifecycle case console

- New `/app/employee-lifecycle` console on existing case RPCs: create wizard, dependency preview, re-preview lock before apply, cancel with reason, CSV report export.

### Import center last-mile UX

- Job history pagination, domain/status/file filters, finalize/rollback confirmation with reasoned action previews. Domain processors remain employees-only.

### Readiness remediation last-mile

- Workforce coverage-impact projections (current / 30 / 90 day).
- Per-risk governed action copy.
- `route_workforce_readiness_remediation(facility_id)` routes the 30-day forecast into the universal work queue on demand.

### Tests

- Unit: invitation lifecycle helpers, employee lifecycle helpers, workforce impact helpers.
- pgTAP: `invitation_and_readiness_management.test.sql` for function presence, grants, and resend receipt behavior.

### Next acceptance slices

1. Durable import worker + mapping for remaining seven domains.
2. Authenticated Playwright journeys for invite repair, lifecycle apply, and readiness routing.
3. Wave 2 credential renewal inbox and assessor qualification enforcement.


## Implemented slice: retraining cohort enroll (2026-07-31 follow-on)

- Retraining Monitor lists staff needing practicum action per facility and supports
  one-action cohort enrollment into a scheduled/in-progress class via
  `register_for_training_session` (capacity → waitlist preserved).
- Unit coverage for candidate ordering and enrollment result summaries.

## Implemented slice: survey rehearsal (2026-07-31 follow-on)

- New regulated tables `survey_rehearsals` and `survey_rehearsal_items` with manager RPCs
  for create, random/high-risk sample, item results, complete report, and cancel.
- UI at `/app/survey-rehearsals` for the full draft → sample → score → complete loop.
