# Workflow & UI efficiency implementation (July 2026)

Implements the product workflow/UI efficiency recommendations for PA PCH/ALF daily ops.

## Four product wins

| Win | What shipped |
|---|---|
| **One home + one survey path** | Managers land on **Today** only (scorecard under Advanced). **Survey path** checklist = readiness → binder → documentation room → Survey Day. Start here + Safety & survey lead with Survey path + Survey Day. |
| **Reach deskless staff** | Employee **Do these next** inbox + SMS/notification settings CTA on My day. Account → Notification settings in employee nav. Pilot flags **enabled in cohort mode** for demo orgs (see below). |
| **Collapse nav** | Manager/auditor: Home → Start here → People → Training → Credentials → Residents & care → Safety & survey → Advanced → Admin. Employee: Home / My shift / My learning / My records / Account. |
| **Multi-page jobs as checklists** | Shared `JobChecklist` for onboard hire, survey prep (`SurveyPrepChecklist`), and incident close-loop progress. |

## Navigation IA
- Manager/auditor sidebar reorganized around **daily work first**.
- **Dashboard demoted**: labeled “Compliance scorecard” under Advanced; linked from Today.
- **Survey path** and **Survey Day** raised into Start here + Safety & survey.
- Employee nav: **Home / My shift / My learning / My records / Account**.
- Trainer nav adds **Training gaps** hub.

## New surfaces
| Route | Purpose |
|---|---|
| `/app/report-event` | One chooser for incident / complaint / confidential report |
| `/trainer/gaps` | Matrix + retraining + pending approvals hub |
| `JobChecklist` / `SurveyPrepChecklist` | Multi-step job UI (onboard, survey path) |

## Role quick-start
Updated org admin, facility manager, trainer, employee, auditor cards to match the new paths (survey path, Report Event, trainer gaps).

## Employee day
- Home title **My day** with prominent **Do these next** inbox.
- SMS prompt → `/account/notifications`.
- Sticky **Not survey-ready** strip on Employee detail when readiness ≠ ready.
- Onboarding as **JobChecklist** with Mark done + progress.

## Detail navigation
- Facility detail sticky section chips (Overview / Licensing / People / Safety).
- Incident detail sticky section chips + **Close-loop checklist** progress on follow-through.

## Purpose labels
`SurfacePurpose` on Today, Dashboard (scorecard), Command Center, Survey Day, Value Center, Closed-loop compliance, Inspection readiness.

## Trainer day
Primary **Start today's kiosk** when a class is scheduled today + link to Training gaps.

## Backend / pilot flags (enabled for cohort)

Migration `20260731180000_workflow_ux_efficiency_rollout.sql`:

1. Ensures cohort `carebase-pilot-2026` is active.
2. Enrolls **demo orgs** (`organizations.is_demo = true`) for each feature key.
3. Sets release flags to **`rollout_mode=cohort`, `is_enabled=true`** (operator equivalent of `set_release_flag`):

| Feature key | Effect |
|---|---|
| `notifications.expanded_delivery_types` | Email/SMS for credential/certificate/practicum, course assigned, attestation, incident reported |
| `notifications.critical_multichannel` | Critical alerts fan out to both email + SMS when consented |
| `screening.on_hire_exclusion` | Queue exclusion screening on mid-cycle hire |
| `learning.video_watch_gate` | Require training videos watched through before advance |

Non-demo orgs stay off until assigned to the cohort via `assign_organization_release_cohort` (or enrolled in a later migration).

### Manual operator path (if flags were already applied off)

As AAL2 platform admin:

```sql
select public.set_release_flag(
  'notifications.expanded_delivery_types', 'cohort', true,
  'notifications', 'Enable pilot cohort', null);
select public.set_release_flag(
  'notifications.critical_multichannel', 'cohort', true,
  'notifications', 'Enable pilot cohort', null);
select public.set_release_flag(
  'screening.on_hire_exclusion', 'cohort', true,
  'screening', 'Enable pilot cohort', null);
select public.set_release_flag(
  'learning.video_watch_gate', 'cohort', true,
  'learning', 'Enable pilot cohort', null);
```

## Already present (not reimplemented)
- Expanded notification trigger allowlist (flag-gated)
- On-hire exclusion screening (flag-gated)
- Video watch state + `CourseVideoPlayer` gate
- Async compliance binder jobs
- Global search with `/` and Cmd/Ctrl+K
- Account notification settings for self-serve SMS consent

## Verification
```bash
pnpm --filter @workspace/caremetric-carebase test -- roleQuickStart
pnpm --filter @workspace/caremetric-carebase typecheck
# After db push: demo org should see feature_release_active true for the four keys
```

## Follow-on: residual ops console (same day)

| Surface | Purpose |
|---|---|
| `/admin/pilot-cohorts` | Enroll/unenroll orgs in `carebase-pilot-2026`, set release flags, kill switches (AAL2) |
| Security & Governance | Data lifecycle status, place/release audit legal holds, run lifecycle policies |
| My Credentials | Employee **Submit renewal** (upload PDF/JPEG/PNG → create renewal submission) |
| Inspections list | Bulk log inspection on selected equipment/procedural items |

Migration: `20260731210000_pilot_cohort_console.sql` (`unassign_organization_release_cohort`, `list_audit_legal_holds`).


## Follow-on: training records import + binder CSV appendix

| Surface | Purpose |
|---|---|
| Import Center | **training_records** domain is active (`bulk-import-training-records`); domain-aware upload + `rollback_data_import_job` |
| Compliance Binder | Full untruncated **CSV appendix** (manifest + per-section CSVs) stored with each PDF export |

Migration: `20260731220000_training_records_import_rollback.sql`.


## Residual product gaps wave 2 (same day)

| Gap | What shipped |
|---|---|
| **Multi-domain import** | Active processors: credentials, rooms, residents, resident_contacts, incidents (plus prior employees/training_records). Assessments remain template-only. |
| **Credential OCR + SLA** | `process-credential-renewals` edge worker + queue summary RPC; renewal inbox shows age SLA badges (>24h/>72h). |
| **SCORM authoring control plane** | `register_learning_package` / `accept_learning_package` / `quarantine_learning_package` + Governed Learning Standards package list. |
| **Survey evidence packet selection** | Packet item ledger + assemble manifest on Survey Day binder section. |

Migrations: `20260731230000_residual_product_gaps_wave2.sql`.


## Residual gaps complete (same day, follow-on)

| Gap | What shipped |
|---|---|
| **Assessments import** | `bulk-import-assessments` active; dry-run/apply + 24h draft rollback |
| **Survey packet zip + guest** | `package-survey-evidence-packet` builds zip; `issue_survey_packet_guest_grant` + guest download worker |
| **SCORM register on upload** | CourseDetail SCORM zip → `learning-packages` + `register_learning_package` |
| **Credential OCR** | Structured tool extraction when BAA+key set; 10-min cron; SLA queue already live |
| **Pilot enroll** | Org search, optional enrollment expiry, enrollment filter |

Migration: `20260731240000_residual_gaps_complete.sql`.
