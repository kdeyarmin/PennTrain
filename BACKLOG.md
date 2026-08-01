# CareMetric CareBase — Living Backlog

**Status:** Canonical forward backlog
**Last verified against main:** `67506b1` (2026-08-01) — UI/UX debt wave
**Owner:** product + engineering

**How to update:** edit this file in the same change set that ships or retires work, and
bump the stamp above. This is enforced, not requested — `pnpm run check:planning-registers`
fails when application source, a migration, or an edge function moves without this file
moving with it. Do not create a parallel planning register; the same check rejects new
root-level review markdown.

---

## Why this file is enforced

It was created as "the single living backlog" and was wrong two commits later. PR #355
shipped SCORM, POC-lifecycle, and import-worker code against rows this file still listed
as `open`, and the stamp above still pointed at the pre-#355 commit. Nothing failed,
so nobody noticed.

That is the same failure mode as the three standing gaps below: this repository enforces
about twenty machine-checkable invariants rigorously and enforced its planning documents
not at all, so the planning documents are where the drift went. The fix was to make the
register checkable rather than to ask people to be more careful. See
`scripts/check-planning-registers.mjs`.

---

## Register map

One canonical list. Everything else is labelled in its own first lines, and the label is
checked.

| Document | Role |
| --- | --- |
| **BACKLOG.md** (this file) | **Canonical.** Open work, ordered by pilot readiness |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Reference — long-horizon five-phase program |
| [RESIDENT_360_PROGRAM_PLAN.md](RESIDENT_360_PROGRAM_PLAN.md) | Reference — Resident 360 program design |
| [CONTROLLED_PILOT_RUNBOOK.md](CONTROLLED_PILOT_RUNBOOK.md) | Reference — live pilot evidence procedure |
| [SURVEY_DAY_MODE_SPEC.md](SURVEY_DAY_MODE_SPEC.md) | Reference — Survey Day mode spec |
| [PA_DHS_ANNUAL_TRAINING_MATRIX.md](PA_DHS_ANNUAL_TRAINING_MATRIX.md) | Reference — PA DHS requirement matrix |
| [docs/design/POC_LIFECYCLE.md](docs/design/POC_LIFECYCLE.md) | Reference — Plan-of-Correction design |
| [docs/design/SCORM_PRODUCTION_HARDENING.md](docs/design/SCORM_PRODUCTION_HARDENING.md) | Reference — SCORM production PR plan |
| [docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md](docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md) | Reference — ops-only Tier A rows |
| ROADMAP.md, WORKFLOW_UX_REVIEW_2026-07-31.md, docs/audits/\*, CAREBASE_25_\*, EFFICIENCY_REVIEW.md, END_USER_REVIEW.md, ENHANCEMENT_REPORT.md, PLATFORM_ENHANCEMENTS.md, root `PennTrain_*` | **Superseded.** Dated evidence only — do not plan from them |

Six of those superseded documents still read as live registers before this pass, and two
claimed authority in their own opening paragraph. If any of them contradicts this file or
code on `main`, **trust code and this file.**

---

## Standing gaps

Accepted, unfixed problems that survive review cycles *because nothing fails while they
are open*. Each row has a review date. When it passes, `check:planning-registers` goes red
until someone closes the row, moves it to "Explicitly not now", or deliberately re-dates it
— which puts a person on record for the decision. Letting it sit quietly is the option the
check removes.

| ID | Gap | Why it survives | Gate to close | Owner | Review by |
| --- | --- | --- | --- | --- | --- |
| SG-1 | Notification delivery reaches demo organizations only. `20260731180000_workflow_ux_efficiency_rollout.sql` auto-enrols the pilot cohort into `notifications.expanded_delivery_types` and `notifications.critical_multichannel` `where o.is_demo is true`; both `feature_definitions` default to `false`. A real pilot org therefore receives nothing, silently. | Demo orgs *do* get notifications, so every demo and screenshot looks correct. The failure is only visible to a real tenant that nobody has enrolled yet. | One non-demo pilot org enrolled via `assign_organization_release_cohort` (Pilot Cohort Console), with a delivered email and SMS recorded in `notification_delivery_attempts`. Flags stay default-off; enrolment is a deliberate operator act, not a migration. | Eng/ops (see A6) | 2026-09-01 |
| SG-2 | The compliance copilot has no Pennsylvania rule pack. `regulatory_rule_pack_templates` ships exactly one row — `oh.rcf.3701-16.personnel` (Ohio). With no installed and activated PA pack, `compliance-copilot` finds zero governed rule versions and answers every PA question with "No active governed rule version matched". | The copilot degrades politely instead of erroring, and the Ohio template makes the *mechanism* look finished. PA is the product's entire market, and it is the one jurisdiction with no pack. | A `pa.*` template authored from `PA_DHS_ANNUAL_TRAINING_MATRIX.md` and 55 Pa. Code Ch. 2600/2800, carried through the existing governance gates: legal review, golden fixtures, independent approval, shadow evaluation, explicit activation. Regulatory content is not something engineering may author unilaterally. | **Governance: platform admin (super admin) ×2.** Rule packs are platform-scoped — `regulatory_rule_packs` has no `organization_id`, so one `pa.*` pack governs every PA tenant, and `org_admin` cannot reach the RPCs at all (`require_platform_rule_admin` → `is_platform_admin()`). Two *distinct* identities are required: `install_regulatory_rule_pack_template` stamps `authored_by = auth.uid()` and `approve_regulatory_rule_version` refuses when `authored_by = auth.uid()`, so one admin can author, submit, and shadow but never approve. **But a platform admin cannot start this row.** They hold `select` only on `regulatory_rule_pack_templates` (writes are `service_role`-only), and `install_…` merely consumes a template that already exists — so two more owners are needed first: **regulatory content** (citations, effective dates, hour thresholds — legal/compliance, not engineering) and **engineering** (a migration inserting the `pa.*` template row, plus unhardcoding `"oh.rcf.3701-16.personnel"` in `EnterpriseFoundation.tsx:453`). | 2026-10-01 |

Closed this pass: **Railway deployed rebuilds whose tests never ran.** `railway.json`
built with `typecheck && build && check-bundle-budget` and no test step, on its own
push-triggered pipeline — so a red suite still shipped. The repo had already solved this
exact class of problem for migrations (`deploy-migrations.yml` waits on a validated CI
SHA; see `MIGRATION_DEPLOYMENT_AUDIT.md`) and never applied it to the application deploy.
The build command now runs the unit suite and the startup check.

---

## Snapshot (what is true on main today)

### Shipped and credible (do not re-litigate)

- Multi-tenant CareBase SPA + Supabase (RLS, Auth, Storage, Edge Functions, pg_cron)
- Flat billing model (Train / CareBase); Stripe qty=1 intent
- Pilot cohort console + release flags / kill switches
- Learning package runtime bridge (opaque iframe, nonce, `event.source`, commit sequencing)
  with unit, integration, and Chromium e2e proof
- Multi-domain Data Import Center: all 8 domains active
- Survey evidence packet zip + guest download path
- Credential OCR structured extraction path
- Violations → corrective actions → retraining assignment → POC PDF → status ladder,
  now with immutable POC versions and auto-created corrective-action work items (#355)
- Clinical/EHR hybrid (native chart + FHIR ingest), opt-in — `docs/HIPAA_CLINICAL_DATA.md`
- Dense ops surface: Survey Day, Work Queue, Training Matrix, Today, binder, evidence
  room, lifecycle cases, invitations

### Still open (highest risk first)

1. Live pilot evidence against a non-demo org (runbook + manifest)
2. Stripe Prices mapped and internal checkout smoke
3. Notification rail proven on a real org — **SG-1**
4. SCORM production hardening: adapter injection wired into the accept path, real vendor packages
5. Trainer quarantine UX reachable from a surface (dialog built, nothing imports it — B5)
6. Durable import worker that survives a closed browser (claim layer exists; stored file does not)
7. Home IA density (too many "homes")
8. PA rule pack for the copilot — **SG-2**
9. Wave 3/4 verticals: policy campaigns, fire-drill DHS form, med-admin board, offline drafts

---

## Ticket register

Status values: `open` · `in_progress` · `blocked` · `done` · `ops_only`
Size: `S` days · `M` 1–2 weeks · `L` multi-week

### Tier A — Pilot / revenue locks (do first)

Ops-only rows are tracked in [docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md](docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md).

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; verify migration stamp | S | ops_only | Code on main; production apply is ops |
| A2 | Map flat Stripe Prices; internal checkout smoke with qty=1 | S | ops_only | See BILLING_MODEL.md launch checklist |
| A3 | Enroll one real pilot org; enable cohort flags deliberately | S | ops_only | Includes the SG-1 notification flags |
| A4 | Run controlled pilot journeys; fill evidence JSON | M | ops_only | CONTROLLED_PILOT_RUNBOOK.md |
| A5 | BAAs / HIPAA-eligible tiers confirmed for live pilot path | S | ops_only | Partial; clinical path needs legal confirm |

### Tier B — SCORM production hardening

Full plan: [docs/design/SCORM_PRODUCTION_HARDENING.md](docs/design/SCORM_PRODUCTION_HARDENING.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| B1 | Bundle `learning-runtime-bridge.js` into accepted package zip at accept time | M | in_progress | #355 landed `bundleRuntimeAdapter.ts` (injection planner + unit tests). Nothing calls it yet — the accept path still does not inject, and the module's own header says this must run server-side so clients cannot skip it |
| B2 | Handshake timeout + learner-visible recovery in `StandardsRuntimePlayer` | S | done | #355. 12s watchdog, `idle→waiting→connected/timed_out/error`, learner-visible recovery |
| B3 | One Storyline + one Captivate golden fixture package in repo | M | in_progress | #355 added `storyline-shaped` / `captivate-shaped` e2e fixtures — API-shaped, hand-built, no Articulate or Adobe involved. They prove the contract; they do not prove the market. Real vendor exports still needed |
| B4 | Bridge SCORM complete → training record / hour bucket | M | open | Credibility for §2600.65 |
| B5 | Trainer package quarantine UX (reject reason + re-upload) | S | in_progress | `QuarantinePackageDialog.tsx` exists; nothing imports it, so no trainer can reach it. Same shape as B1 — a built component that is not wired to a surface |

### Tier C — Plan of Correction depth

Full design: [docs/design/POC_LIFECYCLE.md](docs/design/POC_LIFECYCLE.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| C1 | Immutable POC versions on submit (append-only history) | M | done | #355. `plan_of_correction_versions` + `submit_plan_of_correction` + `list_plan_of_correction_versions` |
| C2 | Effectiveness gate before `verified` | M | done | `20260801120000_poc_verify_requires_closed_actions.sql` added the missing half: verify now also counts corrective actions not in (`completed`, `cancelled`) and refuses while any remain, including actions reopened after `corrected` |
| C3 | Auto work_items from open corrective actions | S | done | #355. `submit_plan_of_correction` inserts deduplicated `violation_corrective_action` work items on the PA facility day |
| C4 | POC due-date escalation into manager digest / SMS | S | blocked | Blocked on SG-1 — no delivery rail for real orgs |
| C5 | Entrance-conference ordered packet by reg number | M | open | Survey Day companion |

### Tier D — Delivery & imports

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| D1 | Monday manager digest email for pilot orgs | S | blocked | Blocked on SG-1 |
| D2 | Turn on due/overdue/approval notifications for pilot cohort | S | blocked | This *is* SG-1 |
| D3 | Durable import worker (stored CSV, resume after browser close) | M | in_progress | #355 landed the claim/lease layer: `claimed_at`/`claimed_by`/`claim_expires_at`, `claim_data_import_jobs`, `release_data_import_job_claim`, `process-data-import-jobs`. The worker reads no stored file, so a closed browser still loses the CSV — the actual promise of this row |
| D4 | Column mapping UI for non-canonical CSVs | M | open | Optional after D3 |
| D5 | Sample realistic PA facility CSVs in Help / Import Center | S | open | Onboarding friction |

### Tier E — Daily operations wedges

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| E1 | Home IA: Today = action, scorecard = health, Command Center = survey | S | open | Reduce "which dashboard?" |
| E2 | Med-admin "who can pass meds today" board on Schedule | M | open | MedAdminRoster × schedule join |
| E3 | Fire drill DHS 9-field form + monthly tracker PDF | M | open | #5 PCH / #3 ALF citation |
| E4 | Policy campaign center (version pin, targets, knowledge check) | L | open | MedTrainer deal-breaker |
| E5 | Offline service documentation drafts (IndexedDB) + conflict rules | L | open | Floor staff |

### Tier F — Engineering hygiene

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| F1 | Split pages >40 KB before feature work (`CourseDetail`, `ResidentFinancialOperations`, `ResidentAssessmentFormEditor`) | M | open | Velocity insurance |
| F2 | Finish route-manifest ownership of sidebar/search/modules | M | open | Partial today |
| F3 | Replace root README marketing handoff with product + agent runbook | S | open | AGENTS.md already good for agents |
| F4 | Banner stale root reviews as historical | S | done | 29 documents bannered; `check:planning-registers` keeps them that way |

---

## Explicitly not now

| Item | Why |
| --- | --- |
| Capability bundles / config release envelope | Enterprise; post-portfolio |
| Vendor external portal | Until maintenance is top pilot pain |
| Full Spanish i18n retrofit | After SMS + mobile proven |
| Multi-state rule packs | PA must be proven first — and PA itself is SG-2 |
| Expanding Essentials/Pro SKUs | Need conversion data |
| Competing on pharmacy eMAR network | Multi-year moat elsewhere |
| New root "comprehensive review" markdown | Update **this** file instead; the check rejects it |

---

## Suggested two-week sequence

**Week 1 — Live truth:** A1–A4, and SG-1 with it.
Goal: one non-demo org can invite staff, complete a course, export binder, and *receive
one real email*. SG-1 is the difference between a pilot and a demo.

**Week 2 — Wire up what is already built:** B1, B3, B5, D3.
Each is a half-built row: code exists, no surface calls it. Finishing them is cheaper than
the new rows that would otherwise be opened on top. (C2 was the fifth and is now closed —
`20260801120000_poc_verify_requires_closed_actions.sql`.)

Then B4 and C5 as the next product depth, with SG-2 running in parallel on the legal side
since it is gated on review rather than on engineering time.

---

## Verification contract for any row marked `done`

1. Code on `main` (or a merged PR linked in the row notes)
2. Relevant unit / edge / e2e tests pass in CI
3. If user-visible: pilot or demo org exercise recorded
4. This file updated in the same change set — enforced by `check:planning-registers`

A row is `in_progress`, not `done`, when the mechanism exists but nothing calls it. This is
the most common way this register goes wrong: #355 produced four such rows at the time
(B1, B3, C2, D3), and the very next commit added a fifth by shipping
`QuarantinePackageDialog.tsx` with no importer (B5). Of those, only C2 has since been
finished. Recording built-but-unreachable code as `done` is how a backlog stops describing
the product.

Ops-only rows close when runbook evidence exists outside the repo (do not commit customer
data).
