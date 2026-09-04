# Go-live readiness review plan

> **Not the backlog.** See [BACKLOG.md](../../BACKLOG.md) for open work. This document is the
> plan for reviewing CareMetric CareBase before it accepts a paying, regulated customer: what to
> verify, how, in what order, and what "ready" means. Findings it produces become BACKLOG.md rows;
> this file carries no status of its own and is not re-dated when rows close.

**Prepared:** 2026-09-04, against `main` @ `0bc0b48` and the production Supabase project
`xsqobvvreaovwibxwyvv` (dashboard name "CM Train"; `DEPLOYMENT.md` and `ARCHITECTURE.md` still call
it "CM CareBase").

**Scope of this document:** a plan, not the review. Nothing in production or in application code was
changed while preparing it. Every fact stated below was read from the repository, from CI, or from
read-only probes of production (SQL over configuration and aggregate tables, the log stream, the
public site); Appendix A lists each probe so the numbers can be re-derived rather than trusted.

**Operating reality:** one owner-operator who is also the platform admin. Every "owner" below is the
same person wearing a different hat, and the sequence in section 10 is single-threaded on purpose.

---

## 1. Summary

**Verdict as of 2026-09-04: the code is credible; the deployment is not yet operable for a paying
customer.** (Ten blockers were found; six were fixed the same day — see the addendum below — and
the four that remain each need a credential, a console, or a person.) The application, the migration chain, and the edge functions are exactly what `main`
says they are, every automated gate that can run outside CI is green, and the site is up behind the
right headers. What is not ready is the operational layer around the code: billing has no
credentials, no notification has ever been delivered, the exclusion-screening data is stale and one
of its two sources has never loaded, the health check that is supposed to page the owner has been
red on every run, nobody has an MFA factor enrolled, and three date-based gates the repository
built for itself (the SG-2 review date, the DHS source-review age, the nightly advisory audit) have
all gone red in the last week.

None of that is a code rewrite. It is roughly two weeks of single-threaded configuration,
verification and decision work (section 10), followed by the area reviews in section 6, which are
the actual "review the functions, features, workflows and logic" pass and are sized as multi-week
for one person.

### What is verified true today

| Area | Fact | How it was verified |
| --- | --- | --- |
| Repo ↔ production | 603 migrations applied; the md5 of the ordered version list matches the repo's file list byte for byte; last version `20260830230000` | `supabase_migrations.schema_migrations` vs `ls supabase/migrations` |
| Edge functions | 73 of 73 deployed and `ACTIVE`, all stamped 2026-08-31; deploy run #175 succeeded 2026-09-01 | `list_edge_functions`, Actions history |
| CI on `main` | Last run (`0bc0b48`, 2026-09-01) green: application, database (pgTAP, lint, advisors, types diff, Playwright), planning-registers, secret-scan | Actions history |
| Local gates (this pass) | CareBase typecheck 0 errors; `scripts` and `voice-gateway` typecheck 0 errors; CareBase unit suite 168 files / 1,697 tests green; voice-gateway 7 files / 79 tests green; 13 static checks and 5 self-tests green (counts in Appendix A) | Run directly with the workspace binaries (Appendix A explains why not via `pnpm run`) |
| Site | `https://cmcarebase.com/health` → `status: ok`; root serves `Cache-Control: no-cache`, HSTS, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, CSP `frame-ancestors 'none'`; login page renders its title | `curl` |
| Scheduler | 47 active `pg_cron` jobs; every run in the last 7 days `succeeded` at the pg_cron level (about 26,600 runs, 0 failures) | `cron.job`, `cron.job_run_details` |
| Data boundary | 27 storage buckets, only `course-videos` public (as designed); Postgres error log clean over 24 h; only 4xx/5xx from any edge function in 24 h is the billing sync (see B2) | `storage.buckets`, log stream |
| Catalog | 88 courses, all 88 with a published version | `courses` / `course_versions` |

### What blocks go-live today (details in section 4)

| ID | Blocker | Size |
| --- | --- | --- |
| B1 | `check:planning-registers` is red on any branch since 2026-09-02: standing gap SG-2 passed its review date (2026-09-01). Owner decision, not code | S |
| B2 | Billing is dark: `STRIPE_SECRET_KEY` and `STRIPE_BILLING_WEBHOOK_SECRET` unset; `billing-quantity-sync` circuit **open**, failing hourly; 0 Stripe events ever processed; 0 subscriptions | S–M |
| B3 | Notifications have never left the building: 0 rows in `notification_deliveries` ever; **0 rows in `organization_settings`** for both existing organizations, so every delivery for them skips; provider secrets unverified | S–M |
| B4 | Exclusion screening degraded: OIG LEIE active snapshot is from 2026-07-12 (stale after 45 days); the 2026-08-12 monthly run is still `running` with a staging snapshot of 0 rows; SAM.gov has never loaded (no `SAM_GOV_API_KEY`, skipped by design). On-hire screening is released globally against this data | M |
| B5 | The Phase 1 synthetic health check fails on every 15-minute run (two invariants), so the one critical alert channel that exists is permanently red and will be ignored | S |
| B6 | Zero MFA factors enrolled across all 8 accounts, including both `platform_admin` accounts; the mandatory-MFA gate has never been exercised in production | S |
| B7 | Auth hardening still open in the dashboard: leaked-password protection disabled (confirmed by the security advisor); email signup, Site URL / redirect URLs, Turnstile hostname authorization not re-verified since `DEPLOYMENT.md` recorded the `110200` error | S |
| B8 | Six HIGH npm advisories affect `main` (browserslist ≤4.28.6 ×2, fast-uri <3.1.6 ×4); the nightly audit has failed 2026-09-02 and 2026-09-03 and opened its issue | S |
| B9 | The PA DHS human source review is 53 days old against the 45-day limit; the weekly freshness workflow went red 2026-08-31 | S |
| B10 | The one real organization is `trial` with `trial_ends_at = null`, which `20260724180000` treats as never expiring; it also has no `organization_settings` row and no BAA stamp. Decide what it is (internal org, or the first customer) and make its record say so | S |

### Addendum, same day: what was fixed rather than only recorded

The findings above are the review's output as first written. Everything below was then fixed in
the same change set, verified against a clean local Supabase stack (full chain replayed, complete
pgTAP suite, `db lint`, advisors, generated-types diff) rather than by reading. Status lives in
BACKLOG.md Tier H; this section only says which of the ten blockers moved and which did not, so a
reader of the table above is not misled by it.

| Blocker | Outcome | Where |
| --- | --- | --- |
| B1 SG-2 | **Reviewed, one real defect fixed, re-dated not closed.** Both PA templates cited the subsections that state no hours — `2600.65(f)-(g)` and `2800.65(i)-(j)` — when the floors live in `(e)` and `(h)`. Values all verified correct against the published sections. Activation is blocked on facts, not effort: submit/approve/activate each require AAL2 and no account has an enrolled factor (B6), and approval requires a second identity | `20260904010000`, BACKLOG SG-2 |
| B3 Notifications | **Backfill shipped.** Every organization now has a settings row with email and SMS enabled. Enforcement was attempted and withdrawn: a creation trigger broke `record_organization_signup` outright and seven other suites — recorded in the migration, because the lesson (a trigger writing to a second table rewrites that table's contract for every caller) outlives the change | `20260904020000`, H4 |
| B4 Stranded run | **Ledger fixed; the outage itself is still ops.** Abandoned runs now close automatically, keyed on the heartbeat so the resumable SAM sweep is never swept. Why the 2026-08-12 LEIE refresh died, and re-running it, still needs the function log | `20260904080000`, H6 |
| B5 Synthetic health | **Both counters fixed.** A never-configured exclusion source is no longer counted as an integrity violation, and the one pre-atomic-issuance completion got its certificate (and its PDF job) with a cutoff so a *recent* miss stays visible | `20260904030000`, `20260904040000`, H5 |
| B8 Advisories | **Zero high/critical.** `fast-uri` → 3.1.7, `browserslist` → 4.28.8, verified by a strict-mode audit of the new lockfile | `pnpm-workspace.yaml`, H1 |
| B10 Trial | **Forward-only guard.** New non-demo trials get a deadline; the existing null is deliberately left, because stamping it would start a clock on the tenant holding both platform-admin identities | `20260904070000`, H7 |
| N1 / G270 | **Four of six closed.** Each cron entry moved onto the definition its Edge Function actually finishes. The remaining two record no runs at all, so repointing them would swap an always-green signal for an always-red one | `20260904050000`, G270 |
| N2 search_path | **Pinned** | `20260904060000`, H8 |
| N14 bundle budget | **Raised deliberately to 650 KiB** with the reasoning recorded inline | `check-bundle-budget.mjs`, H3 |
| N15 dependency gate | **Short-circuits an identical dependency set**, so a registry outage stops reddening branches that changed no dependency. Strict mode untouched | `check-dependencies.mjs`, H2 |
| B2, B6, B7, B9 | **Unchanged, and not fixable from a repository.** Stripe secrets, MFA enrolment, Auth dashboard toggles, and a human re-attestation of 35 DHS form sources each need a credential, a console or a person | H9–H12 |

One finding was added by doing the work rather than by reviewing it: **N15**, the dependency gate's
fail-closed behaviour during a registry outage, which this document's own pull request hit three
times in seven minutes.

---

## 2. How to use this plan

Each area in section 6 has the same shape: **Scope** (routes, hooks, functions, tables, tests that
belong to it), **Questions** (the logic and workflow checks a reviewer must answer, not just "does
it render"), **Method** (which of the three lanes below proves it), **Pass** (what has to be true
to mark the area reviewed), and **Evidence** (what to keep, outside the repository).

Three verification lanes, referenced by number throughout:

| Lane | What it is | Where it runs | Needs |
| --- | --- | --- | --- |
| **L1** | The repository's own automated gates: `check:all`, `check:database`, Playwright, `check:release` | CI (`ci.yml`) or a workstation on the pinned toolchain | Node 24.15, pnpm 11.13, Deno 2.5.6, Docker |
| **L2** | A clean local Supabase stack with the demo baseline (`pnpm run db:reset:demo`), used for anything destructive, time-shifted (trial expiry, grace periods), or that needs a second organization | Workstation | Docker |
| **L3** | Production, read-only: the SQL probes in Appendix C, the log stream, the public site; plus scripted walkthroughs on the seeded demo tenant and on a **canary organization** created through `/signup` with a real mailbox and phone | Production | Nothing beyond dashboard access |

Rules that apply to every area:

1. **A finding is a BACKLOG.md row, in the same change set as any fix.** `check:planning-registers`
   enforces this; this document is not a place to record status.
2. **Evidence lives outside the repository** (screenshots, exported probe results, dashboard
   states). No customer data in git. Name the evidence in the BACKLOG row's notes.
3. **Nothing is "reviewed" because it was read.** Each Pass line names something that was run or
   observed. The register's own verification contract (BACKLOG.md, last section) applies.
4. **Production probes are read-only** unless a section says otherwise, and the two things this
   plan asks to write in production (the `organization_settings` backfill in B3, the demo-row
   repair in B5) go through migrations so they replay in CI and are recorded.

---

## 3. Ground truth captured on 2026-09-04

Everything in this section was observed, not inferred. Counts are as of roughly 04:40 UTC.

### 3.1 Repository

| Measure | Value |
| --- | --- |
| `main` head | `0bc0b48` (2026-08-31, dependabot bump of `supabase/setup-cli`) |
| BACKLOG.md stamp | `66bae0e` — still valid (only neutral commits after it) |
| Migrations / edge functions / pgTAP suites | 603 / 73 (+ `_shared`) / 145 files |
| Declared routes (`App.tsx`) | 217 |
| Source files / unit test files (CareBase) | 872 `.ts`/`.tsx` / 168 test files |
| Hook modules (`src/hooks`) | 169 (incl. their tests) |
| Edge-function secrets read via `Deno.env.get` | 45 distinct literal names (Appendix B); the Stripe secrets are read through a shared helper and are additional |
| Open BACKLOG rows | A1, A2, A5 (`ops_only`); B3, E8 (`in_progress`); G270 (`open`); SG-2 (review 2026-09-01, **passed**); SG-4 (review 2026-10-01) |
| Scheduled GitHub workflows | `dependency-advisories.yml` daily (red 09-02, 09-03), `dhs-source-freshness.yml` weekly (red 08-31) |

### 3.2 Production database and platform

| Measure | Value |
| --- | --- |
| Project | `xsqobvvreaovwibxwyvv`, us-west-2, Postgres 17.6.1, `ACTIVE_HEALTHY`, created 2026-07-04 |
| Extensions | pg_cron 1.6.4, pg_net 0.20.3, pg_stat_statements, pg_trgm, pgcrypto, supabase_vault, uuid-ossp |
| Organizations | 2: one demo (`is_demo`, active, CareBase plan) and one real (`trial`, `trial_ends_at` null, no BAA stamp, `ai_features_enabled` true, created 2026-07-04) |
| Facilities / employees / residents | 3 / 20 / 4 |
| Auth users / active profiles | 8 / 8 — platform_admin 2, org_admin 2, facility_manager 1, trainer 1, employee 1, auditor 1 |
| MFA verified factors / identity security policies | **0 / 0** |
| `organization_settings` rows | **0** (the table defaults every channel to `false`; `20260802040000` creates the row only for new signups) |
| `notification_deliveries` rows (ever) | **0** |
| `app_private.stripe_billing_events` / `billing_subscriptions` | **0 / 0** |
| `regulatory_rule_packs` / `regulatory_rule_versions` | **0 / 0** (SG-2: no PA pack installed, let alone active) |
| Course assignments | overdue 3, in_progress 2, completed 1; certificates issued: 0 |
| `audit_logs` | 27,166 rows |
| Platform settings | `ai_compliance_copilot_enabled=false`, `ai_course_generation_enabled=true`, `ai_document_analyzer_enabled=true`, `ai_video_generation_enabled=true`, `ai_wellness_summary_generation_enabled=true`, `voice_assistant_enabled=true`, `signup_enabled=true`, `maintenance_mode=false`, `default_trial_days=30` |
| Release flags | 11 features `global`/on; `analytics.cross_tenant_benchmarks` off |

### 3.3 Background jobs

| Measure | Value |
| --- | --- |
| `cron.job` | 47 active; 31 call SQL directly, 16 call an edge function through `net.http_post` |
| `system_job_definitions` | 52 (36 `is_critical`); all circuits `closed` except `billing-quantity-sync` (**open**) |
| Critical definitions with **no** `system_job_runs` row and null `last_known_good_at` | 22 — every critical `sql_cron` definition whose cron entry either calls a plain SQL function directly (not through `execute_registered_sql_job`) or, for the six G270 names, is really a `net.http_post` to an edge function; plus the `organization-data-export` worker. The watchdog can only read their health off pg_cron's exit status |
| `billing-quantity-sync` | failed every hour, `billing_sync_not_configured`; 24 × HTTP 503 from `sync-billing-quantities` in the last 24 h |
| `phase1-synthetic-health` | failed every 15 min: `exclusionSourcesWithoutActiveSnapshot: 1` (SAM), `completedAssignmentsWithoutCertificate: 1` (a demo-org assignment completed 2026-07-05, before atomic issuance shipped on 2026-07-11) |
| `exclusion-screening` | one run, `running` since 2026-08-12 05:00 UTC, heartbeat never updated, cursor `phase: refreshing, source: oig_leie`; refresh run in `staging` with 0 staged rows |
| Exclusion source health | `oig_leie`: active snapshot 2026-07-12, 80,192 records, **stale**; `sam_exclusions`: `not_loaded`, no snapshot ever; screening matches recorded: 0 |
| `sam-sweep-continuation` | succeeds hourly with `idle: true` (nothing to resume) |

### 3.4 Advisors (Supabase `get_advisors`)

| Type | Level | Count | Name |
| --- | --- | --- | --- |
| security | WARN | 524 | `authenticated_security_definer_function_executable` |
| security | WARN | 20 | `anon_security_definer_function_executable` (all guest-token / public-verify surfaces; list in Appendix D) |
| security | WARN | 7 | `function_search_path_mutable` — six are the `pa_*` day helpers, left unpinned **deliberately** and documented in `20260727050000`; the seventh, `app_private.clinical_disclosure_allowed`, is not documented anywhere and should be pinned |
| security | WARN | 1 | `auth_leaked_password_protection` (still disabled) |
| security | INFO | 28 | `rls_enabled_no_policy` (all `app_private`, expected) |
| performance | WARN | 31 | `multiple_permissive_policies` |
| performance | INFO | 1,453 / 21 / 1 / 1 | `unused_index` / `unindexed_foreign_keys` / `no_primary_key` / `auth_db_connections_absolute` |

CI runs `supabase db advisors --local --type all --fail-on error`, so none of the WARN rows fail
a build. That is correct for the gate; it means the WARN list needs a human decision recorded once.

---

## 4. Blocking findings

Each has: what, evidence, why it blocks, what to do, and what closes it.

### B1 — SG-2 passed its review date; the planning-register gate is red

- **Evidence:** `node scripts/check-planning-registers.mjs` on `main` fails with "Standing gap SG-2
  passed its review date (2026-09-01, today is 2026-09-04)". CI's `planning-registers` job runs on
  every pull request and every push to `main`, so the next run of either is red.
- **Why it blocks:** nothing merges cleanly until it is answered, and the answer is a product
  decision — activate a PA governed rule version (install → review → fixture → activate), move SG-2 to
  "Explicitly not now" (the copilot stays a drafting aid for Pennsylvania at launch), or re-date it.
- **Do:** decide, edit the SG-2 row, and say in the row which of the three it is. If the decision is
  "drafting aid at launch", also make sure the copilot's empty state says so in customer terms.
- **Closes when:** `check:planning-registers` is green on `main`.

### B2 — Billing cannot take money

- **Evidence:** `system_job_definitions.billing-quantity-sync` is `circuit_state = open` with every
  run failing `billing_sync_not_configured` ("STRIPE_SECRET_KEY is not set"); `sync-billing-quantities`
  answered HTTP 503 twenty-four times in the last 24 hours; `stripe_billing_events` and
  `billing_subscriptions` are empty. BACKLOG A2 already names both missing secrets.
- **Why it blocks:** Checkout and the Customer Portal answer `503 billing_not_configured`; the
  webhook would reject every event `400 invalid_signature`; a trial that converts has nowhere to go.
- **Do:** follow `BILLING_MODEL.md` "Production activation checklist" steps 5–9 verbatim, in test mode
  first: set `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, confirm `CRON_SHARED_SECRET`;
  register the webhook endpoint pinned to `STRIPE_API_VERSION`; send a dashboard test event and see a
  `stripe_billing_events` row; run Checkout for Train and CareBase monthly and annual; confirm quantity
  1, the flat amount, and reconciliation into `billing_subscriptions`; then repeat with live prices on
  an internal organization.
- **Closes when:** the hourly sync records a `succeeded` run and the circuit closes; ≥1 processed
  Stripe event; a live subscription row for the internal org; A2 marked done with the evidence named.

### B3 — Notifications have never been delivered, and both existing organizations cannot receive any

- **Evidence:** `notification_deliveries` has 0 rows in the life of the project; `organization_settings`
  has 0 rows although two organizations exist. The table's channel switches default to `false`, the
  dispatcher was hardened in `20260706175854` to treat a missing row as "not assigned" rather than
  error, and `20260802040000` only creates the row for new signups (no backfill). `dispatch-notifications`
  runs every 15 minutes and succeeds — because there is nothing to send. Provider secrets
  (`SENDGRID_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_NOTIFICATION_STATUS_CALLBACK_URL`,
  `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY`, `WEB_PUSH_VAPID_*`) could not be verified from here.
- **Why it blocks:** every due/overdue reminder, escalation, digest, critical multichannel alert,
  invitation, support-ticket update and demo-request notice depends on this path. The SG-1 closure
  argued exactly this ("a real signup got no email, no SMS, and no error"); the same silence still
  applies to the two organizations that predate the fix — one of which is the owner's own.
- **Do:** (1) `supabase secrets list` and set what is missing; (2) a migration that inserts an
  `organization_settings` row for every organization without one, with the channel defaults the
  product wants for a real tenant, so it replays in CI and is on record; (3) register the SendGrid
  event webhook and the Twilio status callback against the two `verify_jwt = false` webhook functions
  and confirm signature verification passes; (4) authenticate the sending domain (SPF, DKIM, DMARC)
  for `cmcarebase.com`; (5) send one real email and one real SMS from production to the owner's own
  employee record and follow the row from `queued` to `delivered`.
- **Closes when:** ≥1 email and ≥1 SMS reach a real device from production and their rows reach
  `delivered` through the provider webhook; the Monday digest arrives the following Monday.

### B4 — Exclusion screening is stale and half-loaded while on-hire screening is on for everyone

- **Evidence:** `exclusion_source_health`: `oig_leie` health `stale` (active snapshot activated
  2026-07-12; `stale_after` 45 days); `sam_exclusions` health `not_loaded`. The 2026-08-12 monthly run
  (`app_private.system_job_runs`, job `exclusion-screening`) is still `running` with its heartbeat
  frozen at 05:00:10 UTC that day and a cursor of `phase: refreshing, source: oig_leie`; its
  `exclusion_refresh_runs` row is `staging` with `staged_record_count = 0`. `screen-exclusions` skips
  SAM by design when `SAM_GOV_API_KEY` is absent (line 28 of the function). `screening.on_hire_exclusion`
  is `global`/on. Screening matches recorded to date: 0.
- **Why it blocks:** the product screens new hires and, monthly, every employee against exclusion
  lists as a compliance feature. Today it screens against a July LEIE and no SAM at all, reports zero
  matches, and nothing on the customer-facing side says the data is stale. The next monthly run is
  2026-09-12 (`0 5 12 * *`); if the run is still marked `running`, the lease logic may refuse to start it.
- **Do:** (1) read the function log for the 2026-08-12 invocation to find out where the LEIE
  refresh died (timeout, download failure, out-of-memory) — the run row has no error because the
  function never came back; (2) reconcile the stranded run (dead-letter or fail it through the
  `/admin/system-jobs` controls rather than by hand) and re-run the monthly job from that page;
  (3) confirm a new `oig_leie` snapshot activates and `exclusion_source_health` flips to healthy;
  (4) decide SAM: obtain `SAM_GOV_API_KEY` and load it, or record "LEIE only at launch" as a product
  decision and make the customer-facing screening pages say which sources ran; (5) make the
  stranded-run condition visible — a `running` row older than its `freshness_sla` should fail the
  watchdog, which it currently does not.
- **Closes when:** LEIE active snapshot < 45 days old; the 2026-09-12 run completes and records
  `succeeded`; SAM either loads or is explicitly declared out of scope in BACKLOG.md and on the
  screening pages; no `running` row older than its SLA.

### B5 — The critical health check is permanently red

- **Evidence:** `phase1-synthetic-health` (registered critical, every 15 minutes) has never recorded a
  success (`last_known_good_at` is null) and fails every run with two invariant violations: `exclusionSourcesWithoutActiveSnapshot = 1` (SAM never
  loaded, see B4) and `completedAssignmentsWithoutCertificate = 1` (one demo-organization assignment
  completed 2026-07-05 with a published version and no certificate — it predates
  `20260711154819_atomic_course_completion_certificates`).
- **Why it blocks:** this check exists to catch the next real integrity violation. Red on every run it
  has ever made means a new violation would change nothing on any screen. The daily demo baseline restore has not repaired the row, so it will not fix itself.
- **Do:** (1) a migration that either issues the missing certificate for that assignment through the
  same RPC path a real completion uses, or resets the demo assignment so the baseline restore
  regenerates it; (2) make the exclusion invariant count only sources that are configured (a source
  that is deliberately skipped is not a violation, or the check can never be green without a SAM key);
  (3) after B4, confirm both counters read 0.
- **Closes when:** 24 consecutive hours of `succeeded` runs on `phase1-synthetic-health`.

### B6 — Nobody has MFA, including the two platform admins

- **Evidence:** `auth.mfa_factors` has 0 verified factors; `identity_security_policies` has 0 rows.
  With `20260729130000` the gate requires AAL2 for `org_admin` / `facility_manager` in every
  non-demo organization, and `platform_admin` is always MFA-mandatory.
- **Why it blocks:** the enrollment path (TOTP and phone factors are both enabled in `config.toml`)
  has never been exercised against production Auth, and the recovery path for a lost device is
  undocumented. If it fails, the owner is locked out of `/admin/*` and the first real `org_admin` is
  locked out of `/app/*` at first login.
- **Do:** enrol both platform-admin accounts now; enrol the real organization's `org_admin`; test
  step-up on an `identity_operation_requires_aal2` action; write down the lost-device recovery
  procedure (second platform admin removes the factor; what if both are lost).
- **Closes when:** every privileged account has a verified factor; a step-up prompt was observed
  and passed; the recovery procedure exists outside the repo.

### B7 — Auth dashboard hardening not re-verified

- **Evidence:** the security advisor still reports `auth_leaked_password_protection` disabled;
  `DEPLOYMENT.md` "Limitations / manual steps remaining" lists it, plain email signup, Site URL /
  redirect URLs, and the Turnstile hostname authorization (`110200` on the live widget) as manual
  steps; none has a recorded completion.
- **Do:** Authentication → Policies (leaked-password on, minimum password length), → Providers (plain
  email signup off; `signup-organization` is the only door), → URL configuration (Site URL
  `https://cmcarebase.com`, redirect `https://cmcarebase.com/reset-password`, the SSO root), → Hooks
  (Send Email hook enabled, secret matches `SEND_EMAIL_HOOK_SECRET`), Turnstile hostname list
  includes `cmcarebase.com`. Then run W1 (section 7) end to end.
- **Closes when:** the advisor WARN disappears; a password reset and an invitation email both arrive
  from production; the signup widget renders without `110200`.

### B8 — Six HIGH advisories on `main`

- **Evidence:** `dependency-advisories.yml` failed 2026-09-02 and 2026-09-03: browserslist ≤4.28.6
  (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g) and fast-uri <3.1.6 (GHSA-5jgf-p345-68v8,
  GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp). The workflow opened its
  "[deps] High or critical advisory affects main" issue. The PR-time gate only fails on advisories a
  branch introduces, so pull requests stay green while `main` carries these.
- **Do:** bump the `pnpm-workspace.yaml` override for `fast-uri` from 3.1.5 to 3.1.6 (the follow-up
  advisory widened the range past the current pin, exactly as the override's own comment predicted)
  and add one for browserslist; `pnpm install --lockfile-only`; confirm the lockfile re-resolved.
- **Closes when:** the nightly audit is green and the issue is closed.

### B9 — PA DHS source review is overdue

- **Evidence:** `node scripts/check-dhs-sources.mjs`: "Human source review is stale: 53 days since
  2026-07-13 (limit 45)"; all 35 DHS links and both citation links still resolve. The weekly workflow
  went red on 2026-08-31.
- **Why it blocks:** the state forms, citations and annual-training matrix are the product's
  regulatory claims; the repository set a 45-day human re-verification limit for them on purpose.
- **Do:** re-verify the sources by hand, re-stamp the review date the script reads, and check
  whether any form or citation changed (in which case it is a BACKLOG row, not a re-stamp).
- **Closes when:** the weekly workflow is green.

### B10 — The one real organization has an undefined commercial status

- **Evidence:** `organizations` row: `subscription_status = trial`, `trial_ends_at = null`,
  `baa_version = null`, no `organization_settings`, created 2026-07-04 (the day the project was
  created). `20260724180000` only revokes entitlements when `trial_ends_at is not null and <= now()`,
  so a null trial never expires.
- **Do:** decide whether this is the owner's internal organization (then say so — a flag, a name,
  and a note in BACKLOG — and use it as the internal Checkout target in B2) or a customer (then stamp a
  trial end, run B3's backfill, and take it through W1). Also confirm `signup-organization` always
  stamps `trial_ends_at` so no future row can be null.
- **Closes when:** the row is internally consistent and a pgTAP assertion pins "no non-demo
  organization with a null trial end and no live subscription".

---

## 5. Findings to fix or explicitly accept before launch

Not blockers; each needs a written decision in BACKLOG.md.

| ID | Finding | Recommended disposition |
| --- | --- | --- |
| N1 | **G270 is wider than its row says.** 22 critical definitions (not six) have no run ledger and null `last_known_good_at`; their cron entries call plain SQL functions, so the watchdog reads pg_cron's exit status, which reports "the statement ran", not "the work happened". pg_cron shows all of them succeeding, so nothing is broken today — the alerting is blind, not the jobs | Close G270 before launch, or reduce `is_critical` to the definitions that actually page and add a weekly manual probe (Appendix C, query 4) to the ops checklist |
| N2 | `app_private.clinical_disclosure_allowed` has a mutable `search_path` (the six `pa_*` helpers are deliberate and documented; this one is not) | Pin it in a migration; S |
| N3 | 20 `anon`-executable SECURITY DEFINER functions (Appendix D). All are token- or slug-gated public surfaces by design, but the advisor will flag them forever | Record a one-line justification per function (token validated, expiry, rate limit, audit row) in a migration comment or `docs/`, so the next reviewer does not re-derive it |
| N4 | 31 tables with multiple permissive SELECT policies; 21 unindexed foreign keys; 1,453 unused indexes; one table without a primary key | Not launch work at current scale (`docs/audits/RLS_ROW_FILTER_COST.md` already covers the policy cost). Fix the missing primary key; leave the rest with a dated row |
| N5 | AI posture drift: production has document analyzer, wellness summaries, course generation and video generation **on** and the copilot **off**; `DEPLOYMENT.md` says the switches "still default false except voice". Both organizations have no BAA stamp, so tenant AI is dark regardless | Decide the launch posture per feature, set the switches to match, and correct `DEPLOYMENT.md` |
| N6 | Documentation drift: project name ("CM Train" vs "CM CareBase"); `ARCHITECTURE.md` lists 10 edge functions of 73; `DEPLOYMENT.md` predates the release-flag and job-registry work | One docs pass at the end of the review (section 6, area O) |
| N7 | No backup / point-in-time-recovery posture or restore rehearsal is documented anywhere in the repository; no incident-response runbook | Verify the Supabase plan's PITR/backup setting, rehearse a restore into a branch or staging project, write both one-page runbooks (area O) |
| N8 | SG-4 (`record_resident_service_task`) review date 2026-10-01 | Decide before it trips the same gate as B1 |
| N9 | Terms/Privacy language about the clinical record "should still be confirmed by legal before release" (`docs/HIPAA_CLINICAL_DATA.md`) | Get and record the confirmation (area M) |
| N10 | B3 (real Storyline/Captivate packages) and E8 (diabetes video deck) are `in_progress` | Accept at launch; both are owner-gated and documented |
| N11 | The organization-export worker buffers each table in memory (BACKLOG "still open" item 10b) | Accept at launch scale; dated row |
| N12 | HSTS is `max-age=15552000` without `includeSubDomains` or `preload` (deliberate "moderate" choice in `server/index.mjs`) | Revisit once the domain set is final; not a blocker |
| N14 | `check:bundle` warns that the app-shell chunk (`index`, 564.6 KiB raw) is over 90% of its 620 KiB budget; the next few features will turn the warning into a failing branch | Raise the budget deliberately or split the shell before block 4; not a launch risk (F5 measured ~220 KiB brotli on the wire) |
| N15 | The PR-time dependency gate (`scripts/check-dependencies.mjs --base origin/main`) fails closed when the npm advisory endpoint is unavailable, and it runs before `check:all`, so an endpoint outage turns the whole `application` job red on every open branch, whether or not the branch touched a dependency. Observed on this document's own pull request: `503 Service Unavailable` followed by two 60-second timeouts, on two attempts seven minutes apart. The live-audit design is deliberate (a stale snapshot would defeat the gate); the narrow improvement is to short-circuit when the branch's resolved dependency set is byte-identical to the base's, because then the audit result cannot differ and the outage is blocking nothing | Record in BACKLOG.md; implement as its own change to the script, not inside a docs PR |
| N13 | The toolchain pin (`node >=24.15`, `pnpm 11.13`) is enforced by `engines`; on a machine with an older Node or a different pnpm on `PATH`, `pnpm run test` refuses to run rather than degrading (reproduced here) | Run the review on the pinned toolchain; not a product issue |

---

## 6. Review plan by area

Areas are ordered by risk: the ones whose failure is silent or irreversible come first.

### A. Platform, build and deploy (Railway)

- **Scope:** `artifacts/caremetric-carebase/server/index.mjs`, `server/precompress.mjs`,
  `server/prerender-heads.mjs`, `vite.config.ts` (production env guard), `vite-plugin-pwa`,
  `railway.json`, `.claude/skills/verify/SKILL.md`, `scripts/check-startup.mjs`,
  `scripts/check-bundle-budget.mjs`, `src/lib/deploymentReadiness.ts`, `report-client-error`.
- **Questions:** Is the served bundle built with the production `VITE_*` values (a blank page is the
  failure mode `DEPLOYMENT.md` §8 warns about)? Are `VITE_DEMO_ACCOUNTS_JSON` and
  `VITE_ENABLE_PUBLIC_DEMO` absent from the customer build (`deploymentReadinessChecks` fails a
  production build that carries them)? Does the PWA service worker pick up a new deploy without a
  stale shell, and does `offlineCourseCache` invalidate on publish? Do old asset hashes keep serving
  during a rollout (`ASSET_ARCHIVE_DIR`)? Does the process honour SIGTERM (the `exec` prefix)? Is
  `VITE_RELEASE_ID` set so client error reports carry a release? Behind Cloudflare (`CF_FRONTED`), do
  the IP-keyed rate limits (signup, demo, newsletter, intake, savings) see the client IP?
- **Method:** L1 `check:startup`, `check:bundle`; the verify skill's probe list against a local
  start; L3 header and health probes (done, Appendix A); Railway variable list against
  `.env.example`; a no-op redeploy while a browser holds the old bundle.
- **Pass:** every verify-skill probe passes; no demo credentials in the production build; a redeploy
  does not 404 the previous bundle's chunks; release id present on a forced client error report.
- **Evidence:** the probe transcript; the Railway variable names (not values).

### B. Identity, authentication and session security

- **Scope:** `signup-organization`, `invite-user`, `resend-invitation`, `create-user`,
  `admin-update-user`, `impersonate-user`, `send-auth-email`, `verify-identity-domain`,
  `scim-provision`, `get-platform-status`; `src/lib/auth.tsx`, `sessionIdentity.ts`,
  `components/layout/SessionSecurityGates.tsx` (MFA gate, idle timeout), `pages/auth/*`,
  `/account/security`, `useBreakGlass`, `useImpersonation`; `identity_security_policies`,
  `identity_operation_requires_aal2`, signup abuse controls (`20260709114000`), Turnstile.
- **Questions:** Is plain `POST /auth/v1/signup` disabled and does `signup-organization` remain the
  only way to a role? Do invitation, password reset and email-change mail go out through the Send
  Email hook and arrive branded with `cmcarebase.com` links? Does MFA enrolment work for TOTP and
  phone, does step-up fire on irreversible admin actions, and what is the lost-device path? Do the
  idle timeout and the kiosk idle lock (G23.3) fire at the configured minutes? Does impersonation
  leave audit rows, hide provider secrets, and exit cleanly (G22, G23.4)? Break-glass: two distinct
  identities required (G20) — with one operator, is the second account's use recorded as "not
  independent" per BACKLOG's self-review note? Do the signup rate limits and Turnstile hold under a
  scripted burst from one IP? Does a deactivated profile lose access on its next request
  (`reapply_current_profile_active_revoke`)?
- **Method:** L1 e2e `role-routing.spec.ts`, `role-journeys.spec.ts` ("employee invitation creates a
  usable linked portal account", "org admin guided onboarding"), pgTAP `phase1_access_matrix`,
  `phase1_platform_trust`, `privileged_mfa_default_and_credential_read`, `p1_authorization_hardening`,
  `p2_security_hardening`, `remaining_security_boundaries`, `scim_profile_link_revocation`,
  `signup_rollback_and_checkout_completion`; L3 the dashboard checklist in B7 and W1.
- **Pass:** B6 and B7 closed; W1 passes; a deactivated account is refused within one request; a
  burst of signups from one IP is rate-limited with the expected error copy.
- **Evidence:** dashboard screenshots of each Auth setting; the W1 transcript.

### C. Tenancy, authorization and data boundaries

- **Scope:** RLS helpers (`is_platform_admin`, `current_org_id`, `current_role`,
  `is_assigned_to_facility`, `owns_employee`), every `*_rls` migration, restrictive
  `product_module_entitlement` policies, `app_private.product_module_resources` /
  `product_module_storage_buckets`, storage policies for 27 buckets, the 20 anon DEFINER surfaces,
  `scripts/edge-function-auth.json` (34 `verify_jwt = false` gates), the auditor write allowlists,
  platform-admin confinement to `/admin/*` and the "viewing as org" convenience, organization
  suspension (`20260706043604`, `20260706141329`), facility-manager scoping (the G58–G60 sweeps).
- **Questions:** Can each role reach exactly what `ARCHITECTURE.md` says, and nothing across a
  tenant boundary through any table, RPC, bucket, signed URL or edge function? Are guest tokens
  single-use or expiring where designed (G9), and do the anon DEFINER functions rate-limit and log?
  Are signed storage URL TTLs short (the BACKLOG item-6 residual)? Does a Train-only organization see
  zero CareBase rows and no CareBase navigation, and does a downgrade degrade rather than crash? Is a
  suspended or canceled organization blocked at the edge functions too, not only in RLS?
- **Method:** L1 pgTAP is the primary evidence (`tenant_isolation_invariants`,
  `definer_predicates_are_tenant_scoped`, `rls_and_recalc`, `modular_product_entitlements`,
  `org_feature_enabled`, `trial_expiry_entitlements`, the `*_security_*` suites); L2 a two-organization
  cross-tenant matrix (org A admin, org B admin, an auditor, an employee) exercised through PostgREST
  with each JWT, including one write attempt per role against every write RPC the auditor is excluded
  from (expect `42501`); L3 confirm no bucket other than `course-videos` is public.
- **Pass:** pgTAP green in CI; the cross-tenant matrix has zero reads or writes across the boundary;
  N3's per-function justification exists; W11 (auditor) passes.
- **Evidence:** the matrix spreadsheet with request, JWT role, expected, observed.

### D. Training and learning (the Train product)

- **Scope:** `/admin/courses*`, `/admin/quizzes/:quizId`, `/admin/courses/new-ai`,
  `/admin/ai-generations`, `/app/courses*`, `/app/course-assignments`, `/app/training-plans`,
  `/app/training-matrix`, `/app/training-types`, `/app/competency-*`, `/app/practicums`,
  `/me/courses/:assignmentId` (+ `/quiz/:quizId`, `/offline`), `/me/trainings`, `/me/certificates`,
  `/trainer/*` (classes, kiosk, retraining, gaps), `/checkin/:token`, `/verify/:slug`, `/passport/:slug`;
  functions `generate-certificate-pdf`, `generate-class-notice-pdf`, `generate-course-video`,
  `check-course-video-status`, `poll-heygen-video-statuses`, `list-heygen-options`,
  `generate-course-curriculum`, `regenerate-course-block`, `accept-learning-package`; the learning
  runtime bridge (SCORM/xAPI), video watch gate, hour buckets, compliance credits, the PA annual matrix,
  the diabetes course (E7–E12), `course_assignment_due_reminders`, nightly status recalc.
- **Questions:** For each of the 88 published courses: does it open, do its videos resolve from the
  public `course-videos` bucket (re-hosted URLs, not expired HeyGen links), does the watch gate hold,
  is the quiz graded server-side with the key hidden until the rules allow it, is the certificate
  issued atomically and its PDF rendered by the cron worker within minutes, does `/verify/:slug`
  resolve? Do nightly `course-status-recalculation` and `compliance-recalculation` move overdue
  statuses on the facility day? Do hour buckets and annual requirements compute correctly for a
  personal care home versus an Assisted Living Facility (stored code `ALR`, label ALF)? Does a learner
  mid-way through a superseded version finish under the version they started (pinned
  `course_version_id`)? Does the certificate carry the provider snapshot (E12)? Do the PA-specific
  rules (practicum windows, diabetes education for insulin staff, orientation timing) instantiate on
  hire and on the flag change (E11 fix)? Trainer flow: class notice PDF, rotating QR token, kiosk idle
  lock, verified seat time, post-completion correction RPC (G6). SCORM: contract fixtures only (B3).
- **Method:** L1 e2e ("course assignment completes into a publicly verifiable certificate",
  "checks in through a rotating class QR token", `learning-bridge-browser.spec.ts`), pgTAP
  (`course_completion_atomicity`, `course_progress_monotonicity`, `video_watch_gate`,
  `comprehensive_*`, `required_annual_individual_courses`, `annual_training_audience_applicability`,
  `pa_pch_annual_diabetes_education`, `certification_attempt_entry_point`, `learning_path_*`); L3 on
  the demo tenant as `trainer@sunrisehealthcare.com`, complete one course of each delivery type
  (text, video, quiz-gated, attestation-gated, SCORM fixture) and follow the certificate to
  `pdf_ready`; Appendix C query 6 for `pdf_status` and certificate-less completions.
- **Pass:** every delivery type completes to a verifiable certificate on production; nightly recalcs
  green; zero certificate-less completed assignments outside the demo organization (and the demo row
  repaired per B5); the 12 diabetes video blocks play from the re-hosted URLs.
- **Evidence:** the per-delivery-type transcript with certificate slugs.

### E. Workforce and personnel compliance

- **Scope:** `/app/employees*`, `/app/credentials`, `/me/credentials` (`process-credential-renewals`,
  OCR), `/app/background-checks` (OAPSA windows), `/app/exclusion-screening`,
  `/admin/exclusion-screening` (`screen-exclusions`), `/app/administrator-qualification`,
  `/app/med-admin-roster`, `/app/schedule*`, `/me/schedule` (swaps, time off, duty eligibility,
  qualification-aware scheduling, open shifts), `/app/employee-lifecycle`, `/app/invitations`,
  `/app/qualified-workforce` (HRIS import), `/app/workforce-operations`, `/app/pending-approvals`,
  `/app/my-attestations`, `/app/shift-handoffs`, `/app/shift-log`, `/me/shift`.
- **Questions:** Does a hire trigger on-hire screening against a current LEIE (and SAM if keyed), and
  does a match become an alert or work item someone owns? Do credential expiries alert on the
  facility day, and does the OCR renewal path confirm rather than auto-apply? Are practicum windows
  and the med-admin authorization badge on the schedule correct for a real roster (E2)? Does duty
  eligibility block an unqualified assignment and audit an override (G12.4)? Does termination revoke
  login the same day and close the lifecycle case? Do invitations expire, resend, and link to the
  right portal account? Is the one-shift-per-calendar-day limitation stated where a manager will hit
  it? HRIS staged rows: decisions recorded (G15.16)?
- **Method:** L1 pgTAP (`phase2_scope_workforce`, `phase3_qualified_workforce`,
  `duty_eligibility_enforcement`, `qualification_aware_scheduling`, `on_hire_exclusion_screening`,
  `exclusion_atomic_refresh`, `invitation_and_readiness_management`, `administrator_qualification_scope`,
  `medical_evaluation_cycles`); L3 W6 on the demo tenant; Appendix C queries 3 and 5.
- **Pass:** B4 closed; W6 passes; a terminated employee's JWT is refused on the next request.

### F. Resident care and clinical

- **Scope:** `/app/residents*` (overview, timeline, assessments, support plan, care services,
  documents, financial, incidents/changes, appointments), `/app/residents/:id/chart`,
  `/app/residents/:residentId/assessment-forms/:formId`, `/app/admissions*`, `/app/resident-compliance`,
  `/app/resident-care-delivery`, `/app/services`, `/app/resident-services-calendar`,
  `/app/change-of-condition*`, `/app/dietary-operations`, `/app/resident-finance`,
  `/app/fhir-integration`, `/app/medication-integration`, `/me/residents*`, `/me/floor`,
  `/me/services`, `/me/change-of-condition*`, `/resident-portal` (`resident-portal-download`),
  `/move-in-access/:token`, `/resident-agreement-access/:token`; functions
  `generate-resident-assessment-pdf`, `generate-resident-assessment-summary`, `analyze-state-form`,
  `generate-state-form-prefill`, `fhir-ingest`, `fhir-writeback`; offline drafts
  (`OfflineSyncManager`, service / observation / change-of-condition lanes, receipts ledger); consent
  gating (`20260806090000`); `docs/HIPAA_CLINICAL_DATA.md`.
- **Questions:** Is per-facility clinical enablement defaulting to `true` the intended launch
  default? Does consent (`clinical_data_consent`) gate every outbound path — export, FHIR write-back,
  portal share and download — and is charting itself deliberately ungated? Are chart views and
  document reads access-logged? Is PHI absent from `report-client-error` payloads and the log stream
  (force a client error with a resident name on screen and read the stored report)? Do offline
  drafts encrypt at rest, sync from any page (item 7 closure), and wipe on identity or facility
  change (item 6 closure, including the facility-transfer case)? Are the PA facility-day rules right
  at 21:00 Eastern (the G40–G190 sweep): incident timing, task queues, compliance due dates? Do the
  medical-evaluation grace periods differ correctly between a personal care home and an ALF (F9)? Is
  monthly charge posting idempotent under a double-click and a retry? Are agreement signatures and
  their evidence immutable?
- **Method:** L1 e2e `resident-lifecycle.spec.ts` (12 of 12 steps implemented, ratchet at 0),
  `mobile-workflows.spec.ts`, `public-token-negatives.spec.ts`; pgTAP (`clinical_*`,
  `resident_*`, `structured_change_of_condition`, `support_plan_*`, `service_delivery_contract`,
  `offline_service_documentation_drafts`, `admission_pipeline_move_in`, `hospital_return_reconciliation_reports_gaps`,
  `resident_monthly_charge_idempotency`, `resident_agreements_external_signatures`,
  `resident_portal_guest_surface_holds`, `pa_day_is_the_facility_day`); L3 W5 and W8 on the demo
  tenant at two times of day (mid-afternoon and after 20:00 Eastern).
- **Pass:** W5 passes at both times of day; the consent gate refuses export, write-back and portal
  share while consent is anything but `granted`; the forced client error report contains no PHI;
  access-log rows exist for each chart and document read in the walkthrough.

### G. Safety, survey and compliance operations

- **Scope:** incidents (`/app/incidents*`, `/app/report-event`, follow-through, trends → QAPI,
  `generate-incident-report-pdf`, `generate-incident-state-form-pdf`), confidential intake
  (`/report-safety`, `submit-confidential-intake`, `/app/confidential-incidents*`), complaints,
  violations → corrective actions → POC (`generate-poc-document`, versions, `escalate-plans-of-correction`),
  inspections and fire drills (`generate-fire-drill-tracker-pdf`), `/app/inspection-readiness`,
  `/app/survey-day`, `/app/survey-rehearsals` (`run-mock-inspection`, `generate-mock-inspection-report`),
  `/app/evidence*`, `/evidence-access/:token`, survey evidence packets (`package-survey-evidence-packet`,
  `/survey-packet-access/:token`), `/app/compliance-binder` (`generate-compliance-binder`),
  `/app/compliance-command-center`, `/app/closed-loop-compliance`, `/app/qapi*`, `/app/emergency*`,
  `/app/maintenance*` (+ `/scan/:kind/:token`), `/app/policies`, `/app/policy-documents*`
  (`attest-policy`, knowledge checks, campaigns, reminders), `/app/work*`, `/app/today`,
  `/app/dhs-forms`, `/app/state-forms`, `/app/template-documents*`, `/app/regulatory-crosswalk`,
  `/app/regulatory-copilot`, `/admin/regulatory-updates`, `/app/pch-alr-operations`.
- **Questions:** Are the reportable-incident deadlines computed on the facility day and do the
  state-form PDFs match the current DHS forms (B9)? Does POC escalation warn three days out and
  escalate weekly while overdue (C4), and does verification refuse while any corrective action is
  open (C2)? Are evidence packets ordered by structured citation (C5), do guest links expire, and does
  a revoked grant refuse immediately? Does the async binder export complete through the cron worker
  on production (the `binder-export-jobs` definition has no run ledger — N1) and download through a
  short signed URL? Do policy campaign cycles spawn with targets and never with nobody (G25)? Does
  Survey Day session expiry fire? Is the mock inspection gated by the AI switches and BAA? Do
  work-item registration and escalation (every 15 minutes) produce exactly one item per source
  (`work_item_source_taxonomy`)?
- **Method:** L1 e2e ("a reportable incident produces the official state-form PDF", "a manager
  queues an asynchronous compliance binder", "an evidence-room guest accepts terms and sees only
  granted artifacts", `public-token-negatives`), pgTAP (`incident_*`, `plan_of_correction_escalation`,
  `poc_version_read_scope`, `survey_*`, `evidence_*`, `policy_campaign_*`, `policy_attestation_*`,
  `binder_export_jobs`, `work_item_*`, `formal_qapi_quality`, `emergency_operations`,
  `environmental_work_orders`, `complaints_grievances_resident_rights`,
  `finalized_state_forms_cannot_be_destroyed`, `state_form_reminders`, `inspection_item_schedule_recalc`);
  L3 W2, W3, W4 on the demo tenant; every PDF generator exercised once on production and its output
  opened.
- **Pass:** every PDF function has produced a real file from production; W2–W4 pass; escalation
  notifications enqueue once B3 is closed.

### H. Notifications and communications

- **Scope:** `dispatch-notifications` (every 15 min), `notification_deliveries`, templates and
  versions, quiet hours, fallbacks and critical multichannel escalation, `sendgrid-notification-webhook`,
  `twilio-notification-webhook`, `push-subscriptions` (VAPID), the Monday manager digest
  (`manager-weekly-digest`, 12:00 UTC Monday), `send-regulatory-digest`, `/account/notifications`,
  `/account/manager-digest/:id`, `/account/announcements`, `/admin/notifications` (delivery evidence),
  spend alerts, the demo-tenant suppression trigger, `NOTIFICATION_RECIPIENT_HASH_SECRET`.
- **Questions:** Everything in B3, plus: quiet hours honour the facility time zone; SMS opt-in and
  STOP handling exist (carrier and TCPA expectations); unsubscribe works for the newsletter; the
  digest's counts match the pages it links (G29 class of bug); a provider outage lands in the
  operator surface rather than in `skipped`.
- **Method:** L1 pgTAP (`notification_*`, `critical_multichannel_delivery`,
  `expanded_notification_delivery_types`, `notification_realtime_and_job_watchdog`); L3 the B3 delivery
  test and one deliberate provider failure (wrong key in a staging project, not production).
- **Pass:** B3 closed; the Monday digest arrived; a forced provider failure appears on
  `/admin/notifications` with a retry path.

### I. Billing and entitlements

- **Scope:** `create-billing-session`, `stripe-billing-webhook`, `sync-billing-quantities`,
  `billing-trial-expiry-notices`, `enforce_trial_expiry_entitlements`, `/admin/packages`,
  `/app/billing`, `/app/enterprise` (billing tab), `BILLING_MODEL.md`, `PRODUCT_MODULES.md`,
  `20260813180000` (live price IDs), the failed-event operator surface, the second-live-subscription
  pager (`20260815130000`).
- **Questions:** B2 and B10, plus: what does a customer see the day the trial ends (copy, lockout
  scope, path back)? Cancellation and refunds — who does what in Stripe versus the app? Sales tax
  (Stripe Tax on or off, and is that a decision on record)? Invoice emails: Stripe's or the app's?
  Does the annual price map to the annual Price ID and check out at quantity 1?
- **Method:** L1 pgTAP (`phase2_billing_integration`, `trial_expiry_*`, `stripe_webhook_failed_receipts`,
  `billing_sync_watchdog_reads_real_success`, `failed_billing_event_operator_surface`); L2 a
  time-shifted trial expiry on the demo baseline; L3 W9 in Stripe test mode, then live on the
  internal organization.
- **Pass:** B2 and B10 closed; W9 passes; the trial-expiry copy and lockout were observed.

### J. Integrations, AI and voice

- **Scope:** `integration-api`, `dispatch-integration-webhooks`, credential and webhook rotation
  (G15.2–G15.5), `scim-provision`, `verify-identity-domain`, FHIR (`fhir-ingest`, `fhir-writeback`,
  freshness evaluators), the medication integration boundary; AI: `compliance-copilot`,
  `analyze-state-form`, `generate-resident-assessment-summary`, `generate-course-curriculum`,
  `regenerate-course-block`, `generate-mock-inspection-report`, `voice-tools` and the
  `artifacts/voice-gateway` service (`VITE_VOICE_GATEWAY_URL`); the platform kill switches,
  `org_ai_allowed` (BAA stamp), `ANTHROPIC_BAA_CONFIRMED`, redaction receipts, `course_ai_generations`.
- **Questions:** N5's posture decision, per feature. Is the in-app BAA acceptance reachable for an
  `org_admin`, and does it stamp `baa_version` and `baa_accepted_at`? Is the voice gateway deployed
  and its env set, and is its documented limitation (the platform switch cannot end an open session)
  accepted for launch? Any partner at launch for `integration-api` or SCIM — if none, keep no
  credentials issued and confirm unknown credentials get `401`. With no FHIR sources, the drains stay
  idle (verified). SG-2: with no PA governed version, the copilot is a drafting aid — is that stated
  in the product?
- **Method:** L1 pgTAP (`org_baa_gated_ai`, `compliance_copilot`, `integration_command_contracts`,
  `fhir_*`, `per_facility_and_writeback`, `citation_verification_governance`); L3 BAA acceptance on
  the canary organization, one document-analyzer run on a synthetic PDF, one course-generation run,
  the gateway's `/health` if deployed.
- **Pass:** a written per-feature launch posture; `platform_settings` matches it; `DEPLOYMENT.md`
  matches it; the BAA flow stamps the organization.

### K. Data import, export and lifecycle

- **Scope:** `/app/data-imports` (8 domains, `bulk-import-*`, column mapping, samples), the durable
  worker (`process-data-import-jobs`, every 5 min) and rollback, `/app/enterprise` exports
  (`process-organization-export-jobs`, expiry, consent exclusions), `run-data-lifecycle` (nightly,
  `data_lifecycle_policies`), the demo tenant (`provision-demo-tenant`, daily baseline restore),
  audit export and manifest (`reconcile-audit-integrity-daily`).
- **Questions:** Does each of the 8 domains dry-run, map, apply through the worker after the browser
  is closed, and roll back? Does an export of the demo organization complete, download, and expire?
  Are retention policies defined for the PHI-bearing tables (`docs/HIPAA_CLINICAL_DATA.md` calls this
  partial)? Does the daily audit-integrity job stay green after the walkthroughs?
- **Method:** L1 pgTAP (`data_import_apply_lease`, `room_import_bed_reconciliation`,
  `organization_export_expiry`, `evidence_survives_truncate`, `audit_manifest_covers_every_table`);
  L3 W12 with the three sample CSVs plus one file per remaining domain, then an export.
- **Pass:** all 8 domains apply and roll back on the demo tenant; the export downloads and later
  expires; every PHI table has a lifecycle policy row or a dated "none at launch" decision.

### L. Background jobs and observability

- **Scope:** 47 cron jobs, `app_private.system_job_definitions` / `system_job_runs`, the watchdog
  (every 5 min), `/admin/system-jobs` (rerun, dead-letter replay, kill switches),
  `phase1-synthetic-health`, `/admin` health tiles, `get-platform-status`, `report-client-error`
  and its rate limit, `capture-product-event`, the Supabase log stream.
- **Questions:** How does the owner learn a critical job failed when not looking at `/admin`? Today
  the path is an in-app notification (which B3 blocks from reaching a phone). Which of the 36
  critical definitions should page? Does a `running` row past its SLA count as a failure? Is there
  an external uptime check on `/health` and `get-platform-status`? Are logs free of PHI and how long
  are they retained?
- **Method:** L3 Appendix C queries 2–5 weekly until launch; L2 force a failure (kill switch, then
  a bad secret) and confirm the watchdog flips and a notification enqueues; review
  `/admin/system-jobs` for the stranded run in B4.
- **Pass:** B5 closed; N1 decided; no `running` row older than its SLA; the owner received an
  out-of-band (email or SMS) alert for a forced critical failure; an external monitor exists.

### M. Public, marketing, legal and self-serve

- **Scope:** `/`, `/features`, `/how-it-works`, `/who-its-for`, `/faq`, `/savings`
  (`email-savings-model`), `/security`, `/privacy`, `/terms`, `/legal/facility-signup`, `/request-demo`,
  `/demo` (`provision-demo-tenant`), `/regulatory-updates` (`subscribe-updates`, `unsubscribe-updates`),
  `/pa-training-requirements`, `/pa-dhs-citations`, `/verify/:slug`, `/passport/:slug`,
  `/report-safety`, sitemap and prerendered heads, the help-center manual PDF (`generate:manual`).
- **Questions:** Terminology lock — "Assisted Living Facility (ALF)" everywhere customer-facing,
  never "Assisted Living Residence" or "ALR" (`Landing.copy.test.ts` and `20260805170000` guard
  this; grep the customer strings once more). Pricing copy equals the catalog ($239 / $499 flat,
  annual $2,390 / $4,990). Terms and Privacy confirmed by counsel for the clinical-record language
  (N9), and the legal versions recorded at signup match the published pages. The public demo
  sandbox runs only where `VITE_ENABLE_PUBLIC_DEMO=true`, with unique credentials, in a demo
  organization. Request-demo notifies platform admins (F8) — which, again, needs B3 to reach a phone.
  Newsletter double opt-in and unsubscribe. Sitemap and meta for the marketing routes.
- **Method:** L1 e2e (`public-smoke`, `public-token-negatives`, mobile public), `Landing.copy.test.ts`;
  L3 read every legal page against counsel's approved text; submit one demo request and one
  newsletter subscription from outside.
- **Pass:** counsel sign-off recorded; copy tests green; the demo host and the customer host are
  different builds; a demo request produced a platform-admin notification.

### N. Accessibility, mobile, performance and resilience

- **Scope:** axe in the e2e suites, `mobile-workflows.spec.ts`, `check:bundle` (first load is five
  preloaded chunks, ~220 KiB brotli per F5), `docs/audits/RLS_ROW_FILTER_COST.md`,
  `rls_policy_plan_optimization`, server-side pagination (training matrix, work queue, reports),
  the PWA and offline modes, the Supabase compute tier and `auth_db_connections_absolute`.
- **Questions:** Critical axe findings on the journey pages (G121 and the label sweeps are done;
  re-run). A tablet on facility wifi: Today, Work Queue, Training Matrix, Floor. No load test exists:
  on an L2 stack seeded with a synthetic tenant (5 facilities, 500 employees, 200 residents), what
  are p95 timings for `org_dashboard_summary`, the matrix RPC, `work_item_queue`, and the resident
  compliance recalc? Connection pool headroom with 47 cron jobs plus edge workers plus users?
- **Method:** L1 e2e; L2 the synthetic seed with `EXPLAIN (ANALYZE, BUFFERS)` on the four RPCs;
  L3 the compute add-on and pool settings in the dashboard.
- **Pass:** axe critical = 0; p95 under 2 s for the four RPCs on the synthetic tenant; a written
  pool budget.

### O. Documentation, runbooks and support

- **Scope:** `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `BILLING_MODEL.md`,
  `PRODUCT_MODULES.md`, `docs/HIPAA_CLINICAL_DATA.md`, `ENTERPRISE_OPERATIONS_RUNBOOK.md`,
  `PHASE1_OPERATIONS.md`, `docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md`, `/app/help`, `/admin/help-content`,
  the user manual PDF, implementation tasks (`src/lib/implementationReadiness.ts`).
- **Questions:** N6 and N7. Who answers a support ticket and within what time? What is the
  onboarding checklist for a new customer, and does the in-app implementation-readiness feature carry
  it? Where is the restore rehearsal recorded?
- **Method:** write the backup/restore runbook and the incident-response runbook (one page each);
  rehearse a restore into a branch or staging project; update the three drifted documents.
- **Pass:** both runbooks exist; a restore was rehearsed with evidence; `DEPLOYMENT.md`,
  `ARCHITECTURE.md` and the project name agree with production.

---

## 7. End-to-end workflow scripts

These are the "workflows" review. Each is run by a named role, on the named environment, and its
evidence is a transcript (steps, timestamps, screenshots) kept outside the repository. A script
passes only if every expected result was observed, not if the steps merely completed.

| ID | Role · environment | Script | Expected results |
| --- | --- | --- | --- |
| **W1** | New customer · production, canary organization, real mailbox and phone | `/signup` (Turnstile) → organization created → invitation email → set password → MFA enrol → create a personal care home facility → add one employee with an email → assign a published course → sign in as that employee → complete the course → open the certificate → `/verify/:slug` → queue a compliance binder → download it | Every email arrives within two minutes; an `organization_settings` row exists and `organizations.trial_ends_at` is stamped; the certificate PDF is `ready` within five minutes; the binder downloads via a signed URL that expires; no row in the client error reports; audit rows for each step |
| **W2** | `org_admin` · demo tenant | Today → Work Queue → report an incident (`/app/report-event`) → mark reportable → generate the incident PDF and the state-form PDF → follow-through steps → resolve; log a fire drill → monthly tracker PDF | Deadlines shown on the facility day; both PDFs open; the incident appears in trends; a notification is enqueued to the facility manager (delivered once B3 is closed) |
| **W3** | `org_admin` · demo tenant | Create a violation → corrective actions → retraining assignment → submit POC v1 → view versions → attempt verify while an action is open (refused) → close actions → verify → check the escalation flags after moving `poc_due_date` | Version history immutable; verify refused with the specific reason; due-soon and overdue flags clear when the date moves |
| **W4** | `org_admin` then guest · demo tenant | Start Survey Day → entrance conference items → add packet items with citation refs → package the packet → create a guest grant → open the guest link in a private window → accept terms → download → revoke the grant → reload | Packet ordered by citation; guest sees only granted artifacts; revoked link refuses immediately; session expiry job clears the Survey Day session |
| **W5** | `org_admin` and `employee` · demo tenant, twice (mid-afternoon and after 20:00 Eastern) | Admit → assessment form → state-approved form gate → support plan proposal → activation → service tasks appear on Floor → document one task online and one offline (airplane mode) → reconnect and sync → change of condition → hospital transfer → return with reconciliation → discharge; share a document through the designated-person portal with consent `granted`, then `revoked` | Mirrors the 12 e2e steps; task dates on the facility day at both times; the offline draft syncs from the chart page without navigating; the portal share is refused once consent is revoked; access-log rows for the chart reads |
| **W6** | `org_admin` · demo tenant | Hire an employee → on-hire screening result recorded → upload a credential → OCR renewal suggestion → confirm → practicum window shown → schedule a med-admin shift and see the authorization badge → attempt an ineligible duty (blocked, override audited) → terminate → lifecycle case closes → the employee's login is refused | Screening cites the source and snapshot date; override appears in the audit log; termination revokes within one request |
| **W7** | `trainer` · demo tenant | Create a class → class notice PDF with QR → open the kiosk → check in with a rotating token (and a stale one, refused) → complete with verified seat time → correct a completed class through the audited RPC → retraining monitor reflects it | Stale token refused; seat time drives completion; correction leaves an audit row; kiosk idle-locks |
| **W8** | `employee` · demo tenant, on a phone | `/me` → my trainings → open a course → my shift → services queue → attestation → schedule → offline draft on the chart → sync | No horizontal overflow; primary actions reachable; the offline toast's promise is kept |
| **W9** | `org_admin` and owner · Stripe test mode, then live on the internal organization | Billing & plans → Checkout (Train monthly, then CareBase annual) → webhook event row → subscription row → Customer Portal → cancel; on an L2 stack, shift `trial_ends_at` into the past and sign in | Quantity 1; flat amount; reconciliation into `billing_subscriptions`; the expiry copy and lockout scope match the decision in area I |
| **W10** | `platform_admin` · production | `/admin` → System jobs (rerun a job, replay a dead letter, flip a kill switch and back) → release flags → impersonate an org user → exit → audit rows → suspend the demo organization → confirm its users are refused → unsuspend → packages | Every action leaves an audit row; impersonation exit restores the admin session (G23.4); suspension is enforced at the edge functions too |
| **W11** | `auditor` · demo tenant | Walk every `/app/*` page the auditor can see; attempt one write per page through the UI (no control should exist) and one write RPC through PostgREST with the auditor JWT | Zero writable controls; the RPC attempt returns `42501` |
| **W12** | `org_admin` · demo tenant | Data Import Center: employees sample CSV with two renamed columns → mapping suggested, reviewed, applied → dry run → apply → close the browser mid-apply → reopen → the worker finished it → roll back | The ledger shows the resumed apply; rollback restores the pre-import state; receipts per row |

---

## 8. Gate execution matrix

Run on the pinned toolchain (`.node-version` 24.15.0, `packageManager` pnpm 11.13.0, Deno 2.5.6,
Docker for anything database-shaped). `bash scripts/setup-codex-cloud.sh` installs the pins.

| Command | Lane | Proves | Expected | Status 2026-09-04 |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | L1 | lockfile integrity | clean | ✅ (install succeeded here) |
| `pnpm run typecheck` | L1 | 0 type errors in CareBase, scripts, voice-gateway | 0 errors | ✅ via direct `tsc` (see Appendix A) |
| `pnpm run test` | L1 | unit + render suites | all green | ✅ 1,697 + 79 tests |
| `pnpm run check:all` | L1 | the 13 static checks, self-tests, edge `deno check`, builds, startup, bundle | green | ✅ static checks, build, `check:startup`, `check:bundle` (with the N14 warning); edge `deno check` **not run here** (no Deno) |
| `pnpm run check:database` | L1 | full migration replay, pgTAP (145 files), `db lint --fail-on error`, advisors `--fail-on error`, generated-types diff | green | ⏳ CI's `database` job was green on `main` 2026-09-01; not re-run here (no Docker) |
| `pnpm --filter @workspace/caremetric-carebase run test:e2e` | L1 | 7 Playwright specs incl. axe and the 12-step resident journey | green | ⏳ same |
| `pnpm run check:release` | L1 | dependencies + all + database | green | ❌ `check-dependencies` strict mode is red on `main` (B8) |
| `node scripts/check-dependencies.mjs` | L1 | live advisory audit | 0 high/critical | ❌ 6 HIGH (B8); the endpoint itself answered 503 and then timed out on this document's PR run (N15) |
| `node scripts/check-dhs-sources.mjs` | L1 (network) | DHS links + human review age ≤ 45 days | green | ❌ 53 days (B9) |
| `node scripts/check-planning-registers.mjs` | L1 | register freshness, singularity, standing-gap dates | green | ❌ SG-2 (B1) |
| `deploy-migrations.yml` → `workflow_dispatch` with `dry_run` | L1 | migration and edge-function drift against production | "no drift" | ⏳ run once after B1; checksum parity already confirmed by probe |
| `.claude/skills/verify/SKILL.md` probes | L1/L3 | Railway server behaviour | all pass | ⏳ |
| Appendix C queries | L3 | production posture | per query | run 2026-09-04; rerun weekly |

---

## 9. Go / No-Go

**Go requires all of the following, each with evidence named in a BACKLOG.md row:**

1. B1–B10 closed.
2. W1 passed end to end on production with a real mailbox and a real phone.
3. CI green on `main`, including the `database` job and Playwright, on the pinned toolchain; the
   `deploy-migrations` dry run reports no drift.
4. `phase1-synthetic-health` green for 24 consecutive hours and no `system_job_runs` row `running`
   past its SLA.
5. The advisor WARN list triaged with a written decision per class (section 5, N1–N4).
6. A per-feature AI launch posture written down and matching `platform_settings` (N5).
7. Counsel confirmation of the Terms/Privacy clinical-record language on file (N9) and the
   customer BAA executed for the first paying organization (A5).
8. A restore rehearsed from backup and both one-page runbooks written (N7).
9. The owner receives an out-of-band alert for a forced critical job failure (area L).
10. The area reviews A–O each have a Pass line met or a dated exception in BACKLOG.md.

**Explicitly accepted at launch if recorded** (move to "Explicitly not now" or a dated row): real
vendor SCORM packages (B3), the export worker's memory ceiling (N11), SG-4's disposition (N8),
multi-state rule packs, unused-index cleanup (N4), HSTS preload (N12), and G270 if replaced by the
weekly manual probe (N1).

---

## 10. Sequence

Single-threaded, in this order. Sizes are the register's (`S` days, `M` 1–2 weeks, `L` multi-week).
Do not start a block until the previous one is done; the exception is A5 (BAA execution), which
waits on someone else's calendar and should be started on day one.

| # | Block | Contents | Size |
| --- | --- | --- | --- |
| 0 | **Unblock the gates** | B1 (decide SG-2), B8 (two overrides), B9 (re-verify DHS sources). All three are green-CI prerequisites for everything after | S |
| 1 | **Live truth** | B2 Stripe; B3 provider secrets, `organization_settings` backfill migration, real delivery test; B6/B7 auth hardening and MFA; B10 the real organization's status; N5 AI posture | M |
| 2 | **Screening and health** | B4 exclusion screening repair and the SAM decision; B5 synthetic-health repair; N1 decision on critical-job observability; external uptime check; out-of-band alert test | S–M |
| 3 | **Full gate run** | `check:release` on the pinned toolchain; the `database` and e2e jobs; the deploy dry run; the verify-skill probes; Appendix C queries recorded as the pre-review baseline | S |
| 4 | **Area reviews, security first** | C (tenancy), B (identity), then D (Train, the first revenue path), E, F, G (CareBase depth), H, I, J, K, L, with the W-scripts as each area's walkthrough | L |
| 5 | **Public, legal, docs** | M and O: counsel confirmations, runbooks, restore rehearsal, doc drift, N2/N3 advisor records | S |
| 6 | **Go / No-Go** | Section 9 walked line by line; the canary organization from W1 becomes the first "customer" for a week before the first paying one | S |

Time spent before block 4 is mostly waiting on providers and dashboards, not code; block 4 is the
real review and is where a second reader would help most. If none is available, prioritise C, B and
D inside it — a tenancy or identity defect is unrecoverable in a regulated product, and Train is the
product a first customer buys.

---

## Appendix A — Reconnaissance log (2026-09-04)

All read-only. Numbers in sections 1–5 come from here.

| # | Probe | Result |
| --- | --- | --- |
| A1 | `git log origin/main`, `git status` | head `0bc0b48`; branch clean |
| A2 | `ls supabase/migrations`, `ls supabase/functions`, `ls supabase/tests/database`, `grep -o 'path="' App.tsx` | 603 / 73 / 145 / 217 |
| A3 | `node scripts/check-planning-registers.mjs` | **FAIL**: SG-2 passed its review date |
| A4 | 13 static checks run directly with `node scripts/<check>.mjs` | all pass: source-integrity (2,130 files), migration-policies (275 migrations after baseline), edge-function-auth (73 functions, 34 gated), raise-arity, database-types-format (438 entries), journey-coverage (12/12), date-only-parsing (96 DATE columns), dormant-rpcs (570 granted functions), unrendered-hooks (936 hooks), server-route-links (217 routes), frontend-route-links (1,343 link literals), rpc-call-signatures (827 functions), query-invalidations (270 roots) |
| A5 | `--self-test` for migration-drift, edge-function-drift, migration-immutability, planning-registers, dormant-rpcs | all pass |
| A6 | `node scripts/check-dhs-sources.mjs` | **FAIL**: human review 53 days old (limit 45); 35/35 and 2/2 links resolve |
| A7 | `node scripts/check-dependencies.mjs` | could not complete here (TLS timeout through the session proxy); CI's 2026-09-03 run: 6 HIGH; the PR's own CI run at 05:01–05:08 UTC got `503 Service Unavailable` and timeouts from the advisory endpoint (N15) |
| A8 | `pnpm run typecheck` / `pnpm run test` via the workspace scripts | refused by the `engines` pin (this container has Node 22 and a pnpm 10 shim first on `PATH`); rerun with the workspace binaries: CareBase `tsc` 0 errors; `scripts` 0; `voice-gateway` 0; vitest CareBase 168 files / 1,697 tests green; voice-gateway 7 / 79 green |
| A9 | Production build (`vite build` + prerender + precompress), `check:bundle`, `check:startup`, voice-gateway build, through a pnpm 11.13 shim | all pass: build ends with `precompress: 442 compressible files scanned, 880 variants written`; `check:bundle` passes but warns that the largest chunk (`index`, 564.6 KiB) is over 90% of its 620 KiB budget (N14); `check:startup` passes; voice-gateway builds |
| A10 | Supabase `get_project` | `CM Train`, us-west-2, PG 17.6.1.141, `ACTIVE_HEALTHY` |
| A11 | `select count(*), min, max, md5(string_agg(version…)) from supabase_migrations.schema_migrations` vs the same over the repo file list | 603 / 603; md5 identical (`ec83f358…`) |
| A12 | Supabase `list_edge_functions` vs `ls supabase/functions` | 73 / 73, all `ACTIVE`, updated 2026-08-31 |
| A13 | GitHub Actions: `ci.yml` on `main`, `deploy-migrations.yml`, `dhs-source-freshness.yml`, `dependency-advisories.yml` | CI success 2026-09-01; deploy #175 success; DHS freshness **failure** 2026-08-31; advisories **failure** 2026-09-02 and 09-03 (job log names the six advisories) |
| A14 | `cron.job`, `cron.job_run_details` (7 days) | 47 active; every run `succeeded` |
| A15 | `app_private.system_job_definitions` joined to latest `system_job_runs` | 52 definitions; billing sync circuit open; synthetic health failing; exclusion-screening `running` since 2026-08-12; 22 critical definitions with no ledger |
| A16 | `exclusion_source_state`, `exclusion_source_health`, `exclusion_refresh_runs`, `exclusion_list_entries` count, `exclusion_screening_matches` count | LEIE stale (2026-07-12, 80,192 rows), SAM `not_loaded`, staging run 0 rows, 157,192 list entries, 0 matches |
| A17 | Aggregates: organizations (by `is_demo`, status, trial, BAA), profiles by role, `auth.users`, `auth.mfa_factors`, `identity_security_policies`, facilities, employees, residents, `organization_settings`, `notification_deliveries`, `stripe_billing_events`, `billing_subscriptions`, `regulatory_rule_*`, courses/versions, certificates, assignments by status, `audit_logs`, `storage.buckets`, `platform_settings`, `release_flags`, `pg_extension` | as in section 3 |
| A18 | Supabase `get_advisors` (security, performance), summarised with `jq` | 580 security lints, 1,507 performance lints (section 3.4) |
| A19 | Log stream (24 h): sources, 4xx/5xx by function path, Postgres errors | only `sync-billing-quantities` 503 ×24; no Postgres errors other than one probe of a non-existent table |
| A20 | `curl https://cmcarebase.com/health`, root headers, `/login` title | `status: ok`; headers as in section 1; title "Log In — CareMetric CareBase" |

## Appendix B — Inventory

**Edge-function secrets referenced by literal name in code (45):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ANON_KEY` (platform-provided); `ANTHROPIC_API_KEY`, `ANTHROPIC_BAA_CONFIRMED`,
`ANTHROPIC_DOCUMENT_ANALYZER_MODEL`, `ANTHROPIC_CREDENTIAL_RENEWAL_MODEL`; `HEYGEN_API_KEY`;
`SENDGRID_API_KEY`, `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY`, `NOTIFICATION_FROM_EMAIL`,
`NOTIFICATION_RECIPIENT_HASH_SECRET`; `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
`TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_NOTIFICATION_STATUS_CALLBACK_URL`; `WEB_PUSH_VAPID_PUBLIC_KEY`,
`WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`; `STRIPE_SECRET_KEY`,
`STRIPE_BILLING_WEBHOOK_SECRET` (read through the shared billing helper), `CRON_SHARED_SECRET`;
`TURNSTILE_SECRET_KEY`, `SIGNUP_TURNSTILE_SECRET_KEY`, `SIGNUP_RATE_LIMIT_PEPPER`,
`SIGNUP_MAX_ORGANIZATIONS_PER_DAY`, `SIGNUP_MAX_IP_ATTEMPTS_PER_HOUR`, `SIGNUP_MAX_EMAIL_ATTEMPTS_PER_DAY`,
`SIGNUP_REDIRECT_ORIGINS`, `ALLOW_LOCALHOST_SIGNUP_REDIRECTS`; `PUBLIC_APP_URL`, `PUBLIC_SITE_URL`,
`SITE_URL`, `CF_FRONTED`; `SEND_EMAIL_HOOK_SECRET`; `DEMO_PROVISION_SECRET`, `DEMO_ACCOUNT_PASSWORD`,
`DEMO_RATE_LIMIT_PEPPER`, `DEMO_MAX_IP_REQUESTS_PER_HOUR`; `NEWSLETTER_RATE_LIMIT_PEPPER`,
`NEWSLETTER_MAX_IP_REQUESTS_PER_HOUR`, `NEWSLETTER_GLOBAL_MAX_WELCOME_SENDS_PER_HOUR`;
`SAVINGS_MAX_IP_REQUESTS_PER_HOUR`, `SAVINGS_GLOBAL_MAX_SENDS_PER_HOUR`; `INTAKE_RATE_LIMIT_SALT`;
`SAM_GOV_API_KEY`. The review records which are set (`supabase secrets list`, names only), never values.

**Cron jobs that call an edge function (16 of 47):** billing-quantity-sync, dispatch-notification-deliveries,
drain-fhir-writeback-queue, integration-webhook-dispatch, monthly-exclusion-screening,
poll-heygen-video-statuses, poll-regulatory-updates-weekly, process-binder-export-jobs,
process-certificate-pdf-jobs, process-credential-renewals (hard-coded project URL rather than
`require_functions_base_url()` — note for area L), process-document-analyzer-jobs,
process-durable-data-imports, process-organization-export-jobs, resume-sam-exclusion-screening,
run-data-lifecycle-nightly, send-regulatory-digest-weekly. The other 31 call SQL functions directly.

**Critical definitions without a run ledger (22):** billing-trial-expiry, binder-export-jobs,
certificate-pdf-jobs, change-followup-escalation, compliance-requirement-maintenance, data-lifecycle,
document-analyzer-jobs, fhir-integration-freshness, integration-command-inbox-drain,
integration-webhook-dispatch-cron, medication-integration-freshness, organization-data-export,
organization-export-jobs, plan-of-correction-escalation, policy-campaign-recurrence,
policy-campaign-targeting, resident-service-task-generation, shift-handoff-escalation,
support-plan-activation, system-job-watchdog, work-item-escalation, work-item-registration.

## Appendix C — Production probes (read-only, re-runnable)

Run from the SQL editor or the Supabase MCP `execute_sql`. None writes.

```sql
-- 1. Migration parity: compare md5 with `ls supabase/migrations | sed -E 's/^([0-9]+)_.*/\1/' | sort | paste -sd, | tr -d '\n' | md5sum`
select count(*) as n, min(version), max(version),
       md5(string_agg(version, ',' order by version)) as md5
from supabase_migrations.schema_migrations;

-- 2. Critical job health: circuit state, last good, latest run
with latest as (
  select distinct on (job_key) job_key, status, started_at, error_code, left(error_message, 120) as error_message
  from app_private.system_job_runs order by job_key, started_at desc)
select d.job_key, d.execution_kind, d.is_critical, d.circuit_state, d.cron_job_name,
       d.last_known_good_at, l.status, l.started_at, l.error_code, l.error_message
from app_private.system_job_definitions d left join latest l using (job_key)
where d.is_active order by d.is_critical desc, d.job_key;

-- 3. Stranded runs: running past their definition's freshness SLA
select r.job_key, r.started_at, r.last_heartbeat_at, d.freshness_sla
from app_private.system_job_runs r join app_private.system_job_definitions d using (job_key)
where r.status = 'running' and r.started_at < now() - d.freshness_sla;

-- 4. pg_cron truth for the definitions with no ledger (N1)
select j.jobname, d.status, count(*) as runs, max(d.start_time) as last_start
from cron.job_run_details d join cron.job j using (jobid)
where d.start_time > now() - interval '7 days'
group by 1, 2 order by 1, 2;

-- 5. Exclusion-screening data freshness
select source, health_status, is_stale, active_since, active_record_count, last_attempt_at, last_success_at
from public.exclusion_source_health;

-- 6. Certificates and completions
select
  (select count(*) from public.certificates where pdf_status <> 'ready') as certificates_pdf_not_ready,
  (select count(*) from public.course_assignments ca
     where ca.status = 'completed'
       and not exists (select 1 from public.certificates c where c.course_assignment_id = ca.id)) as completed_without_certificate;

-- 7. Tenant configuration completeness
select o.id, o.is_demo, o.subscription_status, o.trial_ends_at, o.baa_version,
       (s.organization_id is not null) as has_settings
from public.organizations o left join public.organization_settings s on s.organization_id = o.id;

-- 8. Notification pipeline (30 days)
select status, final_outcome, skip_reason, count(*)
from public.notification_deliveries where created_at > now() - interval '30 days'
group by 1, 2, 3 order by 4 desc;

-- 9. Billing reconciliation
select (select count(*) from app_private.stripe_billing_events) as stripe_events,
       (select count(*) from public.billing_subscriptions) as subscriptions;

-- 10. Privileged accounts without MFA
select p.role, count(*) filter (where f.id is null) as without_factor, count(*) as total
from public.profiles p
left join auth.mfa_factors f on f.user_id = p.id and f.status = 'verified'
where p.is_active and p.role in ('platform_admin', 'org_admin', 'facility_manager')
group by 1;
```

Log-stream probe (Supabase `query_logs`, last 24 h):

```sql
select log_attributes['request.pathname'] as path, log_attributes['response.status_code'] as status, count(*) as n
from logs where source = 'function_edge_logs' and toUInt32OrZero(log_attributes['response.status_code']) >= 400
group by path, status order by n desc;
```

## Appendix D — Advisor triage lists

**`function_search_path_mutable` (7):** `public.pa_today`, `pa_day`, `pa_clock`, `pa_now`,
`pa_midnight`, `pa_week_start` (deliberate, documented in `20260727050000` — keep, and say so in the
review record); `app_private.clinical_disclosure_allowed` (N2 — pin).

**`anon_security_definer_function_executable` (20), all token- or slug-gated public surfaces:**
`accept_evidence_guest_terms`, `accept_move_in_guest_terms`, `accept_resident_agreement_guest_terms`,
`accept_resident_portal_terms`, `authorize_evidence_guest_artifact`,
`authorize_resident_portal_document_download`, `get_evidence_guest_room`, `get_move_in_guest_workspace`,
`get_resident_agreement_guest_workspace`, `get_resident_portal_experience`, `get_resident_portal_snapshot`,
`list_regulatory_updates`, `post_resident_portal_message`, `post_resident_portal_request`,
`resolve_safety_report_facility`, `respond_resident_portal_schedule_event`,
`respond_to_resident_agreement_guest`, `sign_move_in_guest_task`, `verify_certificate`,
`verify_training_passport`. For each, the N3 record states: how the token is validated, its expiry,
the rate limit, and the audit row it writes.

**`multiple_permissive_policies` (31 tables):** assessor_qualifications, certification_attempt_items,
certification_checklist_items, certification_definition_versions, certification_definitions,
employee_availability_windows, employee_facility_assignments, employee_schedule_preferences,
employee_training_hour_buckets, facility_assignments, facility_units, help_articles,
hris_source_systems, identity_security_policies, maintenance_locations, open_shift_opportunities,
organization_settings, organization_sso_connections, package_billing_prices, packages,
platform_settings, policy_documents, preventive_maintenance_schedules, regulatory_rule_golden_fixtures,
schedules, scim_group_mappings, service_workload_profiles, shift_definitions,
shift_eligibility_requirements, training_class_attendees, and one more reported past the first
thirty in the raw output. Performance only; N4.
