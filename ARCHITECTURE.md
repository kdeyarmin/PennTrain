# CareMetric CareBase — Workspace

## Overview

CareMetric CareBase (formerly "PA MedTrack") is a multi-tenant SaaS management platform for personal care homes, assisted living residences, and adjacent long-term-care providers. It tracks facility operations, employee compliance, resident assessments, incidents, inspections, scheduling, credentials, medication administration training, annual practicums, training hours, documents, alerts, audit evidence, and survey-ready compliance reporting, plus an integrated training layer for training content, quizzes, certificates, training plans, live classes, and competency checklists.

The app is built directly on Supabase: Postgres + Row-Level Security, Supabase Auth, Supabase Storage, and Edge
Functions. There is no separate backend API server — the React frontend talks to Supabase directly via `supabase-js`.

## Architecture

pnpm workspace monorepo. Single frontend package (`artifacts/caremetric-carebase`) plus a design mockup sandbox; all
backend logic lives in the Supabase project (`xsqobvvreaovwibxwyvv`, "CM CareBase").

### Packages

- `artifacts/caremetric-carebase` — React + Vite frontend, talks to Supabase directly (no API server)
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
  brand-new organization (`signup-organization`, `/signup`) and becomes its `org_admin` only after Turnstile,
  rate-limit, and invite-email checks pass. Plain `POST /auth/v1/signup` should stay disabled in production and,
  even if enabled, confers no organization/role by itself (see the trust-boundary fix in
  `20260704180244_fix_handle_new_user_trust_boundary.sql`)
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
  (browse/read-only -- authoring is platform_admin-exclusive, see below), training assignments, training plans,
  competency templates/records, practicums, alerts, reports, compliance binder, documents, pending approvals,
  users (org-scoped), settings, audit log
- `auditor` — `/app/*`, read-only subset: dashboard, facilities, employees, training matrix, training assignments,
  training plans, competency records, practicums, alerts, reports, compliance binder, documents, audit log. Every
  write action across these pages is gated by a role allowlist that excludes auditor; RLS is the actual backstop
- `trainer` — `/trainer/*`: dashboard, classes, retraining monitor, facilities, employees (read)
- `employee` — `/me/*`: my training (dashboard), training records, training assignment (`/me/courses/:assignmentId`,
  reached from a training record's assignment), certificates, documents

Public (no auth): `/verify/:slug` — certificate verification; `/signup` — self-service organization creation
(creates a brand-new organization, then grants `org_admin` only after Turnstile/rate-limit checks and invite email).

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
  reviewer feedback; rejected once the parent training content version is published
- `poll-heygen-video-statuses` — cron-invoked (`pg_cron`, `verify_jwt=false`) batch poll of every course block
  with an in-progress HeyGen job, so video status flips to "completed" without a manual per-block "check status"
  click

AI-generated training content cannot be published unreviewed: `course_versions.ai_generated` gates a mandatory
self-review step (`ai_reviewed_at`/`ai_reviewed_by`), enforced by a database trigger with **no platform_admin
bypass** -- unlike the immutability trigger above, this one applies to platform_admin specifically, since
platform_admin is the only role that can generate AI content. Every generation call (success or failure) is
logged to the `course_ai_generations` audit table.

## Demo Access

Demo login buttons are environment-configured with `VITE_DEMO_ACCOUNTS_JSON` and are disabled when that value is
absent or malformed. Reusable demo/platform_admin passwords are intentionally not seeded in SQL or committed to docs.

## Key Commands

- `pnpm --filter @workspace/caremetric-carebase run dev` — run the frontend dev server
- `pnpm --filter @workspace/caremetric-carebase run build` — production build
- `pnpm run typecheck` — typecheck all workspace packages
- Schema changes go through `mcp__Supabase__apply_migration`, then the exact same SQL is written to
  `supabase/migrations/<version>_<name>.sql` using the version number Supabase actually assigned (from
  `mcp__Supabase__list_migrations`), so the Supabase GitHub integration's preview-branch deploys stay in sync.

## Scheduling

Basic shift scheduling (not qualification-gated -- see ROADMAP.md's deferred-ideas table). `employee_facility_assignments`
is an additive join table recording every facility an employee can be scheduled at, mirroring the existing
profile-level `facility_assignments`; `employees.facility_id` remains the employee's home/primary facility and is
kept in sync via a trigger, so every pre-existing compliance feature is unaffected. On top of that:
`facility_units` (wings), `shift_definitions` (typical shift time templates), `employee_schedule_preferences` (each
employee's typical recurring shift/unit pattern by day-of-week), `schedules` (a draft/published period for one
facility), and `shift_assignments` (one employee's shift on one date). `generate_schedule_assignments` is the
auto-fill RPC -- it populates a draft schedule from every employee's typical pattern, skipping any date an
employee already has a shift (manual entries always win); `clear_auto_filled_assignments` is the matching undo
(only removes untouched auto-generated rows). `publish_schedule`/`unpublish_schedule` flip a schedule's visibility
to employees -- `shift_assignments_select`'s employee-owned branch requires the parent schedule to be
`published`. `org_admin`/`facility_manager` manage scheduling at `/app/schedule` (`/app/schedule/setup` for
units/shifts/patterns); employees see their own published shifts (read-only) at `/me/schedule`. One deliberate v1
limitation: `shift_assignments` has a `unique (employee_id, shift_date)` constraint, so an employee is capped at
one shift per calendar date across every facility -- no double shifts, no same-day float between two facilities.

## Database Schema (selected tables)

Tenancy/identity: `organizations`, `organization_settings`, `facilities`, `profiles`, `facility_assignments`,
`employees`, `employee_facility_assignments`, `packages`. Scheduling: `facility_units`, `shift_definitions`,
`employee_schedule_preferences`, `schedules`, `shift_assignments`. Compliance core: `training_types`, `employee_training_records`,
`employee_training_hour_buckets`, `practicums`, `training_documents`, `alerts`, `audit_logs`, `training_classes`,
`training_class_attendees`. Training content: `courses`, `course_versions`, `course_blocks`, `quizzes`, `quiz_questions`,
`quiz_answers`, `course_assignments`, `course_progress`, `quiz_attempts`, `quiz_attempt_answers`,
`course_ai_generations` (AI-generation audit trail), `training_plans`,
`training_plan_items`, `competency_templates`, `competency_template_items`, `competency_records`,
`competency_record_items`, `certificates`.

## Important Files

- `artifacts/caremetric-carebase/src/lib/supabase.ts` — Supabase client setup
- `artifacts/caremetric-carebase/src/lib/auth.tsx` — auth context (Supabase session + profile)
- `artifacts/caremetric-carebase/src/lib/viewingOrg.tsx` — platform_admin "Viewing as Org X" UX-only context
- `artifacts/caremetric-carebase/src/App.tsx` — frontend router with role-based access
- `artifacts/caremetric-carebase/src/components/layout/Sidebar.tsx` — role-aware navigation sidebar
- `artifacts/caremetric-carebase/src/hooks/*.ts` — one hand-written TanStack Query hook module per domain
- `artifacts/caremetric-carebase/src/lib/database.types.ts` — generated Supabase types (`mcp__Supabase__generate_typescript_types`)
- `supabase/migrations/` — full schema/RLS/function/storage history, source of truth for the database
- `supabase/functions/*/index.ts` — Edge Function source
