# CareMetric CareBase — Five-Phase Implementation Plan

- **Status:** Canonical program plan
- **Baseline:** main at 2874ee2, reviewed July 11, 2026
- **Scope:** 29 approved recommendations from the ranked product review
- **Explicit exclusion:** Recommendation #29, multilingual experience, is not part of this program

This document turns the approved recommendations into an executable delivery
program. It replaces the sequencing guidance in ROADMAP.md for future work;
ROADMAP.md remains the historical review and rationale.

The phases are dependency boundaries, not single releases or giant pull
requests. Each phase must ship as small, backwards-compatible vertical slices
behind typed rollout controls. Discovery for the next phase may overlap, but a
phase cannot receive general-availability promotion until the prior phase's
production exit gate is satisfied.

## Program summary

| Phase | Outcome | Included recommendations | One squad | Two squads |
| --- | --- | --- | ---: | ---: |
| 1. Trustworthy platform core | Existing evidence becomes transactional, observable, testable, and recoverable | #1, #3, #5, #8, #9, #10 | 12–16 weeks | 8–10 weeks |
| 2. Enterprise domain foundation | Tenancy, identity, workforce, rules, entitlements, and integrations gain stable contracts | #2, #12, #13, #25, #26, #27, #30 | 28–36 weeks | 18–24 weeks |
| 3. Qualified-workforce operations | Intake, credentials, qualifications, classes, and scheduling become one enforceable workflow | #4, #6, #14, #18, #19, #22 | 24–32 weeks | 15–21 weeks |
| 4. Governed learning and content | Content is governed, interoperable, adaptive, and safely available offline | #11, #15, #16, #23, #28 | 26–34 weeks | 17–23 weeks |
| 5. Closed-loop compliance and evidence | Findings and resident workflows produce owned work, reproducible reports, and regulator-ready evidence | #7, #17, #20, #21, #24 | 20–26 weeks | 13–17 weeks |
| **Total** | **29 included recommendations** | **#29 excluded** | **110–144 weeks, about 25–33 months** | **71–95 weeks, about 16–22 months** |

Add 10–15% program contingency for identity-provider certification, vendor and
HRIS coordination, regulatory review, legacy-data cleanup, penetration-test
remediation, and SCORM/LTI implementation variance.

Recommended peak team:

- One staff engineer/architect accountable for tenancy, schema, and shared contracts.
- Two squads totaling six full-stack engineers; at least two should be strong in Postgres, RLS, and Edge Functions.
- One integration/identity engineer from Phase 2 onward.
- One SDET focused on database, browser, migration, concurrency, and provider-contract automation.
- Shared product manager, product designer, SRE/DevOps, application-security/privacy engineer, and independent compliance SME.

## Non-negotiable delivery contract

Every recommendation is complete only when all of the following are true:

1. Acceptance criteria, data classification, tenant/role matrix, compliance impact, and failure behavior are documented.
2. Schema work follows expand, backfill, validate, switch, and contract; the previous app release remains compatible through the rollback window.
3. Every table, view, RPC, Storage path, and Edge Function has positive and negative authorization tests.
4. Unit, database, Edge contract, browser, accessibility, and relevant concurrency tests pass.
5. Structured logs, metrics, alerts, reconciliation queries, an operator runbook, and a named owner exist.
6. The capability is default-off, has an independent kill switch, and has a demonstrated disable or forward-recovery path.
7. A production pilot meets its observation targets with clean reconciliation and product, engineering, QA, security/privacy, and applicable compliance approval.

No feature flag is an authorization boundary. Database policies and trusted
server code must reject unauthorized direct calls even when the React UI hides
the feature.

## Shared architecture to build once

The following primitives prevent each phase from inventing its own state
machines, retry logic, or tenant checks.

Keep CareBase as a Supabase modular monolith. Direct client reads remain
appropriate where RLS fully expresses access, but every compliance-determining
write must pass through a transactional RPC or an authenticated Edge Function.
Do not create new microservices merely to separate domains.

Create a non-exposed app_private schema and revoke access from PUBLIC, anon,
and authenticated. Put internal command receipts, domain events, outbox
messages, job control, permission evaluation helpers, and worker-only functions
there. Expose only narrow, checked commands and security-invoker read models.

### 1. Tenant, identity, and authorization contract

- Represent portfolio, region, organization, and facility scopes explicitly.
- Separate human identities, organization memberships, facility assignments,
  employee records, employment episodes, and permission grants.
- Resolve effective permissions in trusted SQL or Edge code; React checks are
  presentation only.
- Keep RLS enabled on every exposed table. Grant or revoke Data API access
  explicitly and test grants separately from row policies.
- Use composite tenant foreign keys where practical, such as parent ID plus
  organization ID, so even service-role code cannot create a cross-tenant child
  relationship accidentally.
- Prefer security-invoker views. Any SECURITY DEFINER routine must have a fixed
  search path, explicit caller and tenant checks, narrow execute grants, and
  PUBLIC execute revoked.

### 2. Durable command, event, outbox, and job contract

- Give every mutating command an idempotency key, request ID, actor, tenant,
  correlation ID, and causation ID.
- Store command receipts with a unique idempotency key, request hash, and
  canonical result so a retry cannot accidentally reuse a key for new input.
- Commit domain state and durable outbox events in one database transaction.
- Keep domain events append-only with aggregate type, aggregate ID, aggregate
  version, event type, event version, scope, actor, and timestamps. Standardize
  event envelopes and version payload schemas.
- Record job attempts, last success, duration, row counts, cursor, retry state,
  structured error, next run, and last-known-good result.
- Make retries bounded and safe; move exhausted work to an operator-visible
  dead-letter state with replay controls.
- Treat external side effects as at-least-once. Every consumer remains
  idempotent even when a queue provider advertises stronger delivery semantics.

### 3. Audit and evidence contract

- Maintain an audited-entity manifest that identifies every regulated or
  administrative mutation and access event.
- Capture actor, organization, facility when applicable, source, request and
  correlation IDs, timestamp, reason, and before/after references.
- Use append-only history for approvals, rules, qualifications, entitlements,
  policy attestations, report snapshots, and guest evidence access.
- Produce checksummed export manifests so an evidence package can be verified
  after download.

### 4. Versioned rules and workflow contract

- Use explicit states and allowed transitions for approvals, credentials,
  remediation, incidents, move-ins, policies, content, and integrations.
- Store effective dates and supersession links rather than updating regulatory
  or qualification history in place.
- Require separate author and approver identities where a record becomes
  enforceable.
- Put unresolved mappings, failed transitions, and ambiguous matches in visible
  exception queues; never silently guess.

### 5. Rollout and commercial-control contract

Keep four concepts separate:

- Release flag: whether code is operationally enabled.
- Entitlement: whether the tenant is contractually allowed to use it.
- Cohort assignment: who participates in a staged rollout.
- Kill switch: emergency disable independent of billing.

Use typed feature definitions, rollouts, organization entitlements, and
evaluation events. Enforce entitlements in trusted database or Edge code and
audit every change. Temporary controls need an owner and expiration.

### 6. Integration and privacy contract

- Store provider credentials only in managed server secrets; never in React,
  public metadata, logs, or offline storage.
- Validate inbound signatures against the original request, apply timestamp and
  replay windows, rate-limit callers, and rotate secrets.
- Use tenant-scoped external IDs, versioned schemas, idempotency, delivery logs,
  bounded retries, dead-letter queues, and operator replay.
- Minimize PHI and other sensitive fields sent to providers. Complete legal,
  privacy, retention, consent, and BAA reviews where applicable.
- Scan uploads for malware; validate content type, archive structure, file size,
  safe filename, and tenant-derived Storage path.

## Phase 1 — Trustworthy platform core

- **Goal:** make the current compliance platform safe to extend.
- **Sequence:** #10 → #8 and #9 → #1 and #3 → #5.
- **Target:** 8–10 weeks with two squads; 12–16 weeks with one.
- **Implementation status (July 11, 2026):** code-complete in this working
  tree. General-availability promotion still requires the clean CI run and
  14-day production pilot defined in the exit gate below.
- **Operational handoff:** ownership, recovery, kill-switch, and pilot
  procedures are defined in [PHASE1_OPERATIONS.md](PHASE1_OPERATIONS.md).

### P1.1 — #10 Complete the release-quality gate

Deliver:

- Pin the Supabase CLI in the toolchain and make a fresh local-stack database
  reset part of CI.
- Run the full migration chain and pgTAP suite in CI; expand tests to cover each
  role, own and other tenants, assigned and unassigned facilities, RPCs, Storage,
  and explicit grants.
- Regenerate database.types.ts in CI and fail on schema drift.
- Add Playwright journeys for platform admin, organization admin, facility
  manager, trainer, auditor, employee, anonymous verification, and guest access.
- Add database/security advisors, Edge Function tests, dependency and secret
  scanning, accessibility smoke tests, and bundle budgets.

Accept when a clean checkout can reproduce the schema, generate identical
types, pass the complete role matrix, and build an immutable release artifact
without manual intervention.

### P1.2 — #8 Complete and harden the audit trail

Deliver:

- Create the audited-entity manifest and close coverage gaps, including
  facility-scoped access and privileged administrative actions.
- Add request and correlation context to UI, RPC, cron, Edge, and provider
  paths without logging secrets or unnecessary sensitive payloads.
- Define retention, legal-hold, export, and archive behavior.
- Add integrity checks and a reconciliation job that detects missing or
  malformed audit records.

Accept when every manifest action produces one tenant-correct audit event,
cross-tenant reads fail directly through REST/RPC/Storage tests, and an exported
audit package can be independently checksummed.

### P1.3 — #9 Add the operational control plane

Deliver:

- Introduce a shared job registry and job-run model for cron, queue, provider,
  reconciliation, and backfill work.
- Surface last attempt, last success, freshness, counts, error class, retry
  state, next run, and last-known-good status in the platform health UI.
- Add safe rerun, cancellation, dead-letter replay, alerting, synthetic checks,
  and provider circuit breakers.
- Record and monitor queue age, failure rate, provider latency, and retry cost.

Accept when every production background process is visible, attributable,
alerted before its freshness objective is breached, and safely rerunnable.

### P1.4 — #1 Make course completion and certificate issuance atomic

Deliver:

- Replace multi-step client behavior with one idempotent transactional command
  that validates completion, records the outcome, assigns one credential
  number, creates one certificate, and commits one logical outbox event.
- Add uniqueness constraints and replay/concurrency tests.
- Move PDF generation and delivery to durable asynchronous work while keeping
  certificate state observable.
- Reconcile historical completed assignments with missing, duplicate, or failed
  certificates before backfilling.

Accept when retries and concurrent submissions produce exactly one completion,
one certificate, and one logical notification; injected downstream failures do
not lose or duplicate the credential.

### P1.5 — #3 Make exclusion-screening refreshes atomic

Deliver:

- Ingest each external source into an immutable staged dataset version.
- Validate source identity, checksum, expected shape, counts, and freshness
  before activation.
- Switch the active-version pointer transactionally and preserve the
  last-known-good version on any failure.
- Record per-subject screening evidence, source version, match disposition, and
  manual review status; expose stale-data alerts.

Accept when malformed, partial, delayed, and repeated refreshes cannot replace
the active good dataset or erase existing screening evidence.

### P1.6 — #5 Prove notification delivery

Deliver:

- Extend the existing notification outbox into provider attempts and final
  delivery outcomes for in-app, email, and SMS.
- Implement signed and replay-safe provider callbacks; reconcile accepted,
  delivered, bounced, complained, opted-out, and permanently failed states.
- Enforce consent evidence, STOP/START behavior, recipient time zone, quiet
  hours, preference hierarchy, and escalation fallback.
- Add templates with versioning, preview, provider correlation IDs, retry
  budgets, spend alerts, and delivery dashboards.

Accept when replayed callbacks cannot corrupt state, opt-outs are honored across
all send paths, final provider outcomes reconcile, and administrators can see
and safely retry actionable failures.

### Phase 1 production exit gate

- Fresh migrations, database tests, browser role journeys, Edge tests, type
  drift, and build gates pass in CI.
- Fault injection proves the completion/certificate and exclusion-snapshot
  invariants.
- No missing audited action remains in the approved manifest.
- At least 99.5% of internally controlled scheduled jobs succeed during a
  14-day pilot, excluding acknowledged provider outages.
- The pilot has zero unexplained certificate mismatches, cross-tenant test
  failures, or loss of an active exclusion snapshot, and no open Sev-1/Sev-2.

## Phase 2 — Enterprise domain foundation

- **Goal:** establish stable scope, identity, workforce, rule, integration, and
  commercial contracts before operational expansion.
- **Sequence:** #27 → #13 → #12 → #2; #25, #30, and #26 then build on those contracts.
- **Target:** 18–24 weeks with two squads; 28–36 weeks with one.

With two squads, Squad A owns #27, #25, and #30. Squad B owns #13, #12, #2,
and #26. Both must share one tenant/RLS contract and one event envelope.

### P2.1 — #27 Add portfolio/regional hierarchy and custom permissions

Deliver:

- Model portfolio, region, organization, and facility hierarchy with
  effective-dated memberships and scopes.
- Replace hard-coded role assumptions where needed with governed permission
  definitions and role templates while retaining safe built-in roles.
- Centralize scope resolution for RLS, RPCs, Edge Functions, reporting, audit,
  and navigation.
- Backfill existing organizations and memberships in shadow mode, with
  ambiguous mappings in an exception queue.

Accept when the full role × hierarchy × resource matrix passes for same scope,
parent/child scope, unrelated scope, inactive membership, suspended tenant,
guest, and platform administrator, with no privilege expansion.

### P2.2 — #13 Add an effective-dated employee lifecycle

Deliver:

- Separate the person, employee identity, employment episode, organization
  membership, facility assignment, and application account.
- Model hire, pre-hire, active, leave, suspension, transfer, termination,
  rehire, and return-to-work as dated transitions.
- Define how each transition affects sessions, permissions, future shifts,
  assignments, notifications, integrations, and retained evidence.
- Add transition previews, guarded commands, reason capture, approval where
  needed, and immutable history.

Accept when lifecycle transition tests prove consistent access removal,
retention, future-work handling, and rehire behavior without deleting regulated
evidence.

### P2.3 — #12 Add configurable workforce compliance profiles

Deliver:

- Define governed profiles from job function, facility/license type,
  resident-contact duties, medication responsibilities, employment category,
  and other approved attributes.
- Assign profiles with effective dates and retain the assignment explanation.
- Support organization extensions without allowing them to weaken a mandatory
  regulatory baseline.
- Backfill every active employee to a profile or a visible unresolved queue.

Accept when every active employee is mapped or explicitly unresolved, and the
system can explain why each requirement applies for any historical date.

### P2.4 — #2 Add versioned, formally approved regulatory rule packs

Deliver:

- Store jurisdiction, authority, citation, retained source or checksum,
  applicability, effective dates, calculation parameters, supersession, author,
  reviewer, approval, and release notes.
- Separate draft, review, approved, shadow, active, superseded, and withdrawn
  states with author/approver separation.
- Build deterministic golden fixtures for supported facility types, workforce
  profiles, boundary dates, grace periods, and renewals.
- Run candidate rules in shadow mode and reconcile every result difference
  before activation.

Accept when no unsourced or unapproved rule can become enforceable, historic
results remain reproducible by rule version, and pilot organizations have no
unexplained calculation variance.

### P2.5 — #25 Add enterprise SSO, privileged-role MFA, and SCIM

Deliver:

- Configure tenant-owned verified domains and SAML SSO connections with safe
  account linking and just-in-time membership rules.
- Require MFA/AAL2 step-up for privileged roles and sensitive operations;
  provide recovery, session revocation, and audited break-glass procedures.
- Implement idempotent SCIM provisioning, update, group mapping, suspension,
  and deprovisioning through the employee and membership lifecycle.
- Pilot against at least two representative identity providers.

Accept when unverified email/domain linking is impossible, SCIM replay is safe,
deprovisioning revokes sessions without deleting evidence, and every privileged
pilot user is enrolled in MFA.

### P2.6 — #30 Add billing and typed entitlements

Deliver:

- Replace free-form package feature JSON with typed feature definitions,
  contractual entitlements, limits, grants, and effective dates.
- Use Stripe Billing with Checkout or an approved sales-assisted flow and the
  Customer Portal; treat signed subscription webhooks as the billing source of
  truth.
- Process webhook events idempotently and safely when duplicated or delivered
  out of order; model trial, active, grace, past-due, canceled, comped, and
  suspended states.
- Enforce entitlements and limits in trusted database/Edge code, separate from
  release flags and emergency kill switches.
- Add seat, invoice, subscription, entitlement, and exception reconciliation.

Accept when replayed or reordered Stripe events cannot grant incorrect access,
proposed entitlements reconcile in shadow mode, and billing state never becomes
the sole mechanism for emergency feature control.

### P2.7 — #26 Add a signed API/webhook integration hub

Deliver:

- Issue tenant-bound, scoped, expiring, rotatable API credentials stored hashed
  at rest; audit creation, use, rotation, and revocation.
- Publish versioned API and event schemas with pagination, rate limits,
  idempotency, correlation IDs, and deprecation policy.
- Sign outbound webhooks with HMAC, timestamp, replay protection, retry policy,
  delivery history, test delivery, dead-letter state, and operator replay.
- Route inbound integrations through the lifecycle, audit, outbox, and tenant
  authorization contracts rather than provider-specific table writes.

Accept when direct cross-tenant calls fail, replay and rotation tests pass,
delivery is observable end to end, and consumers can verify and safely replay a
versioned event.

### Phase 2 production exit gate

- Hierarchy migration produces no privilege escalation and no unresolved
  cross-tenant authorization failures.
- Every active employee is mapped to a governed profile or visible exception.
- Approved rule packs pass golden fixtures and at least 30 days of shadow/pilot
  reconciliation across two facility/license types.
- SSO/SCIM, entitlements, APIs, and webhooks pass replay, revocation,
  out-of-order, and tenant-isolation tests.
- No open unexplained rule-result or billing-entitlement variance exists.

## Phase 3 — Qualified-workforce operations

- **Goal:** connect workforce ingestion, qualifications, credentials, classes,
  and schedules into one authoritative operating model.
- **Sequence:** #4 → #14, #19, and #22 → #6 → #18.
- **Target:** 15–21 weeks with two squads; 24–32 weeks with one.

### P3.1 — #4 Make employee import idempotent and HRIS-ready

Deliver:

- Add tenant-scoped source systems and external person/employment IDs.
- Provide dry-run validation, normalized field mapping, duplicate candidates,
  explicit merge decisions, import history, exception handling, and resume.
- Apply imports through lifecycle commands and versioned integration contracts,
  not unrestricted upserts.
- Add scheduled delta/full import support, checksums, reconciliation, and
  provider-specific adapters behind the shared mapping layer.

Accept when repeated and resumed imports create no duplicate people or
employment episodes, ambiguous matches never merge automatically, and source
counts reconcile to applied and rejected rows.

### P3.2 — #14 Turn competency records into certification lifecycles

Deliver:

- Model requirement, attempt, observation, assessor qualification, decision,
  issue date, expiry, renewal window, suspension, revocation, and supersession.
- Version checklist definitions and preserve the exact criteria used.
- Require evidence, signatures, separation of duties where configured, and
  server-validated transitions.
- Expose current qualification and historical evidence to scheduling, learning
  paths, alerts, reports, and APIs.

Accept when qualification at any historical instant is reproducible and expired,
suspended, revoked, or improperly assessed credentials cannot satisfy a
schedule or compliance rule.

### P3.3 — #19 Strengthen instructor-led training operations

Deliver:

- Add trainer qualification, room/resource, capacity, roster, waitlist,
  registration, attendance, no-show, makeup, cancellation, and rescheduling.
- Use optimistic or advisory locking and server-side capacity enforcement.
- Support signed attendance evidence, bulk operations, session materials,
  calendar notices, and post-session completion approval.
- Reconcile attendance to training records, assignments, certificates, and
  notifications through idempotent commands.

Accept when concurrent registration and completion cannot exceed capacity,
double-credit attendance, or allow an unqualified trainer.

### P3.4 — #22 Add employee credential-renewal intake with OCR assistance

Deliver:

- Provide employee upload and mobile capture with renewal reminders and an
  administrator review queue.
- Scan files, restrict types and sizes, and extract issuer, credential number,
  issue/expiry dates, and person name through an approved processor.
- Treat extracted data only as a suggestion; require human confirmation and
  retain the extraction, edits, reviewer, and source document.
- Match approved credentials into qualification and compliance profiles with
  effective dates.

Accept when OCR can never approve or enforce a credential by itself, bad files
are isolated, and every accepted field is attributable to a human reviewer.

### P3.5 — #6 Add compliance-aware scheduling

Deliver:

- Build a server-side eligibility decision using employee lifecycle state,
  facility assignment, rule-pack requirements, training, competency,
  credentials, exclusions, trainer status, hours, conflicts, and capacity.
- Return explainable block, warning, or eligible decisions with the exact
  source versions and effective time.
- Require authority, reason, scope, expiration, and audit evidence for every
  permitted override.
- Add locking and concurrency protection for shift/class assignment and expose
  future eligibility changes before they create coverage gaps.

Accept when concurrent requests cannot double-book or bypass a hard
qualification, and every decision and override is historically explainable.

### P3.6 — #18 Add employee scheduling self-service

Deliver:

- Add availability, open-shift browsing, claim, decline, swap, manager
  approval, waitlist, cancellation, and notification workflows.
- Evaluate all changes through the server-side eligibility engine and lock the
  affected schedule rows.
- Show workers clear conflict/qualification explanations without disclosing
  unrelated employee or resident information.
- Add policy-configurable deadlines and escalation to managers.

Accept when concurrent claims and swaps cannot double-book, exceed limits, or
evade qualification rules, and managers can audit every decision.

### Phase 3 production exit gate

- Replaying each import produces no duplicate people and all ambiguous matches
  remain visible.
- Qualifications and credentials are effective-dated, human-approved, and
  consumed by the scheduling decision.
- Schedule assignment, override, registration, waitlist, attendance, claim,
  and swap concurrency tests pass.
- A 30-day pilot has zero unauthorized qualification overrides, double
  bookings, duplicate attendance credit, or unexplained import variance.

## Phase 4 — Governed learning and content

- **Goal:** provide a governed content lifecycle, real standards interoperability,
  adaptive sequencing, policy governance, and safe learner-only offline use.
- **Sequence:** #16 and #23 → #28 → #15 → #11.
- **Target:** 17–23 weeks with two squads; 26–34 weeks with one.

### P4.1 — #16 Add a governed tenant content studio

Deliver:

- Create reusable draft, review, approval, publish, retire, and supersede
  workflows for courses, assessments, media, and supporting documents.
- Separate author and reviewer permissions and show version comparisons,
  comments, ownership, lineage, and validation results.
- Make published versions immutable and define how material changes trigger
  reassignment, re-attestation, or a new due date.
- Add reusable organization templates without allowing tenants to edit the
  platform-owned original.

Accept when a sole author cannot approve a protected publication, learners
always resolve a stable version, and material-change behavior is deterministic.

### P4.2 — #23 Expand policy lifecycle management

Deliver:

- Reuse the governed content workflow for drafting, legal/compliance review,
  approval, publication, acknowledgement, attestation, retirement, and legal
  hold.
- Target policies by hierarchy, workforce profile, facility, and effective
  date; support attestations, quizzes, reminders, exceptions, and re-attestation.
- Preserve exact policy versions, audience, signature evidence, and delivery
  outcome.
- Link policy changes to remediation, learning, incidents, and report evidence.

Accept when historical attestations resolve the exact approved policy, audience
and version, and a material update produces the configured reassignment.

### P4.3 — #28 Add a real SCORM/xAPI/LTI runtime

Deliver:

- Validate packages for path traversal, zip bombs, malicious HTML/scripts,
  oversized assets, invalid manifests, and unsupported capabilities.
- Store immutable packages and run untrusted course content in a sandboxed
  origin/frame with a restrictive CSP and narrow message bridge.
- Implement SCORM runtime commits and normalize score, progress, suspend data,
  completion, and success into the atomic learning contract.
- Add xAPI statement ingestion with actor/tenant validation and idempotency;
  implement the selected LTI roles and security flow rather than claiming
  generic compatibility.
- Clearly label capabilities that require connectivity and maintain a hostile
  package compatibility corpus.

Accept when supported conformance fixtures commit correct results, hostile
packages cannot escape isolation, and replay cannot duplicate completion.

### P4.4 — #15 Add adaptive, sequenced learning paths

Deliver:

- Model prerequisites, ordered and parallel steps, equivalencies, branches,
  remedial steps, assessment thresholds, relative deadlines, waivers, and
  versioned path assignment.
- Evaluate transitions in a deterministic server-side state machine using
  stable course, competency, and standards outcomes.
- Explain why a step is locked, selected, skipped, or remediated.
- Preserve the path definition used by each learner and define behavior when a
  path is revised.

Accept when state-machine fixtures cover branches and boundary dates,
prerequisites cannot be bypassed by direct calls, and historical paths remain
reproducible.

### P4.5 — #11 Add genuine offline learner mode

Deliver:

- Cache only an allowlisted set of approved learner content and learner-owned
  queued actions; exclude resident, incident, credential, admin, report, and
  evidence-room data.
- Encrypt device data, scope it to the authenticated user and organization,
  provide download/storage management, and wipe on logout, revocation, role
  change, or tenant suspension.
- Give every offline action a stable idempotency key and record local status,
  retry, conflict, server outcome, and sync visibility.
- Handle stale versions, device clock skew, expired tokens, tab duplication,
  content withdrawal, partial download, reconnect, and conflict resolution.
- Make unsupported standards packages explicitly online-only.

Accept when offline and reconnect suites produce no lost progress or duplicate
completion/certificate, revoked users lose cached access, and sensitive
non-learner domains never enter the cache.

### Phase 4 production exit gate

- Author/reviewer separation and immutable version history pass for content and
  policies.
- Standards security and compatibility fixtures pass in an isolated runtime.
- Adaptive-path state machines and direct-call authorization tests pass.
- A 30-day learner pilot has zero duplicate completions, unresolved sync loss,
  protected-data cache leakage, or unauthorized publication.

## Phase 5 — Closed-loop compliance and evidence

- **Goal:** turn findings and resident operations into owned work, reproducible
  historical reporting, and tightly scoped external evidence access.
- **Sequence:** #7 → #20 and #21; #17 → #24.
- **Target:** 13–17 weeks with two squads; 20–26 weeks with one.

Historical snapshot collection for #17 begins as Phase 2 and Phase 3 domains
ship even though the complete reporting product is accepted here.

### P5.1 — #7 Add tracked remediation work

Deliver:

- Build a reusable work-item engine with source link, owner, watchers,
  priority, due date, state, dependencies, evidence, comments, approval,
  escalation, recurrence, and closure reason.
- Provide templates and automation for violations, inspections, incidents,
  training gaps, exclusion matches, credentials, policies, and rule exceptions.
- Enforce server-side transitions and facility/tenant scope.
- Add overdue dashboards, escalations, reassignment, workload metrics, and
  immutable history.

Accept when every configured source can create one deduplicated owned action,
deadlines escalate, closure requires its configured evidence, and no user can
see work outside their scope.

### P5.2 — #20 Add confidential frontline incident and near-miss intake

Deliver:

- Provide a minimal mobile-first report flow with save/resume, anonymous or
  identified modes where policy permits, attachments, immediate-danger routing,
  and confirmation.
- Separate reporter identity, investigation details, resident information,
  witness data, and broadly visible task metadata.
- Create triage, investigation, corrective action, review, closure, escalation,
  retention, and regulatory-deadline workflows on the work-item engine.
- Notify only permitted recipients and audit sensitive access, status changes,
  downloads, and disclosures.

Accept when confidentiality and facility-scope tests pass, urgent reports meet
the alert objective, deadlines create owned work, and no unrelated user can
infer protected report details.

### P5.3 — #21 Add a resident move-in collaboration workspace

Deliver:

- Create reusable move-in templates with owners, dependencies, due dates,
  documents, signatures, approvals, exceptions, comments, and completion rules.
- Offer tightly scoped designated-person/guest collaboration without exposing
  unrelated residents, employees, incidents, or facility records.
- Add reminders, missing-item escalation, document review, and a move-in
  readiness summary.
- Apply the upload, consent, audit, retention, and revocation contracts.

Accept when each move-in has a reproducible readiness state, guest access is
resident/task-specific and expiring, and revocation immediately blocks future
access.

### P5.4 — #17 Add saved reports, scheduled binders, and historical analytics

Deliver:

- Save versioned report definitions with filters, columns, audience, delivery,
  schedule, time zone, owner, retention, and entitlement.
- Generate reports and binders server-side from a recorded as-of time and
  immutable configuration.
- Store immutable snapshots and checksummed manifests; distinguish snapshots
  from live dashboards.
- Add historical compliance, qualification, delivery, schedule, remediation,
  incident, and policy trends using version-correct dimensions.
- Reconcile row counts and material totals before release or delivery.

Accept when rerunning the same snapshot definition and as-of point yields the
same included record set, totals reconcile to source queries, and large exports
stay within performance budgets.

### P5.5 — #24 Add an auditor evidence room

Deliver:

- Publish selected immutable report/binder snapshots into facility-scoped
  evidence collections; never expose live unrestricted queries.
- Issue non-enumerable, short-lived, revocable guest access with explicit
  artifact scope, expiration, terms, and optional step-up verification.
- Log every view, download, comment, share, denial, revocation, and artifact
  withdrawal.
- Add watermarking or export manifests, access review, expiration reminders,
  legal hold, and emergency revocation.

Accept when guest access cannot cross facility, resident, artifact, or tenant
scope; expired, revoked, suspended-tenant, and withdrawn-artifact tests fail
closed; and every external access is attributable.

### Phase 5 production exit gate

- Incidents and move-ins reliably produce owned, deadline-driven tasks with
  restricted access and approved retention behavior.
- Reports and binders reconcile to source data and remain reproducible from
  immutable snapshots.
- Evidence-room access is scoped, expiring, revocable, non-enumerable, and
  completely audited.
- A 30-day pilot has zero unauthorized guest access, cross-tenant disclosure,
  unexplained report variance, or lost workflow task.
- Backup/point-in-time recovery and a full application restore have been
  rehearsed, and an independent penetration test has no unresolved critical or
  high findings.

## Complete recommendation-to-phase crosswalk

| Original rank | Recommendation | Phase |
| ---: | --- | ---: |
| 1 | Atomic course completion and certificate issuance | 1 |
| 2 | Versioned and formally approved regulatory rule packs | 2 |
| 3 | Atomic exclusion-screening refreshes | 1 |
| 4 | Idempotent employee import and HRIS readiness | 3 |
| 5 | Proven notification delivery | 1 |
| 6 | Compliance-aware scheduling | 3 |
| 7 | Tracked remediation work | 5 |
| 8 | Complete, hardened audit trail | 1 |
| 9 | Operational control plane | 1 |
| 10 | Complete release-quality gate | 1 |
| 11 | Genuine offline learner mode | 4 |
| 12 | Configurable workforce compliance profiles | 2 |
| 13 | Effective-dated employee lifecycle | 2 |
| 14 | Competency records as certification lifecycles | 3 |
| 15 | Adaptive, sequenced learning paths | 4 |
| 16 | Governed tenant content studio | 4 |
| 17 | Saved reports, scheduled binders, and historical analytics | 5 |
| 18 | Employee scheduling self-service | 3 |
| 19 | Stronger instructor-led training operations | 3 |
| 20 | Confidential frontline incident and near-miss intake | 5 |
| 21 | Resident move-in collaboration workspace | 5 |
| 22 | Employee credential renewal with OCR assistance | 3 |
| 23 | Expanded policy lifecycle management | 4 |
| 24 | Auditor evidence room | 5 |
| 25 | Enterprise SSO, privileged-role MFA, and SCIM | 2 |
| 26 | Signed API/webhook integration hub | 2 |
| 27 | Portfolio/regional hierarchy and custom permissions | 2 |
| 28 | SCORM/xAPI/LTI runtime | 4 |
| 29 | Multilingual experience | **Excluded by request** |
| 30 | Billing and typed entitlements | 2 |

## Critical dependency chains

- #10 → #8/#9 → #1/#3/#5: release safety and instrumentation precede transactional and delivery changes.
- #27 → #13 → #12 → #2: tenant scope and employee state precede profile-driven rule assignment.
- #8/#5/#27 → #26: external integrations need durable events, delivery reliability, auditability, and correct scope.
- #13/#12/#2 → #14/#19/#22 → #6 → #18: scheduling must consume authoritative qualifications before self-service opens.
- #1/#14/#16/#28 → #15 → #11: stable outcomes and versioned content precede adaptive and offline execution.
- #7 → #20/#21: incident and move-in operations reuse the action engine.
- #17 → #24: the evidence room publishes immutable report artifacts, not ad hoc live data.
- #30 continues through Phases 3–5 as each capability receives a typed entitlement, even though foundational ownership is Phase 2.

## Migration, backfill, and rollback playbook

Apply this sequence to every data-model change:

1. **Expand:** add nullable columns or new tables, indexes, RLS, policies, and
   explicit grants without changing the current read path.
2. **Dual compatibility:** keep current and next app releases working; use
   idempotent dual writes or outbox projection where needed.
3. **Backfill:** run resumable batches outside the deploy transaction and record
   cursor, counts, checksums, timing, and structured errors.
4. **Validate:** reconcile business invariants, clear the exception queue, add
   and validate constraints, regenerate types, and rerun tenant tests.
5. **Switch:** enable the new read path for staff, then pilots, using shadow
   comparison where results affect compliance or access.
6. **Contract:** retire the old path only after a complete release cycle,
   observation window, reconciliation, and restore drill.

Prefer flag-off and a forward compensating migration over destructive down
migrations. External messages, webhooks, certificates, and invoices cannot be
rolled back; protect them with idempotency, durable outbox state, cancellation
where supported, and reconciliation.

Stop a rollout immediately for a tenant-isolation failure, unexplained
compliance-result difference, data loss, irreversible duplicate side effect,
or inability to disable the new path.

## Test and release matrix

Every pull request:

- Install the exact Node 24 and pnpm 11.13.0 toolchain with a frozen lockfile.
- Run pnpm run check:all.
- Reset a fresh local Supabase stack with the pinned CLI and run pgTAP.
- Run schema lint/advisors, regenerate database types, and fail on drift.
- Test explicit grants, RLS, privileged functions, Storage, and changed Edge
  Functions.
- Run affected state-machine, provider-contract, concurrency, browser,
  accessibility, security, and bundle tests.

Nightly or scheduled:

- Full role × tenant × facility × operation matrix.
- Date-boundary and property tests for rules, prerequisites, and entitlements.
- Replay/concurrency tests for completion, imports, schedules, notifications,
  webhooks, SCIM, and Stripe.
- Provider sandbox/contract tests using approved fixtures.
- Offline/reconnect/session-revocation browser tests.
- Large-tenant query-plan and latency regression tests.
- Background-job synthetic checks and reconciliation.
- Periodic isolated restore followed by the full smoke suite.

Production promotion:

1. Build immutable application and migration artifacts.
2. Restore an anonymized production-like snapshot to staging.
3. Rehearse migrations and backfills; record locks, duration, counts, and checksums.
4. Run the complete database, Edge, browser, provider, accessibility, security,
   and performance suites.
5. Obtain required security/privacy and independent compliance approval.
6. Deploy backwards-compatible schema, then code with the new path disabled.
7. Backfill, reconcile, and enable staff/demo users.
8. Promote to two or three named pilots, then 10%, 25%, 50%, and 100%.
9. Run synthetic journeys and reconciliation after each ring.

Observe at least 48 hours between low-risk rings and seven days between rings
for compliance, scheduling, identity, integration, or billing changes. Use a
full operating cycle for monthly behavior. A kill-switch drill is required
before each phase exits.

## Program metrics

Track these across all phases:

- Tenant-isolation test failures: target zero.
- Unexplained reconciliation variance: target zero before enforcement.
- Duplicate irreversible side effects: target zero.
- Scheduled-job success and freshness by criticality.
- Notification final-delivery, opt-out, and permanent-failure rates.
- Rule/profile exception count and age.
- Import duplicate/ambiguous/rejected counts.
- Schedule override and prevented-conflict rates.
- Offline sync backlog, age, conflict, and loss rate.
- Report/source reconciliation and evidence-room unauthorized-access attempts.
- Change failure rate, rollback/kill-switch time, and Sev-1/Sev-2 escape rate.

## Principal risks and controls

| Risk | Control and stop condition |
| --- | --- |
| Incorrect regulatory logic | Source and independently approve every enforceable version; unexplained shadow variance stops activation. |
| Cross-tenant disclosure | Direct REST/RPC/Storage negative tests are release blockers; any failure stops rollout. |
| Migration or backfill loss | Expand/contract, resumable batches, reconciliation, and tested restore; unexplained variance blocks switching. |
| Duplicate asynchronous effects | Idempotency keys, uniqueness constraints, outbox state, replay tests, and operator reconciliation. |
| Offline sensitive-data exposure | Strict cache allowlist, encryption, wipe/revocation tests, and no resident/incident/credential/evidence data offline. |
| Malicious learning package | Archive validation, isolated origin/frame, restrictive CSP, size limits, and hostile-package corpus. |
| Identity lockout or takeover | Verified domains, safe linking, staged IdP pilots, MFA, break glass, and reversible SCIM deactivation. |
| Billing/entitlement race | Signed idempotent events, shadow entitlements, reconciliation, grace states, and an independent kill switch. |
| Provider outage or cost surge | Timeouts, retry budgets, queues, circuit breakers, spend limits, and documented manual operation. |
| RLS performance regression | Large-tenant datasets, plan checks, indexes, and per-route latency budgets before each cohort grows. |
| Evidence integrity gap | Append-only history, immutable snapshots, correlation, retention, and checksummed exports. |
| Scope overload | Fixed phase exit gates; unfinished gates block promotion even if a feature UI appears complete. |

## Current official implementation references

- [Supabase breaking changes](https://supabase.com/changelog?tags=breaking-change)
- [Supabase Queues API](https://supabase.com/docs/guides/queues/api)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase SAML SSO](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)
- [Twilio outbound status callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)
- [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Stripe subscription implementation](https://docs.stripe.com/billing/subscriptions/build-subscriptions)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe SaaS and customer portal](https://docs.stripe.com/saas)

These references should be rechecked at the start of the phase that uses them.
Provider behavior, security guidance, and product availability can change
during a multi-year program.
