# Phase 1 operations and production-pilot runbook

This runbook covers the Phase 1 platform-trust controls implemented in this
repository. The code is ready for a clean CI run, but it is not approved for
general availability until the production exit gate in
`IMPLEMENTATION_PLAN.md` has passed.

## Ownership and escalation

| Capability | Accountable owner | First responder | Escalate when |
| --- | --- | --- | --- |
| Release gate, migrations, job control | Platform Engineering | Platform on-call | A migration, role journey, or critical job fails |
| Audit integrity, retention, legal holds | Security and Compliance | Security on-call | An audit gap, invalid hash, or hold conflict appears |
| Course completion and certificates | Learning Operations | Platform on-call | Completion, certificate, or PDF reconciliation differs |
| Exclusion source refreshes | Compliance Operations | Platform on-call | A source is stale, invalid, or loses its last-known-good snapshot |
| Email and SMS delivery | Messaging Operations | Platform on-call | Callbacks fail validation, unknown outcomes rise, or consent differs |
| Privacy and regulated-data handling | Privacy Officer | Security on-call | Provider payloads or logs may contain unnecessary sensitive data |

Open a Sev-1 incident for any tenant-isolation failure, credential duplication,
loss of the active exclusion snapshot, irreversible duplicate provider action,
or audit evidence tampering. Stop the rollout immediately. Open Sev-2 for a
freshness breach on a critical job, unexplained reconciliation variance, or a
provider callback outage that prevents final-outcome evidence.

## Release preflight

1. Use the Node and pnpm versions pinned by `.node-version` and `package.json`.
2. Run `pnpm install --frozen-lockfile` from the repository root.
3. Run `pnpm run check:release` with Docker available. This must complete the
   fresh Supabase reset, full migration chain, pgTAP, database lint/advisors,
   generated-type comparison, application tests, Edge checks, build, bundle
   budgets, and dependency audit.
4. Confirm the GitHub Actions database job passes its six authenticated role
   journeys, anonymous certificate verification, guest journey, and critical
   accessibility scan.
5. Confirm the secret-scanning job is clean and the application artifact name
   contains the exact commit SHA.
6. Rehearse the migration against a restored, anonymized production-like
   snapshot. Record duration, locks, row counts, checksums, and reconciliation
   results.
7. Verify the deployed Edge secrets described in `.env.example`. Never place
   provider credentials or callback verification material in Vite variables.

Do not bypass a failed database-type comparison by manually editing around the
generated output. Regenerate from the same fresh schema and resolve the schema
or generation drift.

## Platform control plane

The platform-admin route `/admin/system-jobs` is the operator entry point for
scheduled SQL jobs, Edge jobs, provider polling, reconciliation, and synthetic
checks. It shows freshness, last attempt and success, counts, retry state,
queue age, failure rate, provider latency, circuit state, and last-known-good
evidence.

### Safe operator actions

- **Run now:** creates a correlated manual execution. Idempotent job claims
  return the stored result for a repeated correlation key.
- **Cancel:** requests cooperative cancellation. Confirm the worker reaches a
  terminal `cancelled` state; cancellation is not proof that an already-issued
  external request was undone.
- **Replay dead letter:** replay only after the underlying cause is corrected.
  The replay creates new attempt evidence while preserving the original.
- **Disable:** activates the job kill switch. Use it before intervention when
  repeated failures could create duplicate or unsafe external effects.
- **Enable:** re-enable only after a synthetic check and reconciliation pass.

If a circuit breaker opens, leave it open until the provider is healthy and
the ambiguous-outcome queue has been reconciled. Never blindly replay a
network request whose provider acceptance is unknown.

## Audit evidence recovery

Use the Security Governance and Audit Log screens to review manifest coverage,
hash integrity, retention classes, legal holds, archive planning, and export
manifests.

1. Treat any invalid or missing audit hash as an incident; do not repair or
   delete the evidence row in place.
2. Run audit reconciliation and retain its correlated job result.
3. Identify the affected manifest entity, tenant, facility, request, and time
   range. Preserve application and database logs under legal hold when needed.
4. Generate the checksum export manifest and verify it independently before
   sharing an evidence package.
5. Archive only batches returned by the archive planner. An active legal hold
   blocks matching evidence from archive or deletion.
6. Release a legal hold only with the approved reason and Security and
   Compliance authorization.

Audit logs are append-only. Recovery is forward-only: record a new corrective
event and incident reference rather than mutating historical evidence.

## Course completion and certificates

Course completion must use the atomic completion RPC. A successful command
records the completion, one stable credential number, one certificate, one
logical outbox event, and durable PDF work in one transaction.

When reconciliation reports a mismatch:

1. Disable certificate PDF generation if the worker is amplifying failures.
2. Compare the assignment, certificate, outbox, and PDF job by assignment ID.
3. Retry or replay the durable PDF job through the control plane. Do not insert
   a replacement certificate directly.
4. If the transactional command failed, repeat it with the original
   idempotency context; a replay must return the canonical certificate.
5. Escalate any duplicate credential number or multiple certificates for one
   assignment as Sev-1.

The public verification journey must continue to validate a real certificate
after every release.

## Exclusion refresh recovery

Every source refresh lands in an immutable staged version and becomes active
only after identity, checksum, shape, count, and freshness validation.

1. On validation or provider failure, confirm the active pointer still refers
   to the previous last-known-good version.
2. Do not edit a staged snapshot to make it pass. Correct the source or parser
   and ingest a new version.
3. Review stale-source age and per-subject manual-review queues before a rerun.
4. Replay with the original source identity and checksum when testing
   idempotency; identical content must not create conflicting evidence.
5. Escalate loss or replacement of a valid active snapshot by malformed or
   partial data as Sev-1.

## Notification delivery recovery

The delivery dashboard distinguishes provider acceptance from final delivery.
`accepted` or `sent` is not proof of delivery. Signed Twilio and SendGrid
callbacks establish delivered, bounced/undelivered, complained, opted-out, or
permanently failed outcomes.

1. Verify provider callback configuration and signatures before retrying.
2. Treat an `unknown` result as quarantined. Reconcile it against the provider
   by correlation ID; do not automatically resend it.
3. Retry an actionable permanent failure only through the guarded retry RPC.
   Respect the bounded attempt budget and the recipient's current consent,
   quiet hours, time zone, and channel eligibility.
4. Keep alternate-channel fallback disabled until its pilot cohort is
   approved. Enable it per organization and use a bounded depth and delay.
5. STOP/unsubscribe evidence must suppress every pending path for the same
   recipient. Confirm duplicate callback delivery does not alter the result.
6. Activate a template only after previewing it with every allowed variable.
   Provider copy must remain generic for resident and support-ticket events.
7. Configure provider-rate estimates and a monthly budget before relying on
   spend alerts. A zero estimate means cost is not configured, not free.

If webhook verification is unavailable, leave callbacks fail-closed, alert the
on-call owner, and reconcile provider outcomes after verification is restored.

## Fourteen-day pilot and promotion

Start with staff/demo accounts, then two or three named tenant cohorts. Record
the cohort, approver, start time, flags, notification fallback policy, and kill
switch drill.

For 14 consecutive days, verify daily:

- at least 99.5% of internally controlled scheduled jobs succeed, excluding a
  separately acknowledged provider outage;
- no critical job breaches its freshness objective without an alert;
- audit manifest reconciliation has no unexplained gap or invalid hash;
- certificate reconciliation has no missing or duplicate credential;
- exclusion sources retain a valid active last-known-good version;
- notification callbacks reconcile and opt-outs remain effective;
- tenant, facility, RPC, REST, and Storage isolation tests remain clean; and
- no Sev-1 or Sev-2 issue remains open.

General-availability promotion requires approval from Product, Platform
Engineering, QA, Security/Privacy, and Compliance Operations. If a stop
condition occurs, disable the affected job or fallback policy, preserve
evidence, perform a forward recovery, restart the observation window, and
document the decision.
