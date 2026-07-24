# PennTrain / CareMetric CareBase comprehensive review — 2026-07-24

**Reviewed commit:** `710342c3a1366bc40a9b22900c1244e5e1ae2ed4` on `claude/app-wide-review-1ytnek` (same tree as `main`).
**Baseline:** prior review at `2a7340d` (2026-07-21).
**Primary delta:** ~36 commits: Stripe billing go-live (#263) and pillar-module package catalog (#262), the shared AI voice gateway + phone front door (#256 and follow-ups), the marketing site redesign and lead funnel (#243–#254), Resident 360 / Work Queue / Survey packet / routing hardening (#238), Survey Day follow-ups (#234), representative-payee profiles (#232), atomic monthly charge posting (#231), four PCH/ALF training courses with the HeyGen video pipeline (#264), and the migration deployment audit (#255).

## Executive summary

This is the strongest the repository has looked across three reviews. Several long-standing P0 trust blockers are now genuinely fixed — most notably PT-002: the Stripe webhook is signature-verified, durable, out-of-order-safe, and Basil/clover field-location-aware with pgTAP coverage. Migration discipline, edge-function authentication, tenant isolation on every new table, and the public lead-capture functions are all in excellent shape, and the voice gateway's browser channel is a model of authenticated, RLS-scoped tool design.

**No new P0s were found**, but six P1s stand between the current tree and the go-lives this delta is aiming at:

1. **The deploy pipeline is broken at HEAD** — two migrations share version `20260724140000` (#263 vs #264, merged a minute apart). The drift gate in `deploy-migrations.yml` hard-fails (verified by execution), `supabase db reset` rejects the chain, and CI/preview environments are broken until one file is renamed (PT-051).
2. **The 30-day trial is never enforced.** `organizations.trial_ends_at` is written at signup and read by nothing; every org keeps full entitlements forever without paying, and checkout stacks a second 30-day Stripe trial on top (PT-052).
3. **Quantity sync can silently diverge from Stripe.** The provider-operation ledger treats operation keys as forever-terminal: one transient Stripe failure permanently wedges sync for that target, and a recurring target quantity skips the Stripe call while updating local rows — the admin UI shows "synchronized" while Stripe invoices a different quantity (PT-053).
4. **The shared phone number is not ready for public go-live.** Phone caps added in review only bound concurrency: caps are keyed on per-call CallSid, so one anonymous dial-loop can burn realtime-AI minutes around the clock and starve the 5-slot pool shared with paying in-app users; the code's own comments say the in-memory call-handoff stores must be DB-backed before go-live (PT-054).
5. **Marketing now contradicts the product it sells.** The site claims "no per-module upsells" and "every plan ships the complete platform" while #262 shipped an active, module-differentiated Essentials/Professional tier ladder visible in the in-app plan selector; "founding partner terms apply automatically" has no backing mechanism (PT-055).
6. **The marketing "Customer Service AI" lead-scores visitors to their face** — it displays the vendor's "% fit" qualification of the prospect, sales-methodology coaching ("Find the pain", "Close the next step"), and is branded AI while being a keyword matcher (PT-056).

**Release posture:** app + Train/CareBase product surfaces are pilot-ready and materially better than 07-21. Paid billing go-live is blocked on PT-051/052/053 (plus webhook poison-receipt persistence, PT-057). Public phone-number launch is blocked on PT-054. The marketing site is publishable after the truthfulness fixes (PT-055/056); the newsletter promise needs either a sender or softer copy (PT-064).

## Scope, method, and evidence

- Read the 07-20/07-21 review and backlog documents first; treated PT-001..PT-050 as prior backlog. New findings are ticketed from PT-051 in `PennTrain_Backlog_Delta_2026-07-24.md`.
- Five parallel deep-dive reviews read the changed surfaces end to end at HEAD: billing/Stripe, voice stack, marketing + production readiness, app features, platform/DB + prior-blocker verification. Every finding cited below was confirmed in code at HEAD, not inferred from diffs or commit messages.
- Validation commands executed in this checkout (Node 22.22.2 — below the repo's `>=24.15` engines floor, noted): `check:source-integrity` ✅, `check:migration-policies` ✅, `typecheck` ✅ (all workspaces), `test` ✅ (367 carebase + 40 voice-gateway), production build ✅ (with placeholder `VITE_*` env), `check:bundle` ✅ with 4 warnings (below), `check:edge-functions` ✅ (88 Deno tests), `check:dependencies` ✅ (663 packages, no known vulnerabilities), `check:pilot` ❌ (no evidence file exists — PT-007 unchanged), `check-migration-drift` ❌ (duplicate version — PT-051; verified as the same failure the deploy workflow hits).
- Not executed here: `check:database` (no local Supabase/Docker stack), Playwright e2e, remote drift query.
- **Bundle measurements:** largest JS chunk 513.5 KiB (90.1% of the raised 570 KiB cap), all JS 3,616.7 KiB (97.7% of 3,700), CSS 154.2 KiB (96.4% of 160), initial shell 1,178.0 KiB (94.2% of 1,250). PT-042 asked for headroom "without simply raising caps"; the entry cap was raised 510→570 with a documented policy, and growth has consumed the new headroom on every top-level metric anyway. PT-042 remains open and is now worse.
- The build's `generate:manual` step rewrites the checked-in `public/CareMetric-CareBase-User-Manual.pdf` non-deterministically, dirtying the worktree on every build (appendix nit N-1).

**Parallel work notice:** open draft PR #265 (`cursor/comprehensive-app-review-2b6d`, unmerged) independently fixes several of the same defects — the duplicate migration version, facility-type gating that blocks platform admins/employees from PCH/ALF-only routes, `no_show` schedule-analytics counting, some user-facing ALR copy, detail-page error masking, orphaned storage objects on failed metadata inserts, and public-function body-size caps. If #265 merges first, close the overlapping slices of PT-051 and re-verify; if not, the tickets stand alone.

## Status of previously open blockers

| ID | Prior finding | Status at HEAD | Evidence |
|---|---|---|---|
| PT-002 | Stripe webhook unversioned / not durably processed | **Fixed** | Signature verify with tolerance + constant-time compare (`_shared/phase2Billing.ts:44-65`); durable `app_private.stripe_billing_events` dedup ledger with payload-sha reuse guard and `provider_api_version` recorded; post-Basil field locations with legacy fallback; pgTAP covers Basil shape, dupes, out-of-order (`phase2_billing_integration.test.sql`). Residual: poison events roll back their receipt (PT-057). |
| PT-003 | Integration gateway rejects medication/eMAR snapshot import | **Open** | Verified catch-22 unchanged since baseline: gateway hard-codes scope `commands:write` (`integration-api/index.ts:41`) and schema `"2026-07-11"` (`_shared/phase2Integration.ts:1`), while the DB registers `medication.snapshot.import` at `'2026-07-14'` and `apply_medication_integration_command` requires `'2026-07-14'` (`20260714210309...sql:369-370`). Either version fails one side. |
| PT-006B | Complete verifiable tenant export | **Partially fixed** | Export graph now complete-by-construction via `get_organization_export_catalog()` (every public table with `organization_id`), archive sha-256 + enforced row counts. Still missing: binaries not embedded (1-hour signed URLs in manifest only), in-memory `zipSync`, `expires_at` never enforced by the download policy and no purge job, non-`organization_id` tables excluded. |
| PT-007 | Controlled pilot evidence | **Open** | `pilot/controlled-pilot.template.json` still all-`failed`/empty approvals; `check:pilot` has nothing to validate. |
| PT-008 | SCIM/SSO/employee/login reconciliation | **Partially fixed** | SCIM auth + employee reconciliation solid, but `scim_subject_links.profile_id` is never written, so the login-revocation/role-mapping block gated on it (`20260711200637:2195-2220`) is dead code; SSO subjects live in a disjoint table; SCIM deprovision doesn't set `profiles.is_active=false`. |
| PT-015 | Immutable migration provenance | **Partially fixed** | Version-level drift gate + automated post-CI DB deploys now exist (`deploy-migrations.yml`), but the gate compares version strings only — no content checksum; the 71-migration backfill recorded `(version, name)` only; and the gate is currently hard-failing on PT-051. |
| PT-016 | Test/deploy production artifact | **Partially fixed** | CI publishes an immutable build artifact per SHA and DB deploys are automated behind CI, but Railway still rebuilds from source at deploy time (deployed bundle ≠ CI-tested artifact) and edge functions deploy manually (PT-068). |
| PT-019 | Regulated AI tenant governance | **Open** | Platform-wide AI kill-switches only; no per-organization opt-in; `baa_version` captured at signup is never consulted by any AI path. |
| PT-026 | Tenant AI data minimization | **Open** | compliance-copilot sends resident first/last names + room and employee names to the AI provider (`_shared/complianceCopilot.ts:162-176,238-242`); `generate-resident-assessment-summary` sends the entire assessment JSON (`index.ts:275,325`). No redaction layer. Mitigations: caller-RLS scoping, row caps, immutable receipts. |
| PT-024 / PT-042 | Bundle headroom | **Open, worse** | Caps raised (entry 510→570; policy documented in `check-bundle-budget.mjs:9-47`); all four top-level metrics are back over the 90% warning line (measurements above). |
| PT-035 | Quantity-sync idempotency/reconciliation | **Partially fixed** | Durable `billing_provider_operations` ledger + stable Stripe idempotency keys + provider-succeeded/local-failed resume exist; but terminal-forever operation keys create the wedge/drift modes in PT-053. |
| PT-036 | Billing cron URL configuration | **Partially fixed** | The dead cron is fixed and fires (`20260724131000`), but the fix re-hard-codes the production project URL into the migration and `coalesce`s a missing vault secret to `''` (silent 401s) — PT-069. |
| PT-037 | Sync worker deadline/batching | **Fixed** | `maxRuntimeMs` clamp + deadline checks; deferred subscriptions keep old `quantity_sync_checked_at` and sort first next run; `partial` terminal status with job accounting. |
| PT-038 | Module fail-open bridge | **Fixed** | Default fail-closed (`productModuleAccess.tsx:57-72`); bridge requires explicit `VITE_CAREMETRIC_ALLOW_LEGACY_MODULE_FAIL_OPEN === "true"`; DB fails closed independently via restrictive `has_product_module` policies. Residual: no telemetry when the bridge engages; `enforce_carebase_bundle` treats a missing `modules.carebase` key as `true` (appendix N-2). |
| PT-039 | Server-side module coverage tests | **Fixed (carried)** | `modular_product_entitlements.test.sql` updated for the new `modules.workforce/compliance/billing` keys. |
| PT-040 | Billing catalog error surfacing | **Fixed** | Distinct per-query error labels, destructive alert, plan grid suppressed on error. Residual: mutation errors still swallow structured codes (PT-058). |

## New findings by area

Full tickets with implementation slices and acceptance criteria live in `PennTrain_Backlog_Delta_2026-07-24.md`. Severity: P1 = go-live blocker for the affected surface, P2 = should fix before/at GA, P3 = appendix.

### Deployment & platform

- **PT-051 (P1)** — Duplicate migration version `20260724140000` breaks `db reset`, CI, and the deploy drift gate (verified by execution). Third occurrence of this collision class; `check-migration-policies.mjs` (which runs in PR CI) has no duplicate-version rule.
- **PT-068 (P2)** — Edge functions have no deploy automation or drift gate; a fixed function can sit undeployed indefinitely — the exact root cause the #255 audit fixed for migrations, still open for the 55 functions.
- **PT-069 (P2)** — Billing cron hygiene: `20260724131000` re-hard-codes the prod project URL and `coalesce`s a missing vault cron secret to `''` (silent 401s on every run — the same failure class the migration was written to fix).

### Billing & revenue

- **PT-052 (P1)** — Trial never enforced; entitlements never expire for non-paying orgs; checkout stacks a second Stripe trial (~60 free days).
- **PT-053 (P1)** — Provider-operation ledger wedge/drift: `failed` ops short-circuit forever; stale terminal ops for a recurring target quantity skip Stripe and write local state that disagrees with the invoice; webhook item delete+reinsert races the worker into silent 0-row updates.
- **PT-057 (P2)** — Webhook poison events roll back their durable receipt and vanish after Stripe's ~72h retry window; `processing_status='failed'` is never written by any code path.
- **PT-058 (P2)** — Plan selector renders raw `FunctionsHttpError` messages; structured codes (`aal2_required`, `existing_subscription_requires_portal`, …) never reach the user — the most common go-live failure (org admin without fresh MFA) is an opaque dead end.
- **PT-059 (P2)** — Receivables aging sums `balance_due` across cumulative statement snapshots, double-counting carried balances and ignoring post-statement payments; the unit test encodes the flaw.

### Voice stack

- **PT-054 (P1)** — Phone front door go-live: per-caller/number caps and a phone-channel budget separate from the browser pool; daily minutes kill-switch; DB-backed pending-call/transfer stores (the code's own MUST-before-go-live comment).
- **PT-060 (P2)** — Voice truthfulness: a facility_manager selecting an unassigned same-org facility gets confident spoken "nothing due"/"no tracked items" (RLS returns zero rows without error — the org-wide facility gate passes while data tables are assignment-scoped); spoken deadline counts silently truncate at 100.

### Marketing & funnel

- **PT-055 (P1)** — Reconcile marketing claims with the shipped catalog: "no per-module upsells" / "every plan ships the complete platform" vs the active Essentials/Professional module ladder (also un-checkoutable — draft prices with no `stripe_price_id` show "Checkout is being configured"); founding-partner "locked-in pricing for life… applies automatically" has no system of record; trial length hardcoded in copy while actually platform-configurable.
- **PT-056 (P1)** — Rebuild the marketing assistant for a buyer audience: remove the on-screen "% fit" lead score, "Hot buyer" stage labels, and sales-methodology cards; stop branding a keyword matcher as "AI"; add focus management, `aria-live`, and Escape handling.
- **PT-062 (P2)** — Public intake abuse hardening: per-IP rate caps key on spoofable headers (`cf-connecting-ip`, first XFF hop) across all four public intakes; the two email-sending endpoints then rely on Turnstile alone against mail-bombing arbitrary recipients (no double-opt-in).
- **PT-063 (P2)** — Non-`/assets` static files (marketing MP4s, posters, logos, opengraph, manual PDF) are served `no-cache` with no ETag/Last-Modified — full re-download on every visit.
- **PT-064 (P2)** — Newsletter promises "email the moment something changes" but no digest sender exists (`buildRegulatoryDigestEmail` is referenced only by its own test), the schema's `unsubscribe_token` has no consumer, and unsubscribe is mailto-only (bulk-sender rules effectively require one-click unsubscribe).
- **PT-061 (P2)** — Maintenance mode gates only the React router while its comments claim "nobody reads or writes data mid-migration"; API clients and stale tabs keep writing. (Ops-lockout behavior is correct: admin bypass, fails open.)

### App features & content

- **PT-065 (P2)** — New standalone-course citation notes assert per-topic annual hour mandates that `PA_DHS_ANNUAL_TRAINING_MATRIX.md` explicitly disclaims ("PennTrain curriculum design, not a regulator-issued hour allocation"); the matrix was not updated for the four new courses.
- **PT-067 (P2)** — Class check-in tokens use standard base64: ~17% of 12-char tokens contain `/`, splitting the QR URL path so it never matches `/checkin/:token` — a 1-in-6 dead QR frame on a compliance-evidence flow.
- **PT-066 (P2)** — Server-side coverage + finance hardening: zero pgTAP for `resident_personal_fund_payee_profiles` (+ its SECURITY DEFINER upsert), `post_resident_monthly_charges` (money-posting RPC, also not idempotent per billing period — a double-click duplicates a month's charges), `savings_model_requests`, `regulatory_updates`/`list_regulatory_updates` (the only new anon-reachable function), `newsletter_subscribers`, `org_feature_enabled`; payee audit events omit before/after values for the money fields a surveyor would ask about.

## Strengths worth preserving

- **Migration discipline**: 100% of new SECURITY DEFINER functions pin `search_path`; SECURITY INVOKER for read paths so RLS composes; restrictive module policies down to storage buckets; append-only/immutability triggers; root-cause narratives inside migration files (`survey_day_mode.sql` is a model migration). The drift gate catching PT-051 is the control working.
- **Edge-function auth story**: all 55 functions carry explicit, commented `verify_jwt` decisions enforced by a CI drift check; every `verify_jwt=false` handler was verified to implement real auth (constant-time cron secrets that fail closed, provider signatures, Turnstile + peppered-IP caps, token-credential RPCs). `impersonate-user` (platform-admin + fresh AAL2 + audit-before-token) is best-in-class.
- **Voice gateway architecture**: JWT verified per session against GoTrue, claim-once stream tickets checked before the WebSocket is accepted, no service-role keys in the gateway, every tool read under the caller's own RLS (verified to the policy level), zod validation at both ends, PHI-shape-only logging, and 40 real HTTP+WS integration tests.
- **Billing engineering**: server-authoritative quantities (browser input ignored), integer-cents/`numeric(12,2)` money math throughout, durable ordered webhook processing with pgTAP including the Basil field relocation, deliberate tested `proration_behavior: "none"`, and unusually accurate docs (`BILLING_MODEL.md`, `PRODUCT_MODULES.md`).
- **Public funnel security**: server-verified Turnstile, peppered-hash IP caps, revoked anon grants with platform-admin-only RLS on lead tables, no email-injection surface, demo provisioning with constant-time secrets + daily baseline restore + outbound-comms suppression for demo orgs.
- **Honesty-driven product course-corrections**: PT-043's removal of fake AI theater, PT-047's "code-complete, not GA" roadmap relabel, real `dataUpdatedAt` freshness labels, and marketing that leads with "no guaranteed survey outcomes".
- **Terminology discipline**: the ALF rule is honored across app, marketing, emails, PDFs, and spoken voice output, enforced by canonical labels and a regression test; the only borderline strings name the state's own "PCH/ALR" resource pages (appendix N-3).

## Appendix — minor nits (P3, not individually ticketed)

| # | Nit | Evidence |
|---|---|---|
| N-1 | Build's `generate:manual` rewrites the checked-in user-manual PDF non-deterministically → dirty worktree every build | `artifacts/caremetric-carebase/package.json` build script |
| N-2 | `enforce_carebase_bundle` treats a missing `modules.carebase` key as `true`; a package created outside the admin UI silently becomes full CareBase | `20260724130000...sql:117` |
| N-3 | Six borderline "PCH/ALR" strings name DHS's own resource pages; defensible rewording available; URL slug `/app/pch-alr-operations` flagged for a deliberate decision | `DhsFormsLibrary.tsx:88`, `residentCompliance.ts:64,83`, `documentTemplates.ts:768,787,889` |
| N-4 | Voice: timeout-cascade invariants (copilot 60s < tool 65s < dispatcher 75s < idle 90s) enforced only by comments; no boot validation | `voice-gateway/src/config.ts:73-79` |
| N-5 | Voice: unauthenticated `/phone/stream` sockets held up to 10s with no aggregate cap; Twilio webhook replay unbounded (no CallSid idempotency); no client-socket backpressure; platform AI kill-switch doesn't reach the Realtime conversation; `/phone` unconfigured returns TwiML with HTTP 503 (Twilio won't render it); `VOICE_PLAYBACK_GRACE_MS` undocumented | `twilio-media.ts:69-78`, `signature.ts`, `routes.ts:102,139` |
| N-6 | Billing: return-URL validation unions the attacker-controllable `Origin` header into the allowlist; platform-admin-initiated first checkout binds the operator's email as the tenant's Stripe `customer_email` | `_shared/phase2Billing.ts:186-188`, `create-billing-session/index.ts:210-211` |
| N-7 | `index.html` base head still says "survey evidence" post-rename (3 meta descriptions, served on all non-prerendered routes); robots.txt disallows nonexistent `/employee/` instead of `/me/`+`/account/`; `subscribe-updates` discloses subscription status for arbitrary emails; ~540 lines of dead marketing content + dead `CtaBanner` → retired route; Privacy Policy omits marketing lead capture; Portfolio "Talk to us" CTA links to `/signup`; FAQ's "15-day initial assessment" imprecise for ALF | marketing agent findings 9–15 |
| N-8 | End User Experience panel: only `dark:` variants left in `src/` (PT-046 deleted the rest → two-tone app for dark-OS users); "Last updated" chip shows render time not data freshness (the PT-043 pattern); renders outside the route error boundary with no dismissal | `EndUserExperiencePanel.tsx:55-63,105`, `MainLayout.tsx:165-166` |
| N-9 | `SurveyDay.tsx` declares `ActivationCard` inside the component body — dialog state resets on parent refetches | `SurveyDay.tsx:153` |
| N-10 | Work-queue search: unescaped ILIKE wildcards; no client debounce (two RPCs per keystroke) | `20260721210000...sql:54-55`, `WorkQueue.tsx:230` |
| N-11 | HeyGen resolver buffers full video in memory (`arrayBuffer()`); seeded orientation-video URLs pin the production project (documented; watch-gate defaults off) | `_shared/heygenPolling.ts:139`, `20260724040747...sql:100,122,144` |
| N-12 | Check-script gaps: `check-edge-functions` runtime floor is 3/55; `check-dependencies` never audits Deno/jsr imports; bundle initial-shell pattern hardcodes chunk-name prefixes; `check-migration-policies` passes enable-RLS-without-policy | `scripts/*` |
| N-13 | `20260724150000` disables `protect_subscription_fields` and targets demo orgs by display name; `subscribe-updates` logs a slice of the provider error body (could echo a recipient address) | `20260724150000...sql:27-35`, `subscribe-updates/index.ts:132` |
| N-14 | Public-token hardening is client-side scrubbing (good) but sessionStorage isn't cleared on server-rejected/expired tokens, and governance rules 3/4 double-report one condition | `publicAccessToken.ts:24-58` |
| N-15 | Voice test gaps: tool-timeout abort, transfer fallback timer, max-duration warning, wrong-app ticket claim, tracker accounting after abnormal close; live e2e exercises browser PCM16 only, never µ-law telephony | `voice-gateway/test/*` |
