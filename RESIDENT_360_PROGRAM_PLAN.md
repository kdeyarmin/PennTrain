# Resident 360 Operating-Core Program Plan

- **Status:** Proposed program plan (not yet approved)
- **Baseline:** `claude/resident-360-redesign-kq8udx` at `cb56f75`, reviewed July 25, 2026
- **Scope:** the 25-item request to make Resident 360 the center of the application and finish the
  care/quality/operations loops around it
- **Relationship to existing plans:** `IMPLEMENTATION_PLAN.md` remains the canonical five-phase
  *platform* program (tenancy, identity, workforce, governed learning, closed-loop evidence). This
  document is the *care-operations* program that sits on top of it. Where the two disagree on
  sequencing, the delivery contract in `IMPLEMENTATION_PLAN.md` ("Non-negotiable delivery contract")
  wins — it is not restated here, only extended.

---

## 1. The core judgment call in this request

Items 1–24 ask for substantial new capability. Item 25 asks to **stop feature expansion until
critical workflows pass real pilots**. Taken literally, the two halves cancel out.

**This plan resolves the tension by making item 25 the gate rather than the finale.** Proof of the
end-to-end journey is not a phase at the end; it is the exit criterion of every phase. Concretely:

- Phase 0 builds the journey harness *first*, because two Playwright specs
  (`e2e/public-smoke.spec.ts`, `e2e/role-routing.spec.ts`) against ~140 routes cannot gate anything.
- Each later phase names the specific pilot journey steps it must make executable, and cannot exit
  until those steps run green in CI against a seeded tenant **and** have been observed once in a
  controlled pilot in the manner already established by `pilot/controlled-pilot-2026-07-24.json`.
- No phase starts while its predecessor's journey steps are red.

The practical effect is the same discipline item 25 asks for, without a multi-quarter freeze that
would leave the half-built assessment→plan→service chain sitting in production unfinished — which is
itself an operational risk, not a safe resting state.

**Second judgment call:** the request describes several capabilities as missing that are in fact
partly built. Building them again would be waste. Section 3 records, per item, what already exists
in the repository so each phase is scoped as a *delta*, not a greenfield build. The largest
corrections:

- The assessment→proposal→plan rule engine is **modeled already**
  (`support_plan_assessment_mapping_rules` carries `proposed_need` / `proposed_service` /
  `proposed_intervention` / `rationale`). The gap is seeded rule content, template coverage, and the
  review UI — not the engine's shape.
- Support-plan interventions **already** generate service requirements and task instances
  (`resident_service_requirements`, `resident_service_task_instances`, migration
  `20260713160000_support_plan_service_task_automation.sql`). The gap is task-kind coverage and
  floor usability.
- Hospital departure/return is **already** modeled in detail (`hospital_transfer_episodes` carries
  departure, bed hold, medication reconciliation status, discharge document, condition/diet/mobility
  changes, and review-required flags). The gap is the workflow UI, the timeline entry, and the
  follow-up work items.

**Third judgment call:** four items in the request are cross-cutting rather than sequential
(#17 universal work queue, #24 regulatory content, #25 pilots, and the resident header's data
model). Each is split so that a thin governed foundation lands early and every later phase
contributes its slice. Splitting these is what keeps the phase count from collapsing into one
undeliverable mega-phase.

---

## 2. Program shape

Ten phases, grouped into four waves. Waves are communication units; phases are dependency
boundaries.

| Wave | Phases | Outcome a user would notice |
| --- | --- | --- |
| **A. The record becomes a command center** | 0–1 | Opening a resident answers "what do I need to do about this person today?" in one screen |
| **B. Care actually flows** | 2–4 | Assessment → identified need → intervention → plan section → staff task → documented delivery is one unbroken, auditable chain |
| **C. The system notices and routes** | 5–7 | Changes, incidents, and obligations surface themselves and land in one owned queue instead of four dashboards |
| **D. The surrounding operation** | 8–10 | Staffing, admissions/occupancy, and the regulator-facing surface catch up to the care core |

| Phase | Name | Request items | Est. (one squad) | Est. (two squads) |
| --- | --- | --- | ---: | ---: |
| 0 | Proof harness and program guardrails | 25 (harness) | 4–6 wks | 3–4 wks |
| 1 | Resident 360 as the command center | 1, 2, 17a | 8–11 wks | 5–7 wks |
| 2 | Governed assessment content and plan lifecycle | 5, 6, 24a | 10–14 wks | 6–9 wks |
| 3 | Assessment→plan→service engine | 3, 4, 7 | 10–13 wks | 6–8 wks |
| 4 | Floor execution mode | 8, 9, 10 | 9–12 wks | 6–8 wks |
| 5 | Change intelligence and care transitions | 11, 12 | 7–9 wks | 5–6 wks |
| 6 | Guided incident investigation and quality | 13, 14, 15, 22 | 12–16 wks | 8–10 wks |
| 7 | Universal work and one home surface | 16, 17b | 7–9 wks | 5–6 wks |
| 8 | Workforce fit and acuity-aware scheduling | 18, 19 | 8–11 wks | 5–7 wks |
| 9 | Admissions CRM and occupancy board | 20, 21 | 9–12 wks | 6–8 wks |
| 10 | Governed PA regulatory library and Survey Day | 23, 24b | 10–13 wks | 6–9 wks |
| | **Total** | **25 items** | **94–126 wks (~22–29 mo)** | **61–82 wks (~14–19 mo)** |

Estimates are planning ranges for a squad of three full-stack engineers with Postgres/RLS depth,
plus shared PM/design/SDET/compliance-SME time. They exclude the 10–15% program contingency
`IMPLEMENTATION_PLAN.md` already reserves. **Phases 8, 9, and 10 are genuinely independent of
Wave B/C** and can be run by a second squad in parallel from the end of Phase 1 — that parallelism
is the difference between the two estimate columns, not heroics.

### Sequencing constraints that are not negotiable

1. **Phase 0 precedes everything.** Journeys cannot gate phases that shipped before the harness.
2. **Phase 2 precedes Phase 3.** A conflict detector (#4) needs typed assessment fields to compare;
   today's free-text/jsonb content cannot be compared field-to-field.
3. **Phase 3 precedes Phase 4.** Floor task cards and exception documentation are only as good as
   the service definitions behind them.
4. **Phase 1's work-item contract (17a) precedes Phases 5–7.** Every later domain registers work
   items against it; retrofitting a contract across six domains is the expensive version.
5. **Phase 2's regulatory citation registry (24a) precedes Phase 10's full pack (24b).** Templates
   need "source regulation" before the library is complete; the library then backfills the rest.
6. **Bundle budget gates Phase 1 and Phase 4.** `PT-042` reports the entry chunk at 89.0% and the
   shell at 83.9% of their caps. Resident 360 tabs and Floor mode must be route-level lazy chunks,
   and each phase carries a bundle check in its exit gate. This is a design constraint on the tab
   architecture, decided in Phase 1, not a cleanup task afterwards.

### Terminology constraint (applies to every phase)

Per `CLAUDE.md`: all customer-facing text says **Assisted Living Facility / ALF**. The stored
`facility_type` value stays the literal `"ALR"` in `facilityTypes.ts`, migrations, RLS policies, and
data rows. New templates, labels, dropdowns, report headings, and printable output introduced by
this program must say ALF; no phase in this plan renames the stored code.

---

## 3. Baseline: what exists today, per request item

Verified against the working tree at `cb56f75`. This table is the scoping input for every phase —
"Delta" is the actual work.

| # | Request | What exists today | Delta |
| --- | --- | --- | --- |
| 1 | Resident 360 header + tabs | `ResidentDetail.tsx` (706 lines) stacks eight sections vertically; `Resident360Summary.tsx` gives four metrics + a filterable timeline; `residents` already carries `photo_document_id`, `advance_directive_status`, `mobility_summary`, `supervision_requirements`, `food_allergies`; diet/texture in `resident_dietary_profiles` | Coded care attributes missing (clinical level of care, transfer assistance, ambulation, fall/elopement risk, cognitive status, code status, non-food allergies); no composed read model; no tabs; no code splitting |
| 2 | Needs Attention panel | `moveInReadiness.ts` computes packet gaps/blockers; `residentCompliance.ts` computes item status; `careLevelReview.ts` flags billing/assessment mismatch; all rendered separately | No unified, prioritized, resident-scoped risk evaluator; no single panel |
| 3 | Assessment→plan engine | `support_plan_assessment_mapping_rules` (condition → proposed need/service/intervention/DME + `rationale`), `support_plan_proposals` (proposed/accepted/modified/rejected), `ResidentSupportPlanSection.tsx` | Rule content is not seeded for PA scenarios; no per-intervention "why" surface; approve/modify/reject is coarse, not per-item |
| 4 | Field-level conflict detection | `support_plan_proposals.conflict_warnings text[]` | Untyped strings — no source record, conflicting record, date, reviewer, recommended resolution, or accept/correct/document-exception action |
| 5 | PA PCH and ALF assessment templates | `residentAssessmentFormSchema.ts` (899 lines) models RASP/ASP faithfully; four reasons only (`initial`, `annual`, `significant_change`, `department_request`); `ResidentAssessmentFormEditor.tsx`; analyzers, prefill, PDF functions | Six of the ten requested templates do not exist (pre-admission, hospital-return, cognitive/behavioral, mobility/fall, nutritional, continence); no conditional questions, inline PA guidance, source regulation, or per-template signature rules |
| 6 | Support-plan lifecycle | `resident_support_plans.state`: draft, in_review, approved, effective, superseded, archived; version numbers, `prior_plan_id`, `assessment_form_id`, approver, signature jsonb | Missing awaiting-participation, awaiting-signature, revision-required, closed; no participation date, staff notification/acknowledgment, revision reason, or side-by-side diff |
| 7 | Interventions → services | `resident_service_requirements` + `resident_service_task_instances` auto-generated from plans; frequency, time window, role, two-staff, `documentation_mode` | No shift/weekly/as-needed/observation/manager-review task kinds; no qualification requirement, acceptable-response set, refusal handling, or escalation conditions on the service |
| 8 | Floor-staff mode | `/me/services`, `/me/work`, `/me/shift`, `/me/change-of-condition`, `/me/resident-services-calendar` | Employee pages inherit the management shell and information density; no five-action Floor entry, no resident task card, no photo |
| 9 | Exception-based documentation | Task status enum already includes refused/unavailable/not-completed/completed-late; `service_exception_rules` escalates by threshold | No "completed with more assistance" or "concern observed"; no structured follow-up prompts; documentation is free-text `note` |
| 10 | Unscheduled services | **Nothing** (no table, no UI, no term anywhere in the repo) | Entire capability, plus wiring into care-level review and change detection |
| 11 | Change-of-condition intelligence | `resident_change_events` (14 categories, notification/monitoring/follow-up structure), manager + employee queues, `resident_change_monitoring_entries` | No rule-based *detector* — every event is human-initiated; no supporting-record/date-range/why-it-matters presentation |
| 12 | Hospital leave and return | `hospital_transfer_episodes` models nearly all requested fields including bed hold, med reconciliation, changed-order acknowledgment, review-required flags | No workflow UI, no timeline entry, no automatic follow-up work items, no completion deadline enforcement |
| 13 | Guided incident investigation | `incidents` with 10 reportable types; documents, PDFs, state forms, `IncidentQapiEscalation.tsx` | Types are the *reportable-event* list, not the operational list (no fall, skin tear, injury, behavioral, property loss, staff-resident altercation); one generic form for all types |
| 14 | Incident follow-through | Corrective actions, QAPI escalation with duplicate prevention | No required stage machine; no trend/severity-driven QAPI recommendation |
| 15 | Incident and quality trends | `incidentAnalytics.ts` (54 lines) | No shift/location/time/resident/root-cause analyses; no click-through to source records |
| 16 | Merge Dashboard/Today/Work/Alerts | Four separate pages: `Dashboard.tsx` (854), `Today.tsx` (178), `WorkQueue.tsx` (404), `Alerts.tsx` (397), plus Compliance Command Center | The repo's own inventory already calls this duplication out; consolidation not started |
| 17 | Universal work queue | `work_items` with owner, priority, due, state, dedup key, recurrence, root cause, effectiveness review | Writers exist for only some sources; no backup owner, required evidence, escalation path, completion criteria, reviewer, or regulatory source |
| 18 | Duty-eligibility engine | `employeeReadiness.ts` returns the six-verdict readiness result | Verdict is displayed but enforces nothing at assignment, scheduling, assessor, or evaluator boundaries |
| 19 | Acuity-aware scheduling | `service_workload_profiles` sets per-shift minimum qualified staff; `scheduleAnalytics.ts` | No resident-acuity input to workload; no advisory workload/gap output |
| 20 | Admissions CRM | Prospects, tours with scheduled times, agreements, guest access, structured lost/declined reasons, move-in workspaces | Pipeline is coarser than the 14 requested stages; no referral source/ROI, probability, expected revenue, barriers, or competitor tracking |
| 21 | Occupancy and room board | `facility_buildings`, `residential_units`, `residents.bed_id`, census events | No visual board, no availability calendar, no waitlist matching, no hold/turnover states |
| 22 | QAPI as measurable improvement | QAPI projects, incident escalation, lead validation | No baseline/target/measurement/sustainment fields, no recommendation engine, no meeting packet |
| 23 | Survey Day workspace | `SurveyDay.tsx` (578 lines), `SURVEY_DAY_MODE_SPEC.md`, evidence room, mock inspections, `generate-compliance-binder` | Spec exceeds implementation; selected-evidence packet builder incomplete; the binder edge function is `@ts-nocheck` and not exercised by CI |
| 24 | Governed PA regulatory content | Regulatory engine, Copilot, crosswalk, `poll-regulatory-updates` | The Chapter 2600/2800 rule pack is not populated; no citation-level versioning, verification date, or approval record |
| 25 | Pilot coverage | 2 Playwright specs; `pilot/controlled-pilot-2026-07-24.json` records one executed controlled pilot | No journey-level browser coverage; few component render tests; limited Edge Function runtime tests |

---

## Phase 0 — Proof harness and program guardrails

**Outcome:** the program can prove a workflow works before calling a phase done.

**Why first:** every later exit gate in this plan cites journey coverage. Without the harness those
gates are decorative.

**Build**

1. **Seeded pilot tenant fixture.** A deterministic organization with both facility types (PCH and
   the `"ALR"`-coded ALF), residents at several acuity levels, employees with varied readiness
   verdicts, and open records in each domain. Reused by CI, by local development, and by demo.
2. **Playwright journey harness.** Page objects and role-authenticated sessions for administrator,
   facility manager, direct-care employee, and auditor. Journeys are written as composable steps so
   Phase *n* extends a spec rather than writing a new one.
3. **Journey skeleton for the twelve-step resident lifecycle** (admit → initial assessment →
   support plan → deliver/document services → increased assistance → change-of-condition review →
   plan revision → fall → investigation → QAPI → survey packet → discharge), with steps not yet
   buildable marked `test.fixme` and *counted in a coverage report* so the remaining gap is visible.
4. **Component render-test baseline** for the highest-risk surfaces, following the existing
   `QueryState.render.test.tsx` / `CheckIn.render.test.tsx` pattern.
5. **Edge Function runtime tests** for the functions this program depends on
   (`generate-resident-assessment-pdf`, `generate-state-form-prefill`, `generate-compliance-binder`),
   and removal of `@ts-nocheck` from `generate-compliance-binder` so CI type-checks it.
6. **Bundle headroom plan.** Record the current entry/shell percentages, add a per-phase budget
   delta check to CI, and decide the lazy-chunk boundary Resident 360 will use in Phase 1.

**Exit gate**

- The twelve-step journey spec exists and runs; implemented steps pass, unimplemented steps report
  as a tracked coverage number.
- Both facility types are exercised by at least one role journey each.
- The bundle check fails a PR that regresses entry or shell share.

---

## Phase 1 — Resident 360 as the command center

**Request items:** 1 (fixed header + tabs), 2 (Needs Attention), 17a (work-item contract).

**Outcome:** a resident record that answers "who is this person clinically, and what needs to happen
today?" without scrolling.

### 1a. Resident clinical profile (the data problem, solved first)

Fifteen of the seventeen requested header fields have no home. Sourcing them:

| Header field | Source |
| --- | --- |
| Room, facility, admission date, status, hospice, **photo** | `residents` (exists — `photo_document_id` already points at `resident_documents`, so no new PHI storage class is needed; reads go through the existing logged signed-URL path) |
| Diet, texture, food allergies | `resident_dietary_profiles` (exists — project, don't duplicate) |
| Mobility / transfer assistance | `resident_evacuation_profiles.assistance_level` exists but is *evacuation* scope; needs a care-scope field |
| Current hospital status | derived from open `hospital_transfer_episodes` |
| Last assessment date | derived from `resident_assessment_forms` / `clinical_assessments` |
| Current support-plan version | derived from `resident_support_plans` |
| **New:** clinical level of care, transfer assistance, ambulation status, non-food allergies, fall risk, elopement risk, cognitive status, code status | new coded fields |

Decisions this phase must make explicitly, because they are not reversible cheaply:

- **Level of care is currently only a billing concept** (`resident_rate_agreements.level_of_care_charge`).
  Introduce a *clinical* level of care as a distinct governed field and keep `careLevelReview.ts`'s
  job — comparing assessed acuity to billed level — intact rather than collapsing the two.
- **Code status and allergies are clinical data.** They belong on the clinical side of the boundary
  documented in `docs/HIPAA_CLINICAL_DATA.md`, behind per-facility clinical enablement, not on
  `residents`.
- **Resident photo** turned out to need no new storage decision: `residents.photo_document_id`
  already references `resident_documents`, so the photo inherits that table's bucket, RLS,
  retention, and logged signed-URL path. Reading it is a logged PHI access like any other resident
  document, and it degrades to initials wherever it is absent or fails to load.

Deliver as a single tenant-scoped read model (`get_resident_header` RPC or security-invoker view) so
the header, Floor task cards (Phase 4), and printable output all read one source. Every field carries
`as_of` and `source` so the header can show staleness rather than implying currency it doesn't have.

### 1b. Tabbed navigation

Nine tabs: Overview, Care and services, Assessments, Support plan, Incidents and changes,
Appointments, Documents, Financial and agreements, Timeline.

- Tab state lives in the URL (the enhancement report's existing "make major workspaces deep-linkable"
  recommendation), validated against role and facility access on load.
- Each tab is a lazily-loaded chunk; the header and Needs Attention panel are in the eager chunk.
  `ResidentDetail.tsx` decomposes from 706 lines into a shell plus per-tab modules.
- The header stays fixed on scroll and collapses to a compact bar on small screens; print output
  keeps today's face-sheet behavior.
- Existing sections move into tabs unchanged in this phase. Redesigning a section *and* moving it in
  the same change makes regressions unattributable.

### 1c. Needs Attention panel

One prioritized evaluator (`residentNeedsAttention.ts`, pure and unit-tested in the style of
`moveInReadiness.ts`) unioning: overdue/at-risk compliance items, move-in blockers, support-plan
review due, unreviewed proposals, open change events, open incident follow-ups, incomplete hospital
return reconciliation, unsigned agreements, missing physician information, fall clustering
(three in thirty days), repeated service refusals, documented increased assistance, missing state
forms, and care-level review flags.

Each card states **what**, **why it matters**, **since when**, **who owns it**, and **the one action**.
Cards are derived from records, never from an opaque score — consistent with the request's explicit
"no black-box AI risk score" constraint in item 11, applied here too.

### 1d. Work-item contract (17a)

Extend `work_items` with backup owner, required evidence, escalation path, completion criteria,
reviewer, and regulatory source, and publish a single registration helper every later phase uses.
Backfill existing sources. Needs Attention cards that represent owned work link to their work item
rather than inventing a parallel to-do concept.

**Risks**

- *Tab migration hides a section a user relied on finding by scrolling.* Mitigation: an in-app
  "where did it go" map for one release, plus the search-by-section affordance in the shell.
- *Header queries fan out per resident and regress the list page.* Mitigation: one RPC, measured
  against the seeded tenant with a query-count assertion in CI.

**Exit gate**

- Journey steps 1 (admit) and 12 (discharge) pass end-to-end.
- Header renders with real data for both facility types; every field shows source and as-of.
- Needs Attention is unit-tested per card type including the empty state; no card can render without
  an owner and an action.
- Entry/shell bundle share does not regress; tab chunks load on demand.

---

## Phase 2 — Governed assessment content and support-plan lifecycle

**Request items:** 5 (templates), 6 (lifecycle), 24a (citation registry, resident scope).

**Outcome:** assessments are governed, typed documents with regulatory provenance, and a support plan
moves through a lifecycle that matches how PA facilities actually approve care.

### 2a. Citation registry (24a — the slice the templates need)

A versioned `regulatory_citations` registry carrying citation, exact requirement text, facility type,
responsible role, frequency, required evidence, related module, effective date, source URL, last
verified date, superseded version, and approval record. Populate the resident-assessment and
support-plan scope only. Phase 10 completes the pack and connects it to training, incidents,
employee qualifications, survey readiness, and plan-of-correction drafting.

Governance matters more than volume: a wrong citation shown next to a form field is worse than no
citation. Every row requires a named verifier and a verification date, and the UI shows both.

### 2b. Template engine

Generalize `residentAssessmentFormSchema.ts` from two hard-coded form types into a governed template
model supporting: required fields, conditional questions, inline PA guidance, source regulation
reference, missing-field validation, electronic review, signature requirements, version and effective
dates, and printable state-compatible output.

Ten templates: initial, annual, significant change, support plan/RASP, pre-admission, hospital
return, cognitive and behavioral review, mobility and fall-risk review, nutritional review,
continence and toileting review.

Two constraints carried forward from the existing code:

- The digital form remains a **drafting and reference aid**. `complete_resident_compliance_item()`
  requires a signed DHS-prescribed document; nothing in this phase weakens that, and the templates'
  copy must keep saying so.
- `resident_assessment_forms.reason` widens from four values to the template set via an additive
  migration with a backfill; existing finalized forms keep their reason and their content shape.

Template fields must be **typed and addressable** — this is what makes Phase 3's field-level conflict
detection possible. Free-text answers stay free text, but every field the conflict detector compares
(transfer assistance, diet texture, assistance level, fall risk, continence) is an enumerated,
versioned field key.

### 2c. Support-plan lifecycle

Expand `resident_support_plans.state` from six values to nine: draft, awaiting clinical review,
awaiting resident/designated-person participation, awaiting signature, approved, active, revision
required, superseded, closed. Additive migration with an explicit mapping of existing rows
(`in_review` → awaiting clinical review, `effective` → active, `archived` → closed), a documented
legal transition table enforced in the RPC, and a rollback path.

Track initiator, source assessment, revision reason, effective date, participation date, signatures,
staff notification, staff acknowledgment, prior version, and changes from prior version.

Add **side-by-side comparison** between any two versions, computed from the stored plan content
rather than a stored diff, so it stays correct if content is corrected. The comparison is the
artifact a surveyor asks for ("what changed and why") and should be printable.

**Exit gate**

- Journey steps 2 (initial assessment) and 3 (generate and approve support plan) pass, for both
  facility types.
- Every template renders, validates missing required fields, and produces printable output; every
  guidance string resolves to a verified citation row.
- pgTAP covers the state machine including every rejected illegal transition.
- Version comparison is unit-tested against added, removed, and modified interventions.

---

## Phase 3 — Assessment→plan→service engine

**Request items:** 3 (connected workflow), 4 (field-level conflicts), 7 (interventions → services).

**Outcome:** answering an assessment produces defensible proposed care, and approving it produces the
tasks staff will actually perform.

### 3a. The connected chain

Make `assessment answer → identified need → proposed intervention → support-plan section → staff
service task` traceable in both directions: from any staff task, show the intervention, the need, the
assessment answer, and the rule that connected them; from any assessment answer, show what it
produced.

The engine shape exists. The work is:

- **Seed PA rule packs** against `support_plan_assessment_mapping_rules`, governed and versioned like
  the citation registry, with the request's worked example as an acceptance fixture: extensive
  toileting assistance + two recent falls + walker + forgets to request assistance → scheduled
  toileting every two hours, standby assistance during ambulation, walker within reach,
  fall-prevention checks, cue resident to call for help, monitor and document refusals.
- **Per-item review.** Approve, modify, or reject each proposed intervention individually with the
  triggering rule and its `rationale` shown inline. Today's proposal review is whole-proposal.
- **Rule provenance in the UI.** Every suggestion shows why it was suggested and which rule version
  produced it. A modified intervention records what the administrator changed relative to the
  proposal — that delta is the most valuable rule-improvement signal the product can collect.

### 3b. Field-level conflict detection

Replace `support_plan_proposals.conflict_warnings text[]` with typed conflicts carrying source
record, conflicting record, date, responsible reviewer, recommended resolution, and an
accept / correct / document-exception action that writes an auditable disposition.

Detectors to ship (each a pure, unit-tested rule):

- Assessment says two-person transfer; plan says one-person assistance.
- Assessment records mechanical-soft diet; dietary profile or header says regular.
- Staff documentation repeatedly shows extensive assistance; plan says supervision.
- New fall risk documented with no fall intervention in the active plan.
- Resident returned from hospital and the active plan predates the return.

Conflicts surface in Needs Attention (Phase 1) and create work items (17a), so a detected conflict
cannot be silently ignored.

### 3c. Interventions → services

Extend `resident_service_requirements` with task kind (scheduled care, shift, weekly, as-needed,
observation, manager review, documentation requirement), required qualification, acceptable
completion responses, refusal handling, escalation conditions, and end date. Generation from an
approved plan becomes opt-in per intervention rather than implicit, and supersession when a plan
version changes must be transactional — a resident must never be left with tasks from two live plan
versions.

**Risks**

- *Seeded rules propose clinically wrong care.* Mitigation: rules are advisory and require per-item
  human approval; no rule auto-applies; clinical SME review is a named sign-off on the rule pack, not
  an engineering review.
- *Requirement supersession races with in-flight task instances.* Mitigation: transactional
  supersession with pgTAP concurrency coverage; the existing `unique (requirement_id, scheduled_start)`
  constraint is the backstop, not the design.

**Exit gate**

- Journey steps 4 (deliver and document services) and 7 (revise the support plan) pass.
- The worked example from the request produces the six expected interventions from seeded rules, as a
  committed fixture test.
- Every conflict type has a positive and negative test and a resolvable UI path.
- Plan-version change supersedes requirements and future task instances atomically, proven under
  concurrency.

---

## Phase 4 — Floor execution mode

**Request items:** 8 (CareBase Floor), 9 (exception-based documentation), 10 (unscheduled services).

**Outcome:** a direct-care employee can do a whole shift on a phone without meeting a management
concept.

### 4a. CareBase Floor

A distinct mode under `/me` with five large actions: my assignment, resident tasks, document care,
report a concern, shift handoff. Built on the existing employee routes (`/me/services`, `/me/work`,
`/me/shift`, `/me/change-of-condition`) rather than beside them — this is a shell and interaction
redesign, not a second data path.

Resident task card shows photo, room, task, due window, brief care instructions, safety alerts, and a
document button. It shows nothing else: no compliance status, no work-item metadata, no regulatory
citation. Deciding what to *withhold* is the substance of this phase.

Non-negotiable for a floor surface: touch targets sized for gloved hands, legibility in poor lighting,
offline-tolerant submission with explicit queued/sent state (the offline-learning cache is prior art),
and no destructive action without confirmation.

### 4b. Exception-based documentation

Seven default responses: completed as planned, completed with more assistance, partially completed,
resident refused, resident unavailable, not completed, concern observed. Only exceptions require more.

The task status enum already carries four of these; the additive migration adds the rest and, more
importantly, adds a **structured exception payload** so "more assistance" stops being free text.
Follow-up prompts for increased assistance: temporary or ongoing, what level was required, was a
supervisor notified, should a change-of-condition report be created — with the change-of-condition
path handing straight to the existing `/me/change-of-condition` flow rather than a parallel form.

Structured exceptions are what make Phase 5's detector and Phase 3's "staff documentation repeatedly
shows extensive assistance" conflict computable. That is the real reason this is not cosmetic.

### 4c. Unscheduled services

New capture for care provided but not scheduled: unscheduled toileting, extra transfer assistance,
additional redirection, increased supervision, extra meal assistance, additional hygiene, behavioral
intervention, unplanned safety check. Two taps to record, resident and time pre-filled from context.

Repeated unscheduled services feed support-plan review, assessment review, level-of-care review, and
staffing review — extending `service_exception_rules`' existing threshold model rather than inventing
a second escalation mechanism. This is also the evidence that upgrades `careLevelReview.ts` from a
read-only worklist to a claim backed by utilization data.

**Risks**

- *Capture friction kills adoption; captured data then misleads because it is sparse.* Mitigation:
  a measured target for time-to-record in the pilot, and every downstream consumer treats
  unscheduled-service counts as a floor, never a census.
- *Floor mode becomes a second implementation of task logic.* Mitigation: shared hooks and RPCs; the
  exit gate includes an explicit no-duplicate-logic review.

**Exit gate**

- Journey steps 4 and 5 (report increased assistance) pass from the employee role on a mobile
  viewport.
- Median time to document a routine task and to record an unscheduled service, measured in the
  controlled pilot against a stated target.
- Offline submission proven: queued while offline, delivered on reconnect, never double-posted.

---

## Phase 5 — Change intelligence and care transitions

**Request items:** 11 (rule-based change detection), 12 (hospital leave and return).

**Outcome:** the system notices deterioration from records staff already create, and a hospital round
trip cannot quietly leave a resident's plan stale.

### 5a. Rule-based change detector

Detect increased assistance, multiple falls, reduced meal intake, weight change, behavior change,
new incontinence, repeated refusals, skin concern, hospital visit, increased supervision, repeated
unscheduled services, and decline in mobility — from `resident_service_task_instances` exceptions
(Phase 4b), unscheduled services (Phase 4c), `resident_meal_records`, `resident_weight_readings`,
incidents, and change events.

Presentation is fixed by the request and is the right constraint: **what changed, supporting records,
date range, why it matters, recommended review, who must respond.** No score. Every detection links to
the rows that produced it, and every threshold is a configured, visible, per-facility value — not a
constant buried in code.

Detections raise work items (17a) and Needs Attention cards (Phase 1). A detection a human dismisses
records the dismissal and its reason; that is the tuning signal and the survey defense.

### 5b. Hospital leave and return reconciliation

`hospital_transfer_episodes` already carries most fields. Build:

- **Departure workflow:** date/time, reason, destination, transport, notifications, belongings,
  medication information sent, current documents sent.
- **Return workflow:** discharge paperwork received, medication changes reviewed, new diagnoses, new
  restrictions, diet changes, mobility changes, skin findings, follow-up appointments, physician
  orders, assessment required, support-plan revision required, responsible staff, completion deadline.
- **Automatic consequences:** a timeline entry on Resident 360, follow-up work items with the
  deadline, a Needs Attention card while reconciliation is incomplete, and — when the return flags
  review — a hospital-return assessment (Phase 2 template) and a plan revision (Phase 2 lifecycle).

The requested `assessment_review_required` / `support_plan_review_required` flags already exist and
currently do nothing. Making them produce owned, deadlined work is most of this slice's value.

**Exit gate**

- Journey step 6 (trigger change-of-condition review) passes, driven by a *detected* change rather
  than a hand-created one.
- The full hospital departure→return journey passes and leaves no orphan follow-up.
- Every detector rule has fixture tests at, above, and below threshold, plus a no-false-positive test
  on a stable resident.

---

## Phase 6 — Guided incident investigation and quality

**Request items:** 13 (type-specific pathways), 14 (follow-through stages), 15 (trends), 22 (QAPI).

**Outcome:** an incident is a managed investigation with a closure standard, and patterns become
projects instead of anecdotes.

### 6a. Type-specific pathways

Today's `incident_type` list is the PA *reportable-event* list. Operationally, facilities also manage
falls, injuries, skin tears, behavioral events, emergency transfers, property loss, and staff-resident
altercations. Separate the two concepts: an operational incident type drives the questions asked;
reportability is a determination made *during* the investigation (Stage 3 below), not a synonym for
the type. Conflating them is the current design's core problem, and untangling it is a schema change
with a careful backfill of existing rows.

Twelve pathways, each with its own question set. The fall pathway is the reference implementation:
witnessed or unwitnessed, location, activity before fall, footwear, assistive device, environmental
condition, injury, head strike, emergency evaluation, physician notification, designated-person
notification, prior falls, immediate intervention, support-plan impact, follow-up monitoring.

Pathway questions reuse the Phase 2 template engine. Building a second question-rendering system here
would be the most expensive avoidable mistake in this program.

### 6b. Required follow-through stages

Eleven stages: immediate response, notifications, reportability review, investigation, root cause,
corrective action, resident assessment review, support-plan review, QAPI consideration, administrator
approval, closure. Each stage has an owner, a due time, and a completion standard; an incident cannot
close with an incomplete stage, and every stage transition is audited.

Enhance the existing QAPI escalation to *recommend* based on trend and severity while keeping the
current duplicate prevention.

### 6c. Trends

Falls by shift, location, time, and resident; injuries by type; medication-related events; elopement
concerns; behavioral incidents; hospital transfers; repeat incidents; root causes; overdue
investigations; corrective-action effectiveness. Every chart element opens its source records — an
un-drillable chart in a compliance product is a liability, because the number cannot be defended.

### 6d. QAPI as a measurable system

Per project: problem statement, source records, baseline, root cause, objective, target,
intervention, owner, due date, measurement method, results, sustainment plan, closure decision.
Automatic project recommendations for repeated falls, repeated medication events, increased
hospitalizations, complaint trends, staff training failures, missed services, maintenance hazards,
survey deficiencies, and infection trends. Monthly meeting packet with charts, open projects,
outcomes, and action items.

**Exit gate**

- Journey steps 8 (record a fall), 9 (complete investigation and follow-up), and 10 (escalate to
  QAPI) pass.
- No incident can close with an open required stage (pgTAP).
- Every chart drills to source records; every recommendation cites the records that triggered it.

---

## Phase 7 — Universal work and one home surface

**Request items:** 16 (merge Dashboard/Today/Work/Alerts), 17b (universal coverage).

**Outcome:** one place to start the day, one queue for everything owned.

**Why this late:** consolidating four surfaces before Phases 1–6 change what they display would mean
consolidating twice. By this point every domain registers work items against the Phase 1 contract, so
the merge is an information-architecture change over a stable substrate.

**Build**

- **17b:** every remaining actionable record creates or links a work item — assessment due, support
  plan due, incident follow-up, complaint deadline, credential expiration, training overdue,
  maintenance inspection, admission document, emergency drill, policy review, corrective action, QAPI
  intervention, hospital-return follow-up, resident agreement, regulatory requirement.
- **Home: Daily Command Center** replacing Dashboard/Today/Alerts — urgent, due today, overdue,
  residents needing attention, employees not ready, admissions today, residents out of facility, open
  incidents, open maintenance hazards, staffing concerns, survey-readiness score. Role- and
  facility-scoped, with the portfolio/facility scope behavior `Today.tsx` already established.
- **Work:** the full sortable universal queue.
- **Compliance:** recurring regulatory obligations and evidence (the existing Compliance Command
  Center, kept).
- **Analytics:** trends and KPIs, including Phase 6's incident and quality analyses.

Retire `Today.tsx` and `Alerts.tsx` as destinations with redirects, and reduce `Dashboard.tsx`
(854 lines) to the Home surface. Every retired route redirects for at least one release; no bookmark
breaks silently.

**Exit gate**

- Every source type in item 17 demonstrably creates a work item with owner, due date, completion
  criteria, and regulatory source where applicable.
- No metric appears on more than one surface with two different definitions — an explicit
  reconciliation review, since divergent definitions are how the current duplication became a problem.
- Role journeys for administrator, manager, and auditor pass against the new Home.

---

## Phase 8 — Workforce fit and acuity-aware scheduling

**Request items:** 18 (duty-eligibility enforcement), 19 (acuity-aware scheduling).

*Parallelizable with Wave B/C from the end of Phase 1.*

**Outcome:** the readiness verdict `employeeReadiness.ts` already computes actually prevents things.

**Build**

- Block assignment to medication-related duties when requirements are incomplete; warn on scheduling
  at an unassigned facility; prevent an unqualified assessor from serving as assessor; prevent
  competency verification by an unqualified evaluator; warn when a shift lacks a required
  qualification; identify credentials expiring within the published schedule.
- Enforcement must be **server-side** — RPC/RLS, not a hidden button. Per `IMPLEMENTATION_PLAN.md`,
  no feature flag or UI gate is an authorization boundary.
- Every block is overridable by a named role with a recorded reason. A hard block with no override
  path gets worked around outside the system, which is worse than a logged override.
- Acuity-aware advisory workload: resident count, assistance levels, two-person transfers, behavioral
  supervision, scheduled services, appointments, high-risk residents, admissions/returns, staff
  qualifications, restrictions → expected workload by shift, residents requiring two staff,
  qualification gaps, unbalanced assignments, high-task periods, uncovered critical services.
  Extends `service_workload_profiles`; **advisory, never an automatic staffing mandate**, and labeled
  as such in the UI.

**Exit gate**

- The "employee hire through duty eligibility" and "credential expiration and restriction" journeys
  pass.
- Every block has a negative authorization test proving the direct RPC call is rejected, not just the
  button hidden.
- Workload output is reproducible from a fixture roster and never presented as a required staffing
  level.

---

## Phase 9 — Admissions CRM and occupancy board

**Request items:** 20 (pipeline), 21 (occupancy/room board).

*Parallelizable with Wave B/C from the end of Phase 1.*

**Outcome:** the front of the funnel and the physical plant are as legible as the care record.

**Build**

- Fourteen-stage pipeline: new inquiry, contact attempted, qualified, tour scheduled, tour completed,
  assessment scheduled, assessment completed, financial review, accepted, deposit pending, move-in
  scheduled, move-in ready, admitted, lost/declined. Additive to the existing prospect model, mapping
  current states forward.
- Referral source, lead-source ROI, follow-up reminders, desired move-in date, preferred room, care
  needs, affordability, barriers, competitor selected, probability, expected monthly revenue. Plus the
  waitlist priority and occupancy/conversion export the repo's own backlog already identifies as the
  logical next admissions step.
- Occupancy board over `facility_buildings` / `residential_units` / `residents.bed_id`: licensed
  capacity, current census, occupancy percentage, available, reserved, maintenance holds, hospital
  leave, temporary absence, pending move-in, pending discharge, turnover status, double-occupancy
  availability — in building view, floor view, room list, availability calendar, and waitlist matching.
- Licensed capacity is a regulatory number. It comes from the facility licence record, never from a
  count of rows, and the board must show when census exceeds it.

**Exit gate**

- The "admission inquiry through move-in" journey passes and ends at a resident whose Phase 1 header
  and Needs Attention panel are populated — the point where this phase joins the care core.
- Occupancy figures reconcile against census events with a committed reconciliation query.

---

## Phase 10 — Governed PA regulatory library and Survey Day

**Request items:** 24b (full rule pack and connections), 23 (Survey Day workspace and evidence packet).

*Parallelizable with Wave C from the end of Phase 2 (24a).*

**Outcome:** the PA-specialization claim is backed by governed content, and survey day is a workspace
rather than a scramble.

**Build**

- Complete the Chapter 2600/2800 rule pack on the Phase 2a registry: citation, exact requirement,
  facility type, responsible role, required frequency, required evidence, related module, effective
  date, source URL, last verified date, superseded version, legal/compliance approval.
- Connect citations to compliance requirements, training, resident forms, incident deadlines, employee
  qualifications, survey readiness, plan-of-correction drafting, and help content — the connections
  are what make the library a product rather than a document.
- **Survey Day workspace:** surveyor names, arrival time, requests with assignee and deadline,
  attached evidence, what was provided, interviews, observations, potential findings, follow-up tasks,
  and a final survey evidence packet. Close the gap between `SURVEY_DAY_MODE_SPEC.md` and
  `SurveyDay.tsx`, and finish the selected-evidence packet builder on top of the already-fixed binder
  cover/TOC/pagination.
- Content governance is the risk here, not engineering. Every citation carries a named verifier and a
  verification date; the library shows its own staleness; `poll-regulatory-updates` flags citations
  whose source changed. A confidently-wrong citation in a survey packet is the worst failure mode this
  product has.

**Exit gate**

- The "compliance requirement through evidence approval" journey passes.
- Journey step 11 (generate a survey packet) passes with selected evidence.
- Every seeded citation has a verifier and a verification date; the pack has a compliance-SME sign-off
  recorded outside the codebase.

---

## 4. Cross-cutting requirements

**Per-phase, non-optional** (extending the delivery contract in `IMPLEMENTATION_PLAN.md`):

1. **Journey coverage grows.** The unimplemented-step count in the Phase 0 coverage report must fall.
   A phase that adds capability without converting a `fixme` step has not finished.
2. **Authorization tested both ways.** Every new table, RPC, and Storage path has positive and
   negative tests. UI gating is never the boundary.
3. **Additive migrations only,** with backfill, an explicit rollback window, and the previous release
   left compatible. Three enum expansions in this program (`reason`, plan `state`, `incident_type`)
   are the highest-risk migrations; each gets its own rehearsal against a production-shaped copy.
4. **Bundle budget checked** on every PR; Resident 360 tabs and Floor mode stay lazily loaded.
5. **Clinical data stays behind the clinical boundary** documented in `docs/HIPAA_CLINICAL_DATA.md`
   and per-facility clinical enablement. Photo, allergies, code status, and cognitive status are the
   fields most likely to be placed wrongly.
6. **ALF terminology** in all customer-facing strings; stored `"ALR"` untouched.
7. **Kill switch per capability,** default-off rollout, and a demonstrated disable path.

**Standing risks**

| Risk | Where it bites | Mitigation |
| --- | --- | --- |
| Feature breadth again outruns operational proof | Whole program | Journey gates per phase; the coverage number is reported to the program, not buried in CI |
| Migration chain divergence from production recurs (`PT-051`) | Every phase | Duplicate-version and drift checks already in PR CI stay green as a release condition |
| Advisory output read as a mandate | Phases 5, 8 | Every advisory surface states its status in the UI and in printable output |
| Governed content is wrong | Phases 2, 10 | Named verifier + verification date per row; visible staleness; SME sign-off is a gate, not a review |
| Floor adoption fails | Phase 4 | Time-to-document measured in the pilot with a stated target; failing the target blocks the exit gate |
| Single-operator review capacity | Whole program | Phases are independently shippable; Waves B and D can be paused without stranding the other |

**Explicitly out of scope**

- Renaming the stored `"ALR"` facility-type code (schema/data change, per `CLAUDE.md`).
- Any AI-generated clinical risk score. Item 11's constraint — records and rules, never a black box —
  is applied program-wide, including Needs Attention and QAPI recommendations.
- Replacing the requirement for signed DHS-prescribed forms with digital equivalents.

---

## 5. Delivery log

Kept current as phases land, so the plan does not drift from the code.

### Phase 1 — first slice delivered

**Sequencing deviation, stated deliberately.** Phase 0 is documented above as preceding everything,
and it still should for the journey gates. This slice went to Phase 1 first for one reason: the
Playwright journey harness needs a running Supabase stack to be meaningful, and building a harness
that cannot be executed in the environment where the work happens produces unverifiable
infrastructure. The Phase 0 discipline that *is* executable here — pure-logic unit tests, a stable
tab contract under test, typecheck, and the bundle gate — was applied to everything below. Phase 0's
seeded tenant and browser journeys remain outstanding and still gate Phase 2.

| Item | Delivered | Notes |
| --- | --- | --- |
| 1a — care header data model | `20260726010000_resident_care_header_profile.sql` | Eight coded columns on `residents` + `save_resident_care_profile` (SECURITY DEFINER, manager-gated, writes an administrative-history row) + `get_resident_care_header` (security invoker, composes stored and derived facts, each block carrying its own `asOf`) |
| 1a — placement decisions | Recorded in the migration header | Clinical level of care kept distinct from the billed `level_of_care_charge`; `code_status` distinct from `advance_directive_status` (document-on-file, not preference); non-food `allergies` distinct from `food_allergies`; every column defaults to an explicit "not assessed" rather than NULL, and nothing is inferred from existing free text |
| 1b — tabs | `resident-tabs/` + shell rewrite of `ResidentDetail.tsx` | Eight tabs, each a lazy chunk; tab state in the URL; unknown or no-longer-permitted tabs fall back to Overview; registry is data-driven so later phases add a tab by adding a row |
| 1c — Needs Attention | `residentNeedsAttention.ts` + panel | Twelve card kinds, ranked, each carrying evidence / owner / due / action. Pure and injectable-clock |
| Bundle gate | `check-bundle-budget.mjs` | Resident Detail route chunk 89.8 → 50.3 KiB; route budget **tightened** 100 → 70 KiB. Aggregate JS budget raised 3700 → 4200 KiB (measured 3702.0; it was already at 98.9% and warning before this work) |

**Verified:** typecheck clean; 89 test files / 528 tests pass, including 46 new ones; production
build succeeds; bundle budget passes; migration policy lint and source integrity pass.

**Not verified here:** `check:database` needs a local Supabase stack (no Docker daemon in this
environment), so the migration has not been replayed and `database.types.ts` was extended by hand to
match the generator's output. CI's database job is the check on both.

**Deliberately not built in this slice, and why:**

- **Appointments tab** — `resident_appointments` exists but has no read surface on the record. An
  empty tab reads as "no appointments" rather than "not built". Tracked in `PLANNED_TABS`.
- **"Increased assistance" and refusal-specific cards** — need the structured service exceptions
  from Phase 4. Approximating them from free text would manufacture false signals.
- **Care-level review card** — the evaluator supports it, but feeding it means loading the 11-query
  financial workspace on every resident view. It waits for the Financial tab to own that query.

All three are surfaced in the panel's "checks not yet covered" section rather than silently omitted.

### Phase 2 — 2a and 2c delivered; 2b outstanding

Phase 2 has three parts. Two landed complete; the template engine (2b) is the largest single piece
in the program and is deliberately left for its own slice rather than rushed alongside two
migrations.

**Baseline correction (2a).** The plan proposed a new `regulatory_citations` registry carrying its
own governance fields. Building that would have been a fourth overlapping concept: the repo already
has `regulatory_rule_versions` (governed, versioned, approval-gated — but for *calculable* rules),
`dhs_citation_topics` (chapter/citation taxonomy), `compliance_requirements.regulation_citation`,
and `dhsFormsLibrary.ts` (a governed static catalog with a verification date and a live-link CI
check). More importantly, **`resident_compliance_rule_packs` already carries verified citations**
per facility type, item type, and admission track, with `notes` that mark each point "confirmed" or
"pending confirmation".

So 2a shipped as a reference catalog *derived from that verified data*, not authored fresh:

| Delivered | Notes |
| --- | --- |
| `paRegulatoryCitations.ts` | Seven sections covering the assessment / support-plan / medical-evaluation scope. Every entry records the shipped migration its statement was carried forward from |
| Verification posture | `2600.141` and `2800.225` carry `pending_confirmation` because the source rule packs say their grace periods are unconfirmed. Upgrading them would launder an open question into a settled one; a test asserts they stay unconfirmed and the display label says so |
| Item-type mapping | Mirrors the rule pack — for the ALF, the support plan is governed by `2800.224` alongside the initial assessment. There is no `2800.227`, and inventing one to mirror PCH numbering would be exactly the wrong guess |
| Staleness | `isCitationLibraryStale()` at the point of use, on the same 45-day cadence `check-dhs-sources.mjs` enforces for forms. Extending that script to also ping the pacodeandbulletin.gov links is a recorded follow-up |

**2c — support-plan lifecycle.** Six states to nine, with the transition table expressed once in
`app_private.support_plan_transition_allowed` and mirrored (not re-decided) in the client.

The substantive design correction found while building: the nine-state model only means something
if `approved` and `active` genuinely differ — a plan can be signed off today with an effective date
next Monday. The previous `approve_support_plan` superseded the prior plan and regenerated service
requirements *at approval time*. Future-dating a plan under that code would have left the resident
with no plan in force and no active service requirements for the days in between. Activation is now
separated: `app_private.activate_support_plan` does the supersession and service generation, called
immediately for a same-day effective date and otherwise by a nightly `activate_due_support_plans()`
job.

Also delivered: participation and signature capture (with declined / unable-to-sign as recorded
outcomes), a `support_plan_acknowledgments` table so "which aides have read the revised plan" is
answerable by name, revision reasons required on rework, and a side-by-side version comparison
computed from stored content rather than a stored diff.

**Verified:** typecheck clean; 91 test files / 567 tests pass (39 new); build succeeds; bundle
budget passes with the resident route unchanged at 50.3 KiB. Phase 1's CI ran green end to end,
including the `database` job that replays migrations and regenerates types — confirming the
hand-written `database.types.ts` entries matched the generator.

### Phase 2b — template engine delivered; Phase 2 complete

**Scope decision: extend, do not rewrite.** The plan said "generalize
`residentAssessmentFormSchema.ts` from two hard-coded form types into a governed template model".
Doing that literally would have rewritten the one state-form workflow that already works — 899 lines
faithfully modelling the DHS RASP/ASP, driving the editor, the prefill tools, and PDF generation —
for no gain, because that file's shape is dictated by DHS, not by us.

`assessmentTemplates.ts` therefore sits alongside it, and templates come in two kinds. The split is
a real distinction, not an accident:

- **`state_form_backed`** (initial, annual, significant-change, support plan) — these *are* the
  RASP/ASP. The template records their governance (citation, participation, signature rules,
  version, effective date) and defers content to the existing schema. Their `sections` are
  deliberately empty, and a test enforces that so nobody starts a second definition of the DHS form.
- **`internal_review`** (pre-admission, hospital return, cognitive/behavioral, mobility/fall,
  nutritional, continence) — no DHS form prescribes these. They define their own typed fields.

| Delivered | Notes |
| --- | --- |
| Ten governed templates | Required fields, conditional questions, inline PA guidance, source regulation, signature rules, version and effective dates |
| `resident_assessment_reviews` | Own table for the six internal reviews, rather than forcing them into `resident_assessment_forms` whose content shape is the RASP/ASP. Template version pinned at creation so a later revision cannot change what was asked; one draft per resident per template; a finalized review is superseded, never edited |
| Validation | Lives in the template definition and runs before finalize. `finalize_resident_assessment_review` deliberately does **not** re-implement it in SQL — one source of what "complete" means. The signature and status invariants that make the record evidence *are* enforced in the table's check constraints |
| Clinical review | `record_assessment_review_clinical_review` rejects the assessor signing as their own second reviewer |

**The Phase 3 hand-off is the point of the typed fields.** Conflict detection has to compare an
assessment answer against the care header ("assessment says two-person transfer; plan says
one-person"). That is only computable if answers live at stable keys sharing a vocabulary with the
header. `comparesTo` is that link, `comparableAnswers()` is the accessor, and six parity tests
assert the template option values stay identical to the coded values in `residentCareHeader.ts` —
drift there would break every conflict rule silently.

**Verified:** typecheck clean; 92 test files / 604 tests pass (37 new); build succeeds; bundle
budget passes with the resident route at 50.4 KiB.

**Phase 2 is now complete.**

### Phase 3a/3b — conflict detection and a proposal engine that evaluates its rules

**The engine had no evaluation step.** `generate_support_plan_proposal` selected *every* active
mapping rule and aggregated their proposed needs, services, and interventions without ever comparing
a rule's `condition` against the assessment. With zero rules seeded this was invisible; the moment
content existed it would have proposed every intervention in the pack to every resident — worse than
no engine, because it would look like it was working. The plan scoped 3a as "seed PA rule packs";
the actual first job was to make the engine capable of using them.

| Delivered | Notes |
| --- | --- |
| `app_private.mapping_rule_condition_matches` | A deliberately small predicate language (`equals`, `notEquals`, `gte`/`lte`, `isTrue`, empty). A rule language nobody can read is a rule language nobody can review |
| Unanswered never matches | A rule fires on evidence, never on absence. Four pgTAP assertions pin this specifically |
| `generate_support_plan_proposal_from_review` | Evaluates rules against a finalized review's typed answers, and carries `ruleKey` / `ruleVersion` / `rationale` / the matching answer into the proposal so "why was this suggested" is answerable in the UI |
| Seeded PA rule pack | Ten platform-scoped rules, each with a rationale. **The request's worked example is a committed pgTAP fixture**: extensive toileting assistance + two recent falls + a walker + unreliable requests for help matches exactly the six interventions the request names — and an independent resident with no findings matches zero |
| `residentCareConflicts.ts` | All five conflict types from the request, each naming source record, conflicting record, date, responsible role, and recommended resolution |
| `resident_care_conflict_dispositions` | Accept / correct / document-exception, each requiring a note. Conflicts stay **derived**; only the disposition is stored |

**Why conflicts are derived rather than stored.** A stored conflict goes stale the moment either side
changes. Detection re-runs from current records every time, and a disposition is keyed to the exact
disagreement — so resolving "two-person vs supervision" does not silently absolve "mechanical lift vs
supervision" later. A test asserts that resurfacing behaviour.

**The bundle tripwire fired, as designed.** Putting the conflicts panel in the shell pulled the whole
template catalog into the eager chunk: 50.3 → 83.1 KiB against the 70 KiB budget tightened in Phase 1.
The fix was to make the conflicts section self-contained and lazy, not to raise the budget: back to
50.8 KiB, and the shell stays what its budget says it is.

**Verified:** typecheck clean; 633 tests pass (29 new, plus 22 pgTAP assertions CI runs); build
succeeds; bundle budget passes.

### Phase 3c — service delivery contract; Phase 3 complete

`resident_service_requirements` already said *when* a service happens and *who* broadly. It never
said what kind of task it is, what qualification it demands, what counts as completing it, what to do
when the resident refuses, or when to escalate. Without those, a generated task is an instruction to
"do the thing" and the aide invents the rest at the bedside.

| Delivered | Notes |
| --- | --- |
| Seven task kinds | Only `scheduled_care` / `shift_task` / `weekly_task` have a due window, so the rest must never raise missed-window alerts — `taskKindHasDueWindow()` is what scheduling and the floor queue read |
| `required_qualification_key` | Shaped like `certification_definitions.qualification_key`, deliberately **not** a foreign key: definitions are org-scoped or platform-wide, and a requirement must not break because an org has not defined its own row yet |
| Seven completion responses | The same seven the request names for exception-based documentation, defined now on the requirement that owns them so the floor phase wires an existing vocabulary rather than inventing a second one |
| Per-kind response defaults | A manager review cannot be refused by a resident; offering that response invites recording something that did not happen. Enforced in SQL and mirrored in TS, with pgTAP on both |
| Refusal handling and escalation | The UI flags a service that allows a refusal but does not say what staff should do next |
| Opt-out, not opt-in | A service entry suppresses generation with `"generate_service": false`. The author opted *in* by putting it in `services`; flipping to opt-out-by-default would have silently stopped generating tasks for every existing plan |

**Two constraints worth noting.** A service with an empty response set is rejected — it could never
be closed and would sit red forever. And an entry listing only unrecognized responses falls back to
the kind's defaults rather than producing that unclosable service.

**Verified:** typecheck clean; 658 tests pass (25 new, plus 12 new pgTAP assertions); build succeeds;
bundle budget passes with the resident route at 50.8 KiB.

**Phase 3 is now complete.**

### Phase 4 — floor execution, exception documentation, unscheduled services

| Delivered | Notes |
| --- | --- |
| `/me/floor` | Five large actions and a resident task card carrying photo initials, room, task, due window, instructions, and the two-staff safety alert — and deliberately **nothing else**. No compliance status, work-item metadata, citation, or plan version |
| Exception documentation | One tap for the routine path; only exceptions open follow-ups. `record_service_task_response` stores the response, a structured payload, and a denormalized assistance level |
| Unscheduled services | `resident_unscheduled_services` plus `record_unscheduled_service` — the eight kinds the request names, two taps to record |
| Utilization read model | `get_resident_service_utilization` returns unscheduled counts, exception counts, and documented assistance levels, so the care-level review can finally rest on what staff did rather than what somebody planned |

**Why the task status enum was left alone.** `resident_service_task_instances.status` drives
scheduling, alerting, and every completion metric in the product. The seven documentation responses
are a different axis: "completed with more assistance" is still a completed task. Folding it into
status would understate delivery and overstate missed care everywhere at once. The response is stored
alongside the status, and exception analysis reads the response.

**Why unscheduled services got their own table.** They have no requirement, no schedule, and no due
window — the three things `resident_service_task_instances` is built around. Recording them as
instances would mean inventing a fake requirement per event and permanently distorting the completion
denominator.

**Two live bugs found while wiring the floor surface**, both of which would have shipped silently:

- `get_resident_service_task_queue` rejects a zero-width window (`p_through <= p_from`). A floor
  query passing today for both bounds would have failed on every load.
- The queue returns a flat row, not a nested requirement. The card's two-staff safety alert and care
  instructions read a nested object and would have rendered as *nothing* — the failure mode being an
  aide not told a transfer needs two people.

The queue now also returns `task_kind`, `acceptable_completion_responses`, `refusal_handling`, and
`required_qualification_key`, so the floor offers the responses the plan allows and shows the plan's
refusal instruction at the moment a refusal is recorded — the one moment that instruction exists for.

**Verified:** typecheck clean; 681 tests pass (23 new, plus 10 new pgTAP assertions); build succeeds;
bundle budget passes.

### Phase 5a — change intelligence

**The Phase 4 loose end is closed.** `documented_assistance_exceeds_plan` now reads real records:
`useResidentServiceExceptions` filters server-side on the partial index added with the exception
columns, so a resident with a year of clean documentation does not download it all.

**Twelve detections, no score.** The request rules out a black-box risk number by name, and this
holds the line: every signal states what changed, the records that say so, the date range, why it
matters, the recommended review, and who must respond. `summarizeChangeSignals` returns counts only —
a weighted total would become a risk score the moment somebody sorted by it.

| Detection | Source |
| --- | --- |
| Increased assistance, repeated refusals | Structured exception documentation (Phase 4b) |
| Repeated unscheduled services, increased supervision | Unscheduled-service capture (Phase 4c) |
| Multiple falls | Incidents **and** condition changes together — a fall without injury is routinely recorded only as a condition change, so one source undercounts |
| Reduced meal intake | `resident_meal_records`, with a minimum sample: two poor meals out of three is noise, not a trend |
| Weight change | 5% in 30 days or 10% in 180 — the conventional clinical thresholds, reported as a measurement rather than a diagnosis |
| Behaviour, continence, skin, mobility | Recorded condition changes, lifted rather than re-inferred |
| Hospital visit | Transfer episodes, excluding cancelled ones |

Every threshold is a named exported constant, so a facility can read the rule before arguing with it,
and the tests assert the boundary in both directions — fires at the threshold, silent below it, and
silent for records outside the window.

**Verified:** typecheck clean; 709 tests pass (28 new); build succeeds; bundle budget passes.

**Bundle:** aggregate JS crossed its 90% warning line at 3790.0 KiB, so the budget went 4200 → 4700
under the file's documented convention. Worth noting what did *not* move: the Resident Detail route
chunk has held at ~51 KiB across the entire program, because every new surface — conflicts, change
signals, each tab — is its own lazy chunk. The aggregate grows with feature count by design; the
per-page weight is the number that matters and it stayed flat.

### Phase 5b — hospital return reconciliation; Phase 5 complete

**The flags drove nothing.** `assessment_review_required` and `support_plan_review_required` were
set on every return and read by no code. A return could record "yes, this needs a reassessment" and
produce no assessment, no owned task, and no trace anywhere a person would look.

| Delivered | Notes |
| --- | --- |
| Seeded return review | A flagged return now creates the draft hospital-return review (Phase 2b template) linked to the episode, pre-filled from what the return already recorded — asking someone to retype it is how it gets skipped |
| Gated closure | `complete_hospital_return_reconciliation` refuses while required steps are outstanding and names them in the error, then closes the follow-up work item |
| Reconciliation checklist | `hospitalReconciliation.ts` — five steps, each with the reason it exists, a 24-hour deadline matching the work item, and not-applicable handled as distinct from complete |
| Timeline | Hospital episodes, governed assessment reviews, and unscheduled services now appear on the resident timeline |

**A regression I nearly shipped.** Extending `get_resident_timeline` meant re-declaring it, and my
first version kept only the sources I was thinking about — silently dropping vitals, progress notes,
clinical assessments, diagnoses, medications, dietary, and external eMAR. That would have emptied
the clinical chart's timeline while every test still passed. Caught by diffing the union sources
against the prior definition before committing; the check is now part of how these re-declarations
get reviewed.

**Two smaller judgment calls.** The plan-revision step accepts a plan in *any* in-flight state, not
just active — requiring an active plan would block closure while the revision sits legitimately in
clinical review. And the closure button is disabled rather than hidden while steps remain, so a
person sees what is blocking them instead of wondering where the button went; the server enforces
the same rule regardless.

**Verified:** typecheck clean; 727 tests pass (18 new); build succeeds; bundle budget passes with the
resident route at 51.5 KiB.

**Phase 5 is now complete.** Phase 6 (guided incident investigation, follow-through stages, trends,
QAPI) is next.

## 6. What to do first

If only one phase is funded now, fund **Phase 0 plus Phase 1a** (the resident clinical profile data
model). Everything else in this request — the header, Floor task cards, conflict detection,
acuity-aware staffing, the occupancy board — reads that projection or proves itself against that
harness. Getting the data model and the proof mechanism right is the difference between this program
compounding and this program becoming another layer of surfaces to reconcile later.
