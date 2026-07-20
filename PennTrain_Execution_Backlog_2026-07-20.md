# PennTrain execution backlog

**Repository:** `kdeyarmin/PennTrain`<br>
**Source review:** `main` at `e027aef3a1fbafc4c6449a1d7dbe8358f8e4dc74`<br>
**Prepared:** July 20, 2026<br>
**Companion:** `PennTrain_Comprehensive_Review_2026-07-20.md`

This document converts the review into GitHub-issue-ready work. It does not assert that every capability is enabled in production; rollout gates are stated explicitly. No issues were created and no repository source was changed.

For compactness in issue evidence, paths beginning with `src/` are beneath `artifacts/caremetric-carebase/`; all other paths are repository-relative.

## Triage rules

- **P0 — release blocker:** resolve before a broader pilot, or before enabling the affected capability.
- **P1 — pilot/next-release gate:** material reliability, privacy, identity, or workflow-completion work.
- **P2 — scale/productization:** worthwhile after the trust boundary and core workflows are stable.
- **Confirmed:** directly demonstrated by latest-state source/schema control flow.
- **Conditional:** the code defect is concrete, but live impact depends on deployment configuration or feature activation.
- **Test-required inference:** static evidence is strong, but a production-like runtime test should be the final proof.

Effort is relative: **S** is approximately 1–3 engineering days, **M** is 4–8 days, **L** is 2–4 weeks, and **XL** should be split into an epic. These are planning ranges, not commitments.

## Release-decision matrix

| ID | Decision | Confidence | Exposure / activation condition | Effort |
|---|---|---|---|---:|
| PT-001 | Block broad pilot | Confirmed | Any authenticated user with another organization UUID | M |
| PT-002 | Block paid billing activation | Confirmed parser drift; live impact conditional | Stripe endpoint on the documented current API version | M |
| PT-003 | Block eMAR rollout | Confirmed | Any `medication.snapshot.import` through the public integration API | S–M |
| PT-004 | Treat dependency CI result as untrusted until fixed | Confirmed | Every build using the current lockfile scanner | S |
| PT-005 | Block expanded external notification delivery | Confirmed path; conditional on channel activation | Email, SMS, or push enabled for handoff types | S–M |
| PT-006 | Block claims of complete/expiring tenant export | Confirmed | Organization export enabled or marketed as complete | L/epic |
| PT-007 | Keep default-off features pilot-only | Operational evidence gap | Any capability without a completed pilot manifest | Cross-functional |
| PT-008 | Block SCIM-based deprovisioning claims | Confirmed | SCIM subject later obtains a CareBase login | M–L |
| PT-009 | Block dependable-offline claim | Confirmed lifecycle defects; cold-start route needs runtime proof | PWA learner downloads, restarts, switches account, or has pending progress | L |
| PT-010 | Do not promise staff responses in the guest portal | Confirmed | Designated person submits a request or schedule response | M |
| PT-011 | Treat badges/Today summaries as eventually consistent | Confirmed | Notification or alert arrives while user is elsewhere in the app | S–M |
| PT-012 | Do not call print/CSV a stable full-report record | Confirmed | More than 100 rows or concurrent report changes | M–L |

## Recommended dependency order

1. **Restore trust in controls:** PT-001, PT-004, PT-005, PT-015, PT-034.
2. **Repair rollout-specific contracts:** PT-002 durable ingest → PT-002 versioned parsing; PT-003; PT-006A; PT-008.
3. **Make critical experiences durable:** PT-009, PT-011, PT-012, PT-016.
4. **Complete connected workflows:** PT-010, PT-013, PT-014, PT-017.
5. **Prove and promote:** PT-007 after the applicable blockers pass; then PT-018 and the P2 productization queue.

PT-006 is intentionally split: the cron/auth and labeling correction is a small blocking issue; the complete, verifiable export pipeline is a larger epic.

---

## Milestone M0 — Restore release trust

### PT-001 — Tenant-bind administrator qualifications and document paths

**Labels:** `priority:P0`, `area:security`, `area:database`, `tenant-isolation`<br>
**Outcome:** an authenticated user can manage only an administrator qualification that belongs to the same profile and active organization, and can store documents only beneath that exact tenant/profile path.

**Evidence**

- Self-service insert/update checks `profile_id = auth.uid()` without binding `organization_id`: `supabase/migrations/20260705162010_administrator_qualification_rls.sql:14-28`.
- The table has independent organization/profile foreign keys and no consistency invariant: `20260705161957_administrator_qualification_core.sql:4-7`.
- Storage self-service validates path segment two but not tenant segment one: `20260705162022_administrator_documents_storage_bucket.sql:7-38`.
- The client constructs `{organizationId}/{profileId}/...` from supplied values: `artifacts/caremetric-carebase/src/hooks/useAdministratorProfiles.ts:116-123`.

**Implementation slice**

1. Add a corrective migration; do not edit historical migrations.
2. Preflight existing row/object mismatches and quarantine them for explicit review rather than silently deleting or reassociating evidence.
3. Enforce profile/organization consistency at the database boundary, preferably with a composite invariant or validation trigger that alternate clients cannot bypass.
4. Make profile and tenant scope immutable after creation except through a privileged, audited repair RPC.
5. Replace insert/update policies so self-service requires the caller's active profile, current organization, and the product-approved administrator role/status. The current product model appears to mean `facility_manager`; confirm that rule before migration.
6. Bind both Storage path segments to the authorized row and reject upload, read/signing, move, overwrite, or delete across either tenant or profile.

**Acceptance criteria**

- A user cannot insert a qualification with their profile ID and another organization's ID.
- A user cannot update an existing row into another organization.
- A user cannot upload, move, or overwrite an object under another organization's prefix.
- Authorized organization administrators/auditors retain intended read access; authorized self-service remains functional.
- Existing mismatches are reported without silently reassociating compliance evidence.
- The corrective migration is reversible or has an explicit rollback procedure.

**Automated verification**

- pgTAP negative tests for cross-tenant insert, update, and select plus employee/non-administrator self-service.
- Direct Storage tests for malformed/victim prefixes, upload, signed URL, move, overwrite, and delete.
- Positive tests for same-tenant self-service and organization-admin/auditor reads.
- A latest-state policy test, not a test that invokes an older function definition directly.

**Preconditions / dependency / effort:** exploitation requires any active account, direct PostgREST/Storage access, and a known/guessed victim organization UUID. Confirm the intended administrator role; otherwise independent. **M**. This should be the first merged ticket.

### PT-002 — Version, parse, and durably process Stripe webhook events

**Labels:** `priority:P0`, `area:billing`, `area:edge-functions`, `reliability`<br>
**Outcome:** every accepted Stripe event is tied to a declared API version, stored durably, parsed using that version's object shape, and safely replayable.

**Evidence**

- Outbound billing pins `2026-02-25.clover`: `supabase/functions/_shared/phase2Billing.ts:1,92-104`.
- SQL reads removed top-level subscription period fields and the old invoice subscription field: `supabase/migrations/20260711200648_phase2_billing_and_entitlements.sql:956-978,1043-1047`.
- Tests use the old payload shape: `supabase/tests/phase2_billing_integration.test.sql:162-174,225-230`.
- `event.api_version` is not enforced or recorded by `supabase/functions/stripe-billing-webhook/index.ts:33-44`.
- Receipt insertion and canonical mutation share one transaction even though the receipt models failed processing: migration lines `337-350,809-858`.

Stripe's current-version changes are documented in its official [subscription period](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) and [invoice parent](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects) changelogs.

**Implementation slice**

Split this into two PR-sized child issues and land durable ingest first:

1. **PT-002A — Durable ingest/replay:** record `event.id`, type, creation time, API version, payload checksum, verification result, receipt time, attempt count, lease, next attempt, and safe failure class before applying billing state. Apply through an idempotent claim/retry/dead-letter worker that can reclaim abandoned `processing` receipts.
2. **PT-002B — Versioned normalization:** declare the endpoint API version in deployment configuration; normalize provider JSON into an internal versioned DTO; parse current per-item subscription periods and invoice parent provenance; define mixed-item and authoritative seat-price semantics. Unsupported versions must be durably rejected, not silently coerced.
3. Add an operator reconciliation action that can safely reprocess a verified failed event and alert on receipt/application drift.

**Acceptance criteria**

- A captured fixture from the configured API version stores correct period and invoice linkage.
- Missing, unexpected, or unsupported `event.api_version` follows an explicit reject/quarantine policy.
- A forced application failure leaves a durable verified receipt with `failed` status.
- Replaying the same event cannot duplicate subscription, invoice, entitlement, or ledger state.
- Reusing an event ID with a different payload hash is terminal, visible, and cannot overwrite the canonical receipt.
- A worker abandoned after claiming an event can be reclaimed without double application.
- Stale events cannot overwrite newer canonical state.
- Operations can list, inspect, retry, and reconcile failed receipts without raw sensitive payloads in UI logs.

**Automated verification**

- Handler tests for signature failure, unsupported API version, duplicate event, stale event, and forced DB failure.
- Database fixtures for current subscription, invoice, cancellation, trial, mixed item period, and out-of-order events.
- Stripe test-mode smoke test before enabling a paid cohort.

**Dependency / effort:** PT-002A precedes PT-002B so parser failures are durable; **M + M**. Billing UX work in PT-014 depends on both.

### PT-003 — Drive integration versions and scopes from a shared command registry

**Labels:** `priority:P0`, `area:integrations`, `area:medications`, `area:edge-functions`<br>
**Outcome:** a least-privilege `medications:write` credential can submit the registered medication snapshot version through the public Edge gateway, while every command remains version-, tenant-, signature-, and replay-safe.

**Evidence**

- The Edge gateway requires `commands:write` and only `2026-07-11`: `supabase/functions/integration-api/index.ts:35-42,96-104`; `_shared/phase2Integration.ts:1`.
- The medication contract registers `medication.snapshot.import`, `2026-07-14`, and `medications:write`: `supabase/migrations/20260714210309_medication_integration_boundary.sql:6-49`.
- The UI directs admins to the medication-specific scope: `artifacts/caremetric-carebase/src/pages/app/MedicationIntegration.tsx:134,144`.
- The current database test bypasses Edge and calls the RPC as service role: `supabase/tests/carebase_remediation_plan.test.sql:168-174`.

**Implementation slice**

1. Authenticate the credential, then resolve command type to allowed schema versions and required scopes from one shared registry.
2. Keep atomic database validation authoritative for tenant, command, idempotency, and scope.
3. Remove the gateway-wide `commands:write` assumption; do not weaken unrelated commands.
4. Add a thin Edge-to-database contract test with an actual medication-only credential.

**Acceptance criteria**

- A valid `2026-07-14` medication snapshot with only `medications:write` succeeds end to end.
- Wrong version, wrong scope, cross-tenant credential, bad signature, expired timestamp, and replay fail with stable safe errors.
- Existing command types retain their declared version/scope behavior.
- The UI displays the same version and scope returned by the registry, not duplicated constants.

**Automated verification:** handler plus pgTAP tests for success and each negative case; one deployed staging smoke request with no service-role bypass.

**Dependency / effort:** independent; **S–M**.

### PT-004 — Replace the regex lockfile scanner with a structural dependency audit

**Labels:** `priority:P0`, `area:ci`, `dependencies`, `good-first-hardening`<br>
**Outcome:** CI audits every resolved dependency represented in the pnpm lockfile and fails when parser coverage drops.

**Evidence:** `scripts/check-dependencies.mjs:35` recognizes quoted lockfile keys only. At the reviewed commit it parsed 226 of 619 `packages:` entries and skipped 393, including `react`, `vite`, `vitest`, and `esbuild`; `.github/workflows/ci.yml:37-38` treats the output as the vulnerability gate.

**Implementation slice**

1. Parse `pnpm-lock.yaml` structurally with a maintained YAML/pnpm-lockfile library.
2. Normalize scoped/unscoped packages, peer suffixes, git/tarball sources, and duplicate versions.
3. Emit total entries, unique package/version pairs, audited count, skipped-with-reason count, and advisory source.
4. Fail closed on malformed input, network/advisory failure, or an unexpected coverage drop.
5. Bring Deno/JSR/npm URL imports used by Edge Functions into a separate pinned inventory; do not imply pnpm coverage includes them.

**Acceptance criteria**

- The fixture suite covers quoted/unquoted, scoped/unscoped, peer-suffixed, and non-registry entries.
- The real-lockfile test asserts the expected inventory within an intentionally updated snapshot.
- CI cannot report “no vulnerabilities” after parsing zero or a partial unacknowledged inventory.
- Output distinguishes “no applicable advisory,” “not auditable by this source,” and “scanner failed.”

**Automated verification:** unit fixtures; real-lockfile coverage snapshot; simulated advisory/network/parser failure tests.

**Dependency / effort:** independent; **S**.

### PT-005 — Make external notification content generic by default

**Labels:** `priority:P0`, `area:privacy`, `area:notifications`, `resident-data`<br>
**Outcome:** email, SMS, and push never contain free-form resident/employee operational narrative unless a specifically reviewed template and policy allow it.

**Evidence**

- Shift reports can contain resident-linked condition, fall, treatment, behavior, and skin concerns: `supabase/migrations/20260714093000_daily_facility_operations_workforce.sql:33-49`.
- Handoff assignment/escalation copies narrative into notification body: `20260714202956_shift_handoff_lifecycle.sql:104-107,248-250`.
- Those types are externally eligible: `20260715215810_complete_product_experience_roadmap.sql:1512-1523`.
- The renderer sanitizes only three named types, then falls back to original title/body: `supabase/functions/_shared/notificationDelivery.ts:155-184`.

**Implementation slice**

1. Reverse the renderer contract: generic authenticated-action copy is the default.
2. Maintain a reviewed allowlist of provider-safe templates and property keys.
3. Keep sensitive detail behind an authenticated deep link; scrub lock-screen preview text.
4. Add a build-time/test-time enumeration tying externally eligible event types to an approved renderer.

**Acceptance criteria**

- Every externally eligible type has either a reviewed safe template or is blocked from external delivery.
- Unknown/new types fail closed to generic copy.
- Handoff narratives, resident identifiers, room numbers, employee notes, and user-supplied strings are absent from provider payloads and dispatch logs.
- In-app notifications retain authorized useful context.

**Automated verification:** table-driven renderer tests across every eligible type, adversarial narrative strings, provider payload snapshots, and a migration/renderer drift test.

**Dependency / effort:** independent; **S–M**.

### PT-006A — Correct organization-export cron authentication and product labeling

**Labels:** `priority:P0`, `area:exports`, `area:cron`, `documentation`<br>
**Outcome:** scheduled processing fails closed with the documented secret, while UI/documentation accurately describes current export coverage and expiry.

**Evidence**

- Deployment creates Vault key `cron_shared_secret`: `DEPLOYMENT.md:79-82`.
- Export cron reads uppercase `CRON_SHARED_SECRET` and falls back to a literal development secret: `supabase/migrations/20260715215810_complete_product_experience_roadmap.sql:1763-1776`.
- The worker validates its environment secret: `supabase/functions/_shared/cronAuth.ts:41-55`.

**Acceptance criteria**

- A new corrective migration reads the documented Vault key; missing configuration produces no request and an observable failed health check.
- No production SQL contains a usable development-secret fallback.
- A deployment smoke test creates, claims, and completes one small export job.
- Until PT-006B is complete, the UI says “partial/beta export,” names omitted classes of data/documents, and distinguishes job expiry from actual object deletion.

**Automated verification:** Vault-present, Vault-missing, wrong-secret, and successful worker tests; copy assertion in the relevant browser journey.

**Dependency / effort:** precedes PT-006B and PT-007; **S**.

### PT-006B — Build a versioned, complete, verifiable tenant export pipeline

**Labels:** `priority:P0`, `area:exports`, `epic`, `data-portability`<br>
**Outcome:** a tenant export has a declared schema graph, stable snapshot/watermark, complete related rows and files, reconciled counts/checksums, bounded processing, and enforced deletion.

**Why this is an epic:** the current worker discovers only direct `organization_id` tables, omits tenant-owned child tables, stores short-lived document URLs rather than binaries, performs separate offset pages without a stable snapshot, buffers ZIP data in memory, and does not bind object access/deletion to represented expiry (`20260715215810_complete_product_experience_roadmap.sql:534-614,764-829`; `supabase/functions/process-organization-export-jobs/index.ts:120-185`).

**Suggested child issues**

1. Define and review a versioned tenant data/file ownership graph.
2. Add schema drift/coverage tests for every tenant-owned table and Storage bucket.
3. Generate against a stable as-of watermark using keyset/cursor semantics.
4. Include document binaries or a durable, explicitly separate transfer mechanism.
5. Stream/chunk generation within runtime budgets; implement retries and dead-letter state.
6. Emit manifest version, per-entity/file counts, hashes, omissions, watermark, and final archive checksum.
7. Make authorization expiry-aware and schedule verified object deletion.
8. Add download verification and isolated restore/reconciliation tests.

**Epic acceptance criteria**

- A seeded representative tenant export reconciles expected rows and files exactly.
- Concurrent writes do not cause duplicates or omissions in the declared snapshot.
- A large-tenant fixture completes within documented memory/time limits or is processed by an architecture intended for longer work.
- Downloaded archive and manifest hashes verify; a corrupted or incomplete artifact is never marked ready.
- Expired jobs cannot mint a signed URL; the object is deleted and deletion status is visible.
- Restore testing demonstrates how the archive is consumed and which records are intentionally excluded.

**Dependency / effort:** PT-006A first; **XL**, split into child tickets.

### PT-007 — Execute the controlled pilot and publish release provenance

**Labels:** `priority:P0`, `area:release`, `pilot`, `cross-functional`<br>
**Outcome:** default-off capabilities are promoted only after a signed, reproducible evidence package meets explicit tenant, privacy, reliability, and recovery exit criteria.

**Evidence:** `CONTROLLED_PILOT_RUNBOOK.md` requires a complete evidence manifest; `pilot/controlled-pilot.template.json` remains a blank template with placeholder failures. The repository alone therefore proves code presence, not production fitness.

**Implementation slice**

1. Choose representative PCH/ALF tenants and name accountable product, clinical/compliance, privacy/security, and engineering approvers.
2. Record the exact commit, migration ledger/checksums, Edge versions, feature flags, provider API versions, and deployment configuration hashes.
3. Run 14–30 days with predeclared metrics and rollback thresholds.
4. Exercise tenant-negative tests, notification privacy, export/binder reconciliation, offline recovery, billing/integration contracts as applicable, and an isolated restore.
5. Store sensitive evidence outside the repository; commit only a redacted signed decision/manifest reference.
6. Tag the approved release and produce human-readable release notes.

**Acceptance criteria**

- Every promoted capability has evidence, owner, pass/fail result, exceptions, and rollback decision.
- No failed or unevaluated mandatory check is silently waived.
- The deployed SHA/artifact and database migration manifest are recoverable from the decision record.
- Support volume, completion success, notification delivery, false-positive/negative compliance outcomes, and recovery results meet declared thresholds.

**Dependency / effort:** depends on every ticket relevant to the pilot cohort; cross-functional rather than a code estimate.

---

## Milestone M1 — Identity, durability, and truthful output

### PT-008 — Authoritatively reconcile SCIM, SSO, employee, and login identities

**Labels:** `priority:P1`, `area:identity`, `area:scim`, `security`<br>
**Outcome:** a SCIM-managed subject that obtains a login is deterministically bound to it, and suspension/deprovision reliably revokes sessions and access without cross-person matches.

**Evidence**

- `scim_subject_links.profile_id` is nullable: `supabase/migrations/20260711200637_phase2_regulatory_rules_and_identity.sql:365-383`.
- SCIM create inserts employee/link without a profile: lines `2107-2122`.
- Deactivation/session revocation is conditional on the nullable link: lines `2195-2219`.
- The test manually patches links before asserting revocation: `supabase/tests/phase2_rules_identity.test.sql:569-611`.

**Implementation slice**

1. Define explicit SCIM-connection ↔ SSO-connection binding plus the authoritative provider subject/external-directory key; do not rely on unauthoritative email matching and never match across organizations.
2. On first SSO login, allow JIT-disabled access only for an active pre-provisioned SCIM subject, then atomically create/link profile, employee, SCIM subject, and SSO subject.
3. Fail closed and queue manual reconciliation when identity evidence is absent, inconsistent, or ambiguous.
4. Backfill/reconcile existing unbound links with an auditable dry-run/report mode.
5. Make suspend/deprovision idempotently disable employee/profile, revoke sessions/tokens, terminate workforce access, and record partial failures for retry.

**Acceptance criteria**

- The full SCIM create → login/JIT → suspend/deprovision → session revocation flow passes without test-only SQL patches.
- With JIT disabled, a valid pre-provisioned subject can log in and an unprovisioned subject cannot.
- Mismatched provider subject, ambiguous mapping, renamed/duplicate email, cross-tenant same email, concurrent first login, and rehire cases have explicit tested outcomes.
- A deprovision retry is safe and converges after an injected Auth failure.
- Operators can see unbound/ambiguous subjects and remediation history without raw secrets.

**Dependency / effort:** identity rollout gate; **M–L**.

### PT-009 — Make offline learning identity-safe, reachable, and no-data-loss

**Labels:** `priority:P1`, `area:pwa`, `area:learning`, `offline`, `reliability`<br>
**Outcome:** a learner who deliberately downloads supported content can open it after a cold offline restart, cannot see another user's metadata, and cannot silently delete unsynced progress.

**Evidence**

- `shouldWipeOfflineData` detects identity/tenant/status changes but is unused outside tests: `artifacts/caremetric-carebase/src/lib/offlineLearning.ts:47-49`; sign-out does not clear the offline IndexedDB database: `src/lib/auth.tsx:270-318,337-353`.
- Bundle metadata remains plaintext and the library lists bundles before identity validation: `src/lib/offlineCourseCache.ts:10-20,111-115`; `src/hooks/useOfflineLearning.ts:12-18`.
- Network failure during profile fetch triggers sign-out: `src/lib/auth.tsx:232-245,270-284`.
- The protected offline route is lazy, Workbox lacks an app-shell navigation fallback, and download does not prefetch the route chunk: `src/App.tsx:155,841-842`; `vite.config.ts:76-120`; `src/hooks/useOfflineLearning.ts:84-112`.
- Remove/wipe deletes bundle and checkpoint without a pending-progress guard: `src/pages/app/MyCourses.tsx:134-136`; `src/lib/offlineCourseCache.ts:65-71,131-139,185-187`.
- Video, PDF/SCORM, and quizzes have material offline limitations shown only after download: `src/pages/app/OfflineCourse.tsx:124-130`.

**Implementation slice**

1. Persist a minimal device-bound offline authorization envelope with explicit expiry/revocation semantics.
2. Distinguish network-unreachable from confirmed inactive/invalid profile; never silently broaden authorization.
3. Validate identity before listing metadata; invoke a local wipe on logout/account/tenant/role/inactive changes.
4. Local wipe must succeed offline; queue remote device revocation separately.
5. Prefetch the app shell and offline-player chunk as part of successful download.
6. Track pending progress centrally, retry on reconnect, and offer “sync then remove”; require explicit confirmation for destructive fallback.
7. Preflight each course and label full/partial/unavailable offline coverage before download.

**Acceptance criteria**

- Fresh install → download → never open offline route → terminate app → disable network → open course succeeds for supported content.
- A network outage alone does not sign out or erase a still-valid offline session.
- Logout and account/tenant switch remove prior-user metadata/ciphertext before the next library render.
- Pending progress cannot be silently deleted; reconnect sync is idempotent and visible.
- “Wipe this device” clears local data without network access and later reconciles remote revocation.
- UI accurately counts unsupported lessons/assets before download.

**Automated verification:** production-build Playwright PWA project with Chromium plus one WebKit/iPhone smoke; IndexedDB assertions for identity switch, pending sync, wipe, cold route, revoked/expired envelope, and reconnect conflict.

**Success metric:** ≥99% successful open rate for eligible downloaded courses; zero silent pending-progress loss in test/telemetry; measured sync retry/recovery rate.

**Dependency / effort:** benefits from PT-016 production-server/PWA test harness; **L**.

### PT-011 — Mount one authenticated Realtime freshness layer

**Labels:** `priority:P1`, `area:realtime`, `area:notifications`, `frontend-platform`<br>
**Outcome:** notification badges and critical-alert summaries update promptly anywhere in the authenticated app and recover predictably after disconnect.

**Evidence:** the database publishes notifications to Realtime (`20260717015547_enforce_notification_operations_and_realtime.sql:8-20`), but `src/hooks/useNotifications.ts:15-44` only polls every five minutes. Alert Realtime exists in `src/hooks/useAlerts.ts:77-100` but is mounted only on `src/pages/app/Alerts.tsx:82`; Today reads a non-polling query at `src/pages/app/Today.tsx:61-68`.

**Implementation slice**

1. Mount one organization/profile-scoped channel in the authenticated layout.
2. Invalidate bounded notification, alert, badge, and Today summary query keys centrally.
3. Expose connecting/live/degraded state and retain focus plus low-frequency polling fallback.
4. Deduplicate channels during route changes and close them on logout/tenant change.

**Acceptance criteria**

- A new notification and critical alert update visible badges/Today within a declared latency target without visiting their pages.
- Disconnect/reconnect catches up without duplicate subscriptions or missed durable records.
- Organization/account change cannot leak invalidations or data from the previous scope.
- Degraded state is diagnosable and fallback polling remains bounded.

**Automated verification:** component tests for invalidation routing; browser tests for insert-to-badge latency, route changes, reconnect, duplicate prevention, and logout.

**Dependency / effort:** shared frontend primitive; **S–M**. PT-010 should consume it.

### PT-012 — Produce stable, safe, explicitly scoped report outputs

**Labels:** `priority:P1`, `area:reporting`, `data-integrity`, `accessibility`<br>
**Outcome:** users always know whether output is one page or the full report; full exports represent a stable as-of dataset and cannot execute spreadsheet formulas.

**Evidence**

- Report view fetches 100 rows and Print prints only current DOM: `src/pages/app/Reports.tsx:608-615,799-819`; `src/components/reports/ReportViewer.tsx:49-51,129-212`.
- CSV drains independent offset pages without a watermark/snapshot: `Reports.tsx:635-664`; `20260717024529_generate_paged_compliance_reports.sql:67-88`.
- Multiple frontend CSV paths lack complete formula neutralization; the organization-export worker already has a stronger encoder: `supabase/functions/process-organization-export-jobs/index.ts:31-44`.
- Report cards use parent `role="button"` keyboard semantics around child buttons: `Reports.tsx:1072-1084,1111-1143`.

**Implementation slice**

1. Immediately rename current behavior “Print this page” and display included/total count.
2. Centralize a tested CSV cell encoder that neutralizes leading whitespace plus `=`, `+`, `-`, `@`, tab, and carriage return while preserving valid values.
3. Replace offset-drained full CSV/print with a server job or stable cursor/as-of receipt, final count, and checksum.
4. Generate an accessible full-report PDF/print artifact or explicitly limit supported formats.
5. Remove nested interactive card semantics and keep dedicated View/CSV/Schedule controls.
6. Emit a server-verifiable `report_exported` event so Customer Value metrics reflect actual successful full exports.

**Acceptance criteria**

- A 5,000-row report either prints all 5,000 stable rows or is unmistakably labeled as a 100-row page.
- Concurrent insert/update fixtures produce no duplicates or omissions in a declared full-export snapshot.
- Output includes report/version, filters, facility scope, as-of time, row count, checksum, and partial/failure state.
- Formula payload fixtures open as literal text in supported spreadsheet applications.
- View/CSV/Schedule controls have correct keyboard and screen-reader behavior.
- Failed or canceled exports do not increment successful export value metrics.

**Automated verification:** encoder unit matrix; stable-export database/worker tests; large-report and concurrent-write fixtures; Playwright keyboard/print-label journey; reconciliation test for telemetry receipt.

**Dependency / effort:** reuse PT-006B patterns where sensible; **M–L**.

### PT-015 — Make released migration history immutable and test upgrades

**Labels:** `priority:P1`, `area:database`, `area:ci`, `release-integrity`<br>
**Outcome:** changing an already released migration fails CI; schema changes use a new corrective migration; a long-lived environment upgrade is tested in addition to a clean reset.

**Evidence:** CI performs only a fresh reset at `.github/workflows/ci.yml:78-87`; `scripts/check-source-integrity.mjs:15-36` has no migration provenance check. Git history includes changes to already-landed migration versions, while hosted databases record only that the timestamp ran.

**Implementation slice**

1. Define the release boundary and check in a SHA-256 manifest for immutable migration files.
2. Fail CI when a released version changes, disappears, or is reordered; require a new migration.
3. Generate/verify the manifest as part of tagged release provenance.
4. Add an upgrade-path database job from the prior release snapshot, including generated type drift and pgTAP.

**Acceptance criteria**

- A fixture editing one immutable migration fails with a clear corrective-migration message.
- Adding a new migration updates only the allowed manifest portion through an explicit release workflow.
- Clean reset and prior-release upgrade produce the same expected latest schema checksums/invariants.
- Emergency exception policy, ownership, and audit trail are documented.

**Dependency / effort:** do before PT-007 evidence is signed; **S–M**.

### PT-016 — Test and deploy the production artifact with end-to-end support references

**Labels:** `priority:P1`, `area:ci`, `area:observability`, `area:edge-functions`<br>
**Outcome:** the Node server and the exact built artifact that passed CI are what gets promoted, and one safe correlation ID joins browser, Edge, audit, and job evidence.

**Evidence**

- Browser CI starts Vite preview rather than the custom production Node server: `artifacts/caremetric-carebase/playwright.config.ts:22-26`; package scripts distinguish `serve` and `start`.
- CI uploads `dist`, but Railway independently rebuilds from source: `.github/workflows/ci.yml:43-49`; `railway.json:3-5`.
- Client reporting creates a fresh ID after a failure instead of propagating the request ID: `src/lib/clientErrorReporting.ts:47-62`.
- Only 3 of 50 deployed handlers are required to have runtime tests: `scripts/check-edge-functions.mjs:84-96`.

**Implementation slice**

1. Add production-server contract tests for security headers, compression, base path, stale assets, `/health`, SPA fallback, and true 404 behavior.
2. Run a small Playwright project against `pnpm start`, including PWA behavior.
3. Publish an immutable SHA-addressed artifact/image after all app/database/security jobs pass; promote that artifact without rebuilding.
4. Put release SHA, migration manifest ID, and build timestamp in safe health/platform status.
5. Centralize authenticated Edge invocation so a validated correlation ID is sent and returned; propagate it through structured Edge logs, audit/job receipts, and safe UI support messages.
6. Raise handler-runtime coverage by risk: identity, cron, Stripe/provider webhooks, notification dispatch, export, and integration API first.

**Acceptance criteria**

- A release can be traced from tag → CI run → artifact digest → deployed health response.
- Production server regressions fail CI even when Vite preview would pass.
- One failing browser action surfaces the same safe support reference in client evidence and Edge/job logs.
- Correlation input is format/length constrained and cannot inject log content.
- High-risk handler matrix covers authentication, malformed/bounded body, idempotency/replay, timeout, safe error, and dependency failure.

**Dependency / effort:** platform epic; first useful slice **M**, full handler expansion **L**.

### PT-034 — Declare and preflight every Edge runtime configuration value

**Labels:** `priority:P1`, `area:edge-functions`, `area:release`, `configuration`, `reliability`<br>
**Outcome:** an environment cannot promote Edge Functions when required configuration is absent, malformed, inconsistent, or undocumented; operators receive a redacted configuration contract without secret values.

**Evidence:** latest-state static inventory found 168 direct `Deno.env.get(...)` reads across 48 TypeScript files and 35 distinct literal names. Sixteen of those names are not mentioned in `DEPLOYMENT.md`, including billing/webhook, notification callback/hash, signup/demo rate-control, and SAM.gov settings. Some values are intentionally optional, but that required/optional/default distinction is encoded separately in each handler rather than one deployable contract.

**Implementation slice**

1. Add a versioned typed manifest declaring each value's owning function(s), required/optional status by environment, secret/non-secret class, format/range, safe default policy, and cross-field dependencies.
2. Centralize parsing helpers that return typed configuration and fail with a safe stable code; never use non-null assertions for required secrets.
3. Add a static check that every literal and approved dynamic environment read is declared, and that stale manifest entries are flagged.
4. Add a pre-deploy command that checks presence and validation against the target environment without printing values; produce a signed/redacted result for PT-007 provenance.
5. Keep platform-injected Supabase values distinct from operator-managed secrets and document rotation/rollback ownership.

**Acceptance criteria**

- Removing or corrupting any required target-environment value blocks promotion before traffic reaches the function.
- Optional values have explicit behavior and cannot silently fall back to a production-unsafe default.
- Adding a new `Deno.env.get` read without a manifest declaration fails CI.
- The preflight output contains names, classification, validation result, manifest version, and target—not secret content.
- Cross-field rules are tested, including paired VAPID keys, Twilio sender choice, Stripe secret/webhook version, allowed return origins, and cron secret presence.

**Dependency / effort:** supports PT-002, PT-005, PT-006A, PT-007, PT-016, and PT-026; **M**.

---

## Milestone M2 — Complete connected workflows

### PT-010 — Add a staff inbox for designated-person requests and schedule responses

**Labels:** `priority:P1`, `area:resident-portal`, `workflow`, `feature`<br>
**User outcome:** a designated person can submit a routine request or schedule response, see acknowledgment and resolution, and receive a facility reply; staff can own and complete the work without leaving CareBase.

**Evidence:** guest submission is implemented in `src/pages/public/ResidentDesignatedPersonPortal.tsx:102,110`. Schema has status, assignee, response, and queue indexes (`20260716160000_product_value_operating_system.sql:1262-1292`), but authenticated access is select-only and there is no management RPC; `src/hooks/useResidentPortal.ts:74-94` and `src/components/residents/ResidentPortalWorkspace.tsx:159-177` omit the inbox.

**MVP scope**

1. Facility-scoped queue with New/Acknowledged/In progress/Waiting/Resolved/Closed states.
2. Exact request deep link, assignee, due/SLA, priority, unread/overdue badges, and permission-checked transitions.
3. Append-only public-safe response history and internal notes kept strictly separate.
4. Schedule responses route to a reconciliation action rather than a generic request state only.
5. Guest portal shows submitted time, status, latest facility response, and closure.
6. Realtime/fallback freshness through PT-011.

**Non-goals for MVP:** broad family social messaging, clinical advice, or exposing internal resident records.

**Acceptance criteria**

- Staff can acknowledge, assign, respond, resolve, reopen, and close with an audited transition history.
- Only authorized staff in the request's organization/facility can see or mutate it.
- Internal notes never appear in guest payloads or external notifications.
- Notifications deep-link to the exact request and do not expose sensitive detail externally.
- Schedule replies record a reconciled outcome or explicit no-change decision.
- Guest refresh/reconnect shows a consistent public state without leaking staff identity beyond the chosen display policy.

**Success metric:** median time to first acknowledgment, percent resolved within SLA, reopen rate, and percent of schedule responses explicitly reconciled. Derive from operational timestamps; do not put narrative in analytics.

**Dependency / effort:** PT-011 recommended; **M**.

### PT-013 — Protect regulated incident and complaint drafts

**Labels:** `priority:P1`, `area:incidents`, `area:complaints`, `ux-safety`<br>
**User outcome:** staff cannot accidentally lose a high-stakes narrative because of Escape, backdrop click, route change, session interruption, or browser restart.

**Evidence:** complaint dismiss resets entered state (`src/components/complaints/CreateComplaintDialog.tsx:62-66,99-126`); incident open/close paths reset the form without dirty confirmation (`src/pages/app/Incidents.tsx:188-194,385-386,535-539`).

**MVP scope:** shared dirty-form guard; accessible confirmation; encrypted/local identity-scoped draft or server draft with explicit retention; debounced autosave; restore/discard affordance; successful submission clears draft; account/tenant switch clears or quarantines it safely.

**Acceptance criteria**

- Escape, backdrop, close, cancel, route navigation, and browser unload cannot silently discard a dirty draft.
- A crash/reload restores the latest acknowledged draft state for the same authorized identity/scope.
- Draft contents never cross tenant/account boundaries and follow a documented short TTL.
- Screen readers receive save status and confirmation focus is correct.
- Duplicate submit/retry is idempotent.

**Success metric:** draft recovery rate and abandonment after ≥3 populated fields; never collect narrative text in telemetry.

**Dependency / effort:** reusable form-safety primitive; **M**.

### PT-014 — Bootstrap server-derived capabilities and productize billing

**Labels:** `priority:P1`, `area:permissions`, `area:billing`, `frontend-platform`<br>
**Outcome:** navigation/actions reflect server-derived effective permissions and entitlements, while billing uses selectable packages and valid seat quantities with observable reconciliation.

**Evidence:** the application does not consume effective-permission/entitlement RPCs outside generated types; routes/navigation use base roles. The billing Edge function accepts `billing.account.manage`, but `/app/enterprise` is org-admin-only. `src/pages/admin/EnterpriseFoundation.tsx:857-915` asks for raw UUIDs and always sends `seatQuantity: 1`; billing return query parameters are not consumed.

**Implementation slice**

1. Return one versioned capability/scope document after authentication and refresh it on relevant policy/entitlement changes.
2. Derive route, navigation, and action visibility from that document while retaining server authorization on every request.
3. Build package/price selection, bounded seat input, current subscription/invoice state, and explicit success/cancel/pending/error feedback.
4. Reconcile webhook-delayed checkout state and avoid claiming success from a return URL alone.

**Acceptance criteria**

- A non-org-admin with `billing.account.manage` can reach permitted billing actions; a user without it cannot.
- UI hiding never substitutes for server enforcement; capability expiry/revocation takes effect predictably.
- Seat values respect configured min/max and server prices; raw package UUID entry is absent from normal UX.
- Return states distinguish canceled, redirected, webhook pending, applied, and failed reconciliation.

**Dependency / effort:** PT-002 before paid activation; capability bootstrap **M**, billing productization **M**.

### PT-017 — Turn immutable resident statement snapshots into usable statements

**Labels:** `priority:P1`, `area:resident-finance`, `area:resident-portal`, `feature`<br>
**User outcome:** authorized staff can view, print/download, and deliberately share the exact immutable statement represented by its transaction snapshot; designated persons can consume a shared statement without calling the facility for detail.

**Evidence:** the database retains statement balance and transaction snapshot (`20260714113000_resident_financial_operations.sql:112-138,482-509`), but `src/pages/app/ResidentFinancialOperations.tsx:97,105` lists metadata/hash only. The guest portal explicitly says to contact the facility for documents/details: `src/pages/public/ResidentDesignatedPersonPortal.tsx:104`.

**MVP scope:** statement detail renderer; accessible PDF/print; snapshot/count/hash verification; delivery/share state; permission-scoped portal attachment; revocation/expiry; audit event for view/download/share without logging financial detail.

**Acceptance criteria**

- Rendered line items, opening/closing balance, totals, dates, and immutable snapshot hash reconcile exactly.
- Staff can preview before sharing; portal access is explicit, revocable, tenant/facility/resident-bound, and visible in history.
- Correct loading/empty/error/expired states exist on staff and guest surfaces.
- PDF is keyboard/screen-reader compatible where HTML is used and prints legibly on letter/A4.

**Success metric:** percent of generated statements successfully viewed/downloaded, delivery failure rate, and support contacts tagged “statement detail.”

**Dependency / effort:** can reuse portal grant/document controls; **M**.

### PT-018 — Add one explicit organization/facility scope control

**Labels:** `priority:P1`, `area:multi-facility`, `frontend-platform`, `data-correctness`<br>
**Outcome:** users always see the active organization/facility scope, and mutations cannot silently target the first accessible facility.

**Implementation slice**

1. Add an authenticated scope bar with organization and facility, remembered per user where appropriate.
2. Define which pages support one facility, all accessible facilities, or organization-wide scope.
3. Require explicit scope in mutation APIs; reject ambiguous/unauthorized facility IDs server-side.
4. Migrate mutation-heavy operational pages first, then reports/dashboards.
5. Include scope in headings, exports, URLs/deep links, query keys, audit events, and error messages.

**Acceptance criteria**

- No mutation defaults to array index zero or an invisible facility.
- Changing scope invalidates relevant cached data and closes old-scope Realtime channels.
- Deep links restore or safely reject the encoded scope.
- All-facility summaries state their aggregation scope and drill down accurately.

**Success metric:** wrong-facility correction/support rate, scope-switch completion, and mutation rejection due to stale scope.

**Dependency / effort:** capability/scope document in PT-014 is a strong foundation; **L**, staged by domain.

### PT-029 — Complete guest document upload for move-in tasks

**Labels:** `priority:P1`, `area:admissions`, `area:resident-portal`, `feature`, `security-review`<br>
**User outcome:** a designated person can securely upload a requested move-in document from a phone, and staff can review it before it becomes admission evidence.

**Evidence**

- The guest portal labels tasks “Document requested” but offers only electronic signature: `src/pages/public/MoveInGuestPortal.tsx:88-123`.
- Guest grants deliberately include tasks requiring documents: `src/pages/app/MoveInWorkspaceDetail.tsx:301-307`.
- The audit event enum already includes guest `upload`: `supabase/migrations/20260712035922_phase5_work_items_confidential_incidents_moveins.sql:49`.
- The move-in dashboard promises “family uploads”: `src/pages/app/AdmissionOperations.tsx:359`.
- Latest-state search found terms/workspace/sign RPCs but no guest upload/finalize boundary.

**MVP scope**

1. Token- and task-scoped initiate/finalize upload boundary with grant expiry/revocation and `requires_document` rechecked at both steps.
2. Strict type/size allowlist, checksum, private quarantine path, malware scanning, and no browser-supplied authoritative storage path.
3. Mobile camera/file picker, progress, retry/resume, replace-before-submit, and clear rejection states.
4. Staff review accepts or rejects the proposed document; acceptance links a governed `resident_document` and advances the task under the existing approval rules.
5. Append-only upload/review/reject/replace events; revocation blocks incomplete uploads and retrieval immediately.

**Non-goals:** broad guest browsing of resident documents, automatic task completion before staff review, or email attachments.

**Acceptance criteria**

- A guest can upload only to an unexpired, accepted grant and an explicitly allowed task that still requests a document.
- Wrong task, workspace, tenant, file type/size, token, revoked grant, expired grant, malware result, and finalize replay fail safely.
- Files remain quarantined and inaccessible as resident evidence until staff acceptance.
- Replacement/rejection preserves audit history; accepted checksum and final object are immutable.
- Upload works at 320px with progress announced and can recover from a dropped connection without duplicate evidence.

**Success metric:** percentage of requested guest documents accepted without staff-assisted re-upload; rejection reason distribution; median request-to-accepted time. Never put filenames or resident details in product telemetry.

**Dependency / effort:** secure upload/scanning infrastructure and staff review RPC/UI; **L**.

---

## Milestone M3 — Productization queue

These are issue-ready candidates, but they should not displace the release and workflow work above.

| ID | Issue | First shippable slice | Acceptance signal | Effort |
|---|---|---|---|---:|
| PT-019 | Confidential reporting access and recovery | Opaque rotatable facility link/QR plus recovery code/status portal; no public facility directory | Reporter can resume/status-check without identity disclosure; facility and rate-limit tests pass | M–L |
| PT-020 | Accessible learning transcripts and real captions | Learner-visible transcript panel; WebVTT upload/validation/player selection | Keyboard and screen-reader course journey passes; caption usage/completion measured | M |
| PT-021 | Responsive operational queues | Reuse Training Matrix mobile-card/desktop-table pattern for Work Queue, Complaints, Admissions | Primary status/owner/action works at 320px without horizontal panning | M |
| PT-022 | Governed-content reviewer workspace | Queue, revision preview/diff, assignment, threaded comment/resolution, evidence lineage | Median review time and unresolved-comment escape rate are measurable | L |
| PT-023 | Scheduled reports inside Reports | “Schedule” beside saved view and Scheduled tab reusing `ReportScheduleManager` | User can create/edit/pause/run a schedule without visiting Value Center | S |
| PT-024 | Audit archive execution and verification | Worker moves planned → exported → verified with immutable object/checksum | Corruption/retry/restore tests pass; no batch remains invisibly planned | L |
| PT-025 | Billing-state reconciliation schedule | Schedule `reconcile_billing_states`; explicit expired-comp provider fallback | Canonical access and entitlements converge after comp expiry in tests | S–M |
| PT-026 | Environment-neutral scheduled Edge calls | Resolve Edge base URL per environment; schedules disabled on restores until rebound | Isolated restore cannot call production workers; rebind smoke passes | M |
| PT-027 | Executable disaster recovery | RPO/RTO, PITR, Auth/Storage/Vault order, job neutralization, reconciliation, quarterly drill | Signed isolated restore evidence meets declared RPO/RTO | M, cross-functional |
| PT-028 | Repository delivery governance | Issue forms, labels/milestones, CODEOWNERS/risk reviewers, security policy, tagged releases/notes | High-risk PRs require named review; release is traceable; intake is actionable | S–M |
| PT-030 | Evidence-room guest questions | Token/artifact-scoped question RPC plus staff unresolved/resolved queue; the `evidence_guest_comments` table and `comment` access event already exist | Every guest question is visible to staff, auditable, rate-limited, and resolved without turning the room into unrestricted chat | M |
| PT-031 | Governed HRIS adapter transport | Conditional rollout deliverable: implement one approved adapter or vendor-neutral snapshot gateway that creates/stages runs and exposes cursor, failures, and reconciliation | Source → staged rows → human duplicate decision → bounded apply works end to end without browser/service-role credential exposure | L |
| PT-032 | Isolated SCORM/LTI runtime gateway | Conditional rollout deliverable: hostile-package scanner, separate cookie-less serving origin, sandbox/message bridge, SCORM runtime, and limited LTI 1.3 launch validation | Hostile archive and issuer/JWKS/state/nonce conformance suites pass before the UI advertises the capability as available | L–XL |
| PT-033 | Exercise the demo seed entrypoint | Add a separate `supabase db reset` seed smoke because normal CI/database scripts use `--no-seed`; assert six Auth identities, role/facility baseline, and repeatable reset | Demo/pilot bootstrap cannot drift or fail outside CI unnoticed | S |

PT-031 and PT-032 are not proven source defects. The operations guides explicitly place their adapters/processors in an approved external runtime (`PHASE3_OPERATIONS.md:25-41`; `PHASE4_OPERATIONS.md:20-34`). They become release blockers only if no separately deployed, tested runtime exists. PT-030 is a lower-risk feature opportunity: schema exists, but the guest room currently lists/downloads artifacts only and latest-state search found no comment submission/response path (`20260712035925_phase5_historical_reports_and_evidence_room.sql:13-14,23,37`; `src/pages/public/EvidenceGuestRoom.tsx`; `src/hooks/useEvidenceRoom.ts`).

## Standard issue completion checklist

Copy this checklist into each implementation issue and remove items that truly do not apply.

- [ ] Persona and workflow outcome are stated.
- [ ] Organization, facility, role/capability, and data-classification boundaries are documented.
- [ ] Loading, empty, stale, partial, error, retry, offline, and destructive-action states are designed.
- [ ] Database/RLS/Storage negative tests cover cross-tenant and wrong-role access.
- [ ] Edge boundary tests cover authentication, bounded input, idempotency/replay, dependency failure, and safe errors.
- [ ] Browser tests cover keyboard, screen reader naming/focus, mobile viewport, deep link, and reconnect where applicable.
- [ ] Audit/evidence behavior and retention are explicit; sensitive narrative is absent from telemetry/logs.
- [ ] Feature flag, rollout cohort, rollback, migration/backfill, and reconciliation plan are recorded.
- [ ] Success metric and pilot exit threshold are defined before rollout.
- [ ] Documentation, operational alerts, support runbook, and release note are updated.

## Suggested GitHub milestones and labels

**Milestones**

1. `M0 — Release trust`
2. `M1 — Pilot-ready durability`
3. `M2 — Connected workflows`
4. `M3 — Productization and scale`

**Minimum label set**

- Priority: `priority:P0`, `priority:P1`, `priority:P2`
- Type: `security`, `reliability`, `feature`, `accessibility`, `documentation`, `epic`
- Area: `area:database`, `area:edge-functions`, `area:frontend`, `area:pwa`, `area:identity`, `area:billing`, `area:reporting`, `area:resident-portal`, `area:notifications`, `area:ci`
- Delivery: `needs-design`, `needs-threat-model`, `needs-migration`, `needs-pilot-evidence`, `blocked`

## First planning session agenda

1. Assign a single owner and reviewer to PT-001 through PT-006A.
2. Confirm which conditional surfaces are enabled: paid Stripe, SCIM, eMAR, expanded external delivery, tenant export, and offline PWA.
3. Create M0 issues exactly from this backlog; split PT-006B and PT-016 into child issues.
4. Set explicit rollout gates rather than one global “production ready” status.
5. Choose the pilot cohort only after M0 tests pass, then bind PT-007 evidence to exact release artifacts.

The central product principle behind this sequence is simple: finish and prove the contracts users already rely on before adding another large module.
