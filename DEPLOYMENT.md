# Deployment: Railway + Supabase

CareMetric Train's backend (Postgres, Auth, Storage, RLS, Edge Functions) already lives entirely in
Supabase -- see `ARCHITECTURE.md` and `README.md` for the architecture. This document covers the piece that
was missing: running the frontend in production on **Railway**, and how the two systems fit together.

## Architecture at a glance

```
Browser  --https-->  Railway (Node server, static SPA build)
Browser  --https-->  Supabase (Postgres + RLS, Auth, Storage, Edge Functions)
```

- **Railway** hosts and runs `artifacts/caremetric-train` -- a static Vite/React build served by a small
  Node process (`artifacts/caremetric-train/server/index.mjs`). There is no API layer on Railway; the
  browser talks to Supabase directly via `supabase-js`.
- **Supabase** ("CM Train" project) is the source of truth for everything else: schema, migrations,
  RLS policies, Auth (GoTrue), Storage buckets, and Edge Functions (`create-user`,
  `admin-update-user`, `bulk-import-employees`, `generate-compliance-binder`,
  `generate-course-video`, `check-course-video-status`, `list-heygen-options`).
- Railway does **not** run Postgres and does **not** proxy database traffic -- the app never opens a
  direct Postgres connection; every read/write goes through PostgREST/RLS or a Supabase Edge Function.

## 1. Supabase project setup

1. You already have a Supabase project for this app (project ref `xsqobvvreaovwibxwyvv`, "CM Train",
   Postgres 17, region `us-west-2`). For a new environment (e.g. a staging project), create a project
   at https://supabase.com/dashboard and note its project ref, URL, and API keys.
2. Apply every migration in `supabase/migrations/` in filename order:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies supabase/migrations/*.sql in order
   ```
   (equivalent to `pnpm run db:migrate` from the repo root once linked). This also creates the
   Storage buckets and RLS policies -- they're defined in the migrations, not a separate step.
3. Deploy the Edge Functions:
   ```bash
   npx supabase functions deploy create-user admin-update-user bulk-import-employees \
     generate-compliance-binder generate-course-video check-course-video-status list-heygen-options
   ```
   Or connect the Supabase GitHub integration (Project Settings -> Integrations) so pushes to `main`
   auto-deploy both migrations and functions declared in `supabase/config.toml`.
4. Set Edge Function secrets (these run on Supabase's infrastructure, never on Railway):
   ```bash
   npx supabase secrets set HEYGEN_API_KEY=... 
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
   Functions automatically by Supabase -- you do not set those secrets yourself.
5. **Auth URL configuration** (Authentication -> URL Configuration in the dashboard): set **Site URL**
   to the production domain (`https://caremetrictrain.com`) and add a **Redirect URL** for every domain
   the app is served from, e.g. `https://caremetrictrain.com/login` plus your
   `https://your-app.up.railway.app/login` fallback domain --
   `ForgotPassword.tsx` calls `supabase.auth.resetPasswordForEmail` with
   `redirectTo: window.location.origin + "/login"`, and Supabase Auth rejects redirects to
   unlisted origins.
6. Seed demo/admin users via the Supabase Admin API or the `create-user` Edge Function -- there is no
   public self-signup route by design (see `ARCHITECTURE.md` "Roles"). The `handle_new_user()` trigger
   creates the matching `profiles` row automatically.
7. Generate TypeScript types after any schema change:
   ```bash
   npx supabase gen types typescript --project-id <your-project-ref> \
     > artifacts/caremetric-train/src/lib/database.types.ts
   ```

### Remaining recommended Supabase hardening (one manual dashboard step)

- **Leaked password protection is disabled** (Authentication -> Policies): enable it to reject
  passwords found in known breach corpora (HaveIBeenPwned). This is an Auth-config toggle, not a
  SQL migration, so it has to be flipped in the dashboard (or via the Management API) rather than
  applied automatically.

See section 7 ("Security notes") for the database-level security fixes that *were* applied via
migration during this change, including one critical finding.

Everything else `get_advisors` reports (a handful of unindexed foreign keys, a few unused indexes,
duplicate-permissive-policy performance notes) predates this change and is a schema-tuning exercise
independent of the Railway/Supabase wiring -- left untouched to avoid touching a live database with
real tenant data outside the scope of this task.

## 2. Railway deployment

The repo root is a pnpm workspace; the deployable app is the `@workspace/caremetric-train` package. Keep
Railway's **Root Directory** setting at the repo root (not `artifacts/caremetric-train`) so `pnpm --filter`
can see the whole workspace and lockfile.

1. In Railway: **New Project -> Deploy from GitHub repo**, select this repository.
2. Railway auto-detects `railway.json` at the repo root:
   - Build: `pnpm install --frozen-lockfile && pnpm --filter @workspace/caremetric-train run build`
   - Start: `pnpm --filter @workspace/caremetric-train run start`
   - Healthcheck: `GET /health`
   Nixpacks reads `.node-version` (Node 24) and the `packageManager` field (`pnpm@10.28.1`) to
   provision the right toolchain automatically.
3. Add the environment variables below (Service -> Variables). Do **not** paste real secrets into
   any file in this repo -- only into Railway's variable UI.
4. Deploy. Railway assigns a `*.up.railway.app` domain; attach the production custom domain
   (`caremetrictrain.com`, under Service -> Settings -> Networking) and use both domains in step 1.5
   above (Supabase Auth redirect URLs).
5. Verify `GET https://<your-domain>/health` returns:
   ```json
   {
     "status": "ok",
     "service": "caremetric-train",
     "timestamp": "2026-07-04T12:00:00.000Z",
     "supabase": "configured",
     "supabaseReachable": true
   }
   ```
   `supabase` reflects whether `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set on the Railway
   service; `supabaseReachable` is a best-effort live check against Supabase Auth's public health
   route (2s timeout, never touches the service-role key, never fails the healthcheck response
   itself -- Railway only cares about the HTTP 200).

### Environment variables to set on the Railway service

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL (Project Settings -> API) |
| `VITE_SUPABASE_ANON_KEY` | yes | anon/publishable key -- safe for the browser, RLS is the real gate |
| `NODE_ENV` | recommended | set to `production` |
| `PORT` | no | Railway injects this automatically; the server reads it |
| `BASE_PATH` | no | e.g. `/train/`; only needed if served from a non-root subpath. Set it identically for both the build (`vite.config.ts` reads it) and the running server (`server/index.mjs` strips it before resolving files) -- both read the same `BASE_PATH` var, so one value covers both. |

Not needed for this repo (and intentionally left out of `.env.example` -- see the comments there for
why): `DATABASE_URL`, `NEXT_PUBLIC_*` (this is Vite, not Next.js), `SESSION_SECRET`/`AUTH_SECRET`
(Supabase Auth owns session state, no server-side session here), `STRIPE_SECRET_KEY` /
`RESEND_API_KEY` (no billing or transactional-email integration exists in this codebase today).
`SUPABASE_SERVICE_ROLE_KEY` must never be set on the Railway service -- it belongs only in Supabase
Edge Function secrets.

## 3. Local development

```bash
pnpm install
cp artifacts/caremetric-train/.env.example artifacts/caremetric-train/.env   # fill in your Supabase URL/anon key
pnpm run dev          # -> pnpm --filter @workspace/caremetric-train run dev, http://localhost:5173
```

To exercise the production build path locally:

```bash
pnpm --filter @workspace/caremetric-train run build
pnpm --filter @workspace/caremetric-train run start   # node server/index.mjs, http://localhost:8080
curl http://localhost:8080/health
```

## 4. Supabase Storage buckets

Defined in `supabase/migrations/` (search for `insert into storage.buckets`), not something you need
to recreate manually -- `supabase db push` creates them. For reference, the buckets in this project:

| Bucket | Public? | Purpose |
|---|---|---|
| `course-documents` | private | course PDFs/attachments |
| `certificates` | private | issued certificate PDFs; no client write policy, only `issue_certificate()`/service role |
| `external-uploads` | private | employee-uploaded documents |
| `signin-sheets` | private | training class attendance sheets |
| `competency-attachments` | private | competency record evidence uploads |
| `org-branding` | private | per-org logo/branding assets |
| `binder-exports` | private | generated compliance binder PDFs; Edge-Function-only write, downloaded via short-lived signed URL |
| `course-videos` | **public** | AI-avatar-generated course videos re-hosted after HeyGen's signed URLs expire; deliberate exception documented in `20260704155836_add_course_videos_public_bucket.sql` -- training content, not tenant-sensitive documents |

All private buckets are accessed via RLS-aware signed URLs generated server-side (Edge Functions) or
through Storage RLS policies scoped by `organization_id`/`facility_id`, so one org can never read
another org's files. Do not add a bucket or relax a policy without checking the corresponding
migration's write-policy comments first.

## 5. Connecting Railway to GitHub

Railway's GitHub integration (set up during "Deploy from GitHub repo") auto-builds on every push to
the tracked branch. To point it at a different branch or enable PR environments, use Railway's
Service -> Settings -> Source panel. This is independent of the Supabase GitHub integration (which
handles migrations/functions) -- both can watch the same repo without conflicting.

## 6. Data-access layer (already implemented)

The required data-access functions for this SaaS already exist in
`artifacts/caremetric-train/src/hooks/*.ts` and `src/lib/auth.tsx` -- this change did not need to build
them from scratch:

- current user profile / session -- `src/lib/auth.tsx` (`useAuth()`)
- current organization -- `useGetOrganization()` in `src/hooks/useOrganizations.ts`, `organizationId`
  on the auth user
- role checks -- `hasRole()` / `isPlatformAdmin()` / `canManageOrganization()`, added to
  `src/lib/auth.tsx` in this change and exposed as `useAuth().hasRole(...)`, alongside the existing
  ad hoc `user.role === "..."` checks already used throughout `src/pages/**` (left as-is; this is a
  reusable helper for new code, not a forced rewrite of existing call sites)
- list courses -- `useListCourses()` in `src/hooks/useCourses.ts`
- assign a course -- `useCreateCourseAssignment()` in `src/hooks/useCourseAssignments.ts`
- mark progress / complete -- `useUpsertCourseProgress()` and `useCompleteCourseAssignment()`
  (RPC `complete_course_assignment`) in `src/hooks/useCourseAssignments.ts`
- start/submit quiz attempt -- `useStartQuizAttempt()`, `useSubmitQuizAttemptAnswer()`,
  `useGradeQuizAttempt()` (RPC `grade_quiz_attempt`) in `src/hooks/useQuizzes.ts`
- issue certificate -- `useIssueCertificate()` (RPC `issue_certificate`) in
  `src/hooks/useCertificates.ts`
- audit log -- write-only via Postgres trigger (`audit_log_trigger()`); there is deliberately no
  client-side insert hook -- `audit_logs` revokes client `INSERT`/`UPDATE`/`DELETE` entirely
  (`20260704053527_group_b_rls_policies.sql`)

## 7. Security notes

### Fixes applied in this change (adversarial production audit)

A follow-up audit of this Railway/Supabase wiring, run against the live project, surfaced and fixed
four real database-level issues (in addition to the app-level fixes described elsewhere in this
doc). All were verified with rollback-safe transaction tests against the live project (insert,
inspect, `rollback` -- zero data persisted) before being written up here.

- **Critical -- account-takeover via public signup**
  (`20260704180244_fix_handle_new_user_trust_boundary.sql`): `handle_new_user()` populated
  `profiles.role`/`profiles.organization_id` -- the two columns every RLS policy keys off of --
  directly from `auth.users.raw_user_meta_data`, which is exactly the field an unauthenticated
  caller controls via a plain `POST /auth/v1/signup` request using only the public anon key. Since
  this Supabase project currently has self-service email signup **enabled**, anyone could have
  self-registered as `platform_admin` with a spoofed `organization_id`, bypassing the app's own
  admin-gated `create-user` Edge Function entirely. Fixed by reading role/organization_id from
  `raw_app_meta_data` instead -- a field only settable via the service-role Admin API, never by the
  public signup endpoint -- and updating `create-user`'s Edge Function to set it there (redeployed
  as part of this fix, so admin-provisioned account creation is unaffected). **Recommended
  additional step**: disable public email signup entirely in Authentication -> Providers unless
  self-service signup is an intended product feature; this fix closes the privilege-escalation path
  regardless, but signup is not otherwise used by this app's UI (see `ARCHITECTURE.md` "Roles").
- **High -- unauthenticated cross-tenant RPC**
  (`20260704180605_revoke_public_grant_on_privileged_functions.sql`): a prior migration
  (`tighten_function_grants.sql`) revoked `EXECUTE` on several `SECURITY DEFINER` functions from
  the named `anon`/`authenticated` roles, but never from `PUBLIC` -- Postgres grants `EXECUTE` to
  `PUBLIC` automatically at `CREATE FUNCTION` time, and revoking a named role's grant doesn't touch
  that separate grant. `recalculate_all_compliance()` (no internal authorization check, mutates
  `employee_training_records`/`practicums`/`alerts` across every organization) was confirmed
  callable by `anon` with zero session as a result. Fixed by revoking from `PUBLIC` on that
  function plus `audit_log_trigger()`, `handle_new_user()`, and `complete_training_class()`, and
  adding `alter default privileges ... revoke execute on functions from public` so new functions
  don't inherit the same gap. The existing `authenticated` grants that legitimate app code depends
  on (`useRecalculateCompliance`, `useTrainingClasses.ts`) were left intact and verified still
  working.
- **High/Medium -- facility misattribution**
  (`20260704180646_stamp_facility_scope_from_employee_on_writes.sql`): `employee_training_records`,
  `practicums`, and `training_documents` let a client-supplied `facility_id` diverge from the
  referenced employee's real facility -- a `facility_manager`/`trainer` assigned only to Facility A
  could insert a record for an employee actually at Facility B while claiming `facility_id=A`,
  since RLS validated `is_assigned_to_facility(facility_id)` against the caller's claim, not the
  employee's real assignment. This is the same bug class already fixed for `competency_records` in
  `20260704164627_fix_codex_review_findings.sql`; this change extends the same
  `stamp_scope_from_employee()` trigger to the two `NOT NULL employee_id` tables, and adds a
  null-safe variant (`stamp_scope_from_employee_if_present()`) for `training_documents`, whose
  `employee_id` is nullable (facility-wide/roster uploads legitimately have no single employee).
- **Low -- stale comment** (`useCompetencies.ts`): updated a comment that described
  `competency_records`' pre-fix trigger behavior to match what's actually in the DB today, and
  pointed at the sibling-table fix above so it isn't mistaken for a safe pattern to copy.

A few findings from the same audit were reviewed and intentionally **not** changed: several RLS
helper functions (`current_org_id()`, `is_platform_admin()`, etc.) also carry a leftover `PUBLIC`
grant, but `authenticated` needs direct `EXECUTE` on them for RLS policies to evaluate at all (a
policy's `USING`/`WITH CHECK` expression runs with the querying role's privileges), so revoking
more broadly there risks locking out every signed-in user -- left as accepted, harmless residual
advisor noise (these functions are auth.uid()-gated internally and return nothing useful to an
`anon` caller regardless).

**Follow-up from PR review** (`20260704182232_extend_stamp_scope_triggers_to_update.sql`): an
automated review on the PR correctly caught that the fix above only stamped scope on `INSERT`,
while `employee_training_records_update`/`practicums_update` RLS policies re-validate
`is_assigned_to_facility(facility_id)` on `UPDATE` too -- so the same facility-spoofing path was
still open via `useTrainingRecords.ts`/`usePracticums.ts` update calls. Fixed by firing the same
trigger on `BEFORE INSERT OR UPDATE`; verified with a rollback-safe test reproducing the exact
scenario (update an existing row's `facility_id` to a facility the employee doesn't belong to --
correctly overwritten back to the employee's real facility). `training_documents` has no `UPDATE`
policy at all, so it was never exploitable there, but the trigger was extended for consistency.

### Standing security posture

- The service-role key is never referenced anywhere under `artifacts/caremetric-train/src` or
  `artifacts/caremetric-train/server` -- confirmed by grep as part of this change. Vite only exposes
  `VITE_`-prefixed variables to the client bundle (`import.meta.env`), which is itself a structural
  guardrail against accidentally shipping the service-role key to the browser.
- RLS is enabled on every table (`mcp__Supabase__list_tables` confirms `rls_enabled: true` across
  the board); `certificates` and `audit_logs` are intentionally not client-writable -- writes only
  happen through `SECURITY DEFINER` RPCs or the trigger, both server-controlled.
- `organization_id` spoofing is prevented at the database layer: RLS policies compare against
  `current_org_id()` (derived from the authenticated JWT's `profiles` row), not a client-supplied
  value, so a request cannot claim another org's `organization_id` and have it honored.
  `facility_id` spoofing (a narrower, in-org concern) is covered by the fix above.
- **PHI/HIPAA**: this app stores healthcare-adjacent compliance/training data (employee names,
  training records, certificates), not clinical PHI, but treat it with the same care. Before storing
  any real patient-linked data, confirm a Business Associate Agreement (BAA) is in place with both
  Supabase and Railway, and that both platforms' HIPAA-eligible service tiers are enabled -- neither
  is HIPAA-eligible by default on their base plans. Do not upload real PHI to any storage bucket
  until that's confirmed.

## 8. Verifying the deployment

```bash
curl -s https://<your-domain>/health | jq
```

Expect `status: "ok"` and `supabase: "configured"`. If `supabaseReachable` is `false`, double-check
`VITE_SUPABASE_URL` on the Railway service and that the Supabase project is not paused.

## Limitations / manual steps remaining

- Railway project creation, GitHub connection, and env var entry must be done in the Railway
  dashboard -- not scriptable from this repo.
- Supabase Auth redirect URL and Site URL configuration must be set in the Supabase dashboard once
  you know your Railway domain.
- Leaked password protection (Authentication -> Policies) is still disabled and must be toggled on
  manually in the dashboard -- it's an Auth config setting, not something a SQL migration can flip.
- Public email signup is currently enabled on the live project. The privilege-escalation path this
  allowed is closed (see section 7), but if self-service signup isn't an intended product feature,
  disable it in Authentication -> Providers as defense in depth.
- No linter (ESLint/Biome/etc.) is configured in this repo; `pnpm run typecheck` (tsc, no-emit) is
  the static check currently available. Add one separately if desired -- out of scope here.
- `pnpm run db:migrate` requires `supabase login` + `supabase link --project-ref <ref>` to have been
  run once first (interactive, not scriptable).
