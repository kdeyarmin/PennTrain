# CareMetric CareBase — Living Backlog

**Status:** Canonical forward backlog
**Last verified against main:** `6ffc915e` (2026-08-03) — **caregiver charting: closed a latent double-charge path** in `MyResidentChart.submitObservation` — the post-success read-back sat inside the same `try` as the offline fallback, so a throw there while offline would have queued a draft of an already-charted reading and charted it twice on reconnect (the idempotency key cannot catch that: a second draft carries a second key). Unreachable with react-query's current non-rejecting `refetch()`, restructured so it stays that way. Earlier — **security review clean** (no High/Medium findings; the widened photo branch, the offline sync RPC, the two zero-arg roster RPCs, and the encrypted IndexedDB scope binding were each traced end to end). One consistency fix came out of it: `sync_offline_clinical_observation_draft` now scopes its receipt row from the caller's own device registration rather than from the caller-supplied resident's organization, matching `sync_offline_service_task_draft`. Earlier — **E4 campaign creation is now atomic** (`create_policy_campaign_with_questions`, SECURITY INVOKER so existing RLS still authorizes; a failed question insert can no longer leave a committed campaign that looks read-and-sign and lets staff attest with no knowledge check). All PR #433 review findings are now closed. Earlier — **E4 attempt cap serialized** (the cap added a pass earlier was a check-then-act race and did nothing against concurrent submissions; the attestation row is now locked before counting). Earlier — **E4/D1/C4 review fixes** (all 12 Copilot + Codex findings on PR #433 addressed): digest rows now link to pages that exist rather than query params they ignore; a passed knowledge check survives reopening the dialog; campaign creation cannot double-fire. Earlier in the same pass — **E4 knowledge-check review fixes**: closed cross-tenant question injection (composite campaign/org FK), made the freeze trigger guard the campaign a question is moved *out* of, asserted the Compliance entitlement inside both SECURITY DEFINER RPCs, capped attempts at 5/day to bound the score-as-answer-key oracle (counts are kept deliberately, so the leak is bounded not closed), and redacted `correct_choice_index` from the audit log so org auditors cannot recover the key the select policy denies them. **C4's digest half done** (plans of correction due or overdue now counted in the manager digest; the SMS half needs a new notification type, templates, and a daily job, and stays open). **D1 corrected and de-duplicated**: the Monday manager digest was already built and scheduled (the row claiming otherwise was wrong); closing SG-1 exposed that a second job, `send-monday-digest`, fired the same minute to the same audience, so every manager got two — that schedule is retired and its resident-compliance counts folded into the surviving digest. **E4's knowledge check done** (`policy_campaign_questions` + `policy_knowledge_check_attempts`, server-side grading, `attest-policy` gated on a passing attempt); E4's other two parts — version pin and targets — turned out to have shipped back in `20260705151703_policy_attestation_core`, so the row is now `in_progress` against its remaining scope rather than `open`. **F2 done** (route-manifest now governs the command palette, product-module path classifier, and `Sidebar.tsx`'s own nav data; fixed a live bug where `/app/survey-day` was missing from `APP_PAGES` and therefore hidden from the sidebar for every role). Prior pass: merged main's pilot-program-removal (PR #432, closing SG-1 as noted below), resolving a migration version collision between the two (E3/E5 migrations renamed to `20260802050000`/`20260802060000`; no schema change) — **pilot program removed** (Pilot Cohort Console + controlled-pilot evidence gate deleted; the four previously cohort-gated release flags are now `global`, non-expiring, for every organization; self-service signup now initializes `organization_settings` with notifications on; `/admin/release-flags` replaces the console for flags/kill switches only, closing SG-1); F1 split the three >40KB page files (done); D4 CSV column-mapping UI (done); E3 fire drill monthly tracker PDF (done); E2 med-admin board joined onto Schedule (done); F3 root README replaced with product + agent runbook (done); SG-2 counsel-cleared option 2; templates seeded; activation remains; PA install UI wired; E1 home IA done; **C5 first-class citation_ref done**; B1 complete; D3 complete; residual SCORM confidence is B3 + A1 production verify; service_role grant on survey_evidence_packet_items added (CI fix); **E5 Tier 1 (offline service documentation draft/sync/conflict-rules for floor-queue tasks) shipped** — broader offline scope stays open; F1's `VersionsCard.tsx` version-row selector gained keyboard semantics (a11y fix, PR #431 review); **D4 fixed post-ship** — the column-mapping re-serializer was reusing the export-oriented (formula-injection-hardened) `csvEscape`, corrupting mapped values starting with `+`/`@`/`=`/non-numeric `-` (e.g. E.164 phone numbers) before they ever reached the import pipeline; now uses a plain RFC 4180 `csvQuoteField`; **E2 fixed post-ship** — practicum selection now applies the same completion-first/missing-last ordering as the DB's canonical `current_practicums` instead of an unordered `.find()`; null-`shift_definition_id` assignments with different resolved shift names no longer collapse into one coverage-gap bucket; the per-employee authorization badge now waits for its queries to settle instead of flashing a false "not authorized" during load/error; **E5 fixed post-ship** — `sync_offline_service_task_draft` now sets `performed_at` from the validated client-supplied occurrence time instead of sync time, and an idempotent replay of a `conflict`/`stale`/`rejected`/`wipe_required` receipt now returns that same outcome instead of being hardcoded to `duplicate` (which was making the client silently delete drafts that were never actually applied); **E3 fixed post-ship, including a real authorization gap** — `generate-fire-drill-tracker-pdf` relied on `facilities` RLS (deliberately org-wide) as its only gate, so a same-org caller with no facility assignment (e.g. `employee`, or an unassigned `facility_manager`/`trainer`) could reach the handler, have their `inspection_events` query silently RLS-filtered to empty, and have the function upload an *empty* tracker over a real one at the canonical `{org}/{facility}/{month}.pdf` path via the service-role client; now gated by an explicit `is_assigned_to_facility` check before any facility lookup or service-role write, mirroring `inspection_events_select`'s own RLS logic and failing closed on RPC error. Also fixed: long free-text DHS fields (exit route, problems encountered) were silently truncated with an ellipsis in the PDF instead of wrapping — a compliance document that didn't actually contain what it claimed to; **E5 client fixed post-ship** — `saveServiceDraft` now resolves only from the IndexedDB transaction's `oncomplete`/`onabort` instead of the individual request's `onsuccess`, so a transaction that aborts after the request already succeeded (e.g. quota exceeded at flush time) can no longer show "Saved on this device" for a draft that was never actually committed; the proactive-wipe check now skips while a session exists but its profile hasn't resolved yet (was treating that transient state as an identity change and clearing IndexedDB); `DocumentCareDialog.tsx` now also falls back to the offline-draft path on a genuine network-level failure (fetch never reached the server), not just `navigator.onLine === false`, which browsers can leave `true` during a real DNS/route/captive-portal outage; **employee caregiver clinical charting surface shipped** — new `/me/residents` (roster) and `/me/residents/:id` (vitals + care notes) routes, gated to `employee` only, close the gap the admin chart's `CLINICAL_CHART_ROLES` comment flagged (employees could already author clinical records via the existing SECURITY DEFINER RPCs but had no UI path to reach them); backed by a new `get_clinical_chart_resident_options` RPC (roster gated by the same `clinical_record_visible` helper the chart RPCs already use, not base `residents` RLS, which has no employee path); `ResidentCareDocumentation` reused unmodified for notes/assessments/care plans; `Floor.tsx` gained a per-task "Chart" link; observation formatting/config extracted from `ResidentClinicalChart.tsx` into shared `src/lib/clinicalObservations.ts` (behavior-preserving, admin chart otherwise untouched); **caregiver surface hardened in the same PR** — pgTAP authorization coverage for `get_clinical_chart_resident_options` (the negative cases are the actual PHI boundary, since `employee` reaches residents through no other path); **offline vitals capture** extending E5's device/key/wipe machinery to observations (new `offline_observation_draft_receipts` + `sync_offline_clinical_observation_draft`, second object store on the same `carebase-offline-floor` database at v2, surfaced through the existing `UnsyncedDraftsPanel`) so a reading taken without signal is queued rather than lost; server-flagged critical readings now stop the caregiver for a re-check with a retract / report-change-of-condition handoff; one-tap BP/pulse/temp/SpO₂/pain presets with the UCUM unit no longer free-text; roster grouped by "on your assignment today" from the same queue Floor reads. Also corrected a wrong comment shipped in the first pass: `clinical_record_visible` reaches an employee only via `employees.facility_id` (UNIQUE per profile), so float staff carrying extra facilities via `employee_facility_assignments` cannot chart there — a limitation of the shared clinical helper, recorded rather than silently widened; **resident photos for right-patient verification** (`20260803030000`) — the first `employee` branch on `resident_documents_select` and the `resident-documents` storage read policy, deliberately scoped to the single document `residents.photo_document_id` designates (contracts, agreements, assessments and state forms stay invisible, including for a resident whose photo is readable), enforced through SECURITY DEFINER predicates because `residents` has no employee-readable branch for an inline `exists` to survive
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
| **BACKLOG.md** (this file) | **Canonical.** Open work, ordered by launch readiness |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Reference — long-horizon five-phase program |
| [RESIDENT_360_PROGRAM_PLAN.md](RESIDENT_360_PROGRAM_PLAN.md) | Reference — Resident 360 program design |
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
| SG-2 | Counsel cleared option 2 and `20260802010000_pa_regulatory_rule_pack_templates.sql` seeded `pa.pch.2600.65.personnel` and `pa.alf.2800.65.personnel`, but no active PA governed version exists yet. Until one of those drafts completes install → review → shadow → activate, the copilot remains a drafting aid for Pennsylvania. | The templates now exist and are installable, so the product can look "done" before any PA governed version is actually active. | Install one PA draft, complete the guarded workflow, and activate a PA governed version with evidence. | **You** (product/ops/legal coordination) | 2026-09-01 |

---

Closed this pass: **F1 split the three pages over 40KB.** `CourseDetail.tsx`, `ResidentFinancialOperations.tsx`,
and `ResidentAssessmentFormEditor.tsx` decomposed into `course-detail/`, `resident-financial-operations/`,
and `resident-assessment-form-tabs/` (the last mirrors the existing `resident-tabs/` convention). Pure
structural refactor, zero intended behavior change — verified per-file (typecheck immediately after each
split, not just at the end) plus a DOM-id byte-diff against the pre-split files to catch attribute drift
a normal diff wouldn't surface. No e2e coverage existed for any of the three pages to regression-check
against (confirmed by route grep); unit suite (1136 tests) and production builds are the verification signal.

Closed this pass: **D4 column-mapping UI for non-canonical CSVs.** All 8 `bulk-import-*` edge
functions parse CSV by header name, not position, so a client-side relabel before the existing
D3 dry-run/apply pipeline was sufficient — no edge function, RPC, or ledger change. New
`importColumnMapping.ts` (exact/alias/fuzzy-suggested mapping, never auto-applied without user
review) and `ImportColumnMapping.tsx` UI in `DataImportCenter.tsx`; a canonical exact-header
upload still flows through unchanged. 27 new tests.

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

Closed this pass: **SG-1 pilot-cohort notification gate removed; SG-2 liability gate cleared
by counsel; PA personnel templates seeded.** SG-1 was closed by deleting the pilot program
outright rather than by enrolling a pilot org: `20260802030000_remove_pilot_program.sql`
set `notifications.expanded_delivery_types` and `notifications.critical_multichannel` (plus
`screening.on_hire_exclusion` and `learning.video_watch_gate`) to `global`, non-expiring, for
every organization — no console, no manual enrollment, no separate gate. Review caught a
second, independent gate behind it: `record_organization_signup` never created an
`organization_settings` row, and that table defaults both notification switches to `false`,
so a real signup still received nothing even with the flags global.
`20260802040000_signup_creates_organization_settings.sql` closes that too, so a real signup
now gets email/SMS delivery the same way a demo org always did. Deleting the Pilot Cohort
Console also removed the only in-app UI for `set_release_flag`/`set_feature_kill_switch`;
`/admin/release-flags` (`ReleaseFlags.tsx`) replaces it with a minimal, non-pilot surface —
flags and kill switches only, no cohort enrollment.
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
- Release flags / kill switches (global rollout; no pilot-cohort gate)
- Learning package runtime bridge (opaque iframe, nonce, `event.source`, commit sequencing)
  with unit, integration, and Chromium e2e proof
- Accept-time bridge bundling into package zips (B1) + org-scoped `learning-packages` storage policies
- Multi-domain Data Import Center: all 8 domains active
- Durable import worker: all 8 domains apply from ledger under service-role (direct table or import_apply_* SECURITY DEFINER RPCs)
- Survey evidence packet zip + guest download path
- Credential OCR structured extraction path
- Violations → corrective actions → retraining assignment → POC PDF → status ladder,
  now with immutable POC versions and auto-created corrective-action work items (#355)
- Clinical/EHR hybrid (native chart + FHIR ingest; lightweight employee caregiver charting
  surface at `/me/residents`, offline-tolerant), opt-in — `docs/HIPAA_CLINICAL_DATA.md`
- Dense ops surface: Survey Day, Work Queue, Training Matrix, Today, binder, evidence
  room, lifecycle cases, invitations
- Marketing public suite: documentation terminology lock + Landing design fidelity (#377)
- SCORM/xAPI runtime completion bridges to assignment + training records / hour buckets (B4)
- SG-2 counsel-cleared install path exists for PA personnel templates; activation still pending — [SG2_DECISION.md](docs/ops/SG2_DECISION.md)
- Survey evidence packet first-class `citation_ref` + regulation-ordered list/manifest (C5)
- Offline documentation for one already-queued floor task when a device goes offline, Tier 1 (E5) — encrypted IndexedDB draft store, sync with block-and-flag conflict handling, proactive wipe on identity change; broader offline scope remains open

### Still open (highest risk first)

1. Stripe Prices mapped and internal checkout smoke
2. SCORM real vendor packages (B3); B1/B4/B5 shipped, adapter injection wired
3. Wave 3/4 verticals: policy campaigns beyond E4's knowledge-check slice (declarative targeting, scheduling, reminders); offline drafts beyond E5 Tier 1's single floor-queue-task scope

---

## Ticket register

Status values: `open` · `in_progress` · `blocked` · `done` · `ops_only`
Size: `S` days · `M` 1–2 weeks · `L` multi-week

### Tier A — Launch / revenue locks (do first)

Ops-only rows are tracked in [docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md](docs/ops/TIER_A_PILOT_OPS_CHECKLIST.md).

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; verify migration stamp | S | ops_only | Code on main; production apply is ops — includes `20260801220000_durable_import_apply_rpcs.sql` from #413 |
| A2 | Map flat Stripe Prices; internal checkout smoke with qty=1 | S | ops_only | See BILLING_MODEL.md launch checklist |
| A5 | BAAs / HIPAA-eligible tiers confirmed for the live customer path | S | ops_only | Partial; clinical path needs legal confirm |

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
| C4 | POC due-date escalation into manager digest / SMS | S | in_progress | **Digest half done** (`20260802080000`): the manager weekly digest now counts plans of correction due within 7 days or already overdue, on violations not yet `corrected`/`verified`, facility-scoped and cut on the PA day. **SMS half remains** and is not a one-liner — `notifications.notification_type` has no plan-of-correction value, so it needs a new type on that CHECK constraint, delivery templates for it, and a *daily* escalation job (a weekly digest is the wrong cadence for something already overdue) |
| C5 | Entrance-conference ordered packet by reg number | M | done | First-class `citation_ref` on `survey_evidence_packet_items` + `p_citation_ref` on `add_survey_evidence_packet_item`; list/assemble order prefer `citation_ref` then label parse; Survey Day UI citation input + badge; pgTAP covers structured citation preference. Label-parse fallback remains for older rows. |

### Tier D — Delivery & imports

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| D1 | Monday manager digest email | S | done | The digest **was already built and scheduled** — `queue_manager_weekly_digests()` on `manager-weekly-digest` (Mon 12:00 UTC), with `manager_digest_snapshots`, a rendered page, and registered email/push templates. The row's previous note ("the digest itself is still not built") was wrong. What SG-1's closure exposed was a *duplicate*: `send-monday-digest` fired the same minute to the same audience, so every manager got two. `20260802080000` retires that schedule and folds its resident-compliance counts (the one thing it reported and the survivor didn't) into the manager digest |
| D2 | Turn on due/overdue/approval notifications for all organizations | S | done | This *was* SG-1 — closed by `20260802030000_remove_pilot_program.sql`, which set the release flags to `global` |
| D3 | Durable import worker (apply from ledger, resume after browser close) | M | done | All 8 domains durable under service-role: `employees`, `residents`, `resident_contacts`, `assessments` via direct table; `rooms`, `credentials`, `training_records`, `incidents` via dedicated `import_apply_*` SECURITY DEFINER RPCs granted only to service_role (#413). No table-level INSERT/UPDATE grants widened on restricted tables. |
| D4 | Column mapping UI for non-canonical CSVs | M | done | Client-side relabel; `importColumnMapping.ts` + `ImportColumnMapping.tsx` |
| D5 | Sample realistic PA facility CSVs in Help / Import Center | S | done | Sample employee / training-record / credential CSVs under `public/import-samples/` with `importSamples.ts` registry and `ImportSampleDownloads` component. Column order matches `importTemplate()`. Component is now rendered on `DataImportCenter` (after domain-templates card) so samples are reachable from the UI. |

### Tier E — Daily operations wedges

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| E1 | Home IA: Today = action, scorecard = health, Command Center = survey | S | done | Sidebar + primary surface titles/subtitles now read as Today = action, Compliance scorecard = health/trends, Inspection Readiness / Survey Day = survey prep / live entrance conference. |
| E2 | Med-admin "who can pass meds today" board on Schedule | M | done | `useMedAdminAuthorization` shared hook; per-employee badge + no-one-authorized gap banner on `ScheduleDetail.tsx` |
| E3 | Fire drill DHS 9-field form + monthly tracker PDF | M | done | `generate-fire-drill-tracker-pdf` + `InspectionItems.tsx` action; #5 PCH / #3 ALF citation |
| E4 | Policy campaign center (version pin, targets, knowledge check) | L | in_progress | MedTrainer deal-breaker. **Two of the three parts already shipped in `20260705151703_policy_attestation_core` and were reachable from `PolicyDocumentDetail.tsx`** — version pin (`policy_attestation_campaigns.policy_document_version_id` is NOT NULL, published versions frozen by `lock_published_policy_version`, every attestation stores the signed `content_hash`) and targets (campaigns fan out to explicitly picked employees at assign time, the training-plan pattern the core migration chose deliberately). **Knowledge check was the genuine gap and is now done**: `policy_campaign_questions` + `policy_knowledge_check_attempts`, server-side grading via `submit_policy_knowledge_check`, questions read through `get_policy_knowledge_check` (answer key absent from its signature, not merely filtered), `attest-policy` refuses to record an attestation for a campaign with questions until a passing attempt exists. Remaining for the full L: declarative role/facility targeting that can be re-evaluated (today's targeting is a point-in-time employee pick), campaign scheduling/recurrence, and reminders — all still open |
| E5 | Offline service documentation drafts (IndexedDB) + conflict rules | L | in_progress | Tier 1 (MVP) done: a direct-care employee can document one already-queued floor task while offline and have it sync with block-and-flag conflict handling — new `offlineServiceDraftSafety.ts` (closed-interface draft shape, runtime value validation), `offlineServiceDraftCache.ts` (own encrypted IndexedDB store, separate from `offlineLearning.ts`), `useOfflineServiceDrafts.ts`, `UnsyncedDraftsPanel.tsx` on `Floor.tsx`; server side `sync_offline_service_task_draft` classifies applied/duplicate/conflict/stale/rejected/wipe_required against `record_service_task_response`, `offline_service_draft_receipts` append-only. Proactive wipe wired in `auth.tsx` on sign-out and identity change. Deliberately does not snapshot the full resident record or other residents' data. Full L scope (broader offline surfaces beyond one floor-queue task) remains open. |

### Tier F — Engineering hygiene

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| F1 | Split pages >40 KB before feature work (`CourseDetail`, `ResidentFinancialOperations`, `ResidentAssessmentFormEditor`) | M | done | Decomposed into `course-detail/`, `resident-financial-operations/`, `resident-assessment-form-tabs/` |
| F2 | Finish route-manifest ownership of sidebar/search/modules | M | done | All three lists now governed by `routeRegistrationIssues`: `APP_COMMAND_ACTIONS` (command palette), `productModules.ts`'s `CORE/TRAIN/WORKFORCE/COMPLIANCE/BILLING_PATHS`, and `Sidebar.tsx`'s own `getNavSections` (read as text, like `App.tsx`). Caught a live bug in the process — `/app/survey-day` was in three sidebar sections with a registered route but no `APP_PAGES` entry, so `canViewPath` silently dropped it from the nav for every role |
| F3 | Replace root README marketing handoff with product + agent runbook | S | done | Old content relocated to `docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md` |
| F4 | Banner stale root reviews as historical | S | done | 29 documents bannered; `check:planning-registers` keeps them that way |

---

## Explicitly not now

| Item | Why |
| --- | --- |
| Capability bundles / config release envelope | Enterprise; post-portfolio |
| Vendor external portal | Until maintenance is the top customer pain |
| Full Spanish i18n retrofit | After SMS + mobile proven |
| Multi-state rule packs | Finish Pennsylvania install → activate first, then decide where expansion actually matters |
| Expanding Essentials/Pro SKUs | Need conversion data |
| Competing on pharmacy eMAR network | Multi-year moat elsewhere |
| New root "comprehensive review" markdown | Update **this** file instead; the check rejects it |

---

## Sequence

Single-threaded, because there is one person. This is an order, not a schedule — dates
would be fiction. Do not start the next block until the previous one is actually done.

**1. Live truth.** ~~SG-1~~ closed — A1, A2, A5 remain (ops-only).
A real signup now gets full functionality the moment it signs up — invite staff, complete
a course, export a binder, and *receive real email/SMS* — with no separate pilot-enrollment
step in the way. What is left in this block is ordinary launch operations (live Stripe
pricing, a signed BAA), not a product gate.

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
3. If user-visible: real or demo org exercise recorded
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
