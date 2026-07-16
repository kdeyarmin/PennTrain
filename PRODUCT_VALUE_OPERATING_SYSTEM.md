# CareBase Product Value Operating System

This release turns the product review recommendations into connected, tenant-scoped workflows. It reuses CareBase's existing compliance, work-item, evidence, admissions, staffing, portal, medication, learning, integration, notification, and audit foundations rather than creating parallel systems of record.

## Implemented capabilities

| Recommendation | Product surface | Operating result |
| --- | --- | --- |
| Role-based daily command center | **Today** (`/app/today`) | A manager starts with overdue work, critical alerts, medication exceptions, inspection requests, staffing gaps, admissions work, and automation failures in one prioritized queue. |
| Closed-loop workflow automation | **Value Center → Automation** | Managers configure allowlisted, facility-scoped triggers for alerts, incidents, medication exceptions, and admissions. Every run is deduplicated, recorded, and linked to the notification or work item it creates. |
| Inspection command center | **Value Center → Inspection** | Teams open an inspection war room, request evidence or corrective work, assign owners and due dates, link existing work items, and verify requests before closure. |
| Guided implementation and adoption | **Value Center → Implementation** | A standard launch project creates accountable tasks for configuration, workforce setup, imports, integrations, training, evidence readiness, validation, and go-live. |
| Scheduled operational reporting | **Value Center → Value & reports** | Managers subscribe to allowlisted report keys on daily, weekly, or monthly schedules; a service-role cron worker creates the due in-app deliveries and advances the schedule. |
| ROI and replacement-value proof | **Value Center → Value & reports** | A customer baseline records retired software, license cost, and labor assumptions. The dashboard combines those assumptions with CareBase activity to show software savings, estimated time recovered, and adoption signals. |
| Staffing optimization | **Value Center → Staffing** | The dashboard combines open shifts, coverage gaps, overtime risk, and credential/training eligibility into explainable recommendations. It does not auto-assign staff. |
| Admissions and occupancy intelligence | **Value Center → Admissions & operations** | Pipeline stage, referral-source conversion, bed availability, move-in readiness, and occupancy context are visible together and link back to the operating workspace. |
| Secure offline field learning | **My Training → Offline training library** | Employee-only, device-bound AES-GCM course copies expire after 30 days. Only allowlisted learning content and quiz prompts are cached; answer keys and protected operational domains are excluded. Viewed progress is checkpointed locally and synchronized through conflict-aware, append-only receipts. Quizzes and completion evidence remain online-only. |
| Designated-person portal 2.0 | Resident portal and manager workspace | Permission-scoped users can view schedules, respond to events, submit trackable requests, use manager-approved external payment links, and download authorized documents through an audited edge function. |
| Productized integration operations | **Value Center → Admissions & operations** and Enterprise Foundation | Integration health, failures, credentials, delivery attempts, replay, rotation, and revocation use the existing signed integration boundary rather than exposing source-system credentials. |
| Medication exception accountability | Medication Integration and **Today** | Medication exceptions gain an owner, due date, SLA state, and linked work item so operational failures cannot disappear inside an integration log. |
| Governed regulatory copilot actions | Regulatory Copilot and **Value Center → Automation** | Copilot recommendations can become reviewable drafts. Only an authorized manager can approve an allowlisted action; approvals and executions are separately recorded. |

## Safety and compliance boundaries

- All new operational tables use row-level security and organization/facility scoping. Manager mutations re-check authorization inside security-definer functions.
- Automation and copilot execution are allowlisted; free-form SQL, arbitrary RPC names, and arbitrary URLs are not executable actions.
- Automation runs, inspection activity, portal downloads, offline sync receipts, and copilot decisions preserve an auditable event trail.
- Portal payment support stores an approved external payment link and display label only. CareBase does not collect card or bank credentials.
- Staffing recommendations are decision support. They expose eligibility and risk signals but require a human scheduling decision.
- ROI output is explicitly assumption-based. Baselines remain editable so operators can see and correct the inputs behind estimated savings.
- Offline data is wiped on identity or organization change and can be remotely marked for revocation. Regulated evidence is never finalized offline.

## Deployment and operations

1. Apply `20260716160000_product_value_operating_system.sql` after the existing migration chain.
2. Deploy the `resident-portal-download` edge function with JWT verification disabled at the gateway; the function validates the opaque portal grant token and document share itself before minting a five-minute storage URL.
3. Confirm `pg_cron` is available. The migration installs `process-carebase-report-subscriptions` every 15 minutes and limits direct execution of the worker to `service_role`.
4. Regenerate `artifacts/caremetric-carebase/src/lib/database.types.ts` from a reset local database whenever the schema changes.
5. Pilot with one facility first. Configure a value baseline, open an implementation project, enable only the automation rules desired for the pilot, and review the Value Center weekly.

## Verification contract

The database test `supabase/tests/database/product_value_operating_system.test.sql` checks the new tables, functions, RLS posture, privileges, automation triggers, reporting worker, and cron registration. Release validation should also include the repository typecheck, unit tests, edge-function checks, production build, bundle budget, full migration reset, database lint, database advisors, and generated-type parity check.
