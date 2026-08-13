# CareBase / Train visibility one-pager

**Audience:** sales, CS, pilots  
**Source of truth in product:** `productModules.ts` (package gates) + `appDomains.ts` (role pages) + sidebar filtering

---

## Three personas at a glance

| | **Train-only facility manager** | **CareBase facility manager** | **Employee (learner)** |
|--|--------------------------------|-------------------------------|-------------------------|
| **What they bought / use** | CareMetric Train | Full CareBase suite (includes Train, Workforce, Compliance, Billing) | Whatever the facility runs; they only ever see *their* work |
| **Default home** | Training matrix | **Today** — daily command center | **My day** — personal inbox |
| **Sidebar brand** | Train Learning Platform | CareBase Platform | Same shell; employee nav only |
| **Daily focus** | Assign and track training | Clear due work, alerts, coverage, survey prep | Finish overdue training, signatures, and shift tasks |

---

## What each person sees

### Train-only facility manager

**Included**

- Facilities & employees (roster)
- Training matrix, courses, assignments, plans, in-service classes
- Pending approvals, own training
- Users, settings, help (core admin shell)

**Not included (hidden, not disabled-looking clutter)**

- Today command center, operational work queue, alerts risk board
- Residents, admissions, care delivery, survey day, inspection readiness
- Credentials / background / exclusion / schedule (Workforce pillar)
- Incidents, violations, compliance binder, documentation room as CareBase ops surfaces

**Sales line:** *“They manage learners and proof of training — not the full facility operations desk.”*

---

### CareBase facility manager

**Starts on Today** with:

- Overdue / due / urgent work (same definitions as the Work queue)
- Critical and open alerts
- Coverage gaps and open handoffs when daily ops data exists
- Soonest-due work list and work grouped by source

**Primary nav (expanded by default)**

- Start here · People · Training · Credentials · Residents & care · Safety & survey

**Collapsed by default (still fully available)**

- Advanced — scorecard, command center, value center, plans/templates, binder, reports, regulatory tools
- Admin — users, settings, billing (org admin), audit, help

**Sales line:** *“One morning screen for action; everything else is one expand away, never in the way.”*

---

### Employee

**Sees only their own data**

- Merged “Do these next” list: courses, training records, practicums, policy signatures by due date
- Compliant / due soon / expired training counts
- Next published shift
- Certificates, credentials, documents, attestations
- Floor / shift / services / resident chart when CareBase is enabled for the facility

**Never sees**

- Coworker rosters as a management tool
- Facility-wide alert boards or work queues (except items assigned to them under My work)
- Billing, survey command, or admin configuration

**Sales line:** *“Phone-friendly checklist: what’s due for me, when’s my shift, where’s my proof.”*

---

## Package dependency (quick reference)

| Module | Typical surfaces |
|--------|------------------|
| **Core** (always) | Facilities, employees, users, settings, help, account |
| **Train** | Matrix, courses, assignments, plans, trainer classes, certificates |
| **Workforce** | Credentials, competencies, screening, schedule, practicums |
| **Compliance** | Survey day, inspections, violations, policies, evidence, QAPI |
| **Billing** | Resident finance |
| **CareBase** | Full suite + Today, work queue, residents, admissions, care delivery, etc. |

Buying **CareBase** grants Train + Workforce + Compliance + Billing automatically.

---

## Demo path (10 minutes)

1. **Employee** — show “Do these next” and complete one course or attestation.  
2. **Train-only FM** — training matrix + assign a course; note absence of Today/residents.  
3. **CareBase FM** — Today cards → click overdue into Work queue → Survey Day / binder under Advanced if asked.  
4. Toggle language: *hidden because not in package*, not *grayed out forever*.

---

## Objection handlers

| Objection | Response |
|-----------|----------|
| “Managers need everything on one screen.” | Today is the action screen; Advanced holds configuration and deep analysis so the daily scan stays short. |
| “Train customers will feel limited.” | They get the full learning loop (assign → complete → certificate) without paying for clinical ops they do not use. |
| “Employees might miss facility alerts.” | Risk alerts are manager-owned; employees get direct due-work and optional SMS/email reminders from notification settings. |
