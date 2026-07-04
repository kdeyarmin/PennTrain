# CareMetric Train MVP

CareMetric Train is an original healthcare learning-management and compliance-training MVP for personal care homes, assisted living facilities, and related healthcare organizations. It extends the existing Vite/React/Express/Drizzle workspace rather than replacing it with a different stack.

## What is included

- Role-protected application areas for platform admin, organization/facility admins, trainers, and learners.
- A new **LMS Suite** screen with functional MVP workflows for dashboards, course catalog/builder, assignments, quiz scoring, certificates, configurable compliance requirements, medication administration tracking, competency checklists, live in-service sessions, external certificate review, reporting, compliance binder export, subscription packages, AI-ready placeholders, and audit-log coverage. The workflow buttons now mutate demo state, record activity, export CSV, and open printable PDF/binder packets.
- Supabase/Postgres schema migration at `supabase/migrations/202607040001_caremetric_train.sql` covering the requested LMS/compliance tables, UUID keys, tenant fields, indexes, and RLS enablement statements.
- Protected API endpoints under `/api/caremetric/*` for summary, course creation, assignment creation, quiz attempt scoring, and binder export generation, ready to be backed by the Supabase schema.
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

- The existing repository stack is Vite/React plus Express/Drizzle, so this MVP follows current conventions instead of migrating the whole app to Next.js App Router.
- Supabase Auth/Storage integration is schema-ready, and the current `/api/caremetric/*` endpoints use in-memory MVP state until wired to deployment-specific Supabase project credentials and tables.
- Email reminders currently use an email-ready notification payload pattern; production SMTP/provider integration is a next step.
- Payment processing is intentionally package/status based only; Stripe can be added using the subscription/package tables.
- Compliance templates are configurable tracking tools and are not legal advice.

