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

## Lost authenticator device

A manager or administrator whose enrolled device is gone cannot get back in on
their own: GoTrue refuses self-unenrolment below AAL2, and `MfaPolicyGate`
blocks every route except `/account/security`. Recovery is a platform-admin
action, and the platform admin's own session must itself be at AAL2 inside the
privileged window.

1. **Identify the caller out of band.** Call the facility's main line back, or
   confirm with the organization's administrator. A reset leaves the account
   protected by a password alone until the next enrolment, so this step is the
   control, not the button.
2. **Reset from `/app/users`.** The shield-with-slash icon on the person's row
   opens the reset dialog. Write who you spoke to and how you identified them
   in the reason: it is stored on the audit entry and is what a reviewer reads.
   The dialog will not submit a reason shorter than ten characters.
3. **What it does.** Removes every enrolled factor and revokes all of that
   person's sessions -- a lost device must not keep an already-verified session
   alive -- through the same audited, checksummed `revoke_identity_sessions`
   path used by the console's session revocation, plus an `mfa_reset` entry in
   `audit_logs`.
4. **Tell them to enroll immediately.** Their next sign-in is single-factor.
   `MfaPolicyGate` sends them to `/account/security` wherever the
   organization's policy requires a factor; confirm with them that they
   completed it rather than assuming.
5. **Verify.** `get_identity_control_plane` reports the count of administrators
   and managers without a verified factor per organization. It should return to
   its previous value once they re-enroll.

Two things this action is not:

- **Not for your own device.** Both the page and the function refuse it. An
  administrator replacing their own phone unenrols and re-enrols on
  `/account/security` while still holding the old factor.
- **Not the fix for "Recent multi-factor authentication is required".** That
  refusal means the privileged session window (`max_privileged_session_minutes`,
  8 hours by default) has closed on a session that genuinely holds AAL2. The
  window runs from the Auth session's own creation time and re-verifying a
  factor does not reset it. Sign out and sign back in.

## Where multi-factor authentication is, and is not, enforced

Written down because it was previously only true in one place, and that place was React
(BACKLOG.md I14).

**Enforced on the server.** Every privileged action goes through an Edge Function that calls
`requireFreshAal2` -- creating or modifying a user, impersonation, session revocation, resetting
someone's authenticator -- and the database's `identity_assurance_is_current` backs the privileged
session window. Those cannot be reached with an AAL1 token whatever the client does.

**Enforced only in the client.** The organization-wide requirement that a signed-in user carry a
second factor at all is `MfaPolicyGate`, a React component. No RLS policy reads `aal`. So a user
who has a valid AAL1 session and talks to PostgREST directly -- their own token, their own
organization, their own facility -- reaches the ordinary data their role already allows, without
the factor the policy asks for. RLS still constrains WHICH rows; the factor is not part of that
test.

**What that is and is not.** It is not a tenant-isolation hole: no row becomes visible that the
role could not already see. It is a policy-strength gap -- "this organization requires two
factors" is true of the product's screens and not of its API. For a pilot the vendor operates, on
accounts the vendor enrolled, that is an acceptable posture; it should not survive to general
availability, and turning it into a real boundary means adding an `aal` test to the RLS helpers,
which touches every policy and needs its own change set.

**Closed here:** `KioskLayout` mounted no gate at all, so the class-kiosk route -- a shared device
in a room full of people -- was outside even the client-side requirement. It now wraps
`MfaPolicyGate` like `MainLayout` does.

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
3. Requeue the exhausted PDF job. There is no "replay from the control plane"
   button and there never was -- that instruction named a screen that does not
   exist (BACKLOG.md I25). Two real paths:
   - The holder, an org admin in the certificate's organization, or a platform
     admin taps **Prepare PDF** on My Certificates or Course Assignments. When
     the server reports the job exhausted, the client calls
     `requeue_certificate_pdf` and tries once more, by itself (I12).
   - `select public.requeue_certificate_pdf('<certificate id>')` does the same
     thing directly. It refuses any job that is not actually exhausted, and a
     freshly requeued job must spend five more attempts before another requeue
     is possible, so this cannot start a second attempt series in parallel.
   Do not insert a replacement certificate directly.
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
6. A refresh that stops reporting progress no longer needs closing by hand.
   `run_system_job_watchdog()` fails any run left staging for six hours, so
   `exclusion_source_health` shows a failure with a reason rather than a load
   that appears to still be running. A run that merely ran out of budget parks
   instead, keeps its `stage_cursor`, and is finished by the hourly
   continuation -- do not "Run now" on top of one; that reuses the same open
   run anyway.

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

### Who the product can actually reach, and who it cannot

Every notification path resolves its recipient through a login. The enqueue
functions read `profiles.email` and `profiles.phone`; the reminder jobs join
`employees.profile_id is not null`. The employee record's own `phone` column --
the one a roster import fills in -- is read by nothing that sends anything.

So an employee who is on the roster but has never been invited receives no
reminders, no digests and no alerts, on any channel, and **no failed delivery
row is written for them**. There is nothing on the deliveries dashboard to
find: a facility that imported forty aides and invited none of them looks
exactly like a quiet week.

- The count is on `/admin/notifications` (every organization) and on an
  organization's own Settings page (its own number), from
  `get_notification_reach()`.
- Onboarding is not complete while that number is above zero. Invite **every**
  deskless worker who is expected to receive a reminder, not only the
  administrators -- the training due-date reminders, the policy attestation
  reminders and the shift handoff escalations all go to the worker.
- If a pilot facility genuinely will not give aides logins, say so before the
  pilot starts and plan the reminders around a manager. Do not leave the number
  above zero and assume the messages are going out.

## Backups, and the part they do not cover

Verified against the production project on 2026-09-05. Everything here is a
fact about the platform or a number read from the database; the one thing that
cannot be read from outside the dashboard is called out as such.

**What is running already.** Project `xsqobvvreaovwibxwyvv` (region us-west-2,
Postgres 17.6.1.141) sits in a **Pro** organization, so Supabase takes an
automatic **daily** backup and keeps **the last seven days**. Nobody enabled
this and nobody can forget to: it is a property of the plan. Postgres is newer
than 15.8.1.079, so these are physical backups.

**Point-in-Time Recovery is a paid add-on and Pro does not include it.**
Whether it has been bought for this project is the one thing to check in
Database → Backups → Point in Time; it is not visible from the database or the
Management API without an access token. The difference is the whole recovery
point objective: without PITR the worst case is **one day of lost data**, with
it about **two minutes**. The 7-day tier is roughly $100/month.

**The database is 579 MB.** That is what sets restore downtime, and the project
is inaccessible while a restore runs.

**There are zero replication slots** (`select count(*) from
pg_replication_slots` returns 0), so the documented "drop subscriptions and
replication slots before restoring" step does not currently apply. Re-run that
query before any restore rather than trusting this line; Realtime's own slot is
handled by the platform either way.

**What the backup does not contain, which is the part that matters here.**
Database backups do not include Storage objects -- the database holds only
metadata about them. Today that is **84 objects and about 943 MB** across 27
private buckets, and it is not incidental content:

| Bucket | Objects |
| --- | --- |
| `course-videos` | 66 (988,407,298 bytes -- essentially all of the volume) |
| `binder-exports` | 12 |
| `policy-documents` | 2 |
| `class-notices`, `incident-reports`, `resident-documents`, `violation-documents` | 1 each |

A database restore brings back the rows that point at those objects. If an
object was deleted after the backup was taken, the restore does not bring it
back, and the row now points at nothing. The buckets that are empty today are
the ones a pilot fills first -- `certificates`, `credential-documents`,
`incident-documents`, `compliance-evidence` -- so this gap grows the moment a
real facility starts using the product. For a deployment holding PHI under a
signed BAA, "we have backups" is a statement about the database only, and
saying it without that qualifier would be wrong.

Two smaller ones from the same source: daily backups do not store passwords for
custom roles, and deleting the project permanently deletes its backups too.

**The rehearsal, and a correction to how the plan words it.** The pilot plan
says "restore once into a branch". That is not a thing that can be done:
Supabase branching is a schema and preview feature, not a restore target. The
two real options are restoring the project in place -- destructive, with
downtime -- and restoring to a **new project** (the Duplicate Project flow).
The rehearsal must use the second, because the first is the thing being
rehearsed *for*.

1. Write down the restore point and, from production, the row counts you intend
   to check (`organizations`, `profiles`, `employees`, `residents`,
   `audit_logs`) and `select count(*) from storage.objects`.
2. Database → Backups → restore to a new project. With PITR enabled the
   Management API equivalent is
   `POST /v1/projects/{ref}/database/backups/restore-pitr` with
   `recovery_time_target_unix`.
3. Time it. The number is the input to every future decision about whether to
   restore in place during an incident.
4. On the clone, re-run the counts and compare. Then check whether the Storage
   metadata still resolves to real objects -- that is the finding this rehearsal
   exists to produce, not the row counts.
5. Delete the clone.

**Evidence to keep:** the restore point and the elapsed time, the count
comparison, the Storage finding, and one screenshot of the backups page showing
the retention that is actually configured. Until that exists, treat the recovery
posture as unproven regardless of what the plan says.

## Incident response

Severity definitions, the accountable owners and the safe operator actions are
above; this is the procedure that uses them. It is deliberately short. A runbook
nobody can finish reading at 3am is not a runbook.

**Declare early.** Anyone may declare. Declaring costs a message; not declaring
costs the window in which the blast radius was still small. The declarer names
an incident lead, and the lead's first job is to stop being the person typing.

**First fifteen minutes.**

1. **Contain before diagnosing.** The controls already exist: disable the job
   (kill switch) at `/admin/system-jobs`; leave an open circuit breaker open;
   suspend an organization; revoke a user's sessions from `/app/users`; reset a
   compromised authenticator (see *Lost authenticator device*). Containment that
   turns out to have been unnecessary is cheap.
2. **Write down the time you noticed and what you saw.** Screens change under
   you during an incident and the audit trail will be reconstructed from this.
3. **Decide whether data was lost or exposed** -- those are different incidents
   with different clocks, and the second one has a regulator attached.
4. **Do not blindly replay** a request whose provider acceptance is unknown.
   Reconcile the ambiguous-outcome queue first.

**If PHI may have been exposed, the clock starts at discovery.** CareMetric is
a business associate: 45 CFR 164.410 requires notifying the covered entity --
the facility -- without unreasonable delay and no later than 60 days after
discovery. The signed BAA may impose something shorter, and it governs; read it
before relying on 60 days. The facility, not CareMetric, notifies individuals
and HHS. Pennsylvania's own breach-notification statute may also apply and its
scope is a question for counsel, not for this page. Involve the Privacy Officer
at the moment exposure becomes *possible*, not once it is confirmed.

**Communicating.** Tell affected facilities what happened, what it means for
them, and what you are doing, in that order -- before they notice and ask.
During a pilot the entire user base can be reached by phone in an afternoon,
which will not be true later; use that while it is.

**Closing it.** An incident is not closed when the symptom stops. It is closed
when the record is true again -- ledgers reconciled, audit rows explained, any
fabricated state corrected -- and when there is a written answer to "what made
this possible" that is not "someone was careless". File the follow-up as a
BACKLOG.md row with its residual scope stated, the way every other finding in
this repository is filed.

## Pre-pilot console work, and how to tell it is done

The six items in block 2 of `docs/ops/PILOT_READINESS_PLAN.md` happen in the
Supabase, SendGrid, Twilio and Stripe consoles, not in this repository. What
follows is what each one still needs and, more usefully, the command in this
repository that will tell you it worked -- so "done" is something observed
rather than remembered.

State below was verified on 2026-09-05 unless noted.

**H10 — MFA on the privileged identities.** `auth.mfa_factors` held zero
verified factors across all eight accounts. Enrol TOTP on both `platform_admin`
accounts, then rehearse the lost-device path in the section above against a
third, disposable account: the reset must work from `/app/users` without anyone
opening the Supabase dashboard. Keep the `audit_logs` row for the reset.

**H11 — Auth hardening.** Narrowed by the production security advisor:

- Leaked-password protection is still **off** — it is the only auth finding the
  advisor reports, so it is the one toggle that definitely remains.
- `otp_expiry` is **already at or under one hour**: the advisor's
  `auth_otp_long_expiry` lint fires above that and does not appear. Nothing to
  set. Do not lengthen it to make invitation links live longer — the product now
  states the link's short life and offers Resend, which is the correct answer.
- Still unrecorded and not advisor-visible: plain email signup off, Site URL and
  redirect URLs, the Send Email hook secret, and the Turnstile hostname (the live
  widget returned `110200`).

Confirm with: `pnpm run check:database` — its advisor step should report zero
auth findings when the leaked-password toggle is on.

**B3 — Providers.** Set the SendGrid and Twilio secrets, complete domain
authentication (SPF/DKIM/DMARC), register both provider webhooks, then send one
real email and one real SMS to yourself and follow each row in
`/admin/notifications` to `delivered`.

Before the secrets exist, deliveries on an unconfigured channel now record as
**`skipped`** with `provider_not_configured`, not as failures — so the ledger you
read after setting them contains only real attempts. If you see `failed` rows
predating the secrets, they are from before that change and can be ignored; rows
after it are real.

One thing to check on the first SMS: `twilio-notification-webhook` validates the
signature against the raw request URL, so if the runtime URL differs from the
public one every status callback and every STOP is silently rejected. Send one
signed test callback before you rely on delivery receipts.

**H12 — DHS source re-attestation. Done 2026-09-06.** The forms were re-read and
`DHS_FORMS_LAST_VERIFIED` re-stamped from 2026-07-13 to 2026-09-06, so
`node scripts/check-dhs-sources.mjs` exits 0 at age 0 days and the weekly job goes
green on the next run. `PA_CITATIONS_LAST_VERIFIED` is a separate stamp on its own
45-day clock, sits at 2026-08-04, and falls due first — around 2026-09-18.

**It comes back every 45 days, so the procedure stays here.** Scope the work first:

```
node scripts/snapshot-dhs-sources.mjs
```

It names which **form documents** changed since the last digest, so the review is
those rather than all thirty-five. Table-of-contents pages are reported separately
and routinely change; a change there is not evidence a form moved. A form served
as a web page is reported as `FORM PAGE` — never as navigation — because nothing
here can tell its site chrome moving from the form moving.
Read the documents it names, then re-stamp `DHS_FORMS_LAST_VERIFIED` in
`dhsFormsLibrary.ts` and re-run the digest with `--write`.

It also reports each source's **origin write time** against the attestation date.
The digest diff can only speak from the previous digest forward, which is no help
on the first run after a lapse; pa.gov sends `Last-Modified` on every form PDF, so
that reaches back behind the baseline into the window the digests missed. That is
what scoped this pass: **0 of the 34 form PDFs written since 2026-07-13**, the
newest write across those PDFs being 2025-12-04, so the reading was confirming
they were static rather than opening each one.

The 34 is the PDFs alone. The forms library holds 35 pa.gov sources — those 34
plus **Application for Licensure**, which DHS serves as a web page rather than a
PDF. That one is still a form, so the report names it under `FORM PAGE` and the
review opens it by hand; its bytes and write time track the site rather than the
form, so a diff on it is evidence neither way and it is excluded from the count
rather than folded into it. Do not read "0 of 34 static" as covering it. The two
`pacodeandbulletin.gov` citation sources are table-of-contents pages — navigation,
not forms — and sit on their own stamp.

Neither signal is the attestation, and the gate ignores both by design:

- A write time is blind to a form **superseded at a different url** while the url
  on file keeps serving the bytes it always had. The digest is blind to it too.
  Only a person against the DHS index sees that, and it is the failure mode that
  actually matters to a customer holding an obsolete form.
- The two `pacodeandbulletin.gov` citation pages send no `Last-Modified` at all.
  They record as `null`, which means unknown — never unchanged.
- A digest says nothing about the window before it was taken.

The stamp is the person's, never the tooling's. Nothing in the repository may move
it — the scripts scope the reading and report; they do not attest.

**H13 — The one non-demo organization.** `subscription_status = 'trial'`,
`trial_ends_at` null, no BAA stamp, created the day the project was. Decide
whether it is the internal tenant or the first customer, then either name it
internal and use it as the live-Price target, or stamp a trial end and take it
through the W1 walkthrough. Nothing else in block 2 depends on the answer, but
H7's guard protects only the *next* organization until it is settled.

**H14 — AI posture.** Production has the document analyzer, wellness summaries,
course generation and video generation **on** and the compliance copilot **off**;
`DEPLOYMENT.md` says the switches "still default false except voice". Neither
organization carries a BAA stamp, so tenant AI is dark regardless and nothing is
leaking today — but the written posture and the live one disagree, and one of
them is wrong. Decide which, then change the other to match. Whichever way it
goes, the decision belongs in `DEPLOYMENT.md` beside the switches.

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
