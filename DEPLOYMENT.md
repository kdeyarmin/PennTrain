# Deployment: Railway + Supabase

CareMetric CareBase's backend (Postgres, Auth, Storage, RLS, Edge Functions) already lives entirely in
Supabase -- see `ARCHITECTURE.md` and `README.md` for the architecture. This document covers the piece that
was missing: running the frontend in production on **Railway**, and how the two systems fit together.

> **Production URLs**: the public domain is **https://cmcarebase.com**, a custom domain
> attached to the Railway service, which is also reachable at its Railway-provided domain
> **https://carebase-production.up.railway.app**. Wherever this doc says `<your-domain>` or
> `your-app.up.railway.app`, use `cmcarebase.com` for the current production environment.
> Because the app answers on *both* origins, Supabase Auth's Redirect URL allowlist must contain
> both (see step 1.5 below).

## Architecture at a glance

```
Browser  --https-->  Railway (Node server, static SPA build)
Browser  --https-->  Supabase (Postgres + RLS, Auth, Storage, Edge Functions)
```

- **Railway** hosts and runs `artifacts/caremetric-train` -- a static Vite/React build served by a small
  Node process (`artifacts/caremetric-train/server/index.mjs`). There is no API layer on Railway; the
  browser talks to Supabase directly via `supabase-js`. The server serves precompressed (brotli/
  gzip) assets generated at build time by `server/precompress.mjs` (Railway's proxy does not
  compress for you), sends baseline security headers (nosniff, frame denial, HSTS,
  Referrer-Policy), binds dual-stack `::`, tunes keep-alive above the proxy's idle window, and
  drains in-flight requests on SIGTERM.
- **Supabase** ("CM CareBase" project) is the source of truth for everything else: schema, migrations,
  RLS policies, Auth (GoTrue), Storage buckets, and Edge Functions (`create-user`,
  `admin-update-user`, `bulk-import-employees`, `generate-compliance-binder`,
  `generate-course-video`, `check-course-video-status`, `list-heygen-options`).
- Railway does **not** run Postgres and does **not** proxy database traffic -- the app never opens a
  direct Postgres connection; every read/write goes through PostgREST/RLS or a Supabase Edge Function.

## 1. Supabase project setup

1. You already have a Supabase project for this app (project ref `xsqobvvreaovwibxwyvv`, "CM CareBase",
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
3. Deploy the Edge Functions (every function declared in `supabase/config.toml`):
   ```bash
   npx supabase functions deploy create-user admin-update-user bulk-import-employees \
     generate-compliance-binder generate-certificate-pdf generate-incident-report-pdf \
     attest-policy generate-class-notice-pdf generate-poc-document generate-course-video \
     check-course-video-status list-heygen-options generate-course-curriculum \
     regenerate-course-block poll-heygen-video-statuses dispatch-notifications \
     screen-exclusions send-auth-email invite-user signup-organization
   ```
   Or connect the Supabase GitHub integration (Project Settings -> Integrations) so pushes to `main`
   auto-deploy both migrations and functions declared in `supabase/config.toml`.
4. Set Edge Function secrets (these run on Supabase's infrastructure, never on Railway):
   ```bash
   npx supabase secrets set HEYGEN_API_KEY=... \
     ANTHROPIC_API_KEY=... \
     SENDGRID_API_KEY=... \
     NOTIFICATION_FROM_EMAIL='CareMetric CareBase <notifications@cmcarebase.com>' \
     TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=... \
     CRON_SHARED_SECRET=... \
     TURNSTILE_SECRET_KEY=... \
     SIGNUP_RATE_LIMIT_PEPPER=... \
     SIGNUP_REDIRECT_ORIGINS='https://cmcarebase.com,https://carebase-production.up.railway.app' \
     PUBLIC_APP_URL='https://cmcarebase.com'
   ```
   The AI Edge Functions default to the highest-capability generally available Claude model and
   then fall back through current strong models. If Anthropic changes availability, cost, or account
   entitlements, override model selection without a code deploy by setting comma-separated fallback
   secrets:
   - `ANTHROPIC_COURSE_DRAFT_MODEL` / `ANTHROPIC_COURSE_DRAFT_FALLBACK_MODELS`
   - `ANTHROPIC_COURSE_REGENERATION_MODEL` / `ANTHROPIC_COURSE_REGENERATION_FALLBACK_MODELS`
   - `ANTHROPIC_RESIDENT_SUMMARY_MODEL` / `ANTHROPIC_RESIDENT_SUMMARY_FALLBACK_MODELS`

   Store the same `CRON_SHARED_SECRET` in Supabase Vault before the cron-hardening migration runs:
   ```sql
   select vault.create_secret('<same random value>', 'cron_shared_secret');
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
   Functions automatically by Supabase -- you do not set those secrets yourself.
   `SENDGRID_API_KEY`/`NOTIFICATION_FROM_EMAIL` and the `TWILIO_*` trio are read by the
   `dispatch-notifications` function (training due/expired reminders, escalations, the Monday
   digest); each channel is skipped (not failed) if its credentials aren't set, so these can be
   added later without breaking anything. Create the SendGrid API key with **Mail Send** scope only,
   and verify the `NOTIFICATION_FROM_EMAIL` sender identity (Single Sender Verification or a
   verified domain) in the SendGrid dashboard first -- SendGrid rejects sends from an unverified
   `from` address.
5. **Auth URL configuration** (Authentication -> URL Configuration in the dashboard): set **Site URL**
   to the public domain (production: `https://cmcarebase.com`) and add a **Redirect URL** for
   every origin the app is served from -- production needs both
   `https://cmcarebase.com/reset-password` and
   `https://carebase-production.up.railway.app/reset-password`. `ForgotPassword.tsx` calls
   `supabase.auth.resetPasswordForEmail` with `redirectTo: window.location.origin + basePath +
   "/reset-password"` (not `/login`), and Supabase Auth silently falls back to the bare Site URL --
   no error shown anywhere -- when `redirect_to` isn't an allowlisted match, which strands the user on
   the marketing/login page instead of the password-set form after they click a legitimate reset link.
6. **(Optional) Route Supabase Auth's own mail through SendGrid too.** Step 4 above wires SendGrid
   into the `dispatch-notifications` Edge Function (training reminders/digests), but password-reset,
   invite, and email-change confirmation mail is sent separately by Supabase Auth's built-in mailer.
   Two ways to redirect that, in order of preference:
   - **Send Email Hook (recommended).** Deploy the `send-auth-email` Edge Function
     (`npx supabase functions deploy send-auth-email`), then in the dashboard: Authentication ->
     Hooks -> add a **Send Email** hook of type HTTPS, pointing at
     `https://<project-ref>.supabase.co/functions/v1/send-auth-email`. The dashboard generates a
     signing secret when you save it -- set that as `npx supabase secrets set
     SEND_EMAIL_HOOK_SECRET='v1,whsec_...'`. Once the hook is enabled, Supabase Auth calls this
     function over plain HTTPS for every auth email instead of using SMTP, so it goes through the
     exact same SendGrid `v3/mail/send` API (and the same `SENDGRID_API_KEY`/
     `NOTIFICATION_FROM_EMAIL` secrets) as `dispatch-notifications` -- no SMTP involved at all.
     This is the more reliable option: raw SMTP relays are more prone to being slow or silently
     blocked on outbound network paths than a plain HTTPS API call.
   - **Custom SMTP (simpler, less reliable).** Authentication -> Emails -> SMTP Settings, enable
     "Custom SMTP", and use SendGrid's SMTP relay (`smtp.sendgrid.net:587`, username `apikey`,
     password = a SendGrid API key with Mail Send scope). Both this and the Hook are dashboard-only
     settings, not something a migration can configure. If the Hook is enabled, it takes priority
     and Custom SMTP is bypassed entirely (see [Supabase's Send Email Hook
     docs](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) for the exact
     precedence rules).
7. Create production admin users with `invite-user` or the Supabase Admin API using environment-specific
   credentials. Do not run SQL that seeds reusable platform_admin or demo passwords. Self-service `/signup`
   is available for new organizations and requires Turnstile plus invite-email verification.
8. Generate TypeScript types after any schema change:
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

The repo root is a pnpm workspace; the deployable app is the `@workspace/caremetric-carebase` package. Keep
Railway's **Root Directory** setting at the repo root (not `artifacts/caremetric-train`) so `pnpm --filter`
can see the whole workspace and lockfile.

1. In Railway: **New Project -> Deploy from GitHub repo**, select this repository.
2. Railway auto-detects `railway.json` at the repo root:
   - Builder: **Railpack** (Railway's current default builder; Nixpacks is deprecated on Railway
     and its hosted version cannot provision Node 24 -- it silently falls back to Node 18, which
     breaks the Vite 7 build. Do not switch this service back to Nixpacks.)
   - Build: `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @workspace/caremetric-carebase run typecheck && pnpm --filter @workspace/caremetric-carebase run build`
    (Railpack also runs its own install beforehand; the explicit one is a harmless belt-and-braces
    step, and the typecheck is the deploy's static gate; GitHub Actions runs the broader
    `check:all`-style workflow on pushes/PRs)
   - Start: `corepack enable && pnpm --filter @workspace/caremetric-carebase run start`
   - Healthcheck: `GET /health`
   - Watch paths: only changes under `artifacts/caremetric-train/` and the root toolchain/config files
     trigger a deploy, so pushes touching e.g. `artifacts/mockup-sandbox` or `scripts/` don't
     redeploy production.
   Railpack resolves Node from `engines.node` in package.json / `.nvmrc` / `.node-version` (all
   pinned to Node 24 here; `RAILPACK_NODE_VERSION` would override) and installs pnpm 10.28.1 via
   Corepack from the `packageManager` field.
   **`railpack.json` (repo root) pins `"provider": "node"` and must stay.** The repo root also
   contains `deno.json`/`deno.lock` (Deno tooling for the Supabase Edge Functions), and Railpack's
   auto-detection prefers Deno over Node when both are present -- without the pin it builds a
   Deno-only image with no Node/Corepack/pnpm, and the build dies with `pnpm: not found`
   (exit 127). The `corepack enable` prefix in `buildCommand`/`startCommand` is belt-and-braces on
   top of that: it guarantees the `pnpm` shim exists even if Railpack's own package-manager
   install step is skipped when a custom build command is set. Because `railway.json` sets an explicit
   `startCommand`, Railpack's Vite-SPA auto-detection (serving via Caddy) is overridden and the
   custom Node server is used -- keep `startCommand` in place, or set `RAILPACK_NO_SPA=1` to make
   that explicit.
3. Add the environment variables below (Service -> Variables) **before the first deploy**. Do
   **not** paste real secrets into any file in this repo -- only into Railway's variable UI.
   **Important:** the two `VITE_` variables are baked into the JS bundle at build time, not read
   at runtime. If they are missing the build now fails loudly (guard in `vite.config.ts`); if you
   change them later, trigger a redeploy (which rebuilds) -- merely restarting the service ships
   the old bundle, and `/health` has no way to detect that (see step 5 below).
4. Deploy. Railway assigns a `*.up.railway.app` domain -- for this project it assigned
   `carebase-production.up.railway.app` -- and the production custom domain
   (`cmcarebase.com`) is attached under Service -> Settings -> Networking. Every domain the
   app answers on must be listed in step 1.5 above (Supabase Auth redirect URLs); update that
   list and re-deploy whenever a domain is added.
5. Verify `GET https://cmcarebase.com/health` returns:
   ```json
   {
     "status": "ok",
     "service": "caremetric-carebase",
     "timestamp": "2026-07-04T12:00:00.000Z"
   }
   ```
   `/health` deliberately reports nothing about Supabase configuration or reachability: this server
   never talks to Supabase itself (the browser does, using whatever `VITE_SUPABASE_URL`/
   `VITE_SUPABASE_ANON_KEY` were baked into the bundle at build time), so a field derived from this
   process's own env vars at request time could silently diverge from what the served bundle
   actually contains (no rebuild on a runtime variable change, dummy build-time values, etc.) --
   exactly the false assurance a healthcheck must not give. A green `/health` only means the Node
   process is up; confirm Supabase connectivity by loading the app in a browser (step 8).

### Environment variables to set on the Railway service

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL (Project Settings -> API). **Build-time**: baked into the bundle; changes require a redeploy, not just a restart |
| `VITE_SUPABASE_ANON_KEY` | yes | anon/publishable key -- safe for the browser, RLS is the real gate. **Build-time**, same caveat as above |
| `VITE_TURNSTILE_SITE_KEY` | yes | Cloudflare Turnstile site key for `/signup`. **Build-time**, same redeploy caveat as other `VITE_` values |
| `VITE_DEMO_ACCOUNTS_JSON` | no | Optional JSON array for a deliberate demo environment. Leave unset in production unless public demo access is intentionally enabled |
| `NODE_ENV` | no | Railpack already sets `production`; setting it yourself is harmless |
| `PORT` | no | Railway injects this automatically; the server reads it |
| `HOST` | no | the server binds dual-stack `::` by default (Railway's recommendation); override only if you need something else |
| `BASE_PATH` | no | e.g. `/train/`; only needed if served from a non-root subpath. Set it identically for both the build (`vite.config.ts` reads it) and the running server (`server/index.mjs` strips it before resolving files) -- both read the same `BASE_PATH` var, so one value covers both. |

Never set `NPM_CONFIG_PRODUCTION=true` on this service: every dependency of the app (including
`vite` itself) lives in `devDependencies`, and that variable makes pnpm skip them at install,
emptying the build. (The buildCommand passes `--prod=false` explicitly to defend against it, and
Railpack itself sets `NPM_CONFIG_PRODUCTION=false`; for the same reason, never set
`RAILPACK_PRUNE_DEPS=1`.)

Not needed for this repo (and intentionally left out of `.env.example` -- see the comments there for
why): `DATABASE_URL`, `NEXT_PUBLIC_*` (this is Vite, not Next.js), `SESSION_SECRET`/`AUTH_SECRET`
(Supabase Auth owns session state, no server-side session here). `SUPABASE_SERVICE_ROLE_KEY` must never be set on the
Railway service -- it belongs only in Supabase Edge Function secrets, alongside `SENDGRID_API_KEY`
and `TWILIO_*` (see step 4 below) -- none of these are Railway variables.

## 3. Local development

> **Platform note:** `pnpm-workspace.yaml` uses pnpm `supportedArchitectures` to install native
> optional dependencies for the current developer machine plus linux-x64-glibc CI/deploys.
> Windows/macOS local installs are supported for frontend typecheck/unit-test work; Deno is still
> required for `pnpm run check:edge-functions`.

```bash
pnpm install
cp artifacts/caremetric-train/.env.example artifacts/caremetric-train/.env   # fill in your Supabase URL/anon key
pnpm run dev          # -> pnpm --filter @workspace/caremetric-carebase run dev, http://localhost:5173
```

To exercise the production build path locally (the build fails fast if the `VITE_` vars are
missing from your `.env`/environment -- that's the `vite.config.ts` guard doing its job):

```bash
pnpm --filter @workspace/caremetric-carebase run build   # vite build + server/precompress.mjs (.br/.gz)
pnpm --filter @workspace/caremetric-carebase run start   # node server/index.mjs, http://localhost:8080
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
  as part of this fix, so admin-provisioned account creation is unaffected). Production should keep
  plain Supabase email signup disabled in Authentication -> Providers; the intended self-service
  path is the hardened `signup-organization` Edge Function, which creates a brand-new organization
  only after Turnstile, rate-limit, platform-setting, and invite-email checks pass.
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
- **AI + resident data**: `resident_assessment_forms.content` is the one place in the app that
  stores real clinical/functional-assessment content (see `residentAssessmentFormSchema.ts`). The
  `generate-resident-assessment-summary` edge function can draft its "Overall Wellness Summary" via
  Anthropic Claude, but this is gated off by the `ai_wellness_summary_generation_enabled`
  `platform_settings` row, which defaults to `false`. Every other AI integration in this codebase
  (course drafting) is scoped to training content and never touches resident data -- do not flip
  this setting to `true` until a BAA with the AI vendor has been confirmed to cover resident data,
  same as the Supabase/Railway BAA requirement above.

## 8. Verifying the deployment

```bash
curl -s https://cmcarebase.com/health | jq
# same app on the Railway-provided domain:
curl -s https://carebase-production.up.railway.app/health | jq
```

Expect `status: "ok"` -- that only confirms the Node process is up and serving requests, nothing
about Supabase. `/health` intentionally can't tell you whether the served bundle has working
`VITE_` values (see step 5), so the real verification is to load the app in a browser and confirm
the login page renders (a blank page means the bundle was built without the `VITE_` vars) --
after changing `VITE_` variables, redeploy (rebuild); a mere restart ships the old bundle and a
green `/health` would not reveal that.

Remember that `/health` reflects the **server process env**, while the SPA uses values **baked in
at build time** -- after changing `VITE_` variables, redeploy (rebuild); don't trust a green
`/health` after a mere restart. Then load the app in a browser and confirm the login page renders
(a blank page means the bundle was built without the `VITE_` vars).

## Limitations / manual steps remaining

- Railway project creation, GitHub connection, and env var entry must be done in the Railway
  dashboard -- not scriptable from this repo.
- Supabase Auth redirect URL and Site URL configuration must be set in the Supabase dashboard.
  The production values: Site URL `https://cmcarebase.com`; Redirect URLs
  `https://cmcarebase.com/login` and `https://carebase-production.up.railway.app/login`.
- Leaked password protection (Authentication -> Policies) is still disabled and must be toggled on
  manually in the dashboard -- it's an Auth config setting, not something a SQL migration can flip.
- Keep plain Supabase email signup disabled in Authentication -> Providers. Self-service signup
  should go through `signup-organization`, which enforces Turnstile, rate limits, and invite-email
  verification before the org_admin can set a password.
- No linter (ESLint/Biome/etc.) is configured in this repo yet; CI now runs install, typecheck,
  unit tests, Edge Function `deno check`, and production build. Add a linter separately if desired.
- `pnpm run db:migrate` requires `supabase login` + `supabase link --project-ref <ref>` to have been
  run once first (interactive, not scriptable).
- `SENDGRID_API_KEY` must be set via `supabase secrets set` (step 1.4) for the training-reminder
  emails `dispatch-notifications` sends to actually go out -- without it, those deliveries are
  logged as `skipped` rather than failing loudly. Routing Supabase Auth's own password-reset/
  email-change mail through SendGrid too (step 1.6) is a separate, optional dashboard setting.
