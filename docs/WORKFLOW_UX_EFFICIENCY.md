# Workflow & UI efficiency implementation (July 2026)

Implements the product workflow/UI efficiency recommendations for PA PCH/ALF daily ops.

## Four product wins

| Win | What shipped |
|---|---|
| **One home + one survey path** | Managers land on **Today** (`/app/today`) only. Survey week is one path: readiness → binder → documentation room → Survey Day via `SurveyPrepChecklist` on Inspection readiness. Start here links **Survey path** + **Survey Day**. |
| **Reach deskless staff** | Employee **Do these next** inbox + SMS/notification settings CTA on My day. Account → Notification settings in employee nav. Backend flags (`notifications.expanded_delivery_types`, `notifications.critical_multichannel`) remain default-off with pilot cohort enrollment. |
| **Collapse nav (daily first)** | Manager/auditor sidebar: Home → Start here → People → Training → Credentials → Residents & care → Safety & survey → **Advanced** (scorecards, command center, copilot) → Admin. Dashboard demoted to “Compliance scorecard” under Advanced. |
| **Multi-page jobs as checklists** | Shared `JobChecklist` for **onboard** (Employee detail), **survey prep** (`SurveyPrepChecklist`), and **incident close-loop** (progress bar + “Close-loop checklist” on Incident follow-through). |

## Navigation IA
- Manager/auditor sidebar reorganized around **daily work first**: Home → Start here → People → Training → Credentials → Residents & care → Safety & survey → Advanced (default collapsed) → Admin (default collapsed).
- **Dashboard demoted**: no longer a peer of Home; labeled “Compliance scorecard” under Advanced and linked from Today.
- **Survey path + Survey Day** raised into Start here + Safety & survey (Survey path first).
- Employee nav: **Home / My shift / My learning / My records / Account** (notification settings included).
- Trainer nav adds **Training gaps** hub.

## New surfaces
| Route | Purpose |
|---|---|
| `/app/report-event` | One chooser for incident / complaint / confidential report |
| `/trainer/gaps` | Matrix + retraining + pending approvals hub |

## Shared checklist components
| Component | Used on |
|---|---|
| `JobChecklist` | Employee onboard; composed by SurveyPrepChecklist |
| `SurveyPrepChecklist` | Inspection readiness (survey path) |
| Incident close-loop | `IncidentFollowThroughSection` (progress + stage list) |

## Role quick-start
Updated org admin, facility manager, trainer, employee, auditor cards to match the new paths (survey path, report event, gaps, Do these next).

## Employee day
- Home title **My day** with prominent **Do these next** inbox (courses, training, practicum, attestations).
- **Get reminders on your phone** CTA → `/account/notifications`.
- Sticky **Not survey-ready** strip on Employee detail when readiness ≠ ready.
- Onboarding steps rendered as a **JobChecklist** with Mark done + progress.

## Detail navigation
- Facility detail sticky section chips (Overview / Licensing / People / Safety).
- Incident detail sticky section chips (Next actions / Narrative / Staff / Corrective actions / Evidence).
- Incident follow-through titled **Close-loop checklist** with progress bar.

## Purpose labels
`SurfacePurpose` on Today, Dashboard (scorecard), Command Center, Survey Day, Value Center, Closed-loop compliance, Inspection readiness (survey path).

## Trainer day
Primary **Start today's kiosk** when a class is scheduled today + link to Training gaps.

## Backend (flags remain default-off)
Migration `20260731180000_workflow_ux_efficiency_rollout.sql` enrolls demo orgs in the pilot cohort for:
- `notifications.expanded_delivery_types`
- `notifications.critical_multichannel`
- `screening.on_hire_exclusion`
- `learning.video_watch_gate`

Operators enable with `set_release_flag` (AAL2) `rollout_mode=cohort` + `is_enabled=true`.

## Already present (not reimplemented)
- Expanded notification trigger allowlist (flag-gated)
- On-hire exclusion screening (flag-gated)
- Video watch state + `CourseVideoPlayer` gate
- Async compliance binder jobs
- Global search with `/` and Cmd/Ctrl+K (pages + people + actions)
- Account notification settings for self-serve SMS consent

## Verification
```bash
pnpm --filter @workspace/caremetric-carebase test -- roleQuickStart
pnpm --filter @workspace/caremetric-carebase typecheck
```
