# CareMetric CareBase — Living Backlog

**Status:** Canonical forward backlog
**Last verified against main:** `03fe017` (2026-08-02) — E3 fire drill monthly tracker PDF (done); E2 med-admin board joined onto Schedule (done); F3 root README replaced with product + agent runbook (done); SG-2 counsel-cleared option 2; templates seeded; activation remains; PA install UI wired; E1 home IA done; **C5 first-class citation_ref done**; B1 complete; D3 complete; residual SCORM confidence is B3 + A1 production verify; service_role grant on survey_evidence_packet_items added (CI fix)
**Owner:** the owner-operator (single person, platform admin)

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

That is the same failure mode as the standing gaps below: this repository enforces
about twenty machine-checkable invariants rigorously and enforced its planning documents
not at all, so the planning documents are where the drift went. The fix was to make the
register checkable rather than to ask people to be more careful. See
`scripts/check-planning-registers.mjs`.

---

## Operating reality: one person

This product is owned and run by one person, who holds the platform-admin (super admin)
identity. That is not a staffing gap to be worked around; it is the permanent constraint
this backlog is planned against, and it changes three things:

- **`ops_only` does not mean "someone else".** Those rows are not delegated. They are the
  same person, wearing a different hat, on a different day. An owner column reading
  "Eng/ops", "Product", "QA", or "Legal" is a *kind of work*, never a handoff.
- **Nothing runs in parallel.** Two tracks "in parallel" means one of them is not moving.
  The sequence below is single-threaded on purpose.
- **Separation-of-duties controls cannot do their job.** Several gates in this codebase
  require two distinct identities (most sharply `approve_regulatory_rule_version`, which
  refuses when `authored_by = auth.uid()`). One person can always satisfy those
  mechanically with a second account — and satisfying them that way delivers none of the
  independent review they exist to provide. Where that matters, the row says so rather
  than pretending the gate was met.

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
| [docs/ops/SG2_DECISION.md](docs/ops/SG2_DECISION.md) | Reference — SG-2 counsel-cleared option 2 record; activation follow-up remains (2026-08-02) |
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
| SG-1 | Notification delivery reaches demo organizations only. `20260731180000_workflow_ux_efficiency_rollout.sql` auto-enrols the pilot cohort into `notifications.expanded_delivery_types` and `notifications.critical_multichannel` `where o.is_demo is true`; both `feature_definitions` default to `false`. A real pilot org therefore receives nothing, silently. | Demo orgs *do* get notifications, so every demo and screenshot looks correct. The failure is only visible to a real tenant that nobody has enrolled yet. | One non-demo pilot org enrolled via `assign_organization_release_cohort` (Pilot Cohort Console), with a delivered email and SMS recorded in `notification_delivery_attempts`. Flags stay default-off; enrolment is a deliberate operator act, not a migration. | **You** (ops hat — see A6) | 2026-09-01 |
| SG-2 | Counsel cleared option 2 and `20260802010000_pa_regulatory_rule_pack_templates.sql` seeded `pa.pch.2600.65.personnel` and `pa.alf.2800.65.personnel`, but no active PA governed version exists yet. Until one of those drafts completes install → review → shadow → activate, the copilot remains a drafting aid for Pennsylvania. | The templates now exist and are installable, so the product can look "done" before any PA governed version is actually active. | Install one PA draft, complete the guarded workflow, and activate a PA governed version with evidence. | **You** (product/ops/legal coordination) | 2026-09-01 |

---

Closed this pass: **E3 fire drill DHS monthly tracker PDF.** The 9-field form and per-drill print
view already existed; added the missing rollup — `generate-fire-drill-tracker-pdf` edge function
(facility + month, all 9 DHS fields, mirrors `generate-incident-report-pdf`'s auth/RLS pattern) and
a "Download Monthly Fire Drill Tracker" action on `InspectionItems.tsx`. New private
`fire-drill-tracker-exports` storage bucket, write via service-role only, read scoped by org +
facility assignment. Verified against the local Supabase stack: 2782/2782 pgTAP including
`tenant_isolation_invariants`; `db lint`/`db advisors` clean. No new route.

Closed this pass: **F3 root README replaced with product + agent runbook.** Root `README.md`
was a marketing-site-redesign handoff doc; that content moved to
`docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md` (with provenance note) and root `README.md`
now orients a reader on the actual product, monorepo layout, and points to `AGENTS.md` for
setup/commands and `BACKLOG.md` for current work, without duplicating either.

Closed this pass: **E2 med-admin "who can pass meds today" board joined onto Schedule.**
`useMedAdminAuthorization` extracts the cert (MED-INIT/MED-RENEW) + practicum + diabetes-education
join `MedAdminRoster.tsx` already computed into a shared hook; `ScheduleDetail.tsx` now shows a
per-employee authorization badge (only for staff flagged `administers_medications`) and a gap
banner for any scheduled `(date, shift)` with med-admin staff present but none currently
authorized. `MedAdminRoster.tsx` itself now consumes the shared hook instead of a second copy of
the join. 23 new unit tests.

Closed this pass: **SG-2 liability gate cleared by counsel; PA personnel templates seeded.**
Option 2 is now counsel-cleared in [docs/ops/SG2_DECISION.md](docs/ops/SG2_DECISION.md),
and `20260802010000_pa_regulatory_rule_pack_templates.sql` seeded
`pa.pch.2600.65.personnel` plus `pa.alf.2800.65.personnel`. SG-2 remains open as an
activation gap until a PA governed version is actually active.

Closed this pass: **PA rule pack install UI wired.** Enterprise Foundation's regulatory
expansion panel now offers install buttons for both seeded PA templates
(`pa.pch.2600.65.personnel`, `pa.alf.2800.65.personnel`) alongside the Ohio mechanism
demo, and the Regulatory Copilot empty-state / alert copy directs operators to install
and activate a PA pack instead of describing PA coverage as permanently out of scope.

Closed this pass: **Railway deployed rebuilds whose tests never ran.** `railway.json`
built with `typecheck && build && check-bundle-budget` and no test step, on its own
push-triggered pipeline — so a red suite still shipped. The repo had already solved this
exact class of problem for migrations (`deploy-migrations.yml` waits on a validated CI
SHA; see `MIGRATION_DEPLOYMENT_AUDIT.md`) and never applied it to the application deploy.
The build command now runs the unit suite and the startup check.

Closed this pass: **Marketing suite documentation terminology + Landing design fidelity (#377).**
Public marketing surfaces (Landing.tsx, Features, FAQ) now exclusively use “documentation” /
“documentation rooms” / “Survey documentation” (never “evidence”). Landing restored to
CareBase Landing v2 design fidelity (Prove the work., Education spend, Guest documentation
portals) with regression test; pricing remains single-source from marketingPricing.ts;
self-serve CTAs preserved. Internal product routes unchanged.

Closed this pass: **D3 durable import apply RPCs — all 8 domains complete (#413).** Dedicated
SECURITY DEFINER RPCs (`import_apply_training_record`, `import_apply_employee_credential`,
`import_apply_room_with_beds`, `import_apply_incident`) granted only to service_role mirror
the interactive RPC business rules but replace `auth.uid()` with NULL (system-applied import,
no human reviewer). `PENDING_DURABLE_DOMAINS` is empty; the worker dispatches all 8 domains.
No table-level INSERT/UPDATE grants widened on incidents or employee_credentials;
interactive RPCs for authenticated callers unchanged.

Closed this pass: **B1 accept-time bridge bundling.** `accept-learning-package` edge function
injects `carebase/learning-runtime-bridge.js` into the package zip at accept time, re-hashes,
and updates `content_sha256`. Client routes through the edge function so injection cannot be
skipped. Org-scoped storage policies on the `learning-packages` bucket ship in
`20260731230000_residual_product_gaps_wave2.sql`. Residual market confidence is B3 (real
vendor packages); production apply of migrations remains A1 ops.

Closed this pass: **C5 first-class citation_ref on survey evidence packets.**
`survey_evidence_packet_items.citation_ref` is a first-class column; add/list/assemble RPCs prefer it for
regulation order (label parse remains the fallback); Survey Day packet UI accepts an explicit citation
and shows a badge from the stored field.

Closed this pass: **E1 Home IA density.** Primary navigation and page copy now separate the three
roles cleanly: **Today** = action / due work, **Compliance scorecard** = health / trends, and
**Inspection Readiness / Survey Day** = survey prep / live entrance conference.

Closed this pass: **B4 SCORM/xAPI completion → training record / hour bucket (trigger-based).**
AFTER INSERT on learning_runtime_commits calls internal bridge_learning_runtime_completion
when first completed commit arrives (quiz blocks still gate; `pa_today()`; privileged_write;
upsert employee_training_records + recalculate_compliance_core). Leaves commit_learning_runtime_state
untouched so existing pgTAP remains green.

Closed this pass: **D5 sample CSVs reachable from Import Center.** `ImportSampleDownloads` is
now rendered on `DataImportCenter` (after the domain-templates card). Sample employee /
training-record / credential CSVs under `public/import-samples/` are downloadable for
dry-run practice. Column order matches `importTemplate()`.

---

## Snapshot (what is true on main today)

### Shipped and credible (do not re-litigate)

- Multi-tenant CareBase SPA + Supabase (RLS, Auth, Storage, Edge Functions, pg_cron)
- Flat billing model (Train / CareBase); Stripe qty=1 intent
- Pilot cohort console + release flags / kill switches
- Learning package runtime bridge (opaque iframe, nonce, `event.source`, commit sequencing)
  with unit, integration, and Chromium e2e proof
- Accept-time bridge bundling into package zips (B1) + org-scoped `learning-packages` storage policies
- Multi-domain Data Import Center: all 8 domains active
- Durable import worker: all 8 domains apply from ledger under service-role (direct table or import_apply_* SECURITY DEFINER RPCs)
- Survey evidence packet zip + guest download path
- Credential OCR structured extraction path
- Violations → corrective actions → retraining assignment → POC PDF → status ladder,
  now with immutable POC versions and auto-created corrective-action work items (#355)
- Clinical/EHR hybrid (native chart + FHIR ingest), opt-in — `docs/HIPAA_CLINICAL_DATA.md`
- Dense ops surface: Survey Day, Work Queue, Training Matrix, Today, binder, evidence
  room, lifecycle cases, invitations
- Marketing public suite: documentation terminology lock + Landing design fidelity (#377)
- SCORM/xAPI runtime completion bridges to assignment + training records / hour buckets (B4)
- SG-2 counsel-cleared install path exists for PA personnel templates; activation still pending — [SG2_DECISION.md](docs/ops/SG2_DECISION.md)
- Survey evidence packet first-class `citation_ref` + regulation-ordered list/manifest (C5)

### Still open (highest risk first)

1. Live pilot evidence against a non-demo org (runbook + manifest)
2. Stripe Prices mapped and internal checkout smoke
3. Notification rail proven on a real org — **SG-1**
4. SCORM real vendor packages (B3); B1/B4/B5 shipped, adapter injection wired
5. Wave 3/4 verticals: policy campaigns, offline drafts

---

## Ticket register

Status values: `open` · `in_progress` · `blocked` · `done` · `ops_only`
Size: `S` days · `M` 1–2 weeks · `L` multi-week

### Tier A — Pilot / revenue locks (do first)

Ops-only rows are tracked in [docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md](docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md).

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; verify migration stamp | S | ops_only | Code on main; production apply is ops — includes `20260801220000_durable_import_apply_rpcs.sql` from #413 |
| A2 | Map flat Stripe Prices; internal checkout smoke with qty=1 | S | ops_only | See BILLING_MODEL.md launch checklist |
| A3 | Enroll one real pilot org; enable cohort flags deliberately | S | ops_only | Includes the SG-1 notification flags |
| A4 | Run controlled pilot journeys; fill evidence JSON | M | ops_only | CONTROLLED_PILOT_RUNBOOK.md |
| A5 | BAAs / HIPAA-eligible tiers confirmed for live pilot path | S | ops_only | Partial; clinical path needs legal confirm |

### Tier B — SCORM production hardening

Full plan: [docs/design/SCORM_PRODUCTION_HARDENING.md](docs/design/SCORM_PRODUCTION_HARDENING.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| B1 | Bundle `learning-runtime-bridge.js` into accepted package zip at accept time | M | done | `accept-learning-package` edge injects bridge via fflate, re-hashes, updates `content_sha256`; client cannot skip. Storage bucket + org-scoped policies in `20260731230000`. Residual market confidence is B3; production verify is A1. |
| B2 | Handshake timeout + learner-visible recovery in `StandardsRuntimePlayer` | S | done | #355. 12s watchdog, `idle→waiting→connected/timed_out/error`, learner-visible recovery |
| B3 | One Storyline + one Captivate golden fixture package in repo | M | in_progress | Contract fixtures (`storyline-shaped` / `captivate-shaped`) prove the API. Real vendor exports are owner-gated — see fixtures README owner drop-path. |
| B4 | Bridge SCORM complete → training record / hour bucket | M | done | Trigger on first completed learning_runtime_commits row → bridge_learning_runtime_completion; assignment + training_records + hour buckets when courses.training_type_id set; quiz blocks still gate; pa_today(); internal-only |
| B5 | Trainer package quarantine UX (reject reason + re-upload) | S | done | `QuarantinePackageDialog` imported into `GovernedLearning.tsx`; replaces `window.prompt`. Trainer can now reach quarantine from the Standards tab |

### Tier C — Plan of Correction depth

Full design: [docs/design/POC_LIFECYCLE.md](docs/design/POC_LIFECYCLE.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| C1 | Immutable POC versions on submit (append-only history) | M | done | #355. `plan_of_correction_versions` + `submit_plan_of_correction` + `list_plan_of_correction_versions` |
| C2 | Effectiveness gate before `verified` | M | done | `20260801120000_poc_verify_requires_closed_actions.sql` added the missing half: verify now also counts corrective actions not in (`completed`, `cancelled`) and refuses while any remain, including actions reopened after `corrected` |
| C3 | Auto work_items from open corrective actions | S | done | #355. `submit_plan_of_correction` inserts deduplicated `violation_corrective_action` work items on the PA facility day |
| C4 | POC due-date escalation into manager digest / SMS | S | blocked | Blocked on SG-1 — no delivery rail for real orgs |
| C5 | Entrance-conference ordered packet by reg number | M | done | First-class `citation_ref` on `survey_evidence_packet_items` + `p_citation_ref` on `add_survey_evidence_packet_item`; list/assemble order prefer `citation_ref` then label parse; Survey Day UI citation input + badge; pgTAP covers structured citation preference. Label-parse fallback remains for older rows. |

### Tier D — Delivery & imports

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| D1 | Monday manager digest email for pilot orgs | S | blocked | Blocked on SG-1 |
| D2 | Turn on due/overdue/approval notifications for pilot cohort | S | blocked | This *is* SG-1 |
| D3 | Durable import worker (apply from ledger, resume after browser close) | M | done | All 8 domains durable under service-role: `employees`, `residents`, `resident_contacts`, `assessments` via direct table; `rooms`, `credentials`, `training_records`, `incidents` via dedicated `import_apply_*` SECURITY DEFINER RPCs granted only to service_role (#413). No table-level INSERT/UPDATE grants widened on restricted tables. |
| D4 | Column mapping UI for non-canonical CSVs | M | open | Optional after D3 |
| D5 | Sample realistic PA facility CSVs in Help / Import Center | S | done | Sample employee / training-record / credential CSVs under `public/import-samples/` with `importSamples.ts` registry and `ImportSampleDownloads` component. Column order matches `importTemplate()`. Component is now rendered on `DataImportCenter` (after domain-templates card) so samples are reachable from the UI. |

### Tier E — Daily operations wedges

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| E1 | Home IA: Today = action, scorecard = health, Command Center = survey | S | done | Sidebar + primary surface titles/subtitles now read as Today = action, Compliance scorecard = health/trends, Inspection Readiness / Survey Day = survey prep / live entrance conference. |
| E2 | Med-admin "who can pass meds today" board on Schedule | M | done | `useMedAdminAuthorization` shared hook; per-employee badge + no-one-authorized gap banner on `ScheduleDetail.tsx` |
| E3 | Fire drill DHS 9-field form + monthly tracker PDF | M | done | `generate-fire-drill-tracker-pdf` + `InspectionItems.tsx` action; #5 PCH / #3 ALF citation |
| E4 | Policy campaign center (version pin, targets, knowledge check) | L | open | MedTrainer deal-breaker |
| E5 | Offline service documentation drafts (IndexedDB) + conflict rules | L | open | Floor staff |

### Tier F — Engineering hygiene

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| F1 | Split pages >40 KB before feature work (`CourseDetail`, `ResidentFinancialOperations`, `ResidentAssessmentFormEditor`) | M | open | Velocity insurance |
| F2 | Finish route-manifest ownership of sidebar/search/modules | M | open | Partial today |
| F3 | Replace root README marketing handoff with product + agent runbook | S | done | Old content relocated to `docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md` |
| F4 | Banner stale root reviews as historical | S | done | 29 documents bannered; `check:planning-registers` keeps them that way |

---

## Explicitly not now

| Item | Why |
| --- | --- |
| Capability bundles / config release envelope | Enterprise; post-portfolio |
| Vendor external portal | Until maintenance is top pilot pain |
| Full Spanish i18n retrofit | After SMS + mobile proven |
| Multi-state rule packs | Finish Pennsylvania install → activate first, then decide where expansion actually matters |
| Expanding Essentials/Pro SKUs | Need conversion data |
| Competing on pharmacy eMAR network | Multi-year moat elsewhere |
| New root "comprehensive review" markdown | Update **this** file instead; the check rejects it |

---

## Sequence

Single-threaded, because there is one person. This is an order, not a schedule — dates
would be fiction. Do not start the next block until the previous one is actually done.

**1. Live truth.** A1–A4, and SG-1 with them.
One non-demo org can invite staff, complete a course, export a binder, and *receive one
real email*. SG-1 is the difference between a pilot and a demo, and A1–A4 are worth little
without it. Nothing below this line matters until a real tenant has used the product.

**2. Wire up what is already built.** ~~B1~~, B3, ~~B5~~, ~~D3~~, ~~D5~~.
Each is a half-built row: the code exists, no surface calls it. B1, B5, D3, and D5 are now
wired and done. B3 remains (real vendor packages — owner drop-path). This is the cheapest
block on the list and the one most likely to be skipped, because none of it looks like
progress. Doing it before new features is how the pile stops growing. (C2 was the fifth
and is now closed.)

**3. Finish SG-2 install → activate.**
Counsel cleared option 2 and the PA personnel templates are seeded, with the install UI wired
in Enterprise Foundation. Next step is not more debate; it is to install a PA draft, complete
guarded review/shadow, and activate a governed version. Until that evidence exists, the
copilot remains a drafting aid for Pennsylvania.

**4. Product depth.** ~~B4~~ done, ~~E1~~ done, ~~C5~~ done.
C5 is complete: first-class `citation_ref` on packet items, RPC/UI wired, regulation order prefers
structured citation then label parse. Only once 1–3 are settled for live use.

**Deliberately not in this list:** A5 (BAAs), because it depends on someone outside the
repo. Start it early precisely because it is the only thing here that can wait on another
person's calendar.

---

## Verification contract for any row marked `done`

1. Code on `main` (or a merged PR linked in the row notes)
2. Relevant unit / edge / e2e tests pass in CI
3. If user-visible: pilot or demo org exercise recorded
4. This file updated in the same change set — enforced by `check:planning-registers`

A row is `in_progress`, not `done`, when the mechanism exists but nothing calls it. This is
the most common way this register goes wrong: #355 produced four such rows at the time
(B1, B3, C2, D3), and the very next commit added a fifth by shipping
`QuarantinePackageDialog.tsx` with no importer (B5). Of those, B1, C2, and D3 have since
been finished. Recording built-but-unreachable code as `done` is how a backlog stops
describing the product.

Ops-only rows close when runbook evidence exists outside the repo (do not commit customer
data). "Ops-only" means a different hat, not a different person — see "Operating reality"
above.

**On self-review.** Every gate in this list is one person checking their own work, so the
checks that do not depend on a second reader are the ones carrying real weight: CI, the
pgTAP suite, `check:all`, and this register's own freshness check. Treat a mechanical gate
that a second account merely unlocked (`approve_regulatory_rule_version`) as unverified,
and say so in the row rather than counting it as review.

<!-- Register verified: SG-2 counsel-cleared option 2; PA templates seeded; activation gap remains; C5 citation_ref done; B1 done; B3 owner drop-path documented -->
