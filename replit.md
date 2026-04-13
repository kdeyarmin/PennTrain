# PA MedTrack — Workspace

## Overview

PA MedTrack is a production-ready, multi-tenant SaaS compliance tracking platform for Pennsylvania Personal Care Homes (PCH) and Assisted Living Residences (ALR). It tracks medication administration training, certifications, annual practicums, training hours, documents, alerts, and 10 compliance report types.

## Architecture

pnpm workspace monorepo using TypeScript. The Express API server serves both the REST API (`/api/*`) and the React frontend (via Vite middleware in dev, static files in production).

### Packages

- `artifacts/api-server` — Express 5 backend + Vite frontend middleware (port 8080)
- `artifacts/pa-medtrack` — React + Vite frontend (served by api-server in dev via Vite middleware mode)
- `artifacts/mockup-sandbox` — Canvas/design mockup sandbox (port 8081)
- `lib/db` — Drizzle ORM schema + migrations + seed
- `lib/api-spec` — OpenAPI spec (`openapi.yaml`)
- `lib/api-zod` — Generated Zod schemas from OpenAPI spec
- `lib/api-client-react` — Generated React Query hooks from OpenAPI spec

### Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **API framework**: Express 5
- **Frontend**: React 18, Vite 7, Tailwind CSS v4, shadcn/ui, Wouter routing
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Session-based (express-session + bcryptjs), cookie `httpOnly`
- **Validation**: Zod, drizzle-zod
- **API codegen**: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- **API server build**: esbuild (ESM bundle) — production only; dev uses tsx
- **Dev server**: `tsx` runs api-server + Vite middleware serves frontend

## Key Design Decisions

1. **Single-port architecture**: Both the API (`/api/*`) and frontend are served from port 8080 (api-server). Vite middleware is used in dev; static file serving in production.
2. **Session auth**: Cookie-based sessions (`SESSION_SECRET` env var, defaults to dev secret). Cookie is `httpOnly`, 8-hour maxAge.
3. **Dev mode**: API server runs via `tsx` (no bundling in dev), Vite runs as Express middleware with `configFile: false`.

## Roles

- `platform_admin` — routes: `/admin`, `/admin/organizations`, `/admin/organizations/:id`, `/admin/facilities`, `/admin/facilities/:id`, `/admin/employees`, `/admin/employees/:id`, `/admin/alerts`, `/admin/users`, `/admin/audit`
- `org_admin` — routes: `/app`, `/app/facilities`, `/app/facilities/:id`, `/app/employees`, `/app/employees/:id`, `/app/training-matrix`, `/app/practicums`, `/app/alerts`, `/app/reports`, `/app/users`, `/app/documents`, `/app/settings`, `/app/audit`
- `facility_manager` — same as org_admin
- `trainer` — routes: `/trainer`, `/trainer/classes`, `/trainer/facilities`, `/trainer/employees`
- `employee` — routes: `/me`, `/me/trainings`, `/me/documents`

## Security / Tenant Isolation

- POST /employees, /training-records, /practicums derive organizationId from session (never from request body)
- Facility ownership is validated against the requesting user's organization
- org_admin cannot create platform_admin users (privilege escalation blocked)
- PATCH /users blocks org_admin from changing organizationId or escalating to higher roles
- Facilities/Employees/Alerts pages use role-aware internal link basePaths (`/admin/*` for platform_admin, `/app/*` for org roles)

## Demo Credentials (seeded)

| Role | Email | Password |
|------|-------|----------|
| platform_admin | admin@pamedtrack.com | admin123 |
| org_admin | admin@sunrisehealthcare.com | demo123 |
| facility_manager | manager@sunrisemanor.com | demo123 |
| trainer | trainer@sunrisehealthcare.com | demo123 |
| org_admin | admin@maplegrove.com | demo123 |

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run api-server + frontend (dev)
- `pnpm --filter @workspace/api-server run build` — build api-server (production)
- `pnpm --filter @workspace/pa-medtrack run build` — build frontend (production)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client hooks from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run seed` — re-seed the database

## Database Schema

Tables: `users`, `organizations`, `facilities`, `employees`, `training_types`, `employee_training_records`, `practicums`, `training_documents`, `alerts`, `audit_logs`, `employee_training_hour_buckets`, `facility_user_assignments`, `organization_settings`

## API Routes

All routes prefixed with `/api/`:
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`
- `GET/POST /organizations`, `GET/PUT/DELETE /organizations/:id`, `GET /organizations/:id/stats`
- `GET/POST /facilities`, `GET/PUT/DELETE /facilities/:id`, `GET /facilities/:id/compliance-summary`
- `GET/POST /employees`, `GET/PUT/DELETE /employees/:id`, `GET /employees/:id/compliance-summary`, `GET /employees/:id/transcript`
- `GET/POST /training-types`, `GET/PUT/DELETE /training-types/:id`
- `GET/POST /training-records`, `GET/PUT/DELETE /training-records/:id`, `PATCH /training-records/:id/verify`
- `GET /training-matrix`
- `GET/POST /practicums`, `GET/PUT/DELETE /practicums/:id`
- `GET /documents`, `GET/DELETE /documents/:id`
- `GET /alerts`, `PATCH /alerts/:id/dismiss`, `PATCH /alerts/:id/resolve`, `PATCH /alerts/bulk-update`, `POST /alerts/generate`
- `GET /audit-logs`
- `GET/POST /users`, `GET/PUT/DELETE /users/:id`
- `GET /dashboard/summary`
- Reports: `GET /reports/compliance-summary`, `GET /reports/due-soon`, `GET /reports/expired`, `GET /reports/annual-hours`, `GET /reports/facility-scores`, `GET /reports/employee-transcript`, `GET /reports/training-type-compliance`, `GET /reports/practicum-status`, `GET /reports/new-hires`, `GET /reports/compliance-by-facility`

## Important Files

- `artifacts/api-server/src/app.ts` — Express app + Vite middleware setup
- `artifacts/api-server/src/routes/index.ts` — All API route definitions
- `artifacts/api-server/src/lib/compliance.ts` — Compliance calculation logic
- `artifacts/pa-medtrack/src/App.tsx` — Frontend router with role-based access
- `artifacts/pa-medtrack/src/components/layout/Sidebar.tsx` — Role-aware navigation sidebar
- `lib/db/src/schema/index.ts` — Full DB schema
- `lib/db/src/seed.ts` — Demo data seed script
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
