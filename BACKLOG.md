# CareMetric CareBase — Living Backlog

**Status:** Canonical forward backlog  
**Last verified against main:** `b7d734b` (2026-08-01) — residual gaps PR #351  
**Owner:** product + engineering  
**How to update:** edit this file in the same PR that ships or retires work; bump “Last verified” and ticket status. Do not create parallel root review markdown.

---

## Authority and supersession

This file is the **single living backlog** for near-term product and engineering work.

| Document | Role now |
| --- | --- |
| **[BACKLOG.md](BACKLOG.md)** (this file) | Canonical open work, ordered by pilot readiness |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Long-horizon five-phase program; not the daily backlog |
| [CONTROLLED_PILOT_RUNBOOK.md](CONTROLLED_PILOT_RUNBOOK.md) | Live pilot evidence procedure |
| [ROADMAP.md](ROADMAP.md) | **Historical** review (July 2026). Many “broken” claims are stale |
| [EFFICIENCY_REVIEW.md](EFFICIENCY_REVIEW.md), root `PennTrain_*Review*`, `*_Backlog_Delta_*`, `ENHANCEMENT_REPORT.md`, `FEATURE_FUNCTIONALITY_ENHANCEMENT_REPORT.md` | **Superseded** as planning sources — keep for archaeology only |
| [docs/design/POC_LIFECYCLE.md](docs/design/POC_LIFECYCLE.md) | Plan-of-Correction vertical design |
| [docs/design/SCORM_PRODUCTION_HARDENING.md](docs/design/SCORM_PRODUCTION_HARDENING.md) | SCORM production PR plan |
| [docs/LEARNING_PACKAGE_BRIDGE.md](docs/LEARNING_PACKAGE_BRIDGE.md) | SCORM/xAPI bridge contract (shipped) |

If a root review contradicts this file or code on `main`, **trust code + this backlog**.

---

## Snapshot (what is true on main today)

### Shipped and credible (do not re-litigate)

- Multi-tenant CareBase SPA + Supabase (RLS, Auth, Storage, Edge Functions, pg_cron)
- Flat billing model (Train / CareBase); Stripe qty=1 intent
- Pilot cohort console + release flags / kill switches
- Learning package runtime bridge (opaque iframe, nonce, `event.source`, commit sequencing) with unit, integration, and Chromium e2e proof
- Multi-domain Data Import Center: **all 8 domains active** (employees, training_records, credentials, rooms, residents, resident_contacts, assessments, incidents)
- Survey evidence packet zip + guest download path
- Credential OCR structured extraction path
- Violations → corrective actions → retraining assignment → POC PDF → status ladder (`open` → `poc_submitted` → `corrected` → `verified`)
- Clinical/EHR hybrid (native chart + FHIR ingest) with opt-in posture — see `docs/HIPAA_CLINICAL_DATA.md`
- Dense ops surface: Survey Day, Work Queue, Training Matrix, Today, binder, evidence room, lifecycle cases, invitations

### Still open (highest risk first)

1. **Live pilot evidence** against a non-demo org (runbook + manifest)  
2. **Stripe Prices mapped** and internal checkout smoke  
3. **SCORM production hardening** (bundle adapter, handshake failure UX, vendor golden package)  
4. **Notification providers on by default** for pilot cohort (email digest + SMS consent)  
5. **POC lifecycle depth** (immutable versions, effectiveness gate, work-item auto-link)  
6. **Durable import worker** (browser-close safe)  
7. **Home IA density** (too many “homes”)  
8. Wave 3/4 verticals: policy campaigns, fire-drill DHS form, med-admin “cleared today” board, offline floor drafts  

---

## Ticket register

Status values: `open` · `in_progress` · `blocked` · `done` · `ops_only`  
Size: `S` days · `M` 1–2 weeks · `L` multi-week  

### Tier A — Pilot / revenue locks (do first)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; verify migration stamp | S | ops_only | Code on main; production apply is ops |
| A2 | Map flat Stripe Prices; internal checkout smoke with qty=1 | S | ops_only | See BILLING_MODEL.md launch checklist |
| A3 | Enroll one real pilot org; enable cohort flags deliberately | S | ops_only | Pilot console exists |
| A4 | Run controlled pilot journeys; fill evidence JSON | M | ops_only | CONTROLLED_PILOT_RUNBOOK.md |
| A5 | BAAs / HIPAA-eligible tiers confirmed for live pilot path | S | ops_only | Partial; clinical path needs legal confirm |

### Tier B — SCORM production hardening

See full plan: [docs/design/SCORM_PRODUCTION_HARDENING.md](docs/design/SCORM_PRODUCTION_HARDENING.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| B1 | Bundle `learning-runtime-bridge.js` into accepted package zip at accept time | M | open | Host-fetch fails on facility LAN / PNA |
| B2 | Handshake timeout + learner-visible recovery in `StandardsRuntimePlayer` | S | open | Silent failure today if adapter never loads |
| B3 | One Storyline + one Captivate golden fixture package in repo | M | open | Fixture proves contract; vendor tools prove market |
| B4 | Bridge SCORM complete → training record / hour bucket | M | open | Credibility for §2600.65 |
| B5 | Trainer package quarantine UX (reject reason + re-upload) | S | open | Accept/quarantine RPCs exist |

### Tier C — Plan of Correction depth

See full design: [docs/design/POC_LIFECYCLE.md](docs/design/POC_LIFECYCLE.md)

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| C1 | Immutable POC versions on submit (append-only history) | M | open | Today: living PDF only |
| C2 | Effectiveness gate before `verified` | M | open | Block verify until tasks complete + review |
| C3 | Auto work_items from open corrective actions | S | open | Reuse work-item engine |
| C4 | POC due-date escalation into manager digest / SMS | S | open | Needs notification rail on for pilot |
| C5 | Entrance-conference ordered packet by reg number | M | open | Survey Day companion |

### Tier D — Delivery & imports

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| D1 | Monday manager digest email for pilot orgs | S | open | Low PHI; high “wow” |
| D2 | Turn on due/overdue/approval notifications for pilot cohort | S | open | Flags + providers |
| D3 | Durable import worker (stored CSV, resume after browser close) | M | open | Import center otherwise solid |
| D4 | Column mapping UI for non-canonical CSVs | M | open | Optional after D3 |
| D5 | Sample realistic PA facility CSVs in Help / Import Center | S | open | Onboarding friction |

### Tier E — Daily operations wedges

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| E1 | Home IA: Today = action, scorecard = health, Command Center = survey | S | open | Reduce “which dashboard?” |
| E2 | Med-admin “who can pass meds today” board on Schedule | M | open | MedAdminRoster × schedule join |
| E3 | Fire drill DHS 9-field form + monthly tracker PDF | M | open | #5 PCH / #3 ALR citation |
| E4 | Policy campaign center (version pin, targets, knowledge check) | L | open | MedTrainer deal-breaker |
| E5 | Offline service documentation drafts (IndexedDB) + conflict rules | L | open | Floor staff |

### Tier F — Engineering hygiene

| ID | Ticket | Size | Status | Notes |
| --- | --- | --- | --- | --- |
| F1 | Split pages >40 KB before feature work (`CourseDetail`, `ResidentFinancialOperations`, `ResidentAssessmentFormEditor`) | M | open | Velocity insurance |
| F2 | Finish route-manifest ownership of sidebar/search/modules | M | open | Partial today |
| F3 | Replace root README marketing handoff with product + agent runbook | S | open | AGENTS.md already good for agents |
| F4 | Banner stale root reviews as historical (optional cleanup PR) | S | open | This backlog already supersedes |

---

## Explicitly not now

| Item | Why |
| --- | --- |
| Capability bundles / config release envelope | Enterprise; post-portfolio |
| Vendor external portal | Until maintenance is top pilot pain |
| Full Spanish i18n retrofit | After SMS + mobile proven |
| Multi-state rule packs | PA must be proven first |
| Expanding Essentials/Pro SKUs | Need conversion data |
| Competing on pharmacy eMAR network | Multi-year moat elsewhere |
| New root “comprehensive review” markdown | Update **this** file instead |

---

## Suggested two-week sequence

**Week 1 — Live truth:** A1–A4  
Goal: one non-demo org can invite staff, complete a course, export binder, receive one email.

**Week 2 — Demo-killer reliability:** B1–B2, D1–D3  
Goal: SCORM works without host-fetched adapter, import survives closed laptop, manager gets Monday digest.

Then open C1–C2 (POC depth) as the first *new* product vertical.

---

## Verification contract for any backlog ticket marked `done`

1. Code on `main` (or merged PR linked in the row notes)  
2. Relevant unit / edge / e2e tests pass in CI  
3. If user-visible: pilot or demo org exercise recorded  
4. This file updated in the same change set  

Ops-only rows close when runbook evidence exists outside the repo (do not commit customer data).
