# QA script: Today, Work queue, Alerts, and Employee Home

**Purpose.** Confirm metric definitions stay single-sourced, facility scope is consistent, package/role gates hide unavailable surfaces, and the employee deadline merge is complete.

**Prerequisites**

- CareBase org with at least one facility and one facility manager assigned to it
- Open work items in mixed states (`open` / `in_progress` / `closed` / `canceled`) with due dates: overdue, today, within 7 days, beyond 7 days
- At least one open critical alert and one open non-critical alert
- Unfilled shift and/or open handoff data if daily-ops seed is available
- Employee user linked to an `employees` row with:
  - incomplete course assignment with due date
  - training record `due_soon` or `expired`
  - pending policy attestation with due date
  - optional practicum due this year
- Train-only org (or facility with only `modules.train`) for package gating checks

---

## A. CareBase facility manager — Today vs Work queue vs Alerts

| # | Step | Expected |
|---|------|----------|
| A1 | Sign in as facility manager → land on `/app/today` (or navigate there) | Sidebar brand says **CareBase Platform**. Today is the primary home. |
| A2 | Note facility picker | Only assigned facilities. Default is first assigned (not “all”). |
| A3 | Record the four work-related cards: Overdue work, Due today, Due within seven days, Urgent work | Each card shows a scope label (facility name). Hover Info shows definition text from `homeMetrics`. |
| A4 | Click **Overdue work** | Lands on `/app/work` with overdue filter + facility scope. Count of overdue rows matches Today’s overdue card. Closed/canceled excluded. |
| A5 | Click **Due within seven days** (or open Work queue scoped to facility) | Active items due before facility end-of-day + 7 match Today’s “due this week” number. |
| A6 | Click **Urgent work** | Work queue priority=urgent list count matches Today. |
| A7 | Click **Critical alerts** | `/app/alerts` shows open + critical in the same facility scope. Count matches Today. |
| A8 | Click **Open alerts** | All open severities in scope match Today’s open alerts card. |
| A9 | On Today, open **Next work to complete** | Top items ordered by `due_at` ascending; max 8; only non-closed/canceled. Each links to `/app/work/:id`. |
| A10 | On Today, **What the work is** groups | Category totals sum to active open work count for the scope. Badge links preserve facility scope. |
| A11 | Switch facility (if multiple assignments) | All cards, soonest list, and groups recompute for the new facility. Session storage keeps selection on reload. |
| A12 | Confirm course assignments that are **not** work items | Do **not** appear as numbers on Today unless elevated into the work-item queue. |

### Pass criteria (A)

- No metric on Today disagrees with Work queue / Alerts for the same scope and definition.
- Facility managers never see another facility’s counts.
- Definitions are visible on hover for every card.

---

## B. Org admin / auditor portfolio scope

| # | Step | Expected |
|---|------|----------|
| B1 | Org admin on Today with **All permitted facilities** | Scope label is “all permitted facilities”. Counts are portfolio-wide. |
| B2 | Narrow to one facility | Counts drop to that facility only; Work queue links include `facilityId`. |
| B3 | Auditor Today | Read-oriented primary CTA; still uses same metric definitions and work/alerts hooks. |

---

## C. Train-only facility manager — package gate

| # | Step | Expected |
|---|------|----------|
| C1 | Sign in as FM on Train-only package | Default home is **Training matrix** (`/app/training-matrix`), not Today. |
| C2 | Try `/app/today`, `/app/work`, `/app/alerts`, `/app/residents`, `/app/survey-day` | Hidden from sidebar; direct URL redirects or falls back via module home (no CareBase command surfaces). |
| C3 | Sidebar | Brand subtitle **Train Learning Platform**. Core + Train items only (facilities, employees, courses, assignments, plans, pending approvals, help). |

---

## D. Employee Home — deadline merge

| # | Step | Expected |
|---|------|----------|
| D1 | Sign in as employee → `/me` | Title **My day**. No facility work queue, no open-alerts list. |
| D2 | **Do these next** list | Merges course assignments (not completed, has due_date), training records (`due_soon`/`expired`), practicum (if due and not compliant), pending attestations with due_date. Sorted by due date ascending. Cap 8. |
| D3 | Overdue vs due-soon styling | Overdue rows emphasize destructive border; due within 7 days amber. Status badges match source status. |
| D4 | Summary cards | Compliant / Due Soon / Expired from training records; Attestations Due = pending count. |
| D5 | Next shift | Soonest published shift from `fromDate=today`; links to `/me/schedule`. |
| D6 | Fail one source (e.g. attestations error) | Deadlines card shows error + retry for failed sources only — not a silent partial list. |
| D7 | Employee without linked employee profile | Clear message to contact facility manager; no empty false zeros pretending to be real data. |

### Pass criteria (D)

- All four deadline sources appear when present.
- Ordering is strictly by due date.
- No manager operational work items or org alerts on employee Home.

---

## E. Sidebar display (post Advanced moves)

| # | Step | Expected |
|---|------|----------|
| E1 | CareBase FM first visit (cleared localStorage `cmtrain.sidebar.collapsedSections.*`) | **Advanced** and **Admin** collapsed by default. Today / Start here / People / Training / Credentials / Residents / Safety expanded when populated. |
| E2 | Training section | Matrix, content, assignments, classes, pending approvals, my training. **Training plans** is under Advanced. |
| E3 | Credentials section | Clearances, background, exclusion, med-admin (PCH), competency records, practicums. **Templates** and **Administrator qualification** under Advanced. |
| E4 | Safety & survey | Events, incidents, complaints, confidential, work queue, violations, alerts, ops tools, survey day. **Binder, documentation room, reports** under Advanced. |
| E5 | Residents & care | Core resident ops only. **State forms, resident finance, QAPI** under Advanced. |
| E6 | Expand Advanced and open Training plans | Route still works; role + module gates unchanged. |
| E7 | Employee sidebar | Unchanged structure: Home, My shift, My learning, My records, Account. |

---

## Sign-off

| Area | Tester | Date | Pass / Fail | Notes |
|------|--------|------|-------------|-------|
| A Today vs Work vs Alerts | | | | |
| B Portfolio scope | | | | |
| C Train-only gate | | | | |
| D Employee deadlines | | | | |
| E Sidebar Advanced moves | | | | |
