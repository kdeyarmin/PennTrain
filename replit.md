# CareMetric CareBase — Workspace

## Overview

CareMetric CareBase (formerly "PA MedTrack") is a multi-tenant SaaS management platform for personal care homes, assisted living residences, and adjacent long-term-care providers. It tracks facility operations, employee compliance, resident assessments, incidents, inspections, scheduling, credentials, medication administration training, annual practicums, training hours, documents, alerts, audit evidence, and survey-ready compliance reporting, plus an integrated training layer for training content, quizzes, certificates, training plans, live classes, and competency checklists.

The app is built directly on Supabase: Postgres + Row-Level Security, Supabase Auth, Supabase Storage, and Edge
Functions. There is no separate backend API server — the React frontend talks to Supabase directly via `supabase-js`.

## Architecture

pnpm workspace monorepo. Single frontend package (`artifacts/pa-medtrack`) plus a design mockup sandbox; all
backend logic lives in the Supabase project (`xsqobvvreaovwibxwyvv`, "CM CareBase").

### Packages

- `artifacts/pa-medtrack` — React + Vite frontend, talks to Supabase directly (no API server)
- `artifacts/mockup-sandbox` — Canvas/design mockup sandbox
- `supabase/migrations/` — every schema/RLS/function/storage change, applied in order
- `supabase/functions/` — Edge Functions (Deno)

### Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 19, Vite 7, Tailwind CSS v4, shadcn/ui, Wouter routing, TanStack Query
- **Backend**: Supabase (Postgres 17, Auth, Storage, Edge Functions, `pg_cron`)
- **Data access**: `supabase-js` directly from the frontend; hand-written TanStack Query hooks per domain in
  `src/hooks/*.ts` (no codegen layer — the query builder is already typed via generated `database.types.ts`)
- **Auth**: Supabase Auth (GoTrue). No public self-signup — every account is provisioned by an admin via a trusted
  Edge Function (`create-user`)
- **Authorization**: Row-Level Security on every table, plus a handful of `SECURITY DEFINER` RPCs for atomic
  multi-row operations, plus Edge Functions for anything needing the service-role key or outbound HTTP

## Roles

Six roles on `profiles.role`: `platform_admin`, `org_admin`, `facility_manager`, `trainer`, `employee`, `auditor`.

- `platform_admin` — confined to `/admin/*`. Broad, unrestricted RLS access to every table (no impersonation --
  see "Viewing as Org" below). Routes: `/admin`, `/admin/organizations(/:id)`, `/admin/facilities(/:id)`,
  `/admin/employees(/:id)`, `/admin/alerts`, `/admin/users`, `/admin/audit`, `/admin/caremetric`, `/admin/packages`
- `org_admin` / `facility_manager` — `/app/*`: dashboard, facilities, employees, training matrix, training content, training
  assignments, training plans, competency templates/records, practicums, alerts, reports, compliance binder,
  documents, pending approvals, users (org-scoped), settings, audit log
- `auditor` — `/app/*`, read-only subset: dashboard, facilities, employees, training matrix, training assignments,
  training plans, competency records, practicums, alerts, reports, compliance binder, documents, audit log. Every
  write action across these pages is gated by a role allowlist that excludes auditor; RLS is the actual backstop
- `trainer` — `/trainer/*`: dashboard, classes, retraining monitor, facilities, employees (read)
- `employee` — `/me/*`: my training, training workspace, certificates, documents

Public (no auth): `/verify/:slug` — certificate verification.

## RLS / Authorization Model

- Helper functions (`is_platform_admin()`, `current_org_id()`, `current_role()`, `is_assigned_to_facility()`,
  `owns_employee()`), all `security definer stable`, called as `(select fn())` in policies for InitPlan caching.
- Standard per-table policy shape: `is_platform_admin() OR (organization_id = current_org_id() AND (admin role OR
  is_assigned_to_facility(facility_id)))`, write actions further restricted to the roles allowed to mutate that
  table. `auditor` appears in every relevant select policy and zero write policies.
- Compliance-determining fields (`quiz_attempts`, `course_assignments.status`, `certificates`,
  `quiz_answers.is_correct`) are never directly client-writable -- they only change via `SECURITY DEFINER` RPCs or
  Edge Functions, using an `app.privileged_write` GUC escape hatch set only from trusted server-side code.
- Training content is immutable once `course_versions.status = 'published'` (enforced by trigger, overridable only by
  a genuine platform_admin).
- "Viewing as Org X" (header selector, platform_admin only) is a **UX-only convenience** — it is not a security
  boundary. `is_platform_admin()` already grants full RLS access regardless of this selection; the selector only
  narrows which org's rows a handful of `/admin/*` list pages display. Persisted in `sessionStorage`.

## Storage Buckets (all private)

`course-documents`, `certificates` (no client write policy -- issuance is RPC/Edge-Function-only),
`external-uploads`, `signin-sheets`, `competency-attachments`, `org-branding`, `binder-exports` (no client write
policy -- generation is Edge-Function-only, downloaded via a short-lived signed URL returned by the function).

## Edge Functions

- `create-user` — provisions a new auth user + profile; authorization matrix by caller role (platform_admin: any
  role/org; org_admin: any non-platform_admin role, own org; facility_manager: trainer/employee only, own org)
- `admin-update-user` — updates role/org/is_active/email/password for an existing user (platform_admin/org_admin
  only; org_admin cannot touch platform_admin, reassign org, or deactivate self)
- `bulk-import-employees` — CSV import of employees, runs as the calling user's own JWT (RLS already scopes it)
- `generate-compliance-binder` — queries an org's facilities/training compliance/practicums/certificates/alerts and
  renders a multi-page PDF (`pdf-lib`), uploads it to `binder-exports`, returns a 10-minute signed URL

## Local Demo Credentials (seeded)

These predictable credentials are for a disposable local Supabase stack only. Hosted demo users are provisioned
per environment; no seeded account has the `platform_admin` role.

| Role | Email | Password | Organization |
|------|-------|----------|--------------|
| org_admin | admin@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| facility_manager | manager@sunrisemanor.com | demo123 | Sunrise Healthcare Group |
| trainer | trainer@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| employee | employee@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| auditor | auditor@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| org_admin | admin@maplegrove.com | demo123 | Maple Grove Senior Living |

## Key Commands

- `pnpm --filter @workspace/pa-medtrack run dev` — run the frontend dev server
- `pnpm --filter @workspace/pa-medtrack run build` — production build
- `pnpm run typecheck` — typecheck all workspace packages
- Schema changes go through `mcp__Supabase__apply_migration`, then the exact same SQL is written to
  `supabase/migrations/<version>_<name>.sql` using the version number Supabase actually assigned (from
  `mcp__Supabase__list_migrations`), so the Supabase GitHub integration's preview-branch deploys stay in sync.

## Database Schema (selected tables)

Tenancy/identity: `organizations`, `organization_settings`, `facilities`, `profiles`, `facility_assignments`,
`employees`, `packages`. Compliance core: `training_types`, `employee_training_records`,
`employee_training_hour_buckets`, `practicums`, `training_documents`, `alerts`, `audit_logs`, `training_classes`,
`training_class_attendees`. Training content: `courses`, `course_versions`, `course_blocks`, `quizzes`, `quiz_questions`,
`quiz_answers`, `course_assignments`, `course_progress`, `quiz_attempts`, `quiz_attempt_answers`, `training_plans`,
`training_plan_items`, `competency_templates`, `competency_template_items`, `competency_records`,
`competency_record_items`, `certificates`.

## Important Files

- `artifacts/pa-medtrack/src/lib/supabase.ts` — Supabase client setup
- `artifacts/pa-medtrack/src/lib/auth.tsx` — auth context (Supabase session + profile)
- `artifacts/pa-medtrack/src/lib/viewingOrg.tsx` — platform_admin "Viewing as Org X" UX-only context
- `artifacts/pa-medtrack/src/App.tsx` — frontend router with role-based access
- `artifacts/pa-medtrack/src/components/layout/Sidebar.tsx` — role-aware navigation sidebar
- `artifacts/pa-medtrack/src/hooks/*.ts` — one hand-written TanStack Query hook module per domain
- `artifacts/pa-medtrack/src/lib/database.types.ts` — generated Supabase types (`mcp__Supabase__generate_typescript_types`)
- `supabase/migrations/` — full schema/RLS/function/storage history, source of truth for the database
- `supabase/functions/*/index.ts` — Edge Function source
