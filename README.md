# CareMetric Train

**[CareMetricTrain.com](https://caremetrictrain.com)**

CareMetric Train is a multi-tenant healthcare compliance-training and LMS platform for personal care homes,
assisted living facilities, and related healthcare organizations. It is built directly on Supabase: Postgres with
Row-Level Security, Supabase Auth, Supabase Storage, and Edge Functions. There is no separate API server -- the
React frontend talks to Supabase directly via `supabase-js`.

**Production**: https://caremetrictrain.com (Railway-hosted, service domain
`penntrain-production.up.railway.app`; see `DEPLOYMENT.md`).

## What's included

- Six-role RBAC (`platform_admin`, `org_admin`, `facility_manager`, `trainer`, `employee`, `auditor`) enforced by
  Postgres Row-Level Security, not application code.
- Core compliance tracking: organizations, facilities, employees, configurable training types, training records,
  medication practicums, live training classes, document uploads (Supabase Storage, signed URLs), alerts, audit
  logs, and a report center.
- A full LMS layer: course/version/block authoring, quizzes with server-side grading, course assignments and
  progress tracking, certificates (with a public `/verify/:slug` verification route), training plans, and
  competency checklist templates/records.
- A real, generated Compliance Binder PDF (`generate-compliance-binder` Edge Function using `pdf-lib`), replacing
  the earlier print-to-PDF mock.
- Admin user provisioning, role/org management, and bulk CSV employee import, all via Edge Functions running with
  the service-role key behind an authorization check on the caller's own role.
- A platform_admin-only "Viewing as Org X" UX filter for the admin console -- a convenience, not a security
  boundary, since `is_platform_admin()` already grants unrestricted RLS access.

## Run locally

```bash
pnpm install
pnpm --filter @workspace/caremetric-train dev
```

Copy `artifacts/caremetric-train/.env.example` to `.env` and fill in your Supabase project URL and publishable
(anon) key.

## Database / backend setup

All schema, RLS policies, functions, and storage buckets live in `supabase/migrations/`, applied in order via the
Supabase CLI or `mcp__Supabase__apply_migration`. Edge Function source lives in `supabase/functions/*/index.ts` and
must be declared in `supabase/config.toml` to auto-deploy via the Supabase GitHub integration.

1. Create a Supabase project (Postgres 17+).
2. Apply every migration under `supabase/migrations/` in filename order.
3. Deploy the Edge Functions under `supabase/functions/`.
4. Seed demo users via the Supabase Admin API (`auth.admin.createUser`) -- see demo credentials below; the
   `handle_new_user()` trigger creates the matching `profiles` row automatically.
5. Run `mcp__Supabase__generate_typescript_types` (or `supabase gen types typescript`) to produce
  `artifacts/caremetric-train/src/lib/database.types.ts`.

## Demo users

| Role | Email | Password |
|------|-------|----------|
| platform_admin | info@caremetrictrain.com | admin123 |
| org_admin | admin@sunrisehealthcare.com | demo123 |
| facility_manager | manager@sunrisemanor.com | demo123 |
| trainer | trainer@sunrisehealthcare.com | demo123 |
| employee | employee@sunrisehealthcare.com | demo123 |
| auditor | auditor@sunrisehealthcare.com | demo123 |
| org_admin | admin@maplegrove.com | demo123 |

See `ARCHITECTURE.md` for the full architecture writeup (RLS model, storage buckets, Edge Functions, route map).
