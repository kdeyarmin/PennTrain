# CareMetric CareBase — Living Backlog

**Status:** Canonical forward backlog
**Last verified against main:** `18745bbc` (2026-08-13), reviewed on branch `copilot/navsidebar-advanced-qa-sales-docs`: `artifacts/caremetric-carebase/src/components/layout/Sidebar.tsx` on this branch had been replaced with the literal text `PLACEHOLDER`, so the sidebar module no longer parsed and every nav/test consumer of that file was broken. Restored the file from `main`, then made only the requested display-layer regrouping inside `getNavSections`: for org-admin / facility-manager and auditor, lower-frequency training, credential, resident-documentation, and survey-documentation links now live under `Advanced` while the action-first sections keep the remaining daily-work items. `DEFAULT_COLLAPSED_SECTIONS` stays `new Set(["Advanced", "Admin"])`, access rules / `APP_PAGES` / product-module gating are untouched, trainer + employee + platform-admin navs are unchanged, and the branch docs under `docs/qa/` and `docs/marketing/` were left as-is. Verification for this pass is targeted to the restored sidebar surface: source-based Vitest coverage now asserts the moved links stay in the intended sections and that the placeholder text is gone, alongside TypeScript validation of the rebuilt component. Standing gaps re-read and unchanged: SG-2 and SG-4 remain unrelated product/database decisions. No register rows opened or retired — navigation IA repair only. Stamp corrected on follow-up so the declared SHA is an ancestor of HEAD (Codex P1 on #468).

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
| SG-4 | **`public.record_resident_service_task` is superseded, uncalled from this repository, still granted to `authenticated`, and cannot be closed out without changing behaviour for callers this repository cannot enumerate.** **This row now carries the whole finding.** It was opened on `main` via #452 while G15.13 — the row in the unreachable-capability table that started the question — was still in review, so the same RPC had two rows reaching the same conclusion through different reasoning. They are folded here, because two rows that disagree about *why* are worse than one row that is right, and this one is the one with an owner and a review date. `useRecordResidentServiceTask` (`useResidentServiceTasks.ts`) kept the old name but reaches `record_service_task_response`; the only in-repo references left are the pgTAP suite and generated types, so it reads as dead code. It is not: `20260713160000` grants execute to `authenticated` and nothing has revoked it, so it is a live PostgREST surface. All three ways to close it out change behaviour. **Drop it** or **revoke execute** — the caller's request starts failing (42883 / 42501). Both *used* to also remove the last caller of `app_private.evaluate_service_task_exception` and retire the `service_task_alerts` queue with it; `20260805040000` gave `record_service_task_response` that same call, so that consequence is gone and the drop is a smaller change than this row described. It is still breaking for the caller, which is what keeps the row open. **Delegate to the successor via a shim** — the option that looks safe, and the one this row first refused for a reason that was wrong. **Retracted, and stated here rather than quietly dropped: the claim that `completed_by_other` has no equivalent response in the successor, so a shim would record "somebody else did this" as an ordinary completion and lose the fact.** The translation exists in this repository, is tested, and runs on every successor call already: `lib/serviceDeliveryContract.ts`'s `completionResponseForServiceOutcome` maps `completed` / `completed_late` / `completed_by_other` onto `completed_as_planned`, and `useResidentServiceTasks` preserves the distinction in `exception_details` as `legacy_status` plus a `completed_by_other` boolean. Its own doc comment says it exists to accept both vocabularies at the shared boundary. A SQL shim would do the same and has a proven mapping to copy. One caveat before anyone leans on that preservation: `legacy_status` is written by `useResidentServiceTasks` and read back by nothing — no surface in this repository consumes it — so the fact survives in the stored row and nowhere else, available to whoever goes looking for it and to nobody who does not. **What actually blocks the shim is narrower, and is not about fidelity:** `record_service_task_response` refuses any response the requirement's `acceptable_completion_responses` does not list (22023), and a shim that delegates inherits that gate, so calls the predecessor accepts today would start failing on a rule their caller has never seen. That is inherent to delegating — the only way around it is not to delegate. Two further divergences are real but are **cost rather than blocker**, because a careful shim could re-implement both, and they are the reason a careless one is worse than leaving this alone. One of the two has since been closed: the successor **used to never evaluate exception thresholds**, so alerts stopped for the caller that used to get them — `20260805040000` wired `app_private.evaluate_service_task_exception` into `record_service_task_response`, so a shim no longer costs the caller its alerts. What remains is that the successor **enforces neither** the legacy's ≥3-char note on a non-completed outcome **nor** `requires_two_staff`, so calls that used to be refused start succeeding — the worse direction for a compliance record. Recorded on the objects themselves in `20260805000000_the_legacy_service_task_command_is_not_dead_code.sql`, whose fidelity argument `20260805030000_completed_by_other_is_not_lost_in_translation.sql` corrects in place on the function comment — a note in a planning file does not reach the person running "drop the unused RPCs", and neither does a retraction that only lands in the planning file. Pinned behaviourally in `support_plan_service_tasks.test.sql`: still granted; legacy records `completed_by_other` as its own status; successor raises 22023 on it. The first three still pass — `20260805030000`'s correction was to the reasoning drawn from them, not to the facts. The fourth, that the successor's `not_completed` produces no `service_task_alert`, is the one assertion that stopped being true: `20260805040000` inverted it rather than deleting it, because the fact it pinned is exactly what that migration changes. | Leaving it untouched is the only outcome that changes nothing for an unenumerable caller, and nothing fails while both commands exist — they just write the same table under different rules. The cost is real and is the reason this is a gap and not a decision: two write paths, one of which no in-repo surface exercises, so its validation and its alerting drift out of test coverage by ordinary use. The alerting half of that drift **was** live in-product and is now fixed: since the UI moved to the successor, `service_task_alerts` had no producer any in-repo surface reached while `useListServiceTaskAlerts` still read that queue — closed by `20260805040000`. What remains is the validation half, exercised by no in-repo surface. | Either (a) evidence about callers — PostgREST logs or `pg_stat_statements` over a real window showing nobody outside this repository invokes it, which turns the drop into a fact rather than a guess; or (b) a decision that the plan's `acceptable_completion_responses` gate may apply to legacy callers too, which is what makes a delegating shim honest rather than silently tightening — a product decision about existing requirement rows, not a code change — the alerting path no longer needs deciding, since `20260805040000` gave the successor the same threshold evaluation. **Do not close this row by writing the shim while (b) is undecided.** The reason is no longer that a shim cannot express `completed_by_other` — it can, and the mapping is already written — but that a shim inherits a rule its callers have never been subject to, and the failure mode is a call that used to succeed now failing. | **You** (product/eng) | 2026-10-01 |
| SG-2 | Counsel cleared option 2 and `20260802010000_pa_regulatory_rule_pack_templates.sql` seeded `pa.pch.2600.65.personnel` and `pa.alf.2800.65.personnel`, but no active PA governed version exists yet. Until one of those drafts completes install → review → activate, the copilot remains a drafting aid for Pennsylvania. **2026-08-04: the seeded template content itself (not just the option-2 approach) is now attorney-approved, confirmed via product owner (no separate written record) -- a distinct, narrower confirmation than the option-2 approach clearance `docs/ops/SG2_DECISION.md` already recorded.** **2026-08-04, separately: activation no longer requires a live-shadow period** (`20260804020000_activation_no_longer_waits_on_a_shadow_period.sql`) -- see this file's own stamp above for the full account. | The templates now exist, are installable, and their content is legally cleared, so the product can look "done" before any PA governed version is actually active -- legal clearance is not activation evidence. | Install one PA draft, complete independent review and fixture verification, and activate a PA governed version with evidence. | **You** (product/ops -- legal coordination is now discharged on both the approach and the content) | 2026-09-01 |

---

Closed this pass: **SG-3, the video-watch-gate Storage gap.** `20260802030000_remove_pilot_program.sql`
swept `learning.video_watch_gate` to globally enabled along with the other 3 former pilot flags,
which hard-locked New Employee Orientation's 3 HeyGen video blocks (`20260724040747`) everywhere
except the production project -- the only place their real video files exist. Per the product
owner's explicit choice among the 3 options this row laid out:
`scripts/seed-course-video-placeholders.mjs` uploads a tiny, clearly-labeled placeholder MP4 to
the 3 block paths via the Storage REST API, fixing the missing asset without touching the gate's
logic at all. Refuses to
run (exit 1, before any network call) unless `SUPABASE_URL` is a loopback address, with no
override. Wired into CI's `database` job and into `local-supabase-stack.sh` for local dev;
`changes` job's `DB_PATTERNS` extended so the script itself is path-filter-covered. **Verified,
not just implemented:** PR #447's own CI run confirms the new "Seed course-video placeholders"
step completed successfully, and the Playwright e2e suite that runs immediately after it in the
same job also passed -- so the fix is live and nothing downstream regressed.

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
4. `clinical_data_consent` on disclosure paths — **Closed (counsel cleared 2026-08).** Charting stays ungated. Outbound disclosure now requires `granted`: FHIR write-back enqueue + drain, organization export of clinical/FHIR resident-keyed rows, and designated-person portal document share/download (plus prep-instruction redaction). Shared helpers in `20260806090000_clinical_disclosure_requires_consent.sql`; managers set posture via `set_resident_clinical_data_consent` on the clinical chart.
5. Both offline draft safety gates (`assertServiceDraftAllowed`, `assertObservationDraftAllowed`) validate every field except `createdAt` and `syncState` — an unparseable `createdAt` makes a draft immune to both purge clocks and to the overdue warning, and an unrecognized `syncState` makes it invisible to the panel as well. The write paths always set both correctly, so this only bites as the tamper/corruption gate the modules claim to be. Symmetric across both lanes; fix them together or they drift. **Closed.** `offlineDraftFieldGuards.ts` holds the rule and each lane passes its own state set -- the service lane knows `conflict`/`stale`, the observation lane deliberately does not, and a test pins that disagreement so a later tidy-up cannot quietly unify them. Both state lists are typed `Record<Union, true>` rather than written as arrays, so adding a state and forgetting the list fails at compile time instead of the gate refusing a legitimate draft at runtime on a device. Worth recording why it was not merely cosmetic: the `NaN` from an unparseable `createdAt` makes every clock comparison false, so the draft is never overdue, never expired and never purged, while an unrecognized `syncState` keeps it out of both panel lists -- together, care documentation held on a device permanently and invisibly.
6. **A mid-session identity change wipes the offline draft store but not the react-query cache.** `auth.tsx` handles an admin changing someone's role, organization, or facility mid-shift as a first-class case — that effect calls `wipeOfflineServiceDrafts()` — but it never calls `queryClient.clear()`, which only `signOut` and `SIGNED_IN` do. So any cached query whose key does not itself carry the identity keeps serving the previous context's rows until its own `staleTime` lapses. Surfaced by Copilot against the two caregiver hooks and fixed there by putting `(profileId, organizationId, role)` in the key, which is the convention several org-scoped hooks already follow — but the two hooks were the symptom, not the cause. Worst case is a signed storage URL, which is bearer-authorized for its full TTL and keeps resolving no matter what RLS would now say. The general fix is one `queryClient.clear()` in that effect; it was left out of PR #436 because it changes cache behaviour for every query in the app and wants its own change. **Closed.** `auth.tsx`'s identity-change effect now calls `queryClient.clear()` when the signed-in identity actually changes under a surviving session, which was the one transition in that file without a clear -- SIGNED_IN, a definitively-missing profile, a deactivated profile, the AuthProfileError sign-out and `useSignOut` all already had one. The gate is a separate predicate (`sessionIdentity.ts`) rather than the offline-store one sitting next to it, and that distinction is the whole trap: `shouldWipeOfflineServiceDraftData` returns true for any non-employee role by design, so reusing it would clear every manager's entire cache on every identity evaluation. Deactivation is deliberately not part of the new predicate -- its own effect already signs out and clears, and testing activity here would re-fire on every later evaluation of a still-inactive identity rather than once on the transition. What no client-side fix reaches: a signed storage URL already handed to the browser stays bearer-authorized for its full TTL, so short TTLs remain the real mitigation for that half. **Correction (Codex, PR #443): calling this closed was wrong.** The row itself names "role, organization, or facility", and the fix covers the first two. A facility transfer changes the authoritative scope on `employees.facility_id` while profile id, organization id and role all stay put, so `signedInIdentityChanged` returns false and the clear never runs -- leaving the old facility's resident rosters, photos and charts served from cache until their own staleTimes lapse. It is not a one-line predicate change: `AuthUser` carries no facility at all (id, name, email, role, organizationId, isActive), and facility lives on `employees`, not `profiles` -- so the auth profile query has to fetch it before any predicate can see it, and the effect's dependency list has to include it before the effect would even re-run. That is a change to core auth data-fetching and wants its own diff rather than being appended to a five-part PR. **Facility now covered too.** `AuthUser` gains `facilityId` from its own query rather than a PostgREST embed on the profile select -- an embed fails the WHOLE request, which would put every sign-in behind the `employees` RLS policy resolving for every role; separate, it degrades to "facility unknown" instead of "cannot sign in". The comparison is three-valued and that is the load-bearing part: `undefined` (unresolved) appears twice in every ordinary session -- once before the facility query settles and once immediately after each `queryClient.clear()` wipes it -- so an unresolved value on either side must read as not-a-change or the app would clear on every sign-in and then clear again on its own refetch, never converging. `null` is a resolved value, not an absent one: someone with no `employees` row genuinely has no facility, and gaining one is a real scope change. `facilityId` is in the effect's dependency list as well as the predicate, or a transfer would never re-run the effect that asks. **Hardened further (PR #449):** the clear was never the whole client-side story. `useResidentPhotoUrls` (`useResidentPhotos.ts`) already keys its signed-URL query on `(profileId, organizationId, role)`, not just the resident, which closes a narrower race the clear alone does not: a sign already in flight at the moment identity changes can resolve *after* `queryClient.clear()` runs, writing into a key the new identity still reads. Two sibling hooks signing the same resident photos -- `useResidentPhotoUrl` in `useResidentAdministrativeMaster.ts` and the same-named local hook in `ResidentCareHeader.tsx` -- were keyed on the document id alone and missed that. Both now match. The irreducible half is unchanged: a signed URL already handed to the browser stays bearer-authorized for its own TTL no matter what any of this does, so short TTLs remain the only mitigation for that part, as recorded above.
7. **Offline sync still has no persistent trigger.** Raised by Codex on PR #436 as two halves; only the first is still open. (a) `UnsyncedDraftsPanel` now syncs on mount as well as on the `online` event, which covers a caregiver walking back to Floor or the roster after signal returns — but the panel is still mounted only on those two routes, so nobody watches connectivity while the caregiver sits on `/me/residents/:id`, which is exactly where a reading is taken. The offline toast's promise that it "syncs once you're back online" is therefore true only after a navigation. The fix is a headless syncer in the employee shell rather than a component on two pages. (b) *Closed* — `ChangeOfConditionQueue` now honours `?report=1&resident=<id>` by opening the creation dialog with that resident preselected, and consumes the flag so closing or reloading does not reopen it. **Sharpened by Codex on PR #440:** the `online` event is not merely a *late* signal for this, it is frequently no signal at all. The failures the offline fallback exists for -- a LAN link with no route out, a bad DNS resolver, a captive portal, Supabase itself down -- all leave `navigator.onLine` reading `true` throughout both the failure *and* the recovery, so the transition never fires and the mount-sync only helps if the user happens to navigate. Tier 3 mounting the panel on `ChangeOfConditionDetail` narrows the gap (that page is now a third place a mount-sync can fire) but does not close it: an aide who stays on one event through the outage and its recovery still sees no retry, and the toast promising it will sync once back online is unbacked for exactly the case that produced the draft. The headless syncer is the fix, and it should poll reachability rather than trust the browser flag. **Closed.** `OfflineSyncManager` is mounted once in `MainLayout`, so the loop runs for the whole signed-in session rather than on the three pages that happen to carry the panel -- none of which is `/me/residents/:id`, where a reading is actually taken. It retries on a backoff (30s/60s/2m/5m) while a backlog exists and stops when it drains, keeps the `online` listener as the earliest signal when it does fire, and uses no reachability probe: the sync itself is the honest test of whether the server is reachable, and a network-level failure is already a keep-and-retry rather than a loss. The critical-reading warning moved to the shell with it, which was required rather than tidying -- a background sync that can now run on any page could otherwise chart a critical vital sign and display nothing. The two-lane run (sequential, stop-on-wipe) is shared by the panel's manual button and the loop via `useOfflineSyncRunner`, serialised by a module-level latch: two components cannot be ordered by a ref, and overlapping runs would reintroduce from the outside exactly the device-re-registration race the lane ordering closes from the inside.
8. **There are now two offline receipt ledgers, and `20260803090000` argued explicitly for one.** That migration widened `offline_service_draft_receipts` with a `draft_kind` discriminator rather than copying it, on the grounds that `unique (device_id, idempotency_key)` "has to hold across BOTH kinds" and that two tables mean "two places to look when auditing what a device sent." `20260803110000` then added `offline_observation_draft_receipts` as a separate table anyway. The two are otherwise identical in posture — same `modules.carebase` gating, same `profile_id = auth.uid()` select policy, same `offline_device_registrations` parent, same append-only + TRUNCATE guards — so none of the usual reasons to split apply. What does not resolve cleanly is the name: the deployed table is `offline_service_draft_receipts`, and a third kind would put clinical, PHI-linked rows behind a service-lane name. The uniqueness half of the concern is inert today (both lanes mint keys with `crypto.randomUUID()`); the audit half is real. Three ways out — leave it split, widen the service ledger and accept the name, or rename it lane-neutral (`offline_draft_receipts`) and widen. **Decided 2026-08-03: rename lane-neutral, then widen.** One caveat found while scoping it, which makes it larger than it looks: plpgsql resolves table names at runtime, so renaming the relation breaks `sync_offline_service_task_draft` and `sync_offline_unscheduled_service_draft` on their next call, and both deployed functions have to be reproduced with the identifier substituted (~260 lines of another lane's shipped code) in the same migration that does the rename. Indexes, the select policy, both triggers and the guard function repoint by OID via `alter ... rename`, but `product_module_resources.resource_name` and `audit_entity_manifest.table_name` key on the name and must be rewritten or the table silently drops out of entitlement enforcement and the audit coverage report. Worth doing as its own change rather than inside a caregiver-charting PR. **Update (E5 Tier 3, `20260803130000`):** the next lane arrived and went onto the service ledger as a third `draft_kind`, `change_observation`. That is not a re-decision of this question, and it is worth recording why it could not have gone the other way: `offline_observation_draft_receipts` constrains `outcome` to `applied`/`duplicate`/`rejected`/`wipe_required` and argues in its own header that `conflict` and `stale` are values its flow can never produce. A change-of-condition monitoring observation *can* go stale -- the event closes while the device is offline -- so filing it there would have meant widening that table's vocabulary to re-admit exactly the two values it excluded on purpose. The state is therefore three kinds on the service ledger plus one separate observation ledger, and the naming half of the concern is sharper than before: `change_observation` rows point at a `resident_change_events` row, which is clinical-adjacent, behind a service-lane name. Tier 3 keeps the observation *text* off the receipt entirely, so no clinical narrative lands there -- but the linkage does. The third option still resolves it. **Half closed (`20260803140000`): the name is fixed, the split is not.** `offline_service_draft_receipts` is now `offline_draft_receipts`, so the three kinds it already holds -- including the clinical-adjacent `change_observation` -- no longer sit behind a service-lane name. Done as `alter table ... rename` rather than a copy: the rows are append-only evidence of what devices sent, and recreating them elsewhere would rewrite that evidence's identity for no reason. The two things a rename does not carry were the whole risk and are both asserted in-migration: `product_module_resources.resource_name` and `audit_entity_manifest.table_name` key on the name, so leaving them would have dropped the table out of `modules.carebase` enforcement and the audit coverage report *without erroring*; and the three sync RPCs embed the name in their bodies, so every offline sync would have started raising "relation does not exist" on deploy (recreated from their live definitions, every other line asserted byte-identical). The append-only guard was renamed with it, on the same principle `20260802060000` used when it refused to reuse `prevent_phase4_evidence_mutation` -- a guard whose message misdescribes what failed is a trap for whoever reads the error log. **Still open: absorbing `offline_observation_draft_receipts`.** That is a data migration between two append-only PHI tables plus a fourth sync function to retarget -- a different kind of change from a rename, deserving its own reviewable diff. It is now a plain widening rather than a widening plus a rename, which is why this half went first. **Closed (`20260803150000`).** The fourth kind now lives on the one ledger: `offline_draft_receipts` gained `observation_type` and `observation_id`, both CHECKs widened to admit `clinical_observation`, the rows moved, and `sync_offline_clinical_observation_draft` was recreated from its live definition pointing at the survivor. The uniqueness promise the observation table's own header called "the only thing preventing a reconnect from double-charting a vital sign" now holds across every key a device can mint, rather than within one lane -- it was true before only because both lanes happen to use `crypto.randomUUID()`, which is luck, not a constraint. **One thing was genuinely given up and is recorded rather than glossed:** the absorbed table constrained `outcome` to four values and argued that `conflict` and `stale` are states its flow can never reach. That was correct and useful, and the shared ledger permits all six, so the column no longer says it. Re-encoding it as a per-kind CHECK arm would restate a rule the sync function already guarantees by never writing those values; the shape CHECK still pins what each kind must *carry*, which is the half that catches a malformed row. The row move is an `insert ... select` with an explicit count assertion and a pre-flight cross-lane key collision check, because these rows are append-only evidence and, unlike the rename, this cannot be undone by renaming back -- both guards were mutation-tested (a deliberately lossy copy raises; a planted duplicate key raises before the insert rather than surfacing as a bare 23505). The two registries that key on the table NAME came out with delete-count assertions for the same reason the rename asserted its updates: a leftover row would keep describing a dropped table to entitlement enforcement and to `get_audit_coverage`, and neither would error. The absorbed lane also had no pgTAP coverage at all, which is how a second ledger went unnoticed in the first place; it now has twelve assertions in the same file as the other three tiers -- including a cross-kind replay proving a key spent by a change observation is spent for vitals too, and that the replay charts nothing.
9. **The dependency gate no longer fails a branch for the world's schedule.** *(Closed — recorded because it changed a security gate's semantics.)* `check-dependencies.mjs` audits the LIVE npm advisory database, so a newly-published advisory turned every open branch red the day it landed, main included, with no commit behind it — three times in one week (GHSA-mh99-v99m-4gvg, then GHSA-rgw5-rvv9-x895, then GHSA-7p8r-x3mc-p8w7), each time blocking branches that had not touched a dependency. The failure mode that matters is not the delay, it is that people learn to read a red gate as noise. Neither obvious fix is acceptable: stop auditing live, or pin a stale snapshot — both trade away what the gate is for. Instead the gate now answers a question it could not before: did THIS change introduce the vulnerable package? `--base <ref>` runs the same audit twice, for HEAD's dependency set and the base ref's, and an advisory firing against both is pre-existing — reported loudly, not failed. Comparison is by advisory id across two registry audits rather than by matching `vulnerable_versions` locally, because reimplementing semver range logic inside a security gate is where a subtle bug would be invisible. **Fails closed:** no `--base`, or an unreadable one, degrades to the original strict behaviour with a printed reason; pushes to main pass no base and are always strict. The pre-existing half lands in `dependency-advisories.yml`, a daily strict audit of main that opens an issue — so a vulnerability main ships still gets surfaced without waiting for someone to push. `--self-test` covers the classifier, including that a null base fails everything.

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
| A5 | BAAs / HIPAA-eligible tiers confirmed for the live customer path | S | ops_only | Legal/attorney-approved 2026-08-04, confirmed via product owner (no separate written record) -- the clinical-path BAA/HIPAA-eligible-tier language itself is cleared. Remains `ops_only` until BAA execution with the actual vendor(s) and tier confirmation in the live billing config are done outside the repo; legal sign-off on the language is not that execution. |

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
| C4 | POC due-date escalation into manager digest / SMS | S | done | **Digest half** (`20260802080000`): the manager weekly digest counts plans of correction due within 7 days or already overdue, on violations not yet `corrected`/`verified`, facility-scoped and cut on the PA day. **SMS half** (`20260803000000`): daily `escalate-plans-of-correction` sweep, registered in the job control plane as critical. Two types — `plan_of_correction_due_soon` warns three days out through the preferred channel; `plan_of_correction_overdue` joins the critical set, which is the email+SMS path. So SMS only follows a warning that already went out, and only for a missed deadline. `poc_due_soon_notified_at`/`poc_overdue_notified_at` on `dhs_violations` give the daily job a memory (warn once; re-escalate weekly while outstanding), and a BEFORE UPDATE trigger clears both when `poc_due_date` moves so an extended deadline is warned about again. Templates carry no violation free text |
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
| E4 | Policy campaign center (version pin, targets, knowledge check) | L | done | MedTrainer deal-breaker. **Two of the three parts already shipped in `20260705151703_policy_attestation_core` and were reachable from `PolicyDocumentDetail.tsx`** — version pin (`policy_attestation_campaigns.policy_document_version_id` is NOT NULL, published versions frozen by `lock_published_policy_version`, every attestation stores the signed `content_hash`) and targets (campaigns fan out to explicitly picked employees at assign time, the training-plan pattern the core migration chose deliberately). **Knowledge check was the genuine gap and is now done**: `policy_campaign_questions` + `policy_knowledge_check_attempts`, server-side grading via `submit_policy_knowledge_check`, questions read through `get_policy_knowledge_check` (answer key absent from its signature, not merely filtered), `attest-policy` refuses to record an attestation for a campaign with questions until a passing attempt exists. **Reminders were listed as open and were not** — `send_policy_attestation_reminders()` shipped in `20260705152437` and has been scheduled daily since `20260711162509`. It had no test coverage, and `20260803010000` fixes three targeting defects it had accumulated: it stamped `reminder_sent_at` on attestations it had not notified (the UPDATE's predicate was broader than the INSERT's), it reminded terminated employees indefinitely, and it created notification rows for deactivated profiles. **Declarative targeting done** (`20260803050000`, `20260803060000`): a campaign can now be a rule rather than a point-in-time pick. `targeting_mode` plus the predicates `compliance_profile_mapping_rules` already matches employees on -- facility, facility type, worker type, job-title ILIKE -- deliberately reusing that vocabulary rather than inventing a second one. `materialize_policy_campaign_targets` enrols every active matching employee not already on the campaign (idempotent via `policy_attestations_campaign_employee_uk`), the `materialize-policy-campaign-targets` daily job keeps membership true as the roster moves, and the creation RPC sets the target and enrols the initial roster in one transaction so an author does not see an empty campaign until the next sweep. A `CHECK` forbids a declarative campaign with no predicates -- "no predicates" reads downstream as "no constraint on any dimension", which would enrol the whole organization. Enrolment is never revoked: an attestation on file is evidence, and leaving the rule is not the same decision as deleting it. **Recurrence done** (`20260803070000`, `20260803080000`), closing the row: `recurrence_months` on the series parent, `spawn-policy-campaign-cycles` opening each cycle 30 days before it is due, pinned to the document's *current* published version and carrying the targeting rule and knowledge-check questions forward as its own copies. Each cycle is a new campaign rather than a reset, because an attestation is evidence -- clearing last year's signatures to start this year would destroy the record the feature exists to produce. A `CHECK` stops a spawned cycle from recurring itself, which would double the series every period |
| E6 | A promoted staff member cannot sign a policy they are assigned | S | done | **Found and closed 2026-08-03 while fixing the E4 reminder sweep.** `/app/my-attestations` (`App.tsx`, `ROSTERED_STAFF_ROLES` = org_admin/facility_manager/trainer) renders the same `MyAttestations` page for rostered non-employee roles — the page already resolved off `useGetEmployeeByProfileId(user.id)` with no role assumption, so it is correct there unchanged and shows "no employee record" for a manager who has none. `20260803020000` makes both attestation notifications resolve their link from the recipient's own profile role instead of hard-coding `/me/attestations`. Deliberately **not** in `Sidebar.tsx`: most managers hold no `employees` row and a permanent nav item would be a reliably empty page for them; the route is registered in `APP_PAGES` so the manifest governs it and search finds it, and the people who need it arrive from their notification. The original defect: a profile keeps its `employees` link when its role changes — `admin_update_profile` severs `employees.profile_id` only when the *organization* changes (`e.organization_id is distinct from v_row.organization_id`), not the role — and `apply_scim_change` links an IdP-mapped role to an employee row with no role constraint. So the ordinary "the aide is now the shift supervisor" promotion leaves a `facility_manager` (or `trainer`) holding an employee record. Assign that person a policy attestation and they **cannot satisfy it through any UI**: the only self-service surface is `/me/attestations`, which `ProtectedRoute` restricts to `allowedRoles={["employee"]}` and silently redirects them to `/app`. The attestation stays `pending` forever, the campaign reports them outstanding forever, and `send_policy_attestation_reminders` re-notifies them every three days — `20260803010000` makes that *more* visible, since their employee row is active and their profile is active. `/me/*` stays employee-only by design — the fix adds the `/app`-side surface rather than admitting other roles into the employee portal, so `EMPLOYEE_ONLY` in `appDomains.ts`, `helpCopilot.ts` and `navigationPreferences.ts` are untouched |
| E5 | Offline service documentation drafts (IndexedDB) + conflict rules | L | done | Tier 1 (MVP) done: a direct-care employee can document one already-queued floor task while offline and have it sync with block-and-flag conflict handling — new `offlineServiceDraftSafety.ts` (closed-interface draft shape, runtime value validation), `offlineServiceDraftCache.ts` (own encrypted IndexedDB store, separate from `offlineLearning.ts`), `useOfflineServiceDrafts.ts`, `UnsyncedDraftsPanel.tsx` on `Floor.tsx`; server side `sync_offline_service_task_draft` classifies applied/duplicate/conflict/stale/rejected/wipe_required against `record_service_task_response`, `offline_service_draft_receipts` append-only. Proactive wipe wired in `auth.tsx` on sign-out and identity change. Deliberately does not snapshot the full resident record or other residents' data. **Tier 2 server side done** (`20260803090000`): unscheduled services -- the care nobody else knows happened -- now have an offline path. Tier 1 could only document an already-queued task, so an aide in a back hallway could record a scheduled reposition but not the unplanned one they did five minutes earlier. `sync_offline_unscheduled_service_draft` mirrors Tier 1's semantics exactly (device ownership as a hard failure, idempotency replay returning the *original* outcome, clock-plausibility judgment) and **delegates authorization to `record_unscheduled_service`** rather than restating its caller-scope rule. `offline_service_draft_receipts` gained a `draft_kind` discriminator rather than being copied, so `unique (device_id, idempotency_key)` keeps holding across both kinds -- two tables would have meant two independent uniqueness domains and a quietly weaker promise. **Tier 2 complete.** `OfflineFloorDraft` is now a discriminated union, the IndexedDB store carries both kinds, `syncDraft` routes to the right RPC, and `useSaveOfflineUnscheduledDraft` creates one — and `UnscheduledServiceDialog` on `Floor.tsx` falls back to the offline draft path — proactively when `navigator.onLine` is false, and in its catch when the call fails at the network level, which is the case `navigator.onLine` misses (LAN link, no route to Supabase). A genuine rejection still surfaces rather than disappearing into a silent draft. The migration hazard was real and is covered: `taskId` is bound into the envelopes **AES-GCM AAD**, not merely stored, so records already on devices are sealed against a scope built from it. `scopeId` is written for both kinds and equals `taskId` for a service draft, keeping new scope strings byte-identical, and readers fall back to `taskId` when `scopeId` is absent. A test removes that fallback and fails, and only that test. The store-level constraints this had to satisfy, for the record: `OfflineServiceDraft` becomes a discriminated union (its `taskId` is required today and an unscheduled draft has none); `StoredDraftRecord` needs `taskId` optional plus a `kind` discriminator, and **reads must treat a missing `kind` as `service_task`** because records already sitting on aides' devices predate it; **No IndexedDB version bump was required** — `DRAFT_STORE` is created with `keyPath: "draftId"` and no secondary index, so `taskId` is a plain payload column and making it optional changes no index. **Tier 3 done, closing the row** (`20260803100000`): a change-of-condition event carries a monitoring cadence ("check every two hours for 24 hours"), and walking it is what produces the evidence the resident was actually watched -- in resident rooms and back hallways, where the wifi is worst. `sync_offline_change_observation_draft` delegates to `add_change_event_monitoring` exactly as Tier 2 delegates to `record_unscheduled_service`, and `offline_service_draft_receipts` gained a third `draft_kind` rather than a third table, so `unique (device_id, idempotency_key)` still holds across every kind a device can generate -- now asserted behaviourally, by replaying a Tier 2 key through the Tier 3 RPC and getting Tier 2's outcome back. Two rules are specific to this tier. **A closed event is `stale`, not `rejected`**: `add_change_event_monitoring` raises the same `22023` for a closed event and for unusable text, and the offline path re-reads the event status to tell them apart, because an observation that can no longer be filed is real and needs a supervisor, not a retry. **An implausible device clock is clamped to `now()`, not nulled** as in Tiers 1-2, because `resident_change_monitoring_entries.observed_at` is NOT NULL -- nulling it would fail the insert and cost the aide a real bedside observation over a clock problem they cannot see; the raw client value stays on the receipt so a bad clock is still visible in the ledger. **The observation text is deliberately never written to the receipt**, which is append-only: a `rejected` or `stale` observation never enters the resident's record at all, and copying its clinical text into a table that can never be corrected or removed would create a permanent second copy of exactly what the record deliberately does not have. `UnsyncedDraftsPanel` is now mounted on `ChangeOfConditionDetail` as well as `Floor` -- it is a device-level outbox, and a draft whose only surface an aide never opens would sit invisible until the purge ceiling silently deleted it. `create_resident_change_event` is **deliberately excluded**: it opens a regulatory workflow (compliance item, incident, follow-ups, reassessment) and has no idempotency rule, so two offline aides finding the same resident on the floor would produce two events, two compliance items and two incidents for one fall -- worse than the aide getting a plain "you are offline" and telling a supervisor in person, which is what identifying a change of condition requires anyway. Also aligned Tier 2's revoked-device check with Tiers 1 and 3: it tested only `revoked_at`, which no reachable state distinguishes today, but a boundary a later change can defeat by moving one column and not another is held together by coincidence. |

### Tier F — Engineering hygiene

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| F1 | Split pages >40 KB before feature work (`CourseDetail`, `ResidentFinancialOperations`, `ResidentAssessmentFormEditor`) | M | done | Decomposed into `course-detail/`, `resident-financial-operations/`, `resident-assessment-form-tabs/` |
| F2 | Finish route-manifest ownership of sidebar/search/modules | M | done | All three lists now governed by `routeRegistrationIssues`: `APP_COMMAND_ACTIONS` (command palette), `productModules.ts`'s `CORE/TRAIN/WORKFORCE/COMPLIANCE/BILLING_PATHS`, and `Sidebar.tsx`'s own `getNavSections` (read as text, like `App.tsx`). Caught a live bug in the process — `/app/survey-day` was in three sidebar sections with a registered route but no `APP_PAGES` entry, so `canViewPath` silently dropped it from the nav for every role |
| F3 | Replace root README marketing handoff with product + agent runbook | S | done | Old content relocated to `docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md` |
| F4 | Banner stale root reviews as historical | S | done | 29 documents bannered; `check:planning-registers` keeps them that way |
| F5 | Reduce total JavaScript shipped to the browser | M | done | **Resolved by measuring rather than optimizing — the premise was wrong.** This row was opened on "4.2 MiB of JavaScript pushed to a tablet on facility wifi". That number is the sum of **every** chunk, including ~150 lazy route chunks a given user never fetches, so it never described anyone's download. What a first load actually costs: `index.html` preloads exactly five chunks — `index` 533, `supabase` 207, `radix` 133, `query` 35, `router` 12 KiB = **922 KiB raw**, and `server/index.mjs` negotiates `br` over `gzip` against the `.br` siblings `server/precompress.mjs` emits, so **220 KiB brotli actually crosses the wire**. For an application of this size that is unremarkable, and the largest single piece (`index`, 127 KiB brotli) is the app shell rather than anything liftable. No optimization is warranted. The aggregate budget stays useful as what it was always documented to be — a regression tripwire that catches a route module leaking into the shell — not a user-facing weight. Re-open only if the *entry path* grows, which is the thing worth watching |
| F6 | Confirm two pending regulatory grace periods; close the citation-library CI-coverage follow-up | S | done | 2600.141 (PCH medical evaluation) and 2800.225 (ALR annual reassessment) annual-cycle grace periods confirmed at 15 days via PA DHS's own Regulatory Compliance Guides (`20260804000000`); `paRegulatoryCitations.ts`'s two `pending_confirmation` entries are now `verified`. `check-dhs-sources.mjs` extended to live-check the citation library's `pacodeandbulletin.gov` links plus its own staleness date, closing that file's own FOLLOW-UP comment. **2600.141's confirmed figure is not yet applied to `grace_period_days`** -- see F9 -- so this row closes the research/citation-library scope only, not the operational schedule for PCH medical evaluations |
| F7 | De-duplicate hand-synced TOTP derivation in e2e tests | S | done | `e2e/helpers/totp.ts` extracted |
| F8 | Notify platform admins when a demo request arrives | S | done | `notify_platform_admins_of_demo_request` |
| F9 | Split `medical_evaluation` into separate initial/annual item_types so 2600.141's confirmed grace can be applied | M | done | `20260804170000` |
| F10 | Reconcile `paRegulatoryCitations.ts`'s informal `verified` status with `dhs_citation_topics.verification_status`'s governed one | S | done | Library stops claiming governed status |

### Tier G — Shipped schema nothing calls

(See full history in prior stamps; G1–G268 closed across review passes.)

## Explicitly not now

| Item | Why |
| --- | --- |
| Capability bundles / config release envelope | Enterprise; post-portfolio |
| Vendor external portal | Until maintenance is the top customer pain |
| Full Spanish i18n retrofit | After SMS + mobile proven |
| Multi-state rule packs | Finish Pennsylvania install → activate first |
| Expanding Essentials/Pro SKUs | Need conversion data |
| Competing on pharmacy eMAR network | Multi-year moat elsewhere |
| New root "comprehensive review" markdown | Update **this** file instead; the check rejects it |

---

## Sequence

Single-threaded, because there is one person. This is an order, not a schedule — dates
would be fiction. Do not start the next block until the previous one is actually done.

**1. Live truth.** ~~SG-1~~ closed — A1, A2, A5 remain (ops-only).

**2. Wire up what is already built.** ~~B1~~, B3, ~~B5~~, ~~D3~~, ~~D5~~.

**3. Finish SG-2 install → activate.**

**4. Product depth.** ~~B4~~ done, ~~E1~~ done, ~~C5~~ done.

**Deliberately not in this list:** A5 (BAAs), because it depends on someone outside the
repo.

---

## Verification contract for any row marked `done`

1. Code on `main` (or a merged PR linked in the row notes)
2. Relevant unit / edge / e2e tests pass in CI
3. If user-visible: real or demo org exercise recorded
4. This file updated in the same change set — enforced by `check:planning-registers`

A row is `in_progress`, not `done`, when the mechanism exists but nothing calls it.

Ops-only rows close when runbook evidence exists outside the repo (do not commit customer
data). "Ops-only" means a different hat, not a different person — see "Operating reality"
above.

**On self-review.** Every gate in this list is one person checking their own work, so the
checks that do not depend on a second reader are the ones carrying real weight: CI, the
pgTAP suite, `check:all`, and this register's own freshness check. Treat a mechanical gate
that a second account merely unlocked (`approve_regulatory_rule_version`) as unverified,
and say so in the row rather than counting it as review.

<!-- Register verified: SG-2 counsel-cleared option 2; templates seeded; activation remains; C5 citation_ref done; B1 done; B3 owner drop-path documented; F6/F7/F8 done; SG-3 opened (video_watch_gate global-enable vs. non-prod Storage gap) -->
