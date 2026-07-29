# CareMetric CareBase — 25-Improvement Delivery Program

**Program branch:** `codex/carebase-25-improvement-program`  
**Prepared:** July 29, 2026  
**Scope:** CareBase application, Supabase schema/RPCs, Edge Functions, PWA, tests, and operating documentation

## Executive decision

CareBase is not missing 25 independent modules. Most of the required primitives already exist: a universal work queue, Resident 360, structured service delivery, implementation projects, workflow automation, inspection response rooms, credentialing, screening, QAPI, emergency operations, dietary operations, maintenance, integrations, report scheduling, and a mobile Floor workspace.

The correct implementation strategy is therefore **enhance, connect, and govern**. This program closes the seams between those modules instead of adding parallel systems of record.

### Product boundaries

- No pharmacy eMAR, medication dispensing, medication-pass documentation, or replacement of the pharmacy system.
- No new resident/family portal expansion. External collaboration is limited to narrowly scoped vendor or survey documentation access.
- AI output remains draft decision support. A person must review and approve any regulatory, clinical, financial, or compliance artifact.
- Every write remains organization- and facility-scoped, role-gated, auditable, and covered by database policy tests.
- Existing deployed migrations are immutable. Every schema change is a forward migration.

## Program gates

Every phase must pass all applicable gates before the next phase is considered complete:

1. `pnpm run check:source-integrity`
2. `pnpm run check:migration-policies`
3. `pnpm run typecheck`
4. `pnpm run test`
5. `pnpm run check:edge-functions`
6. `pnpm run build`
7. `pnpm run check:bundle`
8. `pnpm run check:database`
9. Playwright journeys for each changed role/workflow
10. Controlled-pilot evidence for the affected workflow

A unit test proves isolated logic. A pgTAP test proves database rules. A browser journey proves the handoff between the two. Features are not complete until the handoff is proven.

## Delivery waves

| Wave | Outcome | Recommendations |
| --- | --- | --- |
| A. One accountable daily workflow | Every task explains why it exists, opens the source, and records one governed completion outcome | 1, 2, 25 |
| B. Faster customer activation | A new organization can configure, import, invite, transfer, and offboard people through guided workflows | 3, 4, 5, 6 |
| C. Predictive workforce compliance | Managers see future readiness risk and can close training, qualification, renewal, and screening loops | 7, 10, 11, 12, 13 |
| D. Governed compliance operations | Rules, POCs, AI drafts, policies, and automations move through approval/versioned lifecycles | 9, 14, 16, 17, 23 |
| E. Resident finance and care review | Assessment/service evidence flows directly into transparent rate-agreement review | 8 |
| F. Survey, quality, and facility operations | Survey requests, QAPI, drills, food safety, and maintenance become complete operating workflows | 15, 18, 19, 20, 21 |
| G. Connected reach | Integrations and calendars become guided, observable, revocable operating surfaces | 22, 24 |

## Current implementation status

| # | Improvement | Existing foundation | Program delta | Status on this branch |
| ---: | --- | --- | --- | --- |
| 1 | Source-aware work items | Work queue, taxonomy, source IDs, detail page | Route every registered source and legacy prefix to a valid source/workspace; readable source labels | **Implemented** |
| 2 | One service-completion workflow | Structured Floor response RPC and manager legacy status RPC | Send manager entries through the structured response contract and refresh the same detectors | **Implemented** |
| 3 | Organization Go-Live Center | `implementation_projects` and ten seeded implementation tasks | Readiness score, owners, dates, evidence, validation links, and a printable go-live report | In progress |
| 4 | Import and Data Migration Center | Employee CSV import, implementation tasks, document analyzer | Governed import jobs, mapping/dry run, row errors, retry, finalization, and rollback contract | Planned |
| 5 | Transfer/leave/offboarding | Employee record, assignments, schedules, work items, session controls | Guided lifecycle case with dependency review, reassignment, access revocation, and completion report | Planned |
| 6 | Invitation lifecycle | User invitations and auth administration | Pending/expired/accepted/bounced dashboard with resend, revoke, correction, and bulk actions | Planned |
| 7 | 30/60/90 readiness forecast | Current readiness verdict and staffing optimization | Future eligibility projection with blocker attribution and facility/shift impact | Planned |
| 8 | Care-level to rate review | Care-level review worklist and rate agreements | Transparent recommendation workspace, approval, effective date, signature, and implementation tracking | Planned |
| 9 | Governed rule/settings releases | Training types, rule packs, settings, audit log | Draft, impact simulation, approval, scheduled activation, rollback, and release notes | Planned |
| 10 | Retraining-to-class loop | Retraining monitor, assignments, classes, waitlists | Cohort suggestion, one-click class/assignment creation, capacity analysis, and completion closure | Planned |
| 11 | Assessor/supervisor qualifications | Competencies, practicums, certification definitions | Qualification scope, expiry, self-evaluation prevention, and signoff enforcement | Planned |
| 12 | Credential renewal inbox | Credential records, employee upload, readiness recalculation | Renewal request, extraction assist, review, replacement linking, and approval workflow | Planned |
| 13 | Screening operations center | Background checks and exclusion screening | Orders, source freshness, possible-match cases, false-positive review, and receipts | Planned |
| 14 | Full POC lifecycle | Violations, corrective actions, POC PDF | Review through agency submission, acknowledgment, effectiveness verification, and closure | Planned |
| 15 | Request-specific Survey packet | Survey Day, evidence room, binder jobs, inspection war rooms | Bind exact documents to each request with redaction, version, delivery receipt, checksum, and final immutable package | Planned |
| 16 | Governed AI artifacts | Copilot receipts and human disposition | Editable draft, source snapshot, diff, reviewer, approval/expiry, and approved-action linkage | Planned |
| 17 | Policy campaign center | Policies and attestations | Audience, deadline, reminders, exceptions, reattestation, and campaign report | Planned |
| 18 | QAPI meeting/outcomes center | QAPI projects and incident trends | Agenda, attendance, minutes, baseline/target charts, decisions, tasks, and packet | Planned |
| 19 | Emergency drills/accountability | Emergency plans, events, resources | Drill calendar, activation, mobile roll call, timings, after-action review, and corrective work | Planned |
| 20 | Dietary/food-safety workflows | Dietary operations | Configurable critical-control logs, out-of-range disposition, alerts, recall/allergy workflows | Planned |
| 21 | Preventive maintenance/vendor collaboration | Assets, QR scans, work orders | Recurring schedules, contracts/warranties, quotes, scoped vendor link, verification, and asset history | Planned |
| 22 | Integration setup/health center | Credentials, API/webhooks, FHIR, SCIM/SSO, Value Center health | Setup wizard, test connection, lag/freshness, failure replay, rotation, kill switch, and troubleshooting | Planned |
| 23 | Safe no-code automation builder | Allowlisted automation rules/runs/actions | Simulation, approval, versions, pause/kill switch, run receipts, conditions, and templates | In progress |
| 24 | Secure calendar subscriptions | Individual ICS export and schedules | Revocable least-privilege feeds for classes, shifts, deadlines, drills, appointments, and work | Planned |
| 25 | Mobile field mode | PWA, Floor, mobile employee workflows, offline course support | Offline operational drafts, resumable uploads, sync/conflict status, QR/photo/voice capture, accessibility modes | Planned |

## Detailed implementation contracts

### 1. Source-aware work queue

**Acceptance criteria**

- Every key in `work_item_source_types` has a readable label and a safe route.
- Exact detail routes are used only where the source ID is known to match that route.
- Non-routable source rows land on the correct filtered operating workspace.
- Historical `rule_exception` rows remain actionable through stable deduplication prefixes.
- `inspection_war_room` is registered in the taxonomy so creating a response-room request cannot fail at the work-item trigger.
- Tests fail when a registered high-value source loses its route.

**Implemented files**

- `src/lib/workItemQueue.ts`
- `src/lib/workItemQueue.test.ts`
- `supabase/migrations/20260729215900_register_inspection_war_room_work_source.sql`

### 2. Unified service documentation

**Acceptance criteria**

- Manager and Floor workflows call `record_service_task_response`.
- Legacy manager status values translate deterministically into the typed response vocabulary.
- Manager-entered refusals and exceptions populate `completion_response` and `exception_details`.
- Resident 360 Needs Attention and change-signal queries refresh after either surface records work.
- Unsupported outcomes fail before an invalid server call.

**Implemented files**

- `src/lib/serviceDeliveryContract.ts`
- `src/lib/serviceDeliveryContract.test.ts`
- `src/hooks/useResidentServiceTasks.ts`

### 3. Organization Go-Live Center

Extend the existing implementation project rather than creating another checklist.

**Required capabilities**

- One active project per organization unless an explicit parallel project is approved.
- Required tasks: organization/facility profile, license/capacity, administrators, roles, employee import, resident import, compliance profile/rule pack, notifications, integrations, training, report/binder validation, security, Survey Day rehearsal, and cutover.
- Owner, due date, status, blocker note, evidence note, and route to the validating screen.
- Readiness score excludes approved `not_applicable` items and separately identifies launch blockers.
- “Validate” actions use real system state; a checked box alone cannot prove completion.
- Printable Go-Live Readiness Report with project scope, incomplete blockers, approvals, and generated timestamp.

### 4. Import and Data Migration Center

Build one import-job control plane reused by employee, training-history, credential, resident, room, contact, assessment, and incident imports.

**Import states**

`uploaded → mapping → validated → ready → applying → applied → finalized`, with `failed`, `rolled_back`, and `canceled` terminal paths.

**Required safeguards**

- File checksum and immutable original upload.
- Typed import definition and template version.
- Column mapping, facility-name resolution, normalized preview, and duplicate strategy.
- Per-row errors and warnings downloadable as CSV.
- Apply through idempotent batches with receipts.
- Rollback only while the batch remains unfinalized and only for rows created by that batch.
- Existing records are never deleted by rollback; updates use before/after evidence and explicit reversal rules.

### 5. Employee lifecycle cases

Use a case record instead of immediately mutating the employee.

**Case types**

- Transfer
- Leave of absence
- Return from leave
- Termination
- Rehire

**Dependency review**

Schedules, residents, work items, classes, inspections, credentials, devices/sessions, facility assignments, open approvals, and owned compliance requirements.

The final action applies the approved changes atomically where possible, records unresolved dependencies, and generates a personnel-file summary.

### 6. Invitation lifecycle

**Views**

- Draft/not sent
- Sent/pending
- Accepted
- Expired
- Revoked
- Delivery failed

**Actions**

Resend, revoke, correct recipient, extend expiration, bulk invite, copy setup link, and open the resulting user/employee record. Never expose reusable auth secrets.

### 7. Future readiness forecast

For each 30/60/90-day boundary, evaluate the same governed readiness rules with the future date substituted for today.

**Output**

- Current verdict and future verdict.
- First date the employee changes state.
- Exact training, credential, practicum, clearance, restriction, or assignment responsible.
- Affected facility, role, shift, service qualification, or assessor privilege.
- Explainable recommended next action.

No forecast may silently treat missing data as compliant.

### 8. Care-level and rate-agreement review

The app must never assert that a resident is misbilled. It may identify a review condition and explain the evidence.

**Lifecycle**

`flagged → reviewing → proposed → internally_approved → awaiting_signature → scheduled → implemented → verified`, with rejected/withdrawn paths.

The proposed tier must show the assessment/service factors used, permit edits, and link the signed agreement version and effective date.

### 9. Governed releases

Create a common release envelope for organization settings, training requirements, regulatory rules, alert thresholds, and other compliance-affecting configuration.

**Release controls**

Draft version, before/after diff, impact simulation, approval, activation date, immutable release note, prior version, rollback target, and activation receipt.

### 10. Retraining-to-class loop

A retraining case must retain its trigger, assigned intervention, successful completion evidence, and manager closure.

One action should enroll a selected cohort in a course or class, respect class capacity/waitlist rules, and keep the retraining case open until the completion condition passes.

### 11. Assessor and supervisor qualification

Qualification must be enforced server-side at competency, practicum, and observation signoff—not only shown as a warning.

Rules include skill scope, facility scope, effective/expiry dates, active employment, self-evaluation prevention, delegation, and second-signature requirements.

### 12. Credential renewal inbox

Renewal submissions remain pending until a qualified reviewer approves them. Extraction may suggest values but may not set compliance dates without review.

The replacement record links to the prior credential, preserves both files, recalculates readiness after approval, and retains rejection reasons.

### 13. Screening operations

Possible matches become investigation cases. The case records the source snapshot, identity fields compared, reviewer, supporting evidence, false-positive or confirmed disposition, restrictions, and next rescreen date.

### 14. POC lifecycle

Required stages:

1. Citation received
2. Finding reviewed
3. Root cause
4. Immediate correction
5. Systemic correction
6. Owner/deadline
7. Supporting documentation
8. Internal compliance review
9. Administrator approval
10. Submitted
11. Agency acknowledgment
12. Follow-up verification
13. Effectiveness review
14. Closed

Every submitted version is immutable.

### 15. Survey request packet

Each request links the exact files/records supplied, version/date range, redaction review, recipient, delivery timestamp, checksum, and replacements. Finalization produces one immutable manifest and package with an access log.

### 16. Governed AI artifacts

An AI artifact stores provider/model, prompt-policy version, source citations/snapshots, generated draft, human-edited draft, diff, reviewer, disposition, approval/expiry, and linked resulting work. Unapproved or expired drafts cannot be submitted as final artifacts.

### 17. Policy campaigns

Campaigns define policy version, audience, due date, reminders/escalation, exceptions/extensions, completion, reattestation rules, and final report. A new policy version never overwrites the evidence for the prior campaign.

### 18. QAPI meeting center

A meeting packet combines projects, incident trends, baselines, targets, current measurements, overdue actions, effectiveness reviews, prior commitments, agenda, attendees, minutes, decisions, and next actions.

### 19. Emergency drills and accountability

Drills are planned events with type, required timing/window, scenario, participants, and objectives. Activation opens a mobile resident/staff accountability roster, contact log, timing checkpoints, missing-person escalation, after-action review, and corrective work.

### 20. Dietary and food-safety workflows

Configurable log templates define the critical limit, unit, schedule, responsible role, and required corrective response. An out-of-range result cannot be saved as a normal reading; it must carry a disposition and may generate urgent work.

### 21. Preventive maintenance and vendor collaboration

Asset schedules generate recurring work orders. Vendor access is an expiring, single-work-order grant with no resident or general facility access. Manager verification is required before closure. Asset history includes labor, parts, cost, warranty, contract, and documentation.

### 22. Integration setup and health

Every integration has an explicit setup state, required scopes/version, test result, last success, lag, rejected/quarantined records, webhook status, failure replay, credential expiry/rotation, audit history, and kill switch.

Medication integrations remain reconciliation and documentation interfaces around the pharmacy-owned eMAR.

### 23. Safe automation builder

The existing allowlisted automation engine remains the execution authority.

**Required enhancements**

- Draft and active versions.
- Simulation against historical/current records.
- Human approval before activation for high-impact templates.
- Conditions UI rather than raw JSON.
- Templates for credential renewal, repeated falls, hospital return, regulatory requirement, policy campaign, and failed integration.
- Rate/cost guardrails, pause/kill switch, and immutable run receipt.

### 24. Calendar subscriptions

Feeds are tokenized, revocable, role-scoped, minimum-necessary, and audited. Separate feeds cover employee schedule/classes, trainer classes, manager deadlines, resident appointments, drills, inspections, and work due dates. Tokens are never placed in analytics or logs.

### 25. Mobile field mode

Extend the PWA and Floor workspace rather than reproducing the desktop application.

**Field actions**

Incident, change of condition, service exception, emergency roll call, maintenance request, food-safety reading, photo/document capture, and resident/room/asset QR scan.

**Offline contract**

Draft-only; encrypted per user/device; visible pending-sync state; resumable uploads; conflict resolution; automatic wipe on identity/org change; no offline finalization of regulated evidence.

## PR sequence

1. **PR A — Daily workflow seams:** source routing/taxonomy and unified service response.  
2. **PR B — Activation:** Go-Live Center UI, validation/readiness RPC, and generic import-job foundation.  
3. **PR C — Workforce lifecycle:** invitation dashboard, employee lifecycle cases, readiness forecast, qualification enforcement, renewals, screening.  
4. **PR D — Governed compliance:** release envelope, POC lifecycle, AI artifacts, policy campaigns, automation versions/simulation.  
5. **PR E — Resident finance/care:** care-level review lifecycle and signed rate implementation.  
6. **PR F — Survey/quality/facility:** request packets, QAPI meetings, emergency drills, food safety, preventive maintenance/vendor access.  
7. **PR G — Connected/mobile:** integration setup/health, calendar feeds, mobile operational drafts and sync.

This sequence keeps each review coherent, prevents a single unreviewable schema change, and makes every shared foundation land before the modules that depend on it.
