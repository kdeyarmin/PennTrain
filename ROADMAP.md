# CareMetric Train — App Review & Improvement Roadmap

*July 2026. Produced from a full codebase review (every page, hook, migration, and edge function) plus market and
regulatory research: 55 Pa. Code Chapters 2600/2800, PA DHS BHSL enforcement data, competitor scans of the
senior-care training and operations software markets, and operator pain-point research. Candidate features were
ranked from three perspectives — a PCH administrator, a compliance consultant/former surveyor, and a staff
engineer who knows this stack — then merged and stress-tested for completeness.*

> **Historical review:** This file preserves the original findings and
> recommendation rationale. The canonical forward delivery sequence is the
> [five-phase implementation plan](IMPLEMENTATION_PLAN.md).

---

## Part 1 — Where the app stands today

### What is genuinely strong

- **Security and data architecture.** ~60 migrations, 43 tables, RLS on every table with a consistent role
  matrix; tenant scoping stamped server-side by triggers (clients cannot spoof `organization_id`/`facility_id`);
  compliance-determining fields (grades, certificates, assignment status, roles) locked behind
  `SECURITY DEFINER` RPCs. The frontend deliberately mirrors RLS role-by-role on every page. This is hard to
  replicate and is the right foundation for a compliance product.
- **A real integrated training suite.** Versioned immutable courses, server-side quiz grading with a proper answer-key boundary,
  certificates with public `/verify/:slug` verification, training plans, competency checklists, live classes with
  sign-in sheets, and a working HeyGen AI-video pipeline.
- **Operational primitives no training-only competitor has.** The credential, incident, and inspection modules are complete
  CRUD with evidence documents, corrective actions, and alert wiring. Pure training vendors (Relias, CareAcademy,
  MedTrainer) do not own incidents/inspections; ops platforms (ECP, ALIS, August Health) do not own training.
  CareMetric Train already holds both sides' primitives — that is the strategic position to press.
- **Audit posture.** Audit-log triggers across write paths plus document-access logging give unusually strong
  survey-defensibility bones.

### The critical weakness: the headline compliance promise does not actually compute

The product's core claim — "we track your §2600.65 annual training hours" — is currently hollow:

| # | Defect | Where |
|---|--------|-------|
| 1 | `employee_training_hour_buckets` has **no writer anywhere** — permanently empty; `required_hours` hardcoded to 12 regardless of facility type (ALR needs 16, group homes 24) | schema + `recalculate_all_compliance()` |
| 2 | Training-type seed is **broken on fresh databases** — UPDATEs against codes (`DIRECT-ANNUAL`, `DEMENTIA`) that were never inserted; no PCH 12-hour, med-admin, orientation, or fire-safety system types exist, so Survey-Readiness med-admin/trainer checks pass vacuously | `20260704234451` migration |
| 3 | **Completing a training course never touches compliance** — no link exists between `courses` and `training_types`, so finishing the seeded "12-hour annual in-service" advances nothing | `complete_course_assignment()` |
| 4 | **New hires generate no "missing" requirement rows** — dashboards only score records that exist, so compliance percentages systematically overstate | recalc engine |
| 5 | **Practicums cannot be created in the UI** — the "Record Practicum" button has no `onClick`; `useCreatePracticum`/`useUpdatePracticum` are dead exports | `Practicums.tsx:36-38` |
| 6 | **No manual training-record entry form anywhere** — an administrator cannot record a paper in-service; `useCreateTrainingRecord` is only invoked by PendingApprovals | app-wide |
| 7 | **No training-type admin UI** — per-org PA rule configuration requires SQL | app-wide |

An operator relying on the app as-is would get burned at survey. Fixing this cluster is not a feature — it is
product integrity, and it gates everything else.

### The second structural gap: delivery

Every alert is **in-app only**, polled at 60 seconds, aimed at deskless aides who rarely log into a web app. The
Settings email/SMS toggles are decorative (no provider, no outbox, no delivery code), and
`organization_settings.default_warning_days` is saved but consumed by nothing. The graduated `due_90 → due_7`
alert ladder also never escalates: dedup keeps the first open alert per record, so severity stays `due_90` right
up to expiration. All three ranking perspectives independently called delivery either the #1 feature or the
multiplier for everything else.

### Trust and correctness debt (predates this roadmap)

- **Password reset is broken end-to-end** — the recovery email link dead-ends at `/login`; there is no
  set-new-password form. Fatal to adoption with high-churn staff.
- **The shipped Login page hardcodes six demo credentials** including a real seeded platform admin account,
  which is a full-platform compromise if bundled into production (`Login.tsx:70-75`).
- **`seed.sql` and `handle_new_user()` disagree**: the seed writes `role`/`organization_id` into
  `raw_user_meta_data`, but the hardened trigger reads `raw_app_meta_data` — a fresh reset provisions every demo
  user as a null-org `employee`.
- **Login derives the post-login role redirect from spoofable `user_metadata`** instead of the `profiles` table.
- `FacilityDetail` hardcodes `useRoute("/app/facilities/:id")`, so the `/admin/facilities/:id` mount shows
  "Facility not found" to platform admins.
- `PendingApprovals` renders Approve/Reject to auditors/trainers whose writes then fail at RLS (missing
  `canManage` gate); Alerts' incident/inspection deep links hardcode `/app/*` and break from `/admin`.
- `recalculate_all_compliance()` is **executable by any authenticated user**, mutates data across every tenant,
  and is called synchronously inside `complete_training_class()` — class completion is O(entire platform), a
  cross-tenant write-amplification/DoS surface. Statuses are otherwise stale up to 24h (`useRecalculateCompliance`
  is wired to nothing).
- The binder PDF **omits credentials, incidents, and inspections entirely**; certificates have `pdf_storage_*`
  columns and a dedicated bucket but the `generate-certificate-pdf` function was never written, and certificates
  never expire.
- Reports print raw employee UUIDs (practicum + hours reports); the three new report categories are missing from
  `catColors`; no date-range parameters; the Dashboard "Add Employee" quick action is a dead deep link;
  `bulk-import-employees` (deployed, working) has zero frontend callers.
- No mobile navigation (fixed 260px sidebar, `maximum-scale=1` viewport), no i18n, minimal AuditLog, Settings
  branding colors are persisted but never applied, and test coverage is one 3-case unit test against ~60
  security-sensitive migrations.

---

## Part 2 — What the market and the regulations demand

### PA enforcement data (what actually gets cited)

The PA DHS Bureau of Human Services Licensing 2025 annual report (published June 2026): **17,476 violations**,
averaging **11 per PCH annual inspection** and 12 per ALR inspection. Most-cited PCH violations:

| Rank | Regulation | % of inspections | App coverage today |
|------|-----------|------------------|--------------------|
| 1 | §2600.187 Medication records | 7.57% | Training angle only; practicums stubbed |
| 2 | §2600.65 Staff training & orientation | 5.40% | **Hollow** (see Part 1) |
| 3 | §2600.183 Medication storage/disposal | 5.34% | Inspection-item adjacent |
| 5 | §2600.132 Fire drills | 4.35% | **Absent** |
| 9 | §2600.225 Resident assessments | 3.67% | Absent (resident-side) |
| 10 | §2600.141 Medical evaluations | 3.54% | Absent (resident-side) |

For ALRs, §2800.65 training is the **#1** citation (6.88%) and fire drills #3 (6.02%). Complaint pressure is
intensifying: 2,236 complaints in 2025, **94% requiring on-site investigation** (up from 73% in 2024), and 49% of
complaint visits find *unrelated* violations — any complaint is effectively a surprise partial inspection, so
facilities must be inspection-ready every day, not annually. Medication errors alone were 12.76% of all reported
incidents.

### The regulatory map (requirements → software)

- **§2600.65 / §2800.65 training hours**: 12 hrs/yr PCH (max 6 OJT), 16 hrs/yr ALR *plus* an 18-hour initial
  training and competency test before unsupervised service, CPR/first-aid prerequisites. Day-1 fire-safety/EP
  orientation for *all* staff, substitutes, and volunteers; fuller orientation within **40 scheduled working
  hours**. Deadlines measured in hours and days — unrepresentable in the current annual-expiration model.
- **§2800.69 dementia training**: 4 hrs within 30 days of hire + 2 hrs annually, **in addition to** the 16 —
  requires separate additive hour buckets whose hours must *not* count toward the general requirement. PCH
  Secured Dementia Care Units (§2600.236) have the same shape (+8 hrs).
- **§§2600.64/2800.64 administrators**: 100-hour Department-approved course, competency test, **24 hrs/yr CE**
  with written verification submitted to the DHS regional office. The administrator's own file is the first thing
  pulled at inspection — and the administrator is the buyer.
- **§2600.190 medication administration**: Department course + performance test valid **2 years**; annual
  practicum; insulin requires a diabetes-education program within the past **12 months**; prescribed artifacts
  (written module exam, data summary sheet, signed training verification form).
- **§§2600.51–.52 hiring**: PSP (Act 34/PATCH) check for everyone; **FBI check when the applicant has under 2
  years of PA residency** (a classic citation trap); OAPSA provisional-employment window with documented
  supervision.
- **§§2600.16/2800.16 incidents**: ~19 reportable categories, report to DHS **within 24 hours** in the prescribed
  manner, followed by a final report; inspectors reconcile the home's incident log against what the regional
  office actually received.
- **§2600.132 fire drills**: monthly unannounced, sleeping-hours drill every 6 months, a **9-field prescribed
  written record** (DHS publishes the literal form), evacuation time set by a fire-safety expert in writing.
- **§2600.107 emergency preparedness**: written procedures, **annual review with the local emergency management
  agency** (dated proof), 3-day food/water supply.
- **§§2600.225/.227 resident assessment chain**: preadmission screening ≤30 days before admission, initial
  assessment ≤15 days after, support plan ≤30 days, annual reassessment, plus the §2600.141 medical-evaluation
  cycle — all on DHS forms (RASP).
- **DHS publishes the inspector's playbook**: the Entrance Conference Guide lists exactly what is requested on
  arrival (census demographics, ~20 screening questions, clearances, training records, drill logs, med-training
  records…), and the Regulatory Compliance Guide gives per-regulation measurement criteria. This is a ready-made
  product spec. DHS also grants waivers to use software in lieu of its paper forms (10 of 11 such waiver requests
  approved) — a future moat.

No 2600/2800 chapter rewrite surfaced for 2024–2026; recent activity is sub-regulatory guidance. The regs are
stable enough to encode.

### Competitive landscape

**Training/compliance platforms** (Relias, CareAcademy, MedTrainer, HealthStream, Smartlinx): the market moved
past standalone training players years ago. Decisive, review-cited capabilities: state-rules **auto-assignment** by
role/location/hire date (CareAcademy claims "95% admin time saved"); automatic **text/email reminders with
escalation** (CareAcademy's most-praised feature); **all-in-one compliance bundles** — training + policy attestations +
credentialing + incident reporting in one login (MedTrainer's entire pitch, Relias "Policy Pro"); accredited
state-specific libraries; audit-ready exports. Universal complaints: inflexible reporting and lost mobile course
progress — both cheap wedges. CareAcademy and Relias both ship full **Spanish** experiences.

**Operations platforms** (ECP, August Health, ALIS, Eldermark, PointClickCare, Yardi, Synkwise, StoriiCare):
anchor purchase for 5–50-bed operators is eMAR with pharmacy integration (ECP's 850+ pharmacy network is a
multi-year moat — do not chase it), then assessments→care plans, then incident reporting. August Health proved
"digitize the worst paperwork moment" (move-ins) as a wedge. **None of the eight embeds staff compliance training** —
the training layer is always a separate vendor. The whitespace CareMetric Train occupies is real, and it runs both
directions.

### Operator pain points (2025–2026)

- **Churn**: 34.5% overall assisted-living turnover, 43% for aides; each departure costs $3,500–5,000; half of
  first-year quits happen inside 90 days. 96% of communities report staffing shortages; 75% use agency staff —
  whose orientation compliance is a blind spot inspectors probe (the regs explicitly cover substitutes and
  volunteers).
- **Survey anxiety**: administrators run whiteboards and spreadsheets to answer "who is due for what," and
  personally chase expirations (est. 3–4 hrs/week). Surveyors work regulation-by-regulation; operators file
  person-by-person — the translation between the two is manual today.
- **Deskless staff**: SMS open rates ~98% vs 20–30% for email; aides will never poll a web dashboard.
- **Documentation burden**: ~4 hrs/week lost per care team to toggling disconnected systems.

---

## Part 3 — Prioritized roadmap

Efforts: **S** = days, **M** = 1–2 weeks, **L** = multi-week. Sequence within each tier is deliberate.

### Tier 1 — Trust & integrity quick wins (each S; ~2–3 weeks total)

1. **Trust & correctness bug sweep** *(prerequisite to everything)*
   Build the missing `/reset-password` route (handle the `PASSWORD_RECOVERY` session, `supabase.auth.updateUser`);
   strip the hardcoded demo credentials from `Login.tsx` and rotate/remove the seeded platform_admin account; fix
   `seed.sql` to write role/org into `raw_app_meta_data` so `handle_new_user()` provisions correctly; read the
   post-login role redirect from `profiles`, not spoofable `user_metadata`; make `FacilityDetail` and the Alerts
   deep links base-path aware; add the missing `canManage` gate to `PendingApprovals`.

2. **Manual training-record entry + training-type admin UI** — wire the dead hooks.
   "Record Training" dialog on EmployeeDetail and TrainingMatrix cells (type, completion date, hours, trainer,
   evidence doc) using the existing `useCreateTrainingRecord`; a training-types admin page on the dead
   `useCreateTrainingType`/`useUpdateTrainingType` exports (renewal interval, required hours, warning days,
   `applies_to_*` flags); repair the broken seed migration and add the missing PCH 12-hour, med-admin,
   orientation, fire-safety, and CPR system types. *This is wiring, not building — and it is the prerequisite for
   the Tier 2 engines.*

3. **Un-stub Practicums CRUD.** Give "Record Practicum" an onClick → create/edit dialog on the never-called
   hooks; `canManage` gating; year selector. The recalc engine already grades practicum rows once they exist.
   (The full lifecycle ledger is Tier 2 — this just makes the sold feature creatable.)

4. **Certificate PDF generation.** One `generate-certificate-pdf` edge function on the proven
   pdf-lib + signed-URL pattern; fills the already-built `pdf_storage_*` columns and service-role-only
   `certificates` bucket; QR of the `/verify` slug; surfaced in MyCertificates and CourseAssignments. *Expiry
   dates land with the Tier 2 course↔training-type mapping — do not invent them here.*

5. **Reporting quality pass.** Join employee names into the practicum/hours reports that print raw UUIDs; add the
   three missing categories to `catColors`; add date-range parameters to `buildReport()`. Weak reporting is the
   #1 stated complaint against every incumbent — CSVs with UUIDs are unusable as surveyor-facing documents.

6. **Fire drill & emergency-preparedness logger** *(S–M — the DHS-form PDF puts it closer to a week)*
   A drill subtype on the existing inspection_items/inspection_events module: monthly unannounced drill scheduler
   with shift/exit rotation, 6-month sleeping-hours tracker, a form enforcing all nine required record fields,
   PDF output on the official DHS Fire Drill Record form, and the fire-safety-expert evacuation-time letter as an
   annually-expiring document. Include the §2600.107 EP lifecycle the same way: EP-plan annual review with
   EMA-submission proof and 3-day supply checks as recurring, expiring items. Fire drills are the #5 PCH / #3 ALR
   citation — a purely documentary failure software nearly eliminates.

7. **Wire orphaned plumbing.** CSV-upload dialog on Employees calling the deployed-but-callerless
   `bulk-import-employees` function (with per-row results); make `?action=add` actually open the add-employee
   dialog; facility filter + cutoff on PendingApprovals' New Submissions tab.

8. **Minimal test harness.** pgTAP (or SQL-fixture) tests for the RLS role matrix and the recalc/hours functions,
   plus a few edge-function integration tests. Tier 2 rewrites the most security-sensitive surface in the product;
   a thin harness materially de-risks it. One 3-case test file cannot gate that work.

### Tier 2 — High-impact features (each M unless noted)

1. **Email/SMS notification delivery engine** — *the unanimous #1 multiplier.*
   Outbox table + delivery edge function (Twilio SMS via a registered A2P 10DLC campaign; SendGrid email)
   driven by the already-enabled `pg_cron`/`pg_net`, consuming the existing alerts/notifications tables.
   Per-user channel + consent capture (TCPA: training reminders are informational, but consent, STOP handling,
   and quiet hours are still mandatory), magic-link deep links into courses, supervisor escalation when staff
   nudges go unanswered, a Monday org-admin digest ("3 staff expire in 14 days; night-shift fire drill due
   Friday"), and a per-staff delivery log that doubles as evidence of diligent administration. Make the decorative
   Settings toggles and `default_warning_days` real. **Includes the alert re-bucketing fix** so severity actually
   escalates (due_90 → due_30 → due_7) as deadlines approach — without it, SMS nudges would carry stale urgency.

2. **Annual training-hours engine + training-compliance bridge** — *make §2600.65 real.*
   Prerequisite sub-task: **a `courses.training_type_id` mapping** (plus seed updates linking the system courses
   to the training-type catalog) — no bridge exists today in either direction. Then: extend the recalc engine to
   aggregate hours into `employee_training_hour_buckets` from training records, class completions, and course
   completions; **support multiple concurrent buckets per employee-year** (general annual + ALR dementia §2800.69
   + SDCU §2600.236) with additive/exclusive accounting; required hours by facility type (PCH 12 / ALR 16 / GH
   24); the 6-hour OJT cap; per-topic coverage flags ("hours met but no dementia training"); bridge
   `complete_course_assignment()` to create the matching training record; minimum seat-time/completion-integrity
   controls so a "12-hour" course clicked through in 90 seconds is not defensible evidence.
   **Includes recalc hardening** (required, not optional): authorization on `recalculate_all_compliance()`
   (cron/platform_admin-only), an org-scoped incremental recalc path, decoupling `complete_training_class()` from
   the global recalc, and an on-demand org refresh so statuses stop being 24h stale.

3. **PA rulepack / requirement auto-assignment engine.**
   A trigger on `employees` + recalc extension that consumes the existing (unconsumed) `training_types.applies_to_*`
   metadata to instantiate "missing" training records, credential shells, practicum rows, and hour buckets on
   hire, role change, or new requirement — per license type (2600 vs 2800 profiles). Make training-type-targeted
   training-plan items actually create records (inert today). Design with a state dimension so future multi-state
   packs are additive data, not code. Auto-assignment is the decisive CareAcademy/Relias feature, and nothing
   today creates "missing" rows — compliance scores silently overstate until this lands.

4. **Med-admin certification & practicum lifecycle ledger.**
   Extend practicums into the full DHS lifecycle: course + performance test on a 2-year clock; annual practicum as
   rolling 6-month windows (2 observations + 2 MAR reviews); a separate 12-month diabetes-education clock gating
   an "insulin-authorized" badge; storage of the prescribed DHS artifacts as evidence documents; a
   qualified-observer roster; and a facility-level **"who can legally pass meds today"** view — a daily staffing
   question no competitor answers. Medication regs dominate PA citations (#1, #3, #6).

5. **24-hour reportable incident workflow.**
   Map the 10 incident types to §2600.16/§2800.16 reportability presets that auto-create the 24-hour notification
   rows; render the prescribed DHS Reportable Incident Form as a pre-filled PDF; capture submission
   channel/time/recipient; track the required final report; keep a reconciliation register (inspectors literally
   diff the home's log against the regional office's); add a `corrective_action → course_assignment` link so
   involved staff get proposed retraining tied to the incident — corrective-action evidence only a training-first
   platform can close natively.

6. **Policy & procedure attestation with ESIGN/UETA audit trail.**
   An attestations table (profile, document version hash, timestamp, IP, auth method) over existing versioned
   document storage; read-and-attest campaigns assigned by role/facility (reusing the training-plan fan-out);
   re-attestation on new versions or annually; delinquency dashboard; logs flow into the binder; reminders ride
   the notification rail. No DocuSign dependency — ESIGN/UETA needs intent, consent, attribution, and the audit
   row. MedTrainer wins deals on exactly this bundle.

7. **Background-check & clearance workflow + automated exclusion screening.**
   Decision logic on the credential module: the "PA resident for the 2 preceding years?" question auto-flagging
   the FBI requirement; OAPSA provisional-employment countdown with supervision attestation; documented
   suitability determinations; PATCH/CNA-registry verification logging. Plus a monthly pg_cron job ingesting the
   free OIG LEIE CSV and calling the free SAM.gov Exclusions API, fuzzy-matched against the roster into a review
   queue — near-zero marginal cost, high perceived value for Medicaid-waiver exposure.

8. **Administrator qualification & CE tracker** *(S)*.
   The administrator's own credential profile: 100-hour course record, competency test, rolling 24-hour annual CE
   bucket with per-entry source capture, the written-verification-to-regional-office task with stored proof, NHA
   exemption path. The buyer's personal file is the first thing pulled at inspection — disproportionate loyalty
   per build-hour.

9. **QR-code class check-in with kiosk mode.**
   Rotating short-lived signed token rendered as a QR in ClassDetail; staff scan to check in (magic-link auth) or
   use a PIN-gated kiosk on a facility tablet; check-in/out timestamps on `training_class_attendees` compute
   verified seat time feeding `complete_training_class()` and the hour buckets. Saves 30–60 min of sign-in-sheet
   transcription per class and produces stronger §2600.65(i) evidence than a signature list. *Placed in Tier 2
   because it needs magic-link auth and timestamp columns that don't exist yet; a minimal instructor-entered
   timestamp roster could ship with Tier 1's wiring sweep.*

### Tier 3 — Strategic bets (L)

1. **DHS inspection-readiness dashboard + one-click entrance-conference packet ("Binder 2.0").**
   Citation-tag columns mapping training types, documents, credentials, and inspection items to their 2600/2800
   reg numbers; a per-regulation readiness score weighted by actual BHSL citation frequency; rebuild
   `generate-compliance-binder` to cover credentials/incidents/inspections (omitted today) and order output by
   regulation, mirroring the DHS Entrance Conference Guide item-by-item; mock-inspection mode with the guide's
   ~20 entrance questions; one-click packet with embedded evidence. Surveyors work reg-by-reg while operators
   file person-by-person — this feature is the translation layer, and no competitor generates a live
   entrance-conference packet. Sequenced after Tier 2 because the readiness score must be honest.

2. **Violation → Plan-of-Correction workflow.**
   Enter cited violations from an inspection → generate a POC with corrective tasks, linked retraining
   assignments, responsible parties, and completion dates → produce the formatted POC document → track evidence
   for the follow-up visit. ~80% of full inspections find violations, so nearly every customer writes a POC every
   year. Natural companion to the readiness dashboard (all three judges ranked it).

3. **New-hire onboarding fast-track with cleared-for-duty gating.**
   Per-hire checklist instantiated on employee creation (rides the rulepack engine): day-1 fire-safety/EP
   orientation as a blocking task; the 40-scheduled-working-hour orientation clock (**computed from
   scheduled-hours-per-week captured at hire** — no scheduling module implied); ALR 18-hour initial training +
   competency test before unsupervised service; 4-hour dementia training within 30 days; CPR-before-care checks;
   a phone-completable e-sign onboarding packet feeding the credential tracker; a hard
   `cleared_for_unsupervised_duty` gate; agency/substitute/volunteer rapid-orientation profiles (an inspector
   blind spot); 7/14/30/60/90-day check-in prompts for retention. Orientation deadlines are measured in hours and
   days — the current annual-expiration model cannot represent them — and half of first-year quits happen inside
   90 days.

4. **Mobile-first employee training experience.**
   Responsive navigation (the sidebar is a fixed 260px `aside` today), an employee "My Training" list (assignments
   without due dates are unreachable today), an installable PWA training workspace with reliable progress
   checkpointing, 5–10-minute lesson chunking with SMS magic-link drip, wiring the dead
   `in_progress`/`overdue` statuses, removing `maximum-scale=1`. Sequenced after the hours engine's seat-time
   controls (easy micro-completion would otherwise aggravate the completion-integrity problem). Relias and
   CareAcademy are punished in reviews specifically for losing mobile progress.

5. **Resident compliance-date registry** *(RASP deadlines only — hard no-EHR guardrail).*
   A deliberately minimal residents table (name, room, admission date, SDCU/hospice flags) driving the deadline
   chain: preadmission screening, 15-day initial assessment, 30-day support plan, annual reassessment, the
   medical-evaluation cycle; completed DHS RASP/DME PDFs stored via existing document storage; census
   demographics feeding the entrance-conference packet. Explicitly no charting, no eMAR, no care plans. Resident
   assessments (#9) and medical evaluations (#10) are the largest citation surface the product doesn't touch, and
   the census is the first entrance-conference request. Also opens the DHS forms-waiver path (10 of 11 approved).

### Deliberately not recommended / deferred (with reasons)

| Idea | Verdict | Why |
|------|---------|-----|
| eMAR / resident clinical records | **No** | ECP's 850+ pharmacy-integration network is a multi-year moat; segment saturated; patient-safety liability the schema deliberately avoids. Own the staff compliance record, not the resident clinical record. |
| Qualification-gated shift scheduling | **Built** (basic scheduling; qualification-gating still deferred) | The employees-single-facility blocker this line cited is resolved: `employee_facility_assignments` is the facility join table for the roster (mirrors the existing profile-level `facility_assignments`), additive alongside `employees.facility_id` as the home/primary facility. On top of that, a shift-scheduling module shipped -- `facility_units` (wings), `shift_definitions` (typical shift templates), `employee_schedule_preferences` (each employee's typical shift/unit pattern), `schedules` (draft/published periods), and `shift_assignments`, with a `generate_schedule_assignments` auto-fill RPC that prioritizes each employee's typical pattern so a manager isn't arranging every cell by hand. `/app/schedule` (org_admin/facility_manager) and `/me/schedule` (employee, published shifts only) in the frontend. Still out of scope: cross-checking a shift assignment against the employee's actual training/med-admin qualification before scheduling them (the "qualification-gated" half of this line) -- today `owns_employee`/roster membership is the only gate, not compliance status; an employee is capped at one shift per calendar date across every facility (no same-day float) as the simplest anti-double-booking rule. |
| Building a NAB-accredited content library in-house | Partner instead | Accreditation is a 12+ month content/regulatory business initiative, not a software feature. What survives inspection is the CE-hour *tracking*. Resell/integrate an approved provider; keep HeyGen for non-accredited in-service content. |
| AI course drafter from policies / policy Q&A tutor | Drafter: **Built**; Q&A tutor: Defer | The course-drafter half shipped as `platform_admin`-only AI curriculum generation (Anthropic Claude, forced tool-use), grounded in optional pasted source material to curb hallucination risk, gated by a mandatory self-review acknowledgment enforced at the database level (no platform_admin bypass) before a version can publish, with a full audit trail via `course_ai_generations` -- the review-gate workflow this line was waiting on now exists. A freeform policy Q&A tutor remains deferred; open-ended chat over policy documents is a different, still-unaddressed hallucination surface. |
| SCORM import/player | Defer | Small PCHs rarely own SCORM content; it's a training-system evaluation checkbox for upmarket switchers. Feasible later without licensing (scorm-again + an edge-function commit endpoint) — nothing is lost by waiting. |
| Multi-state regulation packs | Defer | The PA pack itself doesn't function yet. Design the Tier 2 rulepack engine with a state column so packs become additive data later; earn the abstraction after PA works. |
| Family portal / activity calendars / engagement suite | **No** | Bloat tier for 5–50-bed operators per review evidence; StoriiCare and Icon own the category; requires resident data the product deliberately lacks. |
| Spanish / i18n | Defer (revisit soon) | Competitively validated (CareAcademy's flagship Spanish UX; Relias's translated aide library) and workforce-fit, but it's a large cross-cutting retrofit; sequence after the notification rail and mobile experience so there is a Spanish experience worth translating into. |
| Regulatory update feed; portable training passport | Defer | Nice-to-haves; no citation risk attached; revisit post-Tier-3. |

### Suggested sequence

**Tier 1 in one pass** (integrity + trust, ~2–3 weeks) → **notifications + hours engine** (the multiplier and the
core promise, in either order or interleaved) → **rulepack → med-admin ledger → incident workflow** (the
citation-frequency leaders) → **attestations, background checks, admin CE, QR check-in** → Tier 3 starting with
**readiness dashboard + POC workflow** (the renewal-driving differentiator), then onboarding, mobile, and the
resident registry.

The through-line: CareMetric Train's defensible position is **"the system of record for staff compliance in PA
personal care homes and assisted living residences — inspection-ready every day."** Every recommended feature
either makes the existing promise true (Tiers 1–2) or makes the surveyor-facing story undeniable (Tier 3);
everything that drifts toward being an EHR, a scheduler, or an engagement suite is explicitly out.

---

## Key sources

- 55 Pa. Code Ch. 2600 & 2800 (training §§65/69, administrators §64, med admin §190, hiring §§51–52,
  incidents §16, fire drills §132, EP §107, assessments §§225/227) — pacodeandbulletin.gov
- PA DHS BHSL Annual Report 2025 (June 2026) — violation/citation/complaint/incident statistics — pa.gov
- PA DHS Entrance Conference Guide & Regulatory Compliance Guides (PCH/ALR); DHS Fire Drill Record form;
  Medication Administration Training Program — pa.gov
- Competitor materials & reviews: CareAcademy, Relias (Policy Pro), MedTrainer, HealthStream, Smartlinx, ECP,
  August Health, ALIS, Eldermark, PointClickCare, Yardi, Synkwise, StoriiCare, Icon (G2/Capterra)
- Workforce: AHCA/NCAL staffing surveys; OnShift/Activated Insights turnover data; Argentum 2026 workforce report
- Technical: Twilio TCPA/A2P 10DLC compliance docs; OIG LEIE monthly database & SAM.gov Exclusions API;
  ESIGN/UETA e-signature elements; JMIR microlearning studies
