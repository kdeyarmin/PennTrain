# CareMetric Train MVP

CareMetric Train is an original healthcare learning-management and compliance-training MVP for personal care homes, assisted living facilities, and related healthcare organizations. It extends the existing Vite/React/Express/Drizzle workspace rather than replacing it with a different stack.

## What is included

- Role-protected application areas for platform admin, organization/facility admins, trainers, and learners.
- A new **LMS Suite** screen with functional MVP workflows for dashboards, course catalog/builder, assignments, quiz scoring, certificates, configurable compliance requirements, medication administration tracking, competency checklists, live in-service sessions, external certificate review, reporting, compliance binder export, subscription packages, AI-ready placeholders, and audit-log coverage. The workflow buttons now mutate demo state, record activity, export CSV, and open printable PDF/binder packets.
- Supabase/Postgres schema migration at `supabase/migrations/202607040001_caremetric_train.sql` covering the requested LMS/compliance tables, UUID keys, tenant fields, indexes, and RLS enablement statements.
- Protected API endpoints under `/api/caremetric/*` for aggregate LMS data, summary, course creation, assignment creation, quiz attempt scoring, external record review, competency completion, in-service attendance, medication updates, notifications, and binder export generation, ready to be backed by the Supabase schema.
- Dedicated route entries now deep-link administrators into LMS Suite modules such as courses, assignments, requirements, medication tracking, competencies, in-services, external records, reports, binder export, packages, and LMS settings.
- Seed package data and demo-login guidance in `supabase/seed.sql`.

## Run locally

```bash
pnpm install
pnpm --filter @workspace/api-server dev
pnpm --filter @workspace/pa-medtrack dev
```

The frontend is served by Vite. The API server uses the existing Express routes and database package.

## Demo users

Create these users in Supabase Auth or the existing local auth store, all with password `DemoPass!2026`:

- `super@caremetric.test` — Super Admin
- `admin@caremetric.test` — Organization Admin
- `facility@caremetric.test` — Facility Admin
- `trainer@caremetric.test` — Instructor / Trainer
- `learner@caremetric.test` — Learner / Staff Member
- `auditor@caremetric.test` — Auditor / Read-Only Consultant

## Database setup

1. Create a Supabase project.
2. Apply `supabase/migrations/202607040001_caremetric_train.sql`.
3. Run `supabase/seed.sql`.
4. Create demo Auth users and corresponding `profiles`/`user_roles` rows for the desired tenant and facility.
5. Configure Supabase Storage buckets for course documents, policy files, certificates, external training uploads, sign-in sheets, competency attachments, and binder exports.

## Known limitations / TODO

The next remaining items are exactly:

1. Replace the `/api/caremetric/*` in-memory MVP state with Drizzle/Supabase persistence using the tables in `supabase/migrations/202607040001_caremetric_train.sql`.
2. Add Supabase Storage bucket policies and signed upload/download flows for course documents, certificates, sign-in sheets, competency attachments, and binder exports.
3. Generate typed API client hooks for the CareMetric endpoints instead of the expanded hand-written `caremetricApi.ts` fetch wrapper.
4. Replace the current tab-reused route wrappers with fully independent production pages and forms for courses, assignments, competencies, medications, in-services, external records, reports, and settings.
5. Add real email delivery behind the existing notification payload abstraction.
6. Add Stripe checkout/customer/subscription integration using the existing packages/subscriptions schema.
7. Add browser-level workflow tests for admin assignment, learner quiz completion, certificate generation, and report export.
8. Add production RLS policies for every table after finalizing Supabase Auth claims and tenant membership strategy.
