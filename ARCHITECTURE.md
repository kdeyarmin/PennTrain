# CareMetric Train — Workspace

## Overview

CareMetric Train (formerly "PA MedTrack") is a multi-tenant SaaS compliance-training platform for healthcare
organizations (originally scoped to Pennsylvania Personal Care Homes / Assisted Living Residences, now broader). It
tracks medication administration training, certifications, annual practicums, training hours, documents, alerts, and
compliance reporting, plus a full LMS layer: a course/quiz/certificate authoring and delivery system, training plans,
and competency checklists.

The app is built directly on Supabase: Postgres + Row-Level Security, Supabase Auth, Supabase Storage, and Edge
Functions. There is no separate backend API server — the React frontend talks to Supabase directly via `supabase-js`.

## Architecture

pnpm workspace monorepo. Single frontend package (`artifacts/caremetric-train`) plus a design mockup sandbox; all
backend logic lives in the Supabase project (`xsqobvvreaovwibxwyvv`, "CM Train").

### Packages

- `artifacts/caremetric-train` — React + Vite frontend, talks to Supabase directly (no API server)
- `artifacts/mockup-sandbox` — Canvas/design mockup sandbox
- `supabase/migrations/` — every schema/RLS/function/storage change, applied in order
- `supabase/functions/` — Edge Functions (Deno)

### Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 19, Vite 7, Tailwind CSS v4, shadcn/ui, Wouter routing, TanStack Query
- **Backend**: Supabase (Postgres 17, Auth, Storage, Edge Functions, `pg_cron`)
- **Data access**: `supabase-js` directly from the frontend; hand-written TanStack Query hooks per domain in
  `src/hooks/*.ts` (no codegen layer — the query builder is already typed via generated `database.types.ts`)
- **Auth**: Supabase Auth (GoTrue). Every account is provisioned server-side via a trusted Edge Function: an admin
  creates or invites a user directly (`create-user`, `invite-user`), or a facility admin self-registers a
  brand-new organization (`signup-organization`, `/signup`) and becomes its `org_admin`. Plain
  `POST /auth/v1/signup` remains enabled at the project level but is unused by the app UI and confers no
  organization/role either way (see the trust-boundary fix in `20260704180244_fix_handle_new_user_trust_boundary.sql`)
- **Authorization**: Row-Level Security on every table, plus a handful of `SECURITY DEFINER` RPCs for atomic
  multi-row operations, plus Edge Functions for anything needing the service-role key or outbound HTTP

## Roles

Six roles on `profiles.role`: `platform_admin`, `org_admin`, `facility_manager`, `trainer`, `employee`, `auditor`.

- `platform_admin` — confined to `/admin/*`. Broad, unrestricted RLS access to every table (no impersonation --
  see "Viewing as Org" below). Routes: `/admin`, `/admin/organizations(/:id)`, `/admin/facilities(/:id)`,
  `/admin/employees(/:id)`, `/admin/alerts`, `/admin/users`, `/admin/audit`, `/admin/packages`,
  `/admin/courses(/:id)`, `/admin/quizzes/:quizId`, `/admin/courses/new-ai`. The **only** role that can author
  courses (create/edit/publish `courses`, `course_versions`, `course_blocks`, `quizzes`, `quiz_questions`,
  `quiz_answers`), manually or via AI generation
- `org_admin` / `facility_manager` — `/app/*`: dashboard, facilities, employees, training matrix, courses
  (browse/read-only -- authoring is platform_admin-exclusive, see below), course assignments, training plans,
  competency templates/records, practicums, alerts, reports, compliance binder, documents, pending approvals,
  users (org-scoped), settings, audit log
- `auditor` — `/app/*`, read-only subset: dashboard, facilities, employees, training matrix, course assignments,
  training plans, competency records, practicums, alerts, reports, compliance binder, documents, audit log. Every
  write action across these pages is gated by a role allowlist that excludes auditor; RLS is the actual backstop
- `trainer` — `/trainer/*`: dashboard, classes, retraining monitor, facilities, employees (read)
- `employee` — `/me/*`: my training (dashboard), training records, course-taking (`/me/courses/:assignmentId`,
  reached from a training record's assignment), certificates, documents

Public (no auth): `/verify/:slug` — certificate verification; `/signup` — self-service organization creation
(always grants `org_admin` on a brand-new organization, never an existing one or a different role).

## RLS / Authorization Model

- Helper functions (`is_platform_admin()`, `current_org_id()`, `current_role()`, `is_assigned_to_facility()`,
  `owns_employee()`), all `security definer stable`, called as `(select fn())` in policies for InitPlan caching.
- Standard per-table policy shape: `is_platform_admin() OR (organization_id = current_org_id() AND (admin role OR
  is_assigned_to_facility(facility_id)))`, write actions further restricted to the roles allowed to mutate that
  table. `auditor` appears in every relevant select policy and zero write policies.
- Compliance-determining fields (`quiz_attempts`, `course_assignments.status`, `certificates`,
  `quiz_answers.is_correct`) are never directly client-writable -- they only change via `SECURITY DEFINER` RPCs or
  Edge Functions, using an `app.privileged_write` GUC escape hatch set only from trusted server-side code.
- Course content is immutable once `course_versions.status = 'published'` (enforced by trigger, overridable only by
  a genuine platform_admin).
- Course authoring (create/edit/publish `courses`, `course_versions`, `course_blocks`, `quizzes`,
  `quiz_questions`, `quiz_answers`) is `platform_admin`-exclusive; `org_admin`/`facility_manager`/`trainer`
  retain course browsing (read-only) and enrollment via `course_assignments` only.
- "Viewing as Org X" (header selector, platform_admin only) is a **UX-only convenience** — it is not a security
  boundary. `is_platform_admin()` already grants full RLS access regardless of this selection; the selector only
  narrows which org's rows a handful of `/admin/*` list pages display. Persisted in `sessionStorage`.

## Storage Buckets

All private: `course-documents`, `certificates` (no client write policy -- issuance is RPC/Edge-Function-only),
`external-uploads`, `signin-sheets`, `competency-attachments`, `org-branding`, `binder-exports` (no client write
policy -- generation is Edge-Function-only, downloaded via a short-lived signed URL returned by the function).

One deliberate exception: `course-videos` is **public** -- it re-hosts AI-avatar-generated course videos after
HeyGen's signed URLs expire (training content, not tenant-sensitive documents; rationale documented in
`20260704155836_add_course_videos_public_bucket.sql`).

## Edge Functions

- `create-user` — provisions a new auth user + profile; authorization matrix by caller role (platform_admin: any
  role/org; org_admin: any non-platform_admin role, own org; facility_manager: trainer/employee only, own org)
- `admin-update-user` — updates role/org/is_active/email/password for an existing user (platform_admin/org_admin
  only; org_admin cannot touch platform_admin, reassign org, or deactivate self)
- `bulk-import-employees` — CSV import of employees, runs as the calling user's own JWT (RLS already scopes it)
- `generate-compliance-binder` — queries an org's facilities/training compliance/practicums/certificates/alerts and
  renders a multi-page PDF (`pdf-lib`), uploads it to `binder-exports`, returns a 10-minute signed URL
- `generate-course-video` — kicks off HeyGen AI-avatar video generation for a course block
- `check-course-video-status` — polls HeyGen for generation status and re-hosts the finished video in
  `course-videos`
- `list-heygen-options` — lists available HeyGen avatars/voices for the course authoring UI
- `generate-course-curriculum` — platform_admin-only; drafts a full course (modules, quiz questions/answers,
  video narration scripts) via the Anthropic Messages API (forced tool-use for structured JSON), grounded in
  optional pasted `source_material` to curb hallucination risk in regulated content
- `regenerate-course-block` — platform_admin-only; regenerates a single text/video/quiz block via Claude from
  reviewer feedback; rejected once the parent course version is published
- `poll-heygen-video-statuses` — cron-invoked (`pg_cron`, `verify_jwt=false`) batch poll of every course block
  with an in-progress HeyGen job, so video status flips to "completed" without a manual per-block "check status"
  click

AI-generated course content cannot be published unreviewed: `course_versions.ai_generated` gates a mandatory
self-review step (`ai_reviewed_at`/`ai_reviewed_by`), enforced by a database trigger with **no platform_admin
bypass** -- unlike the immutability trigger above, this one applies to platform_admin specifically, since
platform_admin is the only role that can generate AI content. Every generation call (success or failure) is
logged to the `course_ai_generations` audit table.

## Demo Credentials (seeded)

| Role | Email | Password | Organization |
|------|-------|----------|--------------|
| platform_admin | info@caremetrictrain.com | admin123 | — |
| org_admin | admin@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| facility_manager | manager@sunrisemanor.com | demo123 | Sunrise Healthcare Group |
| trainer | trainer@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| employee | employee@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| auditor | auditor@sunrisehealthcare.com | demo123 | Sunrise Healthcare Group |
| org_admin | admin@maplegrove.com | demo123 | Maple Grove Senior Living |

## Key Commands

- `pnpm --filter @workspace/caremetric-train run dev` — run the frontend dev server
- `pnpm --filter @workspace/caremetric-train run build` — production build
- `pnpm run typecheck` — typecheck all workspace packages
- Schema changes go through `mcp__Supabase__apply_migration`, then the exact same SQL is written to
  `supabase/migrations/<version>_<name>.sql` using the version number Supabase actually assigned (from
  `mcp__Supabase__list_migrations`), so the Supabase GitHub integration's preview-branch deploys stay in sync.

## Database Schema (selected tables)

Tenancy/identity: `organizations`, `organization_settings`, `facilities`, `profiles`, `facility_assignments`,
`employees`, `packages`. Compliance core: `training_types`, `employee_training_records`,
`employee_training_hour_buckets`, `practicums`, `training_documents`, `alerts`, `audit_logs`, `training_classes`,
`training_class_attendees`. LMS: `courses`, `course_versions`, `course_blocks`, `quizzes`, `quiz_questions`,
`quiz_answers`, `course_assignments`, `course_progress`, `quiz_attempts`, `quiz_attempt_answers`,
`course_ai_generations` (AI-generation audit trail), `training_plans`,
`training_plan_items`, `competency_templates`, `competency_template_items`, `competency_records`,
`competency_record_items`, `certificates`.

## Important Files

- `artifacts/caremetric-train/src/lib/supabase.ts` — Supabase client setup
- `artifacts/caremetric-train/src/lib/auth.tsx` — auth context (Supabase session + profile)
- `artifacts/caremetric-train/src/lib/viewingOrg.tsx` — platform_admin "Viewing as Org X" UX-only context
- `artifacts/caremetric-train/src/App.tsx` — frontend router with role-based access
- `artifacts/caremetric-train/src/components/layout/Sidebar.tsx` — role-aware navigation sidebar
- `artifacts/caremetric-train/src/hooks/*.ts` — one hand-written TanStack Query hook module per domain
- `artifacts/caremetric-train/src/lib/database.types.ts` — generated Supabase types (`mcp__Supabase__generate_typescript_types`)
- `supabase/migrations/` — full schema/RLS/function/storage history, source of truth for the database
- `supabase/functions/*/index.ts` — Edge Function source
