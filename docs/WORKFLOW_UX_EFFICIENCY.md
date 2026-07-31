# Workflow & UI efficiency implementation (July 2026)

Implements the product workflow/UI efficiency recommendations for PA PCH/ALF daily ops.

## Shipped in this pass

### Navigation IA
- Manager/auditor sidebar reorganized around **daily work first**: Home → Start here → People → Training → Credentials → Residents & care → Safety & survey → Advanced (default collapsed) → Admin (default collapsed).
- **Dashboard demoted**: no longer a peer of Home; labeled “Compliance scorecard” under Advanced and linked from Today.
- **Survey Day raised** into Start here + Safety & survey.
- Employee nav: **Home / My shift / My learning / My records / Account** (no longer “My Training” as the shell label).
- Trainer nav adds **Training gaps** hub.

### New surfaces
| Route | Purpose |
|---|---|
| `/app/report-event` | One chooser for incident / complaint / confidential report |
| `/trainer/gaps` | Matrix + retraining + pending approvals hub |

### Role quick-start
Updated org admin, facility manager, trainer, employee, auditor cards to match the new paths.

### Employee day
- Home title **My day** with prominent **Do these next** inbox (courses, training, practicum, attestations).
- Sticky **Not survey-ready** strip on Employee detail when readiness ≠ ready.

### Detail navigation
- Facility detail sticky section chips (Overview / Licensing / People / Safety).
- Incident detail sticky section chips (Next actions / Narrative / Staff / Corrective actions / Evidence).

### Purpose labels
`SurfacePurpose` on Today, Dashboard (scorecard), Command Center, Survey Day, Value Center, Closed-loop compliance.

### Trainer day
Primary **Start today's kiosk** when a class is scheduled today + link to Training gaps.

### Backend (flags remain default-off)
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
- Employee onboarding checklist on Employee detail tabs
- Account notification settings for self-serve SMS consent

## Verification
```bash
pnpm --filter @workspace/caremetric-carebase test -- roleQuickStart
pnpm --filter @workspace/caremetric-carebase typecheck
```
