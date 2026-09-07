# CI/CD workflow review and plan

> **Not the backlog.** See [BACKLOG.md](../../BACKLOG.md) for open work; every finding below is a
> Tier K row there, and that row is where status lives. This document is the review of the
> repository's GitHub Actions workflows -- what each one does, what its run history shows, what
> needs looking at, and the order to fix it in. It carries no status of its own and is not
> re-dated when rows close.

**Prepared:** 2026-09-07 (evening UTC), against `main` @ `9d5072f` (PR #501, deployed by run 190 at
22:08 UTC). Run history, issues and job timings were read from the GitHub API on the same evening.
The review was written before anything was changed, because the owner asked for the plan first.

**Status:** all ten code findings (K1–K10) were then implemented on the same branch, in the order
section 6 sets out. K11 is dashboard-side and remains the owner's. The findings below are left as
they were written — they are the evidence, and rewriting them in the past tense would lose it;
section 6 records what was done, what was verified, and the three places the implementation
deliberately departed from the plan. Status for each finding lives in its `BACKLOG.md` Tier K row,
not here.

---

## 1. Scope and method

"Workflows" here means the automation under `.github/`: the four workflow files, the two composite
actions they share, the Dependabot configuration, and the scripts those workflows invoke. Every
file was read in full, every script a workflow runs was read at least to its entry point, and the
claims each workflow makes in its comments were checked against the live run history rather than
taken on trust.

Evidence used:

| Source | What was read |
| --- | --- |
| `.github/workflows/*.yml`, `.github/actions/*/action.yml`, `.github/dependabot.yml` | every line |
| `scripts/check-*.mjs`, `scripts/prune-removed-edge-functions.mjs`, `scripts/stamp-edge-function-deploy.mjs` | full text of every script a workflow calls |
| GitHub Actions API | last 60 `push`-to-`main` CI runs, last 40 CI runs overall, last 40 deploy runs, all 35 advisory runs, all 8 DHS runs, per-job timings for CI run 2069 and deploy run 190 |
| GitHub Issues API | 2 open issues, 32 closed since 2026-08-20 |
| Job logs | deploy runs 185 and 188, advisory run 32, DHS run 7, CI run 2055 |
| `DEPLOYMENT.md`, `ARCHITECTURE.md`, `AGENTS.md`, `MIGRATION_DEPLOYMENT_AUDIT.md`, `BACKLOG.md` | the parts that describe the pipeline |

What was **not** done: no workflow was executed locally, branch-protection and environment settings
were not read (they need repository admin; see section 7), and the pinned action SHAs were not
re-verified against their upstream tags (Dependabot owns those bumps and the pins are all current
releases).

---

## 2. Inventory

| File | Trigger | Jobs | Purpose |
| --- | --- | --- | --- |
| `ci.yml` (614 lines) | `pull_request`; `push` to `main` | `changes` → `application`, `database`, `migration-immutability`, `planning-registers`, `secret-scan` → `ci-result` | Path-aware validation. `ci-result` is the single required check. |
| `deploy-migrations.yml` (467 lines) | `workflow_run` of CI on `main` (success, `push`, same repo); `workflow_dispatch` with `dry_run` / `force` | `deploy` (gated on the `production` environment), `notify-failure` | Apply migrations, deploy edge functions, prune removed functions, verify drift, stamp the deploy. |
| `dependency-advisories.yml` (116 lines) | daily 06:23 UTC; dispatch | `audit-main` | Strict audit of `main` against the live npm advisory database; opens/bumps one `[deps]` issue. |
| `dhs-source-freshness.yml` (129 lines) | Mondays 13:17 UTC; dispatch | `official-source-health` | Probes every PA.gov / pacodeandbulletin.gov source URL and the two human-review stamps; opens/bumps one `[dhs]` issue. |
| `actions/setup-node-pnpm` | composite | -- | Node from `.node-version`, pnpm 11.13.0 via corepack, store cache, frozen install. |
| `actions/setup-supabase-cli` | composite | -- | Supabase CLI 2.109.1 (the same binary CI validates with and the deploy pushes with). |
| `dependabot.yml` | weekly | -- | GitHub Actions ecosystem only, `/` and `/.github/actions/*`, one grouped PR. |

GitHub also runs three managed workflows that are not files in this repository: Copilot code
review, Copilot cloud agent, and Dependabot Updates. They are listed here so nobody looks for them.

Scripts the workflows depend on, and which workflow owns each:

| Script | Called by | Needs |
| --- | --- | --- |
| `check-dependencies.mjs` | CI `application` (with `--base` on PRs), advisories (strict) | network to registry.npmjs.org |
| `check-planning-registers.mjs` | CI `planning-registers` (PR/tree mode), and again inside `check:all` | git history |
| `check-migration-immutability.mjs` | CI `migration-immutability` | git history; deliberately no Supabase token on PRs |
| `check-migration-drift.mjs` | deploy (post-push) | `SUPABASE_ACCESS_TOKEN`, `libpg-query` |
| `check-edge-function-drift.mjs`, `prune-removed-edge-functions.mjs`, `stamp-edge-function-deploy.mjs` | deploy | `SUPABASE_ACCESS_TOKEN` |
| `check-dhs-sources.mjs` | DHS | network to pa.gov |
| `seed-course-video-placeholders.mjs` | CI `database` | loopback Supabase only (refuses anything else) |
| `check:all` (twenty-odd static checks, typecheck, unit tests, `deno check`, builds, startup, bundle budget) | CI `application` | Deno 2.5.6 |

---

## 3. What the run history says

Read on the evening of 2026-09-07. Counts are from the API, not estimates.

**CI.** 1,936 runs in total, 353 of them pushes to `main`. Of the last 60 `main` pushes (2026-08-01
to 2026-09-07), 45 were green and 15 red. Fourteen of the fifteen reds fall between 2026-08-01 and
2026-08-13; the only one since is `ae5710b` on 2026-09-06. A green `main` run takes 7--12 minutes
wall clock (median 9). Per job on run 2069 (`9d5072f`):

| Job | Duration | Where the time goes |
| --- | --- | --- |
| `changes` | 7 s | partial-clone checkout, diff |
| `secret-scan` | 16 s | full clone + gitleaks |
| `planning-registers` | 15 s | partial clone + check |
| `application` | 4 m 25 s | `check:all` 3 m 51 s |
| `database` | 7 m 36 s | stack start 1 m 43 s, pgTAP 1 m 01 s, build 30 s, Playwright 3 m 06 s |
| `ci-result` | 2 s | aggregate |

The comments in `ci.yml` and `dependabot.yml` describe `database` as "the 45-minute `database` job"
with "581 migrations". It is an 8-minute job with 681 migrations. The 45-minute figure is the
timeout, which is fine as headroom, but it is quoted as the cost of running the job and that
overstates it fivefold.

**Deploy.** 190 runs. Of the last 40 (2026-08-05 onward): 30 succeeded, 2 failed (runs 185 and 188,
both on 2026-09-07), 2 were cancelled on their second attempt (runs 177 and 178, the I30 saturation
incident on 2026-09-05), 8 were skipped because the CI run that triggered them was red, and 2 were
manual dispatches. A green deploy takes 2.5--3.5 minutes; `supabase functions deploy` of all 72
functions is 1 m 50 s of that. The two failures:

- **Run 185** (`738ac02`, 05:59 UTC): `db push` applied 24 migrations cleanly, then the drift check
  reported one CONTENT mismatch on `20260906230000` -- a checker bug (it dropped a trailing comment
  block; BACKLOG J95), fixed by #496 an hour later. Production carried the new schema with the
  previous edge functions for that hour. Issue #495 was opened by `notify-failure` and is still
  open.
- **Run 188** (`d332ddf`, 18:55 UTC): `db push` refused to run: "Remote migration versions not found
  in local migrations directory ... `20260907184641`". A migration had been applied to production
  out-of-band (the Support Hub release), #497 merged before the file recording it existed, and the
  deploy of #497 -- edge-function changes included -- was blocked until #499 added the ledger file
  34 minutes later. Issue #500 was opened and is still open.

**Dependency advisories.** 35 runs. Red on 2026-09-02 and 09-03 for a real high-severity Browserslist
advisory (#482, fixed by #485 on 09-06), and red on 2026-09-04 for a different reason entirely: the
advisory endpoint timed out three times at 60 s each, the script threw, the step failed, and the
workflow commented "Still failing" on #482 as though the advisory were the cause.

**DHS source freshness.** 8 runs. One failure, 2026-08-31: all 35 form links and both regulation
links returned 200; the failure was `DHS_FORMS_LAST_VERIFIED` at 49 days against a 45-day limit.
Issue #481 opened and stayed open until the stamp was refreshed on 2026-09-06.

**Issues.** Two open, both `[deploy]`, both for deploys that a later run already superseded. Since
2026-08-20, 32 automated issues closed: 28 `[deploy]` issues from 2026-08-01..05 closed by hand on
2026-09-05 (BACKLOG I24), the two I30 issues, one `[deps]`, one `[dhs]`.

---

## 4. Findings

Priority follows the repository's own scale: P1 is a wrong or missing production signal, P2 is a gap
a plausible event turns into a P1, P3 is drift and cost. Each finding names its BACKLOG row.

### P1 -- signals that are wrong today

**K1. Automated issues open themselves and never close.** All three issue-opening workflows
(`notify-failure`, the advisory audit, the DHS check) create or bump an issue on failure and do
nothing on success. The cost is visible: 28 stale `[deploy]` issues had to be closed by hand on
2026-09-05, and #495 and #500 are open now for deploys that runs 186 and 189 already superseded.
A `[deploy]` issue for an older SHA is moot the moment a newer SHA deploys green, because `db push`
is cumulative and `functions deploy` pushes every function; a `[deps]` or `[dhs]` issue is moot the
moment its own check passes. *Fix:* a `close-resolved` step in each workflow that runs on success
(deploy: `needs.deploy.result == 'success'`, not skipped, not a dry run) and closes the matching
open issues with a comment naming the green run. Keep the dedup on open; add the close.

**K2. The daily audit reports a registry outage as a vulnerability.** `check-dependencies.mjs`
exits 1 both when it finds a high/critical advisory and when it cannot reach the advisory endpoint
(it throws after three 60-second timeouts). `dependency-advisories.yml` opens or bumps
`[deps] High or critical advisory affects main` on `steps.audit.outcome == 'failure'`, so run 32
on 2026-09-04 -- three transport timeouts, no audit performed -- commented "Still failing" on #482.
That is the exact false signal the workflow's own comments say it must not produce. *Fix:* give
transport failure a distinct exit status (e.g. 3) and a distinct message in the script; in the
workflow, open or bump the advisory issue only on the advisory exit status, and turn a transport
failure into a `::warning::` plus a step-summary line. Consider a separate `[deps] audit could not
run` issue only after two consecutive days of transport failure.

**K3. The planning-register check runs in the wrong mode inside `check:all` on pull requests.**
`check:all` runs `check-planning-registers.mjs` with no `--base`, i.e. tree mode: it walks
`declared-stamp..HEAD` commit by commit and flags any commit that touched register-affecting paths
without touching `BACKLOG.md`. That was harmless while the `application` job checked out shallow,
because the freshness rule skips itself on a shallow clone -- and `ci.yml` still says so in the
comment above `planning-registers`. Commit `717d00e` (2026-09-05) gave `application` a
`fetch-depth: 0` checkout for the dependency gate's base comparison, which un-shallowed the clone
and switched that copy on. Since then a PR whose *first* commit touches a migration and whose
*second* commit updates the register fails `application` while the dedicated `planning-registers`
job (PR mode, whole-diff) passes. CI run 2055 on 2026-09-07 is exactly that: `application` red on
"`2c55f74` chore: record the Support Hub production migration ledger", `planning-registers` green,
`ci-result` red. *Fix:* make `check-planning-registers.mjs` fall back to
`origin/$GITHUB_BASE_REF` when `--base` is absent, the way `check-migration-immutability.mjs`'s
`resolveBaseRef` already does, so `check:all` runs PR mode on a PR and tree mode on `main`; then
correct the stale comment in `ci.yml`. (Dropping the check from `check:all` would also work, but
the env fallback keeps local `pnpm run check:all` behaviour unchanged.)

**K4. Out-of-band production migrations race the deploy pipeline.** `ARCHITECTURE.md` ("Key
Commands") and `replit.md` document the schema-change process as: apply through
`mcp__Supabase__apply_migration` first, then write the same SQL to `supabase/migrations/` with the
version Supabase assigned. That ordering predates `deploy-migrations.yml` and is now the wrong way
round for this repository: between the MCP apply and the merge of the file that records it, every
push to `main` fails its deploy with "Remote migration versions not found in local migrations
directory", opens a `[deploy]` issue, and -- because `db push` is the first production step --
blocks the edge-function deploy of whatever did merge. Run 188 on 2026-09-07 (#497 merged; the
ledger file arrived in #499 34 minutes later) is the worked example. *Fix, in three parts:* (a)
rewrite the documented process so the migration file is committed and the pipeline applies it,
reserving the MCP apply for a genuine emergency and requiring the ledger file in the *same* PR as
anything that depends on it; (b) add a `schedule` trigger to `deploy-migrations.yml` that runs the
existing dry-run path nightly, so an orphan or a pending version is reported before the next merge
trips over it (the `if:` guard and the `DRY_RUN` expression need a third clause for `schedule`);
(c) note in `MIGRATION_DEPLOYMENT_AUDIT.md` that "applied out-of-band" is now a pipeline failure
mode, not only a historical one.

### P2 -- gaps that a plausible event turns into a P1

**K5. A red `main` is silent, and the deploy it blocks is silent too.** When CI fails on a push to
`main`, the deploy workflow's `deploy` job evaluates its `if:` to false and both jobs report
`skipped`; nothing opens an issue, and the migrations merged by that push sit undeployed until the
next green push. Eight of the last forty deploy runs are exactly this. The header comment of
`deploy-migrations.yml` names "migrations merged to main could sit undeployed indefinitely" as the
failure it exists to close, and this is the remaining path to it. The frequency has dropped
sharply (14 red `main` pushes in the first two weeks of August, one since), and GitHub does email
the pusher, but a compliance product should not depend on someone reading that email. *Fix:* a
`notify-main-failure` job in `ci.yml` (`if: always() && github.event_name == 'push' && contains(needs.*.result, 'failure')`,
`issues: write` on that job alone) that opens or bumps one `[ci] main is red` issue whose body says
the deploy was skipped, and a close-on-green step per K1.

**K6. The secret scan is described as history-wide and is not.** `secret-scan` pays for the one
non-partial full clone in `ci.yml` "because gitleaks reads the content of every historical blob",
and its step is named "Scan repository history for committed secrets". `gitleaks-action` does not
do that on `push` or `pull_request`: it scopes the scan to the commits in the push or the PR, and
performs a full-history scan only on `schedule` or `workflow_dispatch`. (Verify this against the
pinned v3.0.0 source before acting; it is the documented v2 behaviour and nothing in the v3 notes
says otherwise.) The `.gitleaksignore` entries for historical commits show that history-wide scans
have been run somewhere, but not by this workflow. *Fix:* a small `secret-scan.yml` on a weekly
`schedule` plus `workflow_dispatch` that runs gitleaks over the full history and opens/bumps an
issue on a finding (closing it on green per K1), and a corrected comment on the per-push step. The
full clone on the per-push job is still right -- the action needs the push's base commit reachable.

**K7. Deploy-job hygiene: three small things in one place.** (a) The path short-circuit's
`git diff` list omits `scripts/prune-removed-edge-functions.mjs`, `scripts/removed-edge-functions.json`
and the two composite actions; a CLI bump or a manifest-only change would not, on its own,
re-run the deploy. The `PREV_SHA` logic usually covers it, but the list should be complete. (b)
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are job-level `env`, so they are present during
`pnpm install` (690 packages, with `allowBuilds` for four native modules) and the CLI's function
bundler; scope them to the six steps that use them. (c) That install exists to provide
`libpg-query` for the drift checker; a filtered install of the root package alone would do. None of
these has failed a run; they are cheap to close and each removes a way for the next incident to be
worse.

**K8. Toolchain pins live in nine places, and Dependabot watches one ecosystem.** Supabase CLI
2.109.1 is pinned in `package.json` (three scripts), `actions/setup-supabase-cli`, the devcontainer
`Dockerfile`, `AGENTS.md` and the go-live plan; Deno 2.5.6 in `ci.yml`, the `Dockerfile`,
`scripts/setup-codex-cloud.sh` and `AGENTS.md`; pnpm 11.13.0 in `package.json` (twice),
`actions/setup-node-pnpm`, the `Dockerfile`, the setup script and `AGENTS.md`; Node 24.15.0 in
`.node-version`, `.nvmrc`, the `Dockerfile` and `AGENTS.md`. They agree today; the
`PennTrain_Comprehensive_Review_2026-07-20` found the devcontainer on a different pnpm from CI, so
they have disagreed before. `dependabot.yml` covers GitHub Actions only -- no `npm` (the advisory
gate and `minimumReleaseAge` handle security, routine updates are manual) and no `docker` for the
`Dockerfile`'s three image pins. *Fix:* a `check-toolchain-pins.mjs` in `check:all` (with the
repo's usual `--self-test`) that asserts every copy of each pin agrees with its canonical source;
and a written decision in `dependabot.yml` on `npm` and `docker` -- either enable them grouped and
monthly, or record why not.

### P3 -- drift and cost

**K9. Comments and documents that no longer describe the pipeline.** The "45-minute `database`
job" and "581 migrations" in `ci.yml` and `dependabot.yml`; the `planning-registers` comment that
says `application` "checks out shallow" (K3); `DEPLOYMENT.md`'s "Limitations" section, which says
"CI now runs install, typecheck, unit tests, Edge Function `deno check`, and production build" --
true in July, a fraction of it now; `MIGRATION_DEPLOYMENT_AUDIT.md`, which still describes the
manual `db push` as the deploy path. The repository's comments are unusually load-bearing (they
are where the reasoning lives), which is why stale ones matter more here than elsewhere.

**K10. The DHS freshness clock goes red before anyone is asked.** The 45-day human-review limit
is a good gate, but the first signal that it is about to lapse is the weekly job failing after it
has. Run 7 failed at 49 days; the stamp was refreshed at 55. *Fix:* have `check-dhs-sources.mjs`
print a warning line at 38 days (one week's notice on a weekly cadence) that the run summary
surfaces, and retitle the issue so "check failed" is not read as "link dead" when it is the
review clock. Optional.

**K11. Things only the owner can verify (dashboard-side).** Not findings; items this review could
not read. Confirm branch protection on `main` requires `ci-result` and nothing else (the `ci.yml`
header asks for exactly that, and `report-pr-status.mjs` assumes it); confirm the `production`
environment holds `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` and whether it has a required
reviewer (if it does, the `concurrency` queue and the reviewer gate interact: a queued deploy
waits on both); confirm the Actions artifact retention setting, since the deploy gate reads stamp
artifacts from the last 50 runs and the default 90 days is what makes that work.

---

## 5. What is right, and should stay as it is

This pipeline has had several rounds of review already, and most of it is in good shape. The
following were each checked and should not be changed in the course of fixing the above:

- The `workflow_run` guard in `deploy-migrations.yml` (`event == 'push'` and
  `head_repository.full_name == github.repository`) closes the fork-PR-named-`main` path (G26.1).
  Keep all four conditions.
- The deploy gate resolves every undetermined case toward deploying, not skipping, and captures
  exit statuses instead of relying on `set -e` or `|| true` (G26.2). `db push` is idempotent;
  skipping is not recoverable without a human. Keep that direction.
- `--include-all` on `db push`; the drift check *after* push; functions deployed *after* the
  schema; the prune before the presence check; the two-step `DRY_RUN` (not the ternary); the stamp
  artifact named by the validated SHA rather than the run's `head_sha`.
- `notify-failure` on `always()` rather than `!cancelled()`, for the reason its comment gives: a
  timed-out production deploy must never be silent. K1's auto-close is what makes the resulting
  supersession noise acceptable.
- `ci-result` on `!cancelled()`, and treating `skipped` as success, so path-filtered jobs do not
  block merge and superseded PR runs do not cry wolf.
- `--fail-on error` on `db lint` and `db advisors` (G25.1); the generated-types diff; the
  loopback-only guard in `seed-course-video-placeholders.mjs`; `VITE_ENABLE_PUBLIC_DEMO` set only
  for the throwaway e2e bundle.
- `migration-immutability` deliberately never receiving `SUPABASE_ACCESS_TOKEN` on a PR.
- Partial clones (`filter: blob:none`) on every full-history job except `secret-scan`.
- Every third-party action pinned to a commit SHA with the version in a comment; Dependabot
  grouping the weekly bumps into one PR; the composite actions so CI and deploy share one Node and
  one CLI pin.
- Read-only default `permissions:` with each job adding exactly what it uses; `issues: write` only
  on the jobs that open issues; `actions: read` only on the deploy gate.
- The `[db.seed] enabled = false` single-pass stack, and `supabase stop --no-backup` before start.
- The identical-set short-circuit in the dependency gate (a registry outage cannot redden a
  docs-only PR).

---

## 6. The plan, and what was done

Single-threaded, in this order. Each block is one change set; each has a gate that says it is done.
Sizes use the backlog's scale (`S` = days).

**All three blocks were executed**, in the order below, in one branch rather than three. What each
one actually did is in its `BACKLOG.md` Tier K row. Three things are worth recording here, because
they are decisions rather than implementations:

- **K2 does not do what the plan proposed.** The plan said a transport failure should produce a
  `::warning::` and a green run. That is a run which audited nothing and reports success — the
  silence this repository distrusts everywhere else. Implemented instead as a visible failure plus
  a *differently titled* issue (`[deps] Advisory audit could not run`) that states in its first
  line that main was not audited, and that closes itself on the next clean audit. The false
  security signal is gone either way; this way the absence of an audit is not silent either.
- **K1 grew a shared component the plan did not call for.** Writing close-on-success three times
  meant writing dedup three times, and the three existing copies already disagreed with each other
  (`per_page: 30` in the deploy workflow, `50` in the two audits, and "not on the first page" read
  as "not open"). Both halves now live in `.github/actions/reconcile-issue`, which paginates, so
  the answer to "when does this alert go away" is in one place for all four workflows.
- **K8 had a consequence the finding did not anticipate.** Adding a pin-agreement check to
  `check:all` only helps if the check runs on the diffs that move a pin — and `.devcontainer/*`
  and `AGENTS.md` were in no path-filter group, so a Dependabot dev-container bump would have
  changed a pin in a diff that booted no job able to notice. Both were added to `APP_PATTERNS` in
  the same change.

Each block's gate was met by something other than reading the diff: the K3 regression was
reproduced in a scratch worktree and shown to fail before the fix and pass after; K2's exit path
was exercised end-to-end against an unreachable endpoint; K7's filtered install was measured (3
packages against 690) and all four deploy-time scripts re-run against it; K8's new check was
mutation-tested against a drifted `.nvmrc`, the historical dev-container pnpm regression, and a
pattern that stops matching; K10's two clock paths were run against the live PA.gov sources; K6's
claim about the action's scan scope was verified against the pinned v3.0.0 source before any of it
was written. What could not be verified from here is what runs only on GitHub: the schedules, the
issue open/close round trips, and the `production` environment's behaviour under a scheduled dry
run (see K11).

**Block 1 -- stop the false and missing signals (K1, K2, K3). One change set, `S`.**
These three are the ones producing wrong output *today*: two stale issues open, one PR red for a
reason that was not the PR's, and a security issue bumped by a timeout.
- K3 first, because it is a one-line script change plus a comment, and it unblocks the workflow
  edits' own PR from tripping the same rule.
- K2: exit-status split in the script (self-test it), then the workflow condition.
- K1: close-on-success steps in all three issue-opening workflows.
- *Gate:* re-run the daily audit and the DHS check by `workflow_dispatch`; both green and #495/#500
  closed by the next green deploy (or by hand, citing this plan, if no deploy is due). A PR that
  touches a migration in one commit and the register in the next passes `application`.

**Block 2 -- close the two remaining "undeployed indefinitely" paths (K4, K5). One change set, `S`.**
- K4(a) is a documentation and process change; make it before K4(b) so the nightly dry-run is
  checking a process the docs describe.
- K4(b): `schedule` on `deploy-migrations.yml`, dry-run path only, with the `if:` guard extended.
  Test it with a dispatch first.
- K5: the `notify-main-failure` job with close-on-green.
- *Gate:* one nightly dry-run green in the log; a deliberately failing push to a throwaway branch
  is not needed -- the next red `main`, if any, opens an issue and the next green closes it.

**Block 3 -- hygiene and drift (K6, K7, K8, K9, K10). One or two change sets, `S` each.**
- K6 after verifying the action's scoping against the pinned source.
- K7 and K8 together; K8's pin check joins `check:all` and covers the composite actions, so K7's
  diff-list gap is the same class of thing.
- K9 last, once the workflows are in their final shape, so the comments are rewritten once.
- K10 is optional and can ride with K9.

**K11** is dashboard work with no code; do it whenever the dashboard is open, and record the
answers in `DEPLOYMENT.md` "Limitations / manual steps remaining".

Not in this plan, deliberately: re-pinning the Supabase CLI (H19 explains why a bump is a
migration-privilege event, not a version bump); replacing corepack with `pnpm/action-setup`
(corepack ships with Node 24, which the engines pin holds to; revisit at Node 25); splitting the
`database` job (at 8 minutes it is not the bottleneck it is described as); adding a linter (a
separate decision, already recorded in `DEPLOYMENT.md`).

---

## 7. Appendix -- per-workflow notes

Observations that did not rise to a finding but are worth having in one place.

**`ci.yml`**
- The `changes` job's `case`-pattern matcher treats `*` as matching `/`, so `artifacts/*` does
  cover nested paths; the patterns are correct as written.
- `.node-version`/`.npmrc` bumps run only `application`, not `database`; the e2e build uses the
  same Node, so a Node bump is validated by `application`'s build but not by Playwright. Accepted.
- `supabase/functions/*` runs `application` (`deno check`, the auth-config check, runtime tests)
  but not `database`, so an edge-function change never reaches the browser journeys that call
  functions (`get-platform-status`, `capture-product-event`). Documented as intended in the file
  header; noted here because K4's nightly dry-run does not cover it either.
- `Install Chromium` runs `playwright install --with-deps` on every run even on a cache hit; the
  apt step is what makes it 13 s rather than 2 s. Not worth optimising at this job length.
- The `Publish immutable application artifact` step keeps 14 days of `dist/public` per `main`
  push. Nothing downloads it; `DEPLOYMENT.md` explains why it exists (provenance, PT-016).

**`deploy-migrations.yml`**
- The gate's `gh api` calls use `github.token` with `actions: read`; on a transient API failure
  the gate deploys rather than skips. Correct direction, and the warnings make it visible.
- The `notify-failure` issue dedup reads only the first 30 open issues; with K1 in place that is
  enough, and it was not enough on 2026-08-01..05.
- A `workflow_dispatch` from a branch other than `main` is skipped silently (both jobs `skipped`).
  A one-step job that fails with a message would be kinder to the operator; low value.
- `timeout-minutes: 30` was hit once (I30) by a migration that saturated the database; that row
  is closed and the timeout is right for the normal 3-minute run.
- Stamp artifacts use the repository's default retention; the gate scans 50 runs, which at the
  current ~4 deploys a day is 12 days of history. Both comfortably inside 90 days.

**`dependency-advisories.yml`**
- No `pnpm install`: the script parses `pnpm-lock.yaml` itself and reads edge-function `npm:`
  imports from disk. Good; keep it that way (a compromised dependency cannot run in this job).
- `retries: 0` on `github-script` is the default; issue creation has never failed here.

**`dhs-source-freshness.yml`**
- `set -o pipefail` without `set -e` is correct: the pipeline's status is `node`'s, and the
  runner's default `bash -e` applies to the step anyway.
- Five-way concurrency against pa.gov with HEAD-then-ranged-GET fallback has not been rate-limited
  in 8 runs. If Akamai ever starts returning 403 to GitHub's ranges, the `inspect` retry will not
  help; the fix then is a slower probe, not a longer timeout.

**Composite actions**
- `setup-node-pnpm` caches the pnpm store keyed on the single root lockfile; both the CI jobs and
  the deploy hit it (65 MB, restored in 3 s on run 188).
- `setup-supabase-cli` v3 of `supabase/setup-cli` now bootstraps Bun to install the CLI; the
  Dependabot bump to v3.0.0 landed 2026-08-31 and every run since has been fine.

**`dependabot.yml`**
- The `directories` glob for composite actions works (the v3.0.0 `setup-cli` bump came from
  `/.github/actions/setup-supabase-cli`), so the fix the comment describes is confirmed live.
