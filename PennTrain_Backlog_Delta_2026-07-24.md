# PennTrain backlog delta — 2026-07-24

**Companion report:** `PennTrain_Comprehensive_Review_2026-07-24.md`
**Scope:** new work only. PT-001..PT-050 remain in the prior backlogs; statuses for previously-open items are in the companion report. Numbering continues from PT-050.
**Overlap notice:** open draft PR #265 independently fixes parts of PT-051 (migration rename) and several appendix nits; reconcile before starting work.

## PT-051 — Reconcile the migration chain with production before re-arming deploys (duplicate version + wholesale bookkeeping divergence)

**Labels:** `priority:P0`, `area:deploy`, `area:database`
**Outcome:** the repo's migration chain replays cleanly (`db reset`, CI, preview branches), matches what production actually recorded, and the next `db push` applies only content production does not already have. Duplicate versions from parallel PRs are caught in PR CI, not at deploy.

**Evidence** (see the review's same-day addendum for the full mapping)

- `supabase/migrations/20260724140000_add_standalone_annual_courses_fire_abuse_rights.sql` (#264) and `..._rename_savings_model_facility_count_to_resident_count.sql` (#263) share one version; `scripts/check-migration-drift.mjs:58-59` throws (verified, exit 1) as the final verify step of `.github/workflows/deploy-migrations.yml:79`. Third occurrence of this collision class.
- Production's `schema_migrations` (checked via the management API) recorded the 07-24 batch under **different versions** than the committed files (e.g. `rename_savings_model...` as `20260724042821` vs file `20260724140000`; standalone courses as four split files `0512xx` vs the consolidated pair), holds **six migrations with no repo counterpart** (`042226`, `043912`, `044044`, `051549`, `051753`, `053705` — SQL recoverable from `schema_migrations.statements`), and **never applied** `20260724130000_modular_pillar_packages.sql` (verified: no Essentials/Professional rows in `public.packages`).
- Consequence: renaming the duplicate alone (PR #265's fix) arms a deploy where `db push` re-runs already-applied content — the column rename hard-fails mid-sequence and the consolidated course seeds collide with the split-file content.

**Implementation slice**

1. Reconcile bookkeeping first: rename repo files to production's recorded versions where content is identical, or mark them applied with `supabase migration repair --status applied`; verify content equivalence for the consolidated-vs-split course migrations before choosing.
2. Commit the six production-only migrations into the repo (recover SQL from `schema_migrations.statements`), restoring git as the source of truth.
3. Resolve the duplicate `20260724140000` as part of the renumbering (this also unblocks `db reset`/CI).
4. Make a deliberate decision on `modular_pillar_packages`: apply it to production (shipping the tier catalog — coordinate with PT-055) or hold it explicitly; today's frontend-ahead-of-database skew should be closed one way or the other.
5. Add a duplicate-version rule to `scripts/check-migration-policies.mjs` (runs in PR CI via `check:all`) with a self-test fixture.
6. Only then re-run the deploy workflow and confirm `db push` + the drift step pass.

**Acceptance criteria**

- `supabase db reset --no-seed` completes on a fresh stack.
- `check-migration-drift` passes locally and in the deploy workflow with zero repo-only and zero production-only versions.
- A dry-run `db push` against production lists no already-applied content.
- A synthetic branch with two same-version migrations fails `check:migration-policies` in PR CI.

**Effort:** M.

## PT-052 — Enforce the 30-day trial

**Labels:** `priority:P1`, `area:billing`, `revenue`
**Outcome:** an organization whose trial has lapsed without an active subscription loses non-core entitlements, visibly and reversibly; trial length has one source of truth.

**Evidence**

- `signup-organization/index.ts:247-264` stamps `organizations.trial_ends_at`; nothing reads it for enforcement (exhaustive grep).
- `get_effective_entitlements` (`20260720205629...sql:461-484`) treats `'trial'` as entitled with no cutoff; `ensure_organization_billing_account()` creates every account in `'trial'`.
- `create-billing-session/index.ts:200-231` adds another 30-day Stripe `trial_period_days` on top (~60 free days total).
- Marketing hardcodes "30 days" (`Landing.tsx:80,330,344`) while the real value is `platform_settings.default_trial_days`.

**Implementation slice**

1. Add a trial-expiry branch to `get_effective_entitlements` (or an hourly job) that resolves `'trial'` + `organizations.trial_ends_at < now()` + no live subscription to `past_due`/`suspended`.
2. Decide the Stripe-trial stacking policy (skip `trial_period_days` when the in-app trial is consumed, or document 30+30 deliberately).
3. Surface trial state + days remaining in the org admin billing page; email a T-7/T-1 notice via the existing notification path.
4. Single-source the trial length for marketing copy or soften copy to "free trial".

**Acceptance criteria**

- pgTAP: an org with lapsed `trial_ends_at` and no subscription loses non-core module access; comped/active orgs unaffected; platform admin bypass intact.
- Checkout after a consumed trial does not grant a second free month unless deliberately configured.
- Admin UI shows trial expiry; expiring-trial notice is sent once.

**Effort:** M.

## PT-053 — Make the billing provider-operation ledger converge instead of wedging

**Labels:** `priority:P1`, `area:billing`, `area:edge-functions`, `stripe`, `reliability`
**Outcome:** quantity sync always converges local state and Stripe to the measured quantity, retries transient failures, and never reports success while Stripe disagrees.

**Evidence**

- `sync-billing-quantities/index.ts:262-267` — `operation_key = ["billing-quantity-sync", item.id, quantity]` (no time component, forever-unique per target).
- `:287-314` — on insert conflict, adopts the old row's terminal status: `failed` → returns immediately (one transient Stripe 5xx wedges that target forever); stale `provider_succeeded`/`local_succeeded` for a recurring target quantity → skips the Stripe call, then writes local rows (`:315-372`) — local says N while Stripe invoices M, with a green "Quantity synchronized" badge.
- `:347-362` — webhook delete+reinsert of `billing_subscription_items` races the worker: `update ... eq("id", item.id)` matches 0 rows silently, then `seat_quantity` is overwritten anyway.

**Implementation slice**

1. Scope `operation_key` per reconciliation attempt (e.g. include `current_period_start` or a date bucket), or reset conflicting rows whose terminal state no longer matches the live item quantity.
2. Retry `failed` operations with backoff and an attempts cap; surface stuck operations in System Jobs.
3. Before skipping a Stripe mutation on a prior-success record, read the live Stripe item and reconcile if it disagrees.
4. Update items by `stripe_subscription_item_id`, and treat 0-row local updates as failure.

**Acceptance criteria** (mocked Stripe/DB failure tests, per PT-035's original list)

- Transient Stripe failure → operation retried next run, converges, no manual DB surgery.
- Usage N→M→N sequence ends with Stripe and local rows both at N, with a real Stripe call or verified provider read.
- Concurrent webhook item-replacement does not produce a silent local success.

**Effort:** M.

## PT-054 — Phone front door go-live readiness: per-caller caps, channel budget, durable handoff

**Labels:** `priority:P1`, `area:voice`, `security`, `cost-controls`
**Outcome:** an anonymous caller cannot exhaust paid AI minutes or starve authenticated in-app users, and deploys do not drop live calls.

**Evidence**

- `voice-gateway/src/http/routes.ts:113` keys the session tracker on `phone:<CallSid>` — unique per call, so `maxSessionsPerUser` never binds on the phone path; no `From`-keyed caps, cooldowns, or budgets exist anywhere in `src/`.
- Phone and browser share one `VOICE_MAX_CONCURRENT_SESSIONS` pool (default 5): a dial-loop yields ~24/7 realtime-AI spend and `429 too_many_sessions` for staff.
- `src/session/pending-sessions.ts:9-11` and `src/phone/pending-calls.ts:3-7`: "MUST swap in a DB-backed store before go-live" — deploys kill calls mid-handoff.

**Implementation slice**

1. Per-`From` caps (N calls and M minutes per rolling hour) enforced at `/phone/inbound` before any Realtime session opens.
2. Separate phone-channel concurrency budget so phone traffic can never consume the browser pool.
3. Global daily voice-minutes kill-switch with an operator alert.
4. DB-backed `PhonePendingStore`/`TransferActionStore` behind the existing interfaces.
5. While here: cap concurrent unclaimed `/phone/stream` sockets, add CallSid idempotency at `/phone/inbound`, return 200 with TwiML for the "unavailable" path (Twilio ignores TwiML on 5xx).

**Acceptance criteria**

- Simulated dial-loop from one number is rejected at the cap while browser sessions stay available.
- Redeploy during an in-flight phone handoff completes the call.
- Unit tests cover per-From cap, channel budget, and kill-switch.

**Effort:** M.

## PT-055 — Reconcile marketing claims with the shipped billing catalog

**Labels:** `priority:P1`, `area:marketing`, `trust`
**Outcome:** every pricing/packaging claim on the marketing site is true of the live catalog, and commercial promises have a system of record.

**Evidence**

- `Landing.tsx:919` "no per-module upsells"; `Features.tsx:325,328` "One price. No add-on modules." / "Every plan ships the complete platform"; `Faq.tsx:94`, `HowItWorks.tsx:319` — vs `20260724130000_modular_pillar_packages.sql:368-428` seeding **active** module-differentiated Essentials ($299) / Professional ($399) tiers rendered by `BillingPlanSelector` at `/app/enterprise`. The tiers are also un-checkoutable (draft prices, no `stripe_price_id` → "Checkout is being configured").
- `About.tsx:165,168` "locked-in pricing for life… partner terms apply automatically" — no partner flag/discount/price-lock exists in signup or the catalog.

**Implementation slice**

1. Decide: market the tier ladder (add to pricing page, delete the contradicted claims) **or** seed Essentials/Professional `is_active = false` until launched. Either way, delete or scope "Every plan ships the complete platform".
2. Record founding-partner status at signup (org flag + window) or change copy to an email-us enrollment.
3. Add a unit test pinning marketing plan copy/prices to the seeded catalog (the `sitemap.test.ts` pattern).

**Acceptance criteria**

- No marketing claim contradicts what the in-app plan selector shows.
- Active packages are checkoutable or hidden.
- Partner claims are backed by a stored flag or removed.

**Effort:** S–M.

## PT-056 — Rebuild the marketing assistant for a buyer audience (voice + a11y)

**Labels:** `priority:P1`, `area:marketing`, `trust`, `a11y`
**Outcome:** the widget reads as a helpful buyer-facing guide, does not display internal qualification of the visitor, is honestly labeled, and is usable by keyboard/screen-reader users.

**Evidence**

- `MarketingAIBot.tsx:34-50` sales-methodology cards ("Find the pain", "Close the next step"); `:157-182` live "{score}% fit" meter + "Hot buyer — Book a focused demo now" stage labels (`marketingAIBotSales.ts:392-396`); second-person salesperson coaching in prompts (`:19,104,146`).
- Branded "Customer Service AI" (`:127`) while `answerQuestion` (`marketingAIBotSales.ts:407-429`) is deterministic keyword matching. Mounts on every marketing page (`MarketingLayout.tsx:478`).
- Zero `aria-live`/focus management/Escape handling (grep-confirmed).

**Implementation slice**

1. Remove the fit-score/stage banner and SALES_CARDS; keep visitor context as neutral "Your context" chips.
2. Rewrite intents/answers in customer voice; keep the existing pricing/compliance guardrails and disclaimer.
3. Rename to "guided answers"/"assistant" unless a real model backs it.
4. Focus into the panel on open (return on close), `aria-live="polite"` transcript, Escape closes.
5. Fix the "Email a summary" action's empty `To:` field.

**Acceptance criteria**

- No lead-scoring or sales-stage language renders to visitors.
- Keyboard-only and SR users can open, converse, and close the widget.
- Component tests cover the rewritten intents and a11y wiring.

**Effort:** S–M.

## PT-057 — Persist failed Stripe webhook receipts (dead-letter)

**Labels:** `priority:P2`, `area:billing`, `reliability`
**Outcome:** a poison event leaves a durable `failed` receipt with error text, visible to operators, instead of vanishing after Stripe's retry window.

**Evidence:** `process_stripe_billing_event` (`20260724000000...sql`) inserts the receipt and processes in one transaction; guard exceptions roll back the insert; the webhook returns 500 with only a redacted `console.error`; `processing_status='failed'` is allowed by the check constraint (`20260711200648:344-345`) but never written.

**Implementation slice:** split receipt-insert from processing (commit the receipt first or use an exception handler persisting `failed` + error), and surface failed events in the admin billing/system-jobs UI with a retry affordance.

**Acceptance criteria:** pgTAP: a cross-tenant-bound or malformed event leaves a `failed` receipt row; retries of the same event id do not duplicate; operators can list failed events.

**Effort:** S.

## PT-058 — Surface structured billing error codes in plan-selector mutations

**Labels:** `priority:P2`, `area:billing`, `area:frontend`, `ux`
**Outcome:** checkout/portal failures show actionable copy (e.g. "Set up MFA first" linking `/account/security`) instead of "Edge Function returned a non-2xx status code".

**Evidence:** `useEnterpriseFoundation.ts:193-206` throws the raw `FunctionsHttpError`; `BillingPlanSelector.tsx:131-137,164-170` renders `error.message`; server codes `aal2_required`, `fresh_aal2_required`, `existing_subscription_requires_portal`, `billing_quantity_outside_self_service_range`, `active_price_missing` never reach the user. Correct pattern exists at `Employees.tsx:342-344` (`error.context.json()`).

**Implementation slice:** parse `error.context` in the mutation hooks, map codes to copy + links, component tests per code.

**Effort:** S.

## PT-059 — Compute receivables aging from the ledger, not summed statement snapshots

**Labels:** `priority:P2`, `area:billing`, `correctness`
**Outcome:** the receivables/aging widget reports true open AR.

**Evidence:** `lib/residentBilling.ts:63-83` sums `balance_due` across all statements, but statements are cumulative immutable snapshots (`20260714000000...sql:467-507`): an unpaid $1,000 June + $2,000 July statement shows $3,000 against a true $2,000; post-statement payments are invisible until the next statement. `residentBilling.test.ts:54-66` encodes the flawed summation.

**Implementation slice:** derive aging from open debits minus credits on the live transaction ledger (aged by `effective_on`/due date), or latest statement + post-statement activity; fix the unit test to assert the corrected semantics.

**Effort:** S–M.

## PT-060 — Voice truthfulness: assignment-scope the facility gate and stop truncated counts

**Labels:** `priority:P2`, `area:voice`, `correctness`, `trust`
**Outcome:** the voice assistant refuses facilities the caller cannot actually read instead of reporting confident zeros, and never states a truncated number as a total.

**Evidence:** `voice-tools/index.ts:93-101` validates the facility via org-wide `facilities_select` RLS while the data tables are assignment-scoped for `facility_manager` → zero rows without error → spoken "nothing due"/"no tracked items"; the UI picker lists the whole org and defaults to `facilities[0]` (`RegulatoryCopilot.tsx:110-111`). Counts: `voice-tools/index.ts:167-180` `.limit(100)` feeds `summarizeDeadlines` which speaks `length` as the count.

**Implementation slice:** re-check assignment for facility_manager in voice-tools (return a voiceable `facility_not_accessible` error); scope the picker to assigned facilities; use exact counts (`count: "exact"`) or speak "100 or more"; add Deno tests for both.

**Effort:** S.

## PT-061 — Make maintenance mode honest (or real)

**Labels:** `priority:P2`, `area:platform`, `docs`
**Outcome:** the maintenance-mode contract matches its implementation.

**Evidence:** `maintenanceMode.ts:5-7` claims "nobody reads or writes data mid-migration/deploy"; enforcement is only React routing (`App.tsx:201-207`) — API clients, stale tabs (60s poll), and guest-token holders keep reading/writing. Admin bypass/fail-open behavior is correct.

**Implementation slice:** reword the comment/docs to "holds non-admin users out of the UI", or add a restrictive RLS/edge check on `maintenance_mode` for non-platform-admin JWTs if write-quiescence is genuinely required. Recommend the reword unless migrations depend on quiescence.

**Effort:** S (reword) / M (enforce).

## PT-062 — Public intake abuse hardening: trusted IP derivation and send ceilings

**Labels:** `priority:P2`, `area:edge-functions`, `security`
**Outcome:** per-IP rate caps bind against real clients, and the email-sending intakes have a non-IP backstop.

**Evidence:** `request-demo/index.ts:38-45` (duplicated in `email-savings-model`, `subscribe-updates`, `signup-organization`) prefers `cf-connecting-ip` then the first XFF hop — both attacker-settable unless Cloudflare verifiably fronts the functions; every per-IP cap is bypassable with fresh headers. Turnstile remains the real gate, but `email-savings-model` and the newsletter welcome mail send to arbitrary addresses with no double-opt-in.

**Implementation slice:** derive client IP from the trusted end of the chain (last XFF hop appended by the gateway); ignore `cf-connecting-ip` unless CF-fronted; add a global hourly send ceiling per function; consider double-opt-in for the newsletter (pairs with PT-064); stop returning `alreadySubscribed` to anonymous callers.

**Effort:** S.

## PT-063 — Cache validators for non-hashed static assets

**Labels:** `priority:P2`, `area:server`, `performance`
**Outcome:** marketing videos, posters, logos, and the manual PDF stop re-downloading in full on every visit.

**Evidence:** `server/index.mjs:258,352` — only `/assets/` gets immutable caching; everything else is `no-cache` and `serveFile` emits no `ETag`/`Last-Modified`, so 304s are impossible.

**Implementation slice:** weak ETag (size+mtime) + `If-None-Match`/`If-Modified-Since` handling in `serveFile`; moderate `max-age` for `public/marketing/*`; keep range support.

**Effort:** S.

## PT-064 — Newsletter: working unsubscribe and a digest sender (or softer promise)

**Labels:** `priority:P2`, `area:marketing`, `area:edge-functions`, `compliance`
**Outcome:** the subscription promise is deliverable: one-click unsubscribe works and published updates actually reach subscribers (or the copy stops promising it).

**Evidence:** `RegulatoryUpdates.tsx:256` "we'll email you the moment something changes"; `buildRegulatoryDigestEmail` (`_shared/marketingEmails.ts:160`) has no caller outside its test; `unsubscribe_token` (`20260723120000...sql:159-160`) has no consumer; unsubscribe is `mailto:` only (`subscribe-updates/index.ts:115`). Gmail/Yahoo bulk-sender rules expect RFC 8058 one-click unsubscribe.

**Implementation slice:** public `unsubscribe` edge function keyed on the token + `List-Unsubscribe`/`List-Unsubscribe-Post` headers on all sends; a cron that digests newly-published updates to subscribed addresses; or soften the copy to "periodic digests". Pair with PT-062's double-opt-in decision.

**Effort:** M.

## PT-065 — Correct training-citation framing and update the training matrix

**Labels:** `priority:P2`, `area:content`, `compliance`, `docs`
**Outcome:** course citation notes never overstate what 55 Pa. Code mandates, and `PA_DHS_ANNUAL_TRAINING_MATRIX.md` documents the current catalog.

**Evidence:** `20260724140000_add_standalone_annual_courses...sql:1217-1220` asserts per-topic annual-hour groundings on `required_hours 1.00` types; `PA_DHS_ANNUAL_TRAINING_MATRIX.md:10-12` states hour allocations are "PennTrain curriculum design, not a regulator-issued hour allocation" and its tables already cover these subjects inside the 12/16-hour buckets; the matrix has zero mentions of the four new courses or the `PA-DHS-STANDALONE-` prefix.

**Implementation slice:** requalify the citation notes (subject required annually; the 1.00-hour allocation is curriculum design); update the matrix for the new courses and how standalone types relate to (and don't double-count against) the annual buckets.

**Effort:** S.

## PT-066 — Server-side test coverage and finance hardening for post-baseline surfaces

**Labels:** `priority:P2`, `area:database`, `area:tests`, `finance`
**Outcome:** every new tenant table/RPC has pgTAP coverage; money-posting is idempotent; payee changes leave a usable audit trail.

**Evidence**

- Zero pgTAP for: `resident_personal_fund_payee_profiles` + `upsert_resident_personal_fund_payee_profile`, `post_resident_monthly_charges`, `savings_model_requests`, `regulatory_updates` + `list_regulatory_updates` (the only new anon-reachable function), `newsletter_subscribers`, `org_feature_enabled`.
- `post_resident_monthly_charges` (`20260721120000...sql:6-79`) has no `(resident, period)` guard — a double-click duplicates a month's charges (statements have the unique constraint; charges don't).
- Payee upsert is full-replace and its history event records a 5-field subset — `benefit_amount`, `personal_needs_allowance`, `collective_account_last4`, `external_payee_*` changes leave no before/after values (`20260721120001...sql:88-115`).

**Implementation slice:** pgTAP role-matrix suites mirroring `resident_financial_operations.test.sql`; dedupe guard (or return-existing) for same-period non-adjusted charges; include changed-key old/new values in the payee history `evidence`; document the full-replace RPC contract.

**Effort:** M.

## PT-067 — URL-safe class check-in tokens

**Labels:** `priority:P2`, `area:training`, `correctness`
**Outcome:** every generated QR check-in link resolves.

**Evidence:** token default `encode(gen_random_bytes(9), 'base64')` (`20260705162933_class_checkin_core.sql:6`) includes `/`/`+`; `ClassDetail.tsx:137` interpolates it unencoded into the path — ~17% of 12-char tokens contain `/`, splitting the path so neither `/checkin/:token` nor `/checkin` matches (`App.tsx:401-402`). Recoverable only because kiosk tokens rotate every 45s.

**Implementation slice:** `encodeURIComponent(token)` in `ClassDetail.tsx` (wouter decodes params — fixes all links immediately), plus URL-safe generation (`translate(...,'+/','-_')`) for new rows; a unit test generating many tokens and asserting the built URL round-trips through the router.

**Effort:** S.

## PT-068 — Edge-function deploy automation and drift gate

**Labels:** `priority:P2`, `area:deploy`, `area:edge-functions`
**Outcome:** merged edge-function changes reach production automatically behind CI, and config/function drift is detectable — closing the same root cause the #255 audit fixed for migrations.

**Evidence:** `.github/workflows/` has no function deploy; `DEPLOYMENT.md:50,116,269` documents manual `npx supabase functions deploy`; a fixed function (e.g. the PT-003 gateway fix, when it lands) can sit undeployed indefinitely with nothing failing.

**Implementation slice:** add `supabase functions deploy` (+ `config push`) to the post-CI deploy workflow using the same SHA-checkout pattern as `deploy-migrations.yml`; add a deployed-versions drift check if the platform exposes one, else record deployed SHAs in a platform table at deploy time.

**Effort:** M.

## PT-069 — Billing cron config hygiene: per-environment URL, loud missing-secret failure

**Labels:** `priority:P2`, `area:deploy`, `area:billing`, `supabase`
**Outcome:** the quantity-sync cron targets the current environment and fails visibly when unconfigured — completing what PT-036 asked for.

**Evidence:** `20260724131000_fix_billing_quantity_sync_cron_url.sql:19` hard-codes `https://xsqobvvreaovwibxwyvv.supabase.co/...` (a non-prod environment replaying this migration POSTs its cron secret header at the production URL); `:23-31` `coalesce(cron_shared_secret, '')` recreates the silent-failure class the migration was fixing (401 every run, nothing alarms). The prod project ref now appears in 13+ migrations; the vault/setting seeding path from PT-036 was abandoned rather than completed.

**Implementation slice:** seed `supabase_functions_base_url` in Vault per environment during bootstrap; have cron jobs read it and raise (not coalesce) when the URL or secret is absent; add the deployment doc + verification query PT-036 specified; migrate sibling cron jobs opportunistically.

**Effort:** S.
