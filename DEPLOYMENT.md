# Deployment: Railway + Supabase

CareMetric CareBase uses Supabase for Postgres, Auth, Storage, RLS, and Edge Functions.
Railway serves the frontend and supports an opt-in runtime for SMS MFA and billing providers.
This document explains configuration, credential placement, and rollout for both runtimes;
see `ARCHITECTURE.md` and `README.md` for the architecture.

> **Production URL**: the public domain is **https://cmcarebase.com**, a custom domain
> attached to the Railway service. The previously documented
> `carebase-production.up.railway.app` hostname currently returns Railway's
> `Application not found` response and must not be used for redirects or application links.
> If Railway assigns a new provider hostname, verify it in Service -> Settings -> Networking
> before adding it to any allowlist.

## Architecture at a glance

- **Railway** hosts and runs `artifacts/caremetric-carebase` -- a static Vite/React build served by a small
  Node process (`artifacts/caremetric-carebase/server/index.mjs`), the learning-package proxy, and
  four optional `/api/providers/` routes for SMS MFA and billing. Application data still uses
  Supabase directly via `supabase-js`. The server serves precompressed (brotli/
  gzip) assets generated at build time by `server/precompress.mjs` (Railway's proxy does not
  compress for you), sends baseline security headers (nosniff, frame denial, HSTS,
  Referrer-Policy), binds dual-stack `::`, tunes keep-alive above the proxy's idle window, and
  drains in-flight requests on SIGTERM.
- **Supabase** ("CM Train" project) is the source of truth for schema, migrations,
  RLS policies, Auth (GoTrue), Storage buckets, and Edge Functions (`create-user`,
  `admin-update-user`, `bulk-import-employees`, `generate-compliance-binder`,
  `generate-course-video`, `check-course-video-status`, `list-heygen-options`).
- Railway does **not** run Postgres and does **not** proxy database traffic -- the app never opens a
  direct Postgres connection. Browser data requests retain PostgREST/RLS; trusted provider handlers
  reuse their existing Supabase clients and authorization checks.

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
3. Deploy the Edge Functions (every function declared in `supabase/config.toml`):
   ```bash
   npx supabase functions deploy
   ```
   Note: merges to `main` deploy functions automatically — the `Deploy migrations` workflow
   (`.github/workflows/deploy-migrations.yml`) runs `supabase functions deploy` after `db push`
   once CI passes, so the manual command is only needed for first-time setup or hotfixes.
4. Configure credentials where their consuming handlers run. The example below covers functions
   that remain on Supabase, including Auth mail and notification delivery. In Railway provider
   mode, keep Stripe and SMS MFA credentials in Railway server variables using the table below;
   do not copy them into Supabase for those four routes.
   ```bash
   npx supabase secrets set HEYGEN_API_KEY=... \
     ANTHROPIC_API_KEY=... \
     ANTHROPIC_BAA_CONFIRMED=true \
     SENDGRID_API_KEY=... \
     NOTIFICATION_FROM_EMAIL='CareMetric CareBase <notifications@cmcarebase.com>' \
     SEND_EMAIL_HOOK_SECRET='v1,whsec_...' \
     WEB_PUSH_VAPID_PUBLIC_KEY=... WEB_PUSH_VAPID_PRIVATE_KEY=... \
     WEB_PUSH_VAPID_SUBJECT='mailto:security@cmcarebase.com' \
     CRON_SHARED_SECRET=... \
     TURNSTILE_SECRET_KEY=... \
     SIGNUP_RATE_LIMIT_PEPPER=... \
     SIGNUP_REDIRECT_ORIGINS='https://cmcarebase.com' \
     PUBLIC_APP_URL='https://cmcarebase.com'
   ```
   Set `ANTHROPIC_BAA_CONFIRMED=true` once the Anthropic BAA is on file (signed 2026-07-30).
   The document analyzer refuses provider calls until this secret is exactly `true`.
   The AI Edge Functions default to the highest-capability generally available Claude model and
   then fall back through current strong models. If Anthropic changes availability, cost, or account
   entitlements, override model selection without a code deploy by setting model secrets (and
   comma-separated fallback model lists):
   - `ANTHROPIC_COURSE_DRAFT_MODEL` / `ANTHROPIC_COURSE_DRAFT_FALLBACK_MODELS`
   - `ANTHROPIC_COURSE_REGENERATION_MODEL` / `ANTHROPIC_COURSE_REGENERATION_FALLBACK_MODELS`
   - `ANTHROPIC_RESIDENT_SUMMARY_MODEL` / `ANTHROPIC_RESIDENT_SUMMARY_FALLBACK_MODELS`
   - `ANTHROPIC_DOCUMENT_ANALYZER_MODEL` / `ANTHROPIC_DOCUMENT_ANALYZER_FALLBACK_MODELS`

   Store the same `CRON_SHARED_SECRET` in Supabase Vault before the cron-hardening migration runs:
   ```sql
   select vault.create_secret('<same random value>', 'cron_shared_secret');
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
   Functions automatically by Supabase -- you do not set those secrets yourself.
   That automatic injection applies only to Supabase-hosted handlers. Railway provider mode
   requires the same project's service-role key in Railway's server environment.
   `SENDGRID_API_KEY`/`NOTIFICATION_FROM_EMAIL` are read by both `dispatch-notifications`
   (training due/expired reminders, escalations, the Monday digest) and `send-auth-email`
   (signup, invite, recovery, magic-link, email-change, and reauthentication messages).
   `SEND_EMAIL_HOOK_SECRET` must match the Supabase Auth Send Email hook signing secret.
   Local-only `supabase/config.toml` hook tests require the same secret base64-encoded as
   `SEND_EMAIL_HOOK_SECRET_BASE64`, because the CLI config field expects base64 hook secrets.
   Supabase notification SMS, if enabled, separately consumes `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in its existing Edge runtime.
   `TWILIO_VERIFY_SERVICE_SID` is the separate `VA...` service for SMS MFA; it is not a notification
   sender or the paid Supabase Phone MFA add-on. The notification Twilio variables are only for SMS;
   each notification channel is skipped (not failed) if its credentials
   aren't set, so SMS can be added later without breaking email. Create the SendGrid API key with **Mail Send** scope only,
   and verify the `NOTIFICATION_FROM_EMAIL` sender identity (Single Sender Verification or a
   verified domain) in the SendGrid dashboard first -- SendGrid rejects sends from an unverified
   `from` address.
   The Stripe key, webhook signing secret and PennTrain-specific portal configuration must belong
   to the account owning the launch prices. Production uses `acct_19pJ0MCEZXcVOdjd`; see
   `BILLING_MODEL.md` for the four mappings and launch verification order. Configure and verify
   the dedicated webhook before enabling Checkout. Manage billing requires an explicit `bpc_...`
   portal configuration so another application's default configuration is never selected.
   Generate one VAPID key pair for each environment and keep the private key only in Supabase
   Edge Function secrets. `push-subscriptions` returns the public key to authenticated browsers;
   `dispatch-notifications` uses the same pair to sign provider requests. Rotating the pair
   invalidates existing browser subscriptions, so plan a user re-subscription window.
5. **Auth URL configuration** (Authentication -> URL Configuration in the dashboard): set **Site URL**
   to the public domain (production: `https://cmcarebase.com`) and add a **Redirect URL** for
   every verified origin the app is served from -- production currently needs
   `https://cmcarebase.com/reset-password`. `ForgotPassword.tsx` calls
   `supabase.auth.resetPasswordForEmail` with `redirectTo: window.location.origin + basePath +
   "/reset-password"` (not `/login`), and Supabase Auth silently falls back to the bare Site URL --
   no error shown anywhere -- when `redirect_to` isn't an allowlisted match, which strands the user on
   the marketing/login page instead of the password-set form after they click a legitimate reset link.
   The trusted successful push-CI deployment now reconciles these two nonsecret Auth URL fields
   for CM Train (`xsqobvvreaovwibxwyvv`) with `scripts/reconcile-production-auth-urls.mjs --apply`.
   It sets the canonical Site URL and appends the exact production root and `/reset-password`
   redirects, preserving the existing allowlist text and every other Auth setting. It adds no
   wildcards, changes no MFA/provider configuration, and makes no credential copies. Manual
   dispatches, nightly runs and dry runs do not apply this repair. The script is read-only by
   default; successful push-CI runs reconcile even when the backend deployment is a no-op, so
   a prior manual backend stamp cannot suppress a missing Auth URL repair. It
   refuses any other project. An independent readback must match before the deploy
   can be recorded successful. Do not edit Auth URLs concurrently with this step: the API has
   no documented atomic compare-and-set; detected concurrent changes abort, uncertain writes
   are reported without retry, and no automatic rollback overwrites later operator edits.
6. **Route Supabase Auth's own mail through SendGrid too.** Step 4 above wires SendGrid
   into both application notification mail and the `send-auth-email` Edge Function, but the
   Supabase Auth dashboard hook must be enabled so password-reset, invite, email-change,
   signup, magic-link, and reauthentication mail does not fall back to Supabase's built-in
   mailer. Use the Send Email Hook path below in every hosted environment; the checked-in
   local `auth.hook.send_email` stanza is intentionally disabled until a developer opts in
   with local SendGrid and base64 hook-secret values:
   - **Send Email Hook (required for all-email SendGrid delivery).** Deploy the `send-auth-email` Edge Function
     (`npx supabase functions deploy send-auth-email`), then in the dashboard: Authentication ->
     Hooks -> add a **Send Email** hook of type HTTPS, pointing at
     `https://<project-ref>.supabase.co/functions/v1/send-auth-email`. The dashboard generates a
     signing secret when you save it -- set the same value from step 4 as `npx supabase secrets set
     SEND_EMAIL_HOOK_SECRET='v1,whsec_...'`. Once the hook is enabled, Supabase Auth calls this
     function over plain HTTPS for every auth email instead of using SMTP, so it goes through the
     exact same SendGrid `v3/mail/send` API (and the same `SENDGRID_API_KEY`/
     `NOTIFICATION_FROM_EMAIL` secrets) as `dispatch-notifications` -- no SMTP involved at all.
     This is the more reliable option: raw SMTP relays are more prone to being slow or silently
     blocked on outbound network paths than a plain HTTPS API call.
   - **Custom SMTP (fallback only, less reliable).** Authentication -> Emails -> SMTP Settings, enable
     "Custom SMTP", and use SendGrid's SMTP relay (`smtp.sendgrid.net:587`, username `apikey`,
     password = a SendGrid API key with Mail Send scope). Use this only if the HTTPS hook is unavailable.
     Both this and the Hook are dashboard-only settings, not something a migration can configure. If the Hook is enabled, it takes priority
     and Custom SMTP is bypassed entirely (see [Supabase's Send Email Hook
     docs](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) for the exact
     precedence rules).
7. Create production admin users with `invite-user` or the Supabase Admin API using environment-specific
   credentials. Do not run SQL that seeds reusable platform_admin or demo passwords. Self-service `/signup`
   is available for new organizations and requires Turnstile plus invite-email verification.
8. Generate TypeScript types after any schema change:
   ```bash
   npx supabase gen types typescript --project-id <your-project-ref> \
     > artifacts/caremetric-carebase/src/lib/database.types.ts
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
Railway's **Root Directory** setting at the repo root (not `artifacts/caremetric-carebase`) so `pnpm --filter`
can see the whole workspace and lockfile.

1. In Railway: **New Project -> Deploy from GitHub repo**, select this repository.
2. Railway auto-detects `railway.json` at the repo root:
   - Builder: **Railpack** (Railway's current default builder; Nixpacks is deprecated on Railway
     and its hosted version cannot provision Node 24 -- it silently falls back to Node 18, which
     breaks the Vite 7 build. Do not switch this service back to Nixpacks.)
   - Build: `pnpm install --frozen-lockfile --prod=false && pnpm --filter @workspace/caremetric-carebase run typecheck && pnpm --filter @workspace/caremetric-carebase run build && node scripts/check-bundle-budget.mjs`
    (Railpack also runs its own install beforehand; the explicit one is a harmless belt-and-braces
    step; the typecheck and the bundle-budget check are the deploy's static gates -- the budget
    check reads the `dist/public/assets` the build just produced, so it costs nothing extra and
    catches a size regression before the deploy goes live; GitHub Actions runs the broader
    `check:all`-style workflow on pushes/PRs)

   **Railway rebuilds from source -- deployed bundle ≠ CI artifact (documented residual,
   PT-016).** The bundle Railway serves is compiled *on Railway's builders* by the
   buildCommand above; it is not the immutable `caremetric-carebase-<sha>` artifact that CI
   builds and publishes on the same commit. The two builds run from the same source and
   lockfile, but they are separate executions on separate machines with separate environment
   variables, so nothing structurally guarantees the deployed bytes match what CI validated
   (for example, `VITE_*` values differ by design, and a Railway-side variable change alone
   produces a bundle CI never saw). Running the same bundle-budget gate inside the Railway
   build narrows the gap -- a deploy build that regresses past budget now fails instead of
   shipping -- but does not close it. Closing it would mean deploying the CI-built artifact
   itself: build a container/registry image (or reuse the uploaded artifact) in CI and point
   Railway at that image, so the deploy promotes the exact validated bytes instead of
   rebuilding them. That is a deliberate future change, not something this configuration
   silently accepts as equivalent.
   - Start: `exec node artifacts/caremetric-carebase/server/index.mjs`

     **The `exec`, and the absence of a `pnpm` wrapper, are both load-bearing -- do not
     "simplify" this back to `pnpm --filter ... run start`.** Railway signals the process it
     started (`/bin/sh -c "<startCommand>"`) when it drains a deploy, and only a process that
     receives SIGTERM itself can run the graceful shutdown in `server/index.mjs`. Measured
     locally against this exact server:

     | startCommand | process tree | on SIGTERM |
     |---|---|---|
     | `pnpm --filter ... run start` | `pnpm` -> `sh` -> `node` | pnpm exits **without forwarding**; node is orphaned and keeps serving until SIGKILL. In-flight requests are severed, and pnpm's non-zero `ELIFECYCLE` exit looks like a crash to `restartPolicyType: ON_FAILURE` |
     | `node ...` (no `exec`) | `sh` -> `node` | dash does not exec-optimize here; `sh` absorbs the signal, node again never drains |
     | `exec node ...` | `node` (the shell is replaced) | node receives SIGTERM, closes the listener, drains, exits 0 |

     Starting the server directly also drops two processes from the runtime image and does not
     depend on pnpm being resolvable at run time -- only at build time.
   - Healthcheck: `GET /health`
   - Watch paths: only changes under `artifacts/caremetric-carebase/`, the root toolchain/config
     files, and the two `scripts/` files the build itself runs (`check-bundle-budget.mjs` and the
     `generate:manual` generator) trigger a deploy, so pushes touching e.g.
     `artifacts/mockup-sandbox` or unrelated `scripts/` files don't redeploy production.
   Railpack resolves Node from `engines.node` in package.json / `.nvmrc` / `.node-version` (all
   pinned to Node 24 here; `RAILPACK_NODE_VERSION` would override) and installs pnpm 11.13.0 via
   the package manager declared by the `packageManager` field.
   **`railpack.json` (repo root) pins `"provider": "node"` and must stay.** The repo root also
   contains `deno.json`/`deno.lock` (Deno tooling for the Supabase Edge Functions), and Railpack's
   auto-detection prefers Deno over Node when both are present -- without the pin it can build a
   Deno-only image with no Node/pnpm, and the build dies with `pnpm: not found`
   (exit 127). Railpack installs the declared package manager before the explicit commands run;
   keep the commands in this document synchronized with `railway.json`. Because `railway.json` sets an explicit
   `startCommand`, Railpack's Vite-SPA auto-detection (serving via Caddy) is overridden and the
   custom Node server is used -- keep `startCommand` in place, or set `RAILPACK_NO_SPA=1` to make
   that explicit.
3. Add the environment variables below (Service -> Variables) **before the first deploy**.
   Keep secrets in Railway's server environment or an ignored local environment file; never commit
   credential values. **Important:** `VITE_*` variables are baked into the JS bundle at build time, not read
   at runtime. If they are missing the build now fails loudly (guard in `vite.config.ts`); if you
   change them later, trigger a redeploy (which rebuilds) -- merely restarting the service ships
   the old bundle, and `/health` has no way to detect that (see step 5 below).
4. Deploy. The production custom domain (`cmcarebase.com`) is attached under Service ->
   Settings -> Networking. Railway may also assign a `*.up.railway.app` hostname. Verify that
   hostname actually routes to this service before adding it to step 1.5 (Supabase Auth redirect
   URLs), `SIGNUP_REDIRECT_ORIGINS`, or application links.
5. Verify `GET https://cmcarebase.com/health` returns:
   ```json
   {
     "status": "ok",
     "service": "caremetric-carebase",
     "providerRuntime": "supabase",
     "timestamp": "2026-07-04T12:00:00.000Z"
   }
   ```
   `/health` deliberately reports process liveness, not Supabase reachability. Application data
   uses the browser's build-time `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; the learning-package
   proxy also uses `VITE_SUPABASE_URL` at server runtime. Keep the build/runtime project URL aligned.
   `providerRuntime` reports the validated build's selected mode (`supabase` or `railway`), not
   successful provider access. Confirm Supabase connectivity by loading
   the app in a browser (step 8), and verify an accepted package launches through its nested assets
   after deploying `learning-package-asset`.

   Startup also rejects a missing bundle. Because the endpoint
   is answered by the server rather than by the build output, a deploy whose `dist/public` is
   missing or partial (interrupted build, wrong Root Directory, a start that never ran a build)
   would otherwise return a green `/health` while every real request 500s -- and Railway would
   promote it. The server therefore checks `dist/public/index.html` before it binds the port and
   exits non-zero if it is absent, so the healthcheck fails and Railway keeps the previous,
   working deploy live. The startup log line is `Refusing to start: ... index.html is missing`;
   if a deploy fails its healthcheck, check the deploy logs for it before anything else.

### Railway provider runtime (opt-in)

The code supports running four existing handlers in the Railway Node server. This is an opt-in
deployment path, not evidence that production cutover or live provider checks have completed.
It reuses the existing authentication, database assurance, webhook verification, and job tracking.
Other Edge Functions, Auth mail, notification providers, and the voice gateway retain their
current runtimes and configuration.

| Railway route | Consumer |
| --- | --- |
| `/api/providers/sms-mfa` | Browser SMS status, send, and verify requests with the current Supabase Bearer session |
| `/api/providers/create-billing-session` | Browser Checkout and Customer Portal requests with the current Supabase Bearer session |
| `/api/providers/stripe-billing-webhook` | Dedicated PennTrain Stripe endpoint, authenticated by its own signing secret |
| `/api/providers/sync-billing-quantities` | Existing billing cron/manual dispatch through the authenticated Supabase forwarder |

Browser requests use only these exact same-origin paths, under the built `BASE_PATH` where
applicable. They omit cookies, refuse redirects, and never retry a mutation or fall back to
Supabase after a failure. `BASE_PATH` in Railway mode must be `/` or slash-terminated segments
containing letters, digits, `_`, or `-`. Production's billing forwarder is fixed to
`https://cmcarebase.com/api/providers/sync-billing-quantities` and to project
`xsqobvvreaovwibxwyvv`; do not enable that forwarder in staging. The Node server keeps these
root provider URLs available even when the SPA uses a `BASE_PATH` prefix.

| Setting | Location in Railway provider mode | Requirement |
| --- | --- | --- |
| `VITE_PROVIDER_RUNTIME` | Railway build and service variable; nonsecret | `railway` opts in. Unset or `supabase` preserves the existing SDK/runtime behavior. Blank or another value fails closed. Rebuild after a change. |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway server variable | Required; must belong to CM Train `xsqobvvreaovwibxwyvv`, the same project as the frontend. A key from another Railway app's Supabase project is not interchangeable. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Railway server variables | Required; server aliases fall back to `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The server URL must match the built frontend project. The browser still needs its two `VITE_` values at build time. |
| `STRIPE_SECRET_KEY` | Railway server variable | Required; same Stripe account as the launch prices and dedicated PennTrain portal configuration. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Railway server variable | Required; signing secret for the dedicated PennTrain endpoint at this runtime's webhook URL. Do not reuse another application's endpoint secret. |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Railway server variable | Required; explicit PennTrain `bpc_...` configuration. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Railway server variables | Required; reuse the intended existing Twilio account credentials. |
| `TWILIO_VERIFY_SERVICE_SID` | Railway server variable | Required; the account's SMS Verify `VA...` service, not a Messaging Service `MG...` ID. |
| `CRON_SHARED_SECRET` | Railway server variable and existing Supabase Edge/Vault configuration | Required; must match the existing Edge secret and Vault `cron_shared_secret` used by scheduled and manual dispatch. This cutover does not rotate it. |
| `BILLING_RUNTIME` | Supabase Edge environment; nonsecret | Set `railway` only after Railway is ready. Unset or `supabase` executes the existing Edge worker. Blank or another value fails closed. |
| `PUBLIC_APP_URL`, `BILLING_RETURN_URL_ORIGINS` | Railway server variables; nonsecret | Use the canonical `https://cmcarebase.com` and exact approved return origins; existing safe defaults apply if omitted. |

Provider credentials and the service-role key must never receive a `VITE_` prefix. A connected
account or a redacted list of variable names does not prove that the selected runtime has usable
credentials. Ignored local environment files remain local; Git does not deploy their contents.

The build validates the mode, `BASE_PATH`, and public Supabase configuration, then writes only
mode/project metadata to `dist/provider-runtime.json`, outside the public asset directory.
Required server secrets are validated at startup, not during the frontend build. Railway-mode
startup refuses a missing/invalid manifest, a conflicting configured mode, missing server settings,
or a different Supabase project. Legacy builds without a manifest can remain in Supabase mode.
Validation checks configuration presence and consistency, not provider validity.
`/health` reports the validated `providerRuntime` and does not expose credentials.

Roll out in this order:

1. Prepare the existing provider credentials and the correct CM Train service-role key in Railway's
   server variables. Keep the existing cron secret consistent. Prepare the dedicated PennTrain
   portal configuration and webhook with delivery disabled; install that webhook's own signing
   secret in Railway. Do not alter the other application's Base44 webhook.
2. Deploy the reviewed code with both runtime switches unset or `supabase`. The Railway provider
   routes remain inactive. Keep existing database MFA/RLS enforcement enabled.
3. Set Railway `VITE_PROVIDER_RUNTIME=railway` and rebuild. All required server variables must pass
   startup validation. Verify the deployed `/health` reports `providerRuntime: "railway"`
   and the app uses the authenticated same-origin SMS/billing routes.
4. Enable delivery to the dedicated Stripe webhook only after its matching signing secret is
   installed and the Railway handler is ready. Its production URL is
   `https://cmcarebase.com/api/providers/stripe-billing-webhook`. Confirm signature rejection for
   invalid requests and a supported signed event's durable processing receipt before Checkout.
5. Set only the nonsecret Supabase flag `BILLING_RUNTIME=railway`. Validate both the existing
   scheduled billing job and operator-triggered dispatch through the unchanged Edge URL, including
   their correlation IDs and durable job results. The forwarder authenticates each request and
   sends it once; an ambiguous timeout must be reconciled against its job record before retrying.
   Lost, truncated or invalid responses after dispatch report an unknown outcome. The manual
   dispatcher preserves the run for its worker to finish; an HTTP failure alone cannot mark
   provider work failed. The System Jobs page refreshes the existing run and never retries the
   dispatch automatically. Confirmed pre-dispatch configuration failures remain failures.
6. Complete actual SMS enrollment/send/verify and the security scenarios below, then Checkout,
   Customer Portal, webhook reconciliation, and billing quantity checks in `BILLING_MODEL.md`.
   Passing unit tests or seeing required variable names cannot replace these live checks.

For rollback, first set Supabase `BILLING_RUNTIME=supabase` (or unset it) so dispatch stops
forwarding to Railway. Then restore the prior Railway build/mode, rebuilding with
`VITE_PROVIDER_RUNTIME=supabase` if necessary, and reconcile the dedicated webhook URL and
signing secret with the selected handler runtime before enabling delivery there. Restore only a
previously verified runtime configuration; changing a flag does not provision missing Supabase
provider credentials. If that older runtime was unconfigured, SMS/billing remain unavailable
until a working configuration is restored. Never clear SMS factors, session assurance, RLS,
or database MFA requirements as part of runtime rollback.

### Twilio SMS MFA (no Supabase phone-MFA add-on)

SMS MFA uses `sms-mfa` and Twilio Verify directly. Supabase remains the primary
sign-in provider; the app records a short-lived proof for the exact Auth session
and checks it in the shared database assurance guard. It never writes or fabricates
Supabase's `aal2` JWT claim. Native TOTP remains available for accounts without
an app SMS factor. Once an account enrolls SMS, SMS proof takes precedence over
native factors, including factors enrolled directly through the Auth API. The SMS
requirement survives administrator recovery; native factors cannot become a
backdoor while SMS is awaiting re-enrollment. Restrictive RLS, storage policies
and the existing PostgREST request hook enforce SMS proof on direct data/API
access. Only the caller’s own profile and the exact account-security/lock
bootstrap RPCs remain reachable before verification.

Deployment order is required: apply the reviewed migration (after PR #507's
release migrations), deploy `sms-mfa` and the updated `admin-update-user`,
`impersonate-user`, `process-credential-renewals`, `push-subscriptions`,
`capture-product-event` and `list-heygen-options`, then deploy the frontend and
voice gateway. These backend routes check the caller’s SMS proof before service-role
access, vendor work or a realtime session. The new frontend fails closed if
`get_my_mfa_status` is unavailable. Do not turn on the Supabase Advanced MFA Phone
add-on or configure a Supabase phone-auth SMS hook for this implementation.

Reuse the existing Twilio account credentials in the selected handler runtime:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, plus a dedicated
`TWILIO_VERIFY_SERVICE_SID` (`VA...`). A notification Messaging Service SID
(`MG...`) is a different resource. Create/reuse a Verify Service with six-digit
codes, SMS enabled, Fraud Guard enabled and the permitted destination countries.
For Railway provider mode, use Railway's server variables; for the existing Supabase mode,
use Edge Function secrets. Never put these credentials in `VITE_*` variables. The screen discovers
SMS availability from the selected handler. `VITE_PROVIDER_RUNTIME` selects that transport;
there is no separate flag that can grant SMS verification. An unavailable handler leaves native
TOTP usable for accounts that have not enrolled SMS; SMS accounts retain their verification requirement.

Twilio Verify usage charges still apply: its public pricing on 2026-09-09 lists
$0.05 per successful verification plus channel fees. See
[Twilio Verify pricing](https://www.twilio.com/en-us/verify/pricing). This avoids
the Supabase paid phone-MFA add-on; ordinary existing Supabase usage limits remain.

First enrollment requires a recent password sign-in; accounts with an existing
verified method must prove that method first. Replacing an SMS number requires
both a recent password sign-in and the current SMS proof. Self-service removal
is not offered: losing the phone uses the platform administrator's audited MFA
reset, which revokes sessions and removes both native and app factors. No OTP
or provider secret is stored in the app database or emitted in application logs;
only the saved phone, bound provider verification reference and verification
metadata are retained in the private schema. UI factor lists show masked numbers.

Release verification must include an actual SMS send and approved check with the
owner, wrong/expired code, resend limits, a fresh sign-in, idle lock/unlock, phone
replacement and administrator recovery. Automated fixtures cannot certify carrier
delivery. No Twilio resources, secrets, paid Supabase add-ons or production
settings were changed during source implementation.

### Environment variables to set on the Railway service

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL (Project Settings -> API). Required at **build time and server runtime**: baked into the bundle and used by the learning-package proxy; keep both values aligned. Changes require a redeploy, not just a restart |
| `VITE_SUPABASE_ANON_KEY` | yes | anon/publishable key -- safe for the browser, RLS is the real gate. **Build-time**, same caveat as above |
| `VITE_TURNSTILE_SITE_KEY` | yes | Cloudflare Turnstile site key for `/signup`. **Build-time**, same redeploy caveat as other `VITE_` values |
| `VITE_PROVIDER_RUNTIME` | no | Explicit `railway` enables the four provider routes and requires the server settings in the table above. Unset or `supabase` keeps compatibility mode; blank/invalid values are rejected. Rebuild after a change. |
| `VITE_CLIENT_ERROR_REPORTING_ENABLED` | no | Build-time switch for PHI-scrubbed client error events. Reporting is enabled by default in production; set `false` only during an incident |
| `VITE_RELEASE_ID` | recommended | Build-time release identifier, normally `RAILWAY_GIT_COMMIT_SHA`, attached to client error events |
| `VITE_CENTRAL_SUPPORT_HUB_URL` | no | Optional build-time pin for the first-party Support Hub. Leave unset to use `https://support-hub-web-production.up.railway.app`, or set exactly that origin. Any other configured origin fails the build and the browser launcher fails closed. |
| `VITE_DEMO_ACCOUNTS_JSON` | no | Optional JSON array powering the self-serve sandbox at `/demo` (the "Live demo" links). Leave unset in production unless public demo access is intentionally enabled. See "Public demo sandbox" below |
| `VITE_CAREMETRIC_MODULES` | no | Comma-separated build-time product allow-list. Leave unset for a universal build, use `train` for a standalone CareMetric Train deployment, or `carebase` for the full CareBase deployment (which includes Train). Runtime organization entitlements are still authoritative. |
| `NODE_ENV` | no | Railpack already sets `production`; setting it yourself is harmless |
| `PORT` | no | Railway injects this automatically; the server reads it |
| `HOST` | no | the server binds dual-stack `::` by default (Railway's recommendation); override only if you need something else |
| `BASE_PATH` | no | e.g. `/train/`; only needed if served from a non-root subpath. Set it identically for both the build (`vite.config.ts` reads it) and the running server (`server/index.mjs` strips it before resolving files) -- both read the same `BASE_PATH` var, so one value covers both. |
| `ASSET_ARCHIVE_DIR` | recommended | Mount a Railway volume at this path (for example `/data/release-assets`). The server archives content-hashed assets for 14 days and serves old hashes to tabs that remained open across a deploy |

### Central CareMetric Support Hub

CareBase exposes the shared Support Hub from both the header Help menu and the existing Help Center.
Those links are absolute anchors to
`https://support-hub-web-production.up.railway.app/help`, so the browser never resolves them against
localhost or the CareBase origin. The client sends only `product=carebase` and, when recognized, a
static route template from the checked-in app page registry. It does not send user, organization,
resident, employee, ticket, record identifier, search, query-string, fragment, or free-text context.

The `support.central_hub` release flag is registered `off` by default. After verifying the live Hub,
an AAL2 platform administrator may release it globally through the existing Release Flags control
plane. The current UI does not expose cohort-mode activation; cohort membership alone does not
enable this flag. Loading failures, configuration mistakes, and a disabled flag all fail closed.
The local `/app/help` and `/me/help` articles, Help Copilot, manuals, support-ticket creation/history,
ticket detail routes, and all existing course/HeyGen records remain available independently; this
integration adds a shared entry point and does not redirect or migrate those workflows.

In Cloudflare Turnstile -> Widget -> Hostname Management, authorize `cmcarebase.com`
for the `VITE_TURNSTILE_SITE_KEY` used by this service. A missing hostname authorization
produces client error `110200`, leaves signup and confidential intake disabled, and cannot be
fixed by a Railway redeploy alone. Use a separate site key or explicitly authorized hostname
for each staging environment.

### Public demo sandbox (`/demo`)

The marketing site links to a self-serve sandbox at `/demo` (header, footer, landing
hero, and the `#start` card). A visitor picks a role and is signed straight into a demo
tenant — no human contact. The role picker is populated **entirely** from
`VITE_DEMO_ACCOUNTS_JSON` (a build-time `VITE_` value); when it is unset the page renders
with no accounts, so the "Live demo" links are a dead end. Set it wherever you want the
sandbox live.

- **Shape:** a JSON array of `{ label, email, password, role, description? }`. `role` must be
  one of `org_admin | facility_manager | trainer | employee | auditor`
  (`artifacts/caremetric-carebase/src/lib/demoAccounts.ts` allow-lists these so a stray production credential can't leak in).
- **Local dev:** `supabase/seed.sql` creates matching auth users for every role (all password
  `demo123`), and `pnpm run db:reset:demo` loads it -- seeding is opt-in, so a plain `supabase
  start` gives you the migration chain with no demo accounts. Copy the ready-made
  `VITE_DEMO_ACCOUNTS_JSON` line from `.env.example` into your `.env` and the sandbox works
  immediately.
- **Hosted / prod:** never reuse the seed passwords. Provision dedicated public-demo auth users
  (synthetic credentials only) attached to the demo organization with the
  **`provision-demo-tenant`** Edge Function, then set `VITE_DEMO_ACCOUNTS_JSON` to the value it
  returns. The demo tenant's sample data and its reset-to-baseline routine live in
  `supabase/migrations/20260717163659_demo_playground_seed_and_reset.sql`
  (`app_private.seed_demo_organization` / `public.restore_demo_baseline`).

  1. Set the two secrets (the account password is inherently public — it ships in the browser
     bundle via `VITE_DEMO_ACCOUNTS_JSON` — but the provisioning call must still be authorized):
     ```bash
     npx supabase secrets set \
       DEMO_PROVISION_SECRET="$(openssl rand -hex 32)" \
       DEMO_ACCOUNT_PASSWORD='choose-a-synthetic-demo-password'
     ```
  2. Deploy and invoke it once (it is idempotent — safe to re-run):
     ```bash
     npx supabase functions deploy provision-demo-tenant
     curl -sS -X POST \
       "https://<project-ref>.supabase.co/functions/v1/provision-demo-tenant" \
       -H "x-demo-provision-secret: <the DEMO_PROVISION_SECRET value>"
     ```
     It ensures the demo org, creates the five `org_admin`/`facility_manager`/`trainer`/`employee`/
     `auditor` accounts (never a `platform_admin`), seeds the tenant, and returns a
     `viteDemoAccountsJson` field.
  3. Copy that `viteDemoAccountsJson` string into the Railway build variable
     `VITE_DEMO_ACCOUNTS_JSON` and redeploy the frontend.
- Because it is a `VITE_` value, changing it requires a **rebuild/redeploy**, not just a restart.

### Deployment asset continuity

Attach a Railway volume to the service, set `ASSET_ARCHIVE_DIR` to its mount path, and preserve
the volume across releases. On startup the static server copies the current release's `assets/`
files into that archive without overwriting prior hashes and removes files older than 14 days.
Current assets remain immutable for one year, while missing assets and all other error responses
use `Cache-Control: no-store` so a CDN cannot retain a transient 404.

The PWA uses network-first navigation and the browser performs a one-time cache/service-worker
reset when a dynamic import still fails. These are complementary safeguards: the archive keeps
long-lived tabs working without interruption; automatic recovery handles clients outside the
archive window. Do not configure Cloudflare or Railway to cache `404` responses.

**Attaching the volume is a trade, not a free upgrade -- decide it deliberately.** Railway's
volumes carry two platform constraints that apply to the whole service, not just to the archive
([Railway: volumes](https://docs.railway.com/reference/volumes)):

- **Replicas cannot be used with volumes.** Attaching one caps this service at a single instance,
  so it can no longer be scaled horizontally. (One Node process serves this bundle at roughly
  4.3k req/s for the entry chunk and ~30k req/s for `/health` on a 4-core box, so the ceiling is
  high -- but it becomes a hard one.)
- **Redeploys stop being zero-downtime.** Railway refuses to run two deployments against the same
  volume, so the new deployment cannot come up and pass its healthcheck while the old one is still
  serving. Every release then takes a small amount of downtime *even with a healthcheck
  configured*, and the "failed healthcheck keeps the previous deploy live" protection above is
  weakened: there is a window with nothing serving.

Without the volume, a tab left open across a deploy that requests a since-removed chunk gets a
404 and the client-side recovery above (service-worker unregister + cache clear + one reload)
takes over -- an interruption for those users only, while deploys stay zero-downtime and the
service stays scalable. Choose the volume when long-lived open tabs matter more than
release-time availability; skip it when they don't.

Never set `NPM_CONFIG_PRODUCTION=true` on this service: the app's build tooling (including
`vite` itself) lives in `devDependencies`, and that variable makes pnpm skip it at install,
emptying the build. (The buildCommand passes `--prod=false` explicitly to defend against it, and
Railpack itself sets `NPM_CONFIG_PRODUCTION=false`; for the same reason, never set
`RAILPACK_PRUNE_DEPS=1`.)

Not needed for this repo (and intentionally left out of `.env.example` -- see the comments there for
why): `DATABASE_URL`, `NEXT_PUBLIC_*` (this is Vite, not Next.js), `SESSION_SECRET`/`AUTH_SECRET`
(Supabase Auth owns session state; the Node server does not issue a separate login session).
`SUPABASE_SERVICE_ROLE_KEY`, Stripe, and SMS MFA credentials are required Railway server variables
when Railway provider mode is selected. Supabase-hosted notification and Auth-mail handlers keep
their existing credentials in their own runtime. Credential placement follows the consuming
handler; the prohibition is on committing secrets or embedding them in browser-visible `VITE_*`
values, not on keeping server secrets in Railway.

## 3. Local development

> **Platform note:** `pnpm-workspace.yaml` uses pnpm `supportedArchitectures` to install native
> optional dependencies for the current developer machine plus linux-x64-glibc CI/deploys.
> Windows/macOS local installs are supported for frontend typecheck/unit-test work; Deno is still
> required for `pnpm run check:edge-functions`.

```bash
pnpm install
cp artifacts/caremetric-carebase/.env.example artifacts/caremetric-carebase/.env   # fill in your Supabase URL/anon key
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
`artifacts/caremetric-carebase/src/hooks/*.ts` and `src/lib/auth.tsx` -- this change did not need to build
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

### Support impersonation lifetime

Apply `20260908220014_enforce_impersonation_session_lifetime.sql` before releasing the
impersonation updates. Binding a support context now caps the target's actual Auth refresh session
at the context deadline. The edge function exchanges and binds the target session before returning
any usable credential; a client cannot skip binding by redeeming a returned magic-link hash.
Deploy the updated edge function before the frontend. The frontend now requests `start_bound`,
which returns an already-bound session. The updated edge function rejects a stale browser's legacy
`start` action with HTTP 409 and a refresh-required message before creating a link, session, audit,
or support context. If the frontend reaches an older edge deployment, its unknown `start_bound`
action is refused before those side effects; starting impersonation resumes after the edge update.
Existing `bind` and `end` actions remain compatible so active impersonations can still exit during
the transition. The database also refuses an expired or ended impersonation's existing
JWT through its shared authorization helpers, restrictive RLS policies, and a PostgREST pre-request
hook. The frontend uses the server's deadline for its automatic return; that timer is a convenience,
while the database enforces access even if the tab is suspended or closed.

The migration installs `public.enforce_request_impersonation_lifetime` as
`pgrst.db_pre_request` on `authenticator` and requests a config reload. It refuses to replace an
unrelated pre-request hook: if an environment already has one, compose both checks before applying
the migration. Verify normal authenticated and anonymous requests, an active support session, and
the same JWT after expiry in a hosted release check. Already downloaded files and previously issued
signed Storage URLs keep their independent lifetime; this control prevents new authorized requests.

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

- The service-role key is never referenced anywhere under `artifacts/caremetric-carebase/src` or
  `artifacts/caremetric-carebase/server` -- confirmed by grep as part of this change. Vite only exposes
  `VITE_`-prefixed variables to the client bundle (`import.meta.env`), which is itself a structural
  guardrail against accidentally shipping the service-role key to the browser.
- RLS is enabled on every table (`mcp__Supabase__list_tables` confirms `rls_enabled: true` across
  the board); `certificates` and `audit_logs` are intentionally not client-writable -- writes only
  happen through `SECURITY DEFINER` RPCs or the trigger, both server-controlled.
- `organization_id` spoofing is prevented at the database layer: RLS policies compare against
  `current_org_id()` (derived from the authenticated JWT's `profiles` row), not a client-supplied
  value, so a request cannot claim another org's `organization_id` and have it honored.
  `facility_id` spoofing (a narrower, in-org concern) is covered by the fix above.
- **PHI/HIPAA — BAAs signed (2026-07-30).** CareMetric has signed Business Associate Agreements
  covering production PHI with Supabase, Railway (as applicable to traffic that may carry PHI),
  Anthropic (document analyzer, compliance copilot, assessment summaries, course AI), and OpenAI
  (voice Realtime). HIPAA-eligible service tiers must remain enabled on each vendor. Per-organization
  AI still requires a recorded org BAA acceptance (`organizations.baa_version` / `org_ai_allowed`)
  before tenant AI features run.
- **AI + resident data (post-BAA enablement):** `resident_assessment_forms.content` holds
  clinical/functional-assessment content. Provider paths remain **double-gated**:
  1. Edge secret `ANTHROPIC_BAA_CONFIRMED=true` (set in Supabase after the Anthropic BAA was filed —
     required by `analyze-state-form` before any PDF is sent).
  2. Platform kill-switches in `public.platform_settings`. There are six, and they do not all seed the
     same way, which this list used to imply:
     - Seeded **false**, and off in production today: `ai_wellness_summary_generation_enabled`
       (`20260707020200`), `ai_document_analyzer_enabled` (`20260713233707`),
       `ai_compliance_copilot_enabled` (`20260714010000`). These three are the ones to flip
       deliberately, per feature, when ready to process production data.
     - Seeded **true** by `20260706043635`: `ai_course_generation_enabled`,
       `ai_video_generation_enabled`. Their being on in production is the code default rather than a
       dashboard change somebody made. Both are training-content-only and touch no resident data.
     - Seeded **true** by `20260724220000`: `voice_assistant_enabled`, which is product-enabled.
     So a fresh project comes up with three of the six on. If that is not the posture you want for an
     environment, turn them off explicitly -- do not assume the seed left them off.
  3. Per-org `org_ai_allowed` (BAA stamp + `ai_features_enabled`).
  Document analyzer uploads still land in the Supabase-covered `state-form-analyzer` bucket and wait
  in queue until the platform switch is on. Course drafting remains training-content-only.

## 8. Verifying the deployment

Every successful trusted production deployment (including no-op and nightly checks) now produces an `integration-readiness-<SHA>` artifact, job summary and job-log table. The log table is exactly the same sanitized Markdown, so operators can read it even when artifact ZIP downloads are unavailable. It reports only allowlisted Supabase Edge secret-name presence and selected Auth configuration booleans. It never outputs secret values or digests, never sends a message or changes provider settings, and cannot block a deployment. Missing API access is reported as unknown. Names being present is not proof that credentials are valid or that delivery works; the report excludes Railway server variables, the separately configured frontend, voice gateway and tenant integration credentials. In Railway provider mode, missing Stripe/Twilio names in this Supabase-only report are not a reason to copy those credentials into Supabase. Validate the selected runtime and actual provider flows separately.

```bash
curl -s https://cmcarebase.com/health | jq
```

Expect `status: "ok"` and the intended `providerRuntime` (`supabase` or `railway`). This confirms
process liveness and the selected build/runtime configuration, not Supabase reachability or valid
provider credentials. Load the app and verify login, protected data access, and the selected
provider routes. Rebuild after changing browser `VITE_*` configuration. Railway provider startup
rejects mode/project mismatches, but it cannot certify live Checkout, carrier delivery, or webhook
reconciliation; complete the checks in the provider rollout section.

## Limitations / manual steps remaining

Deployment-setting verification on 2026-09-08 (BACKLOG K11):

| Setting | Supported evidence | Remaining verification |
| --- | --- | --- |
| Required checks on `main` | The intended required check is `ci-result`. The repository ruleset list is empty, but the connection receives HTTP 403 reading classic branch protection. | Verify the classic rule requires `ci-result` only; an empty ruleset list does not prove the branch is unprotected. |
| Production credentials and approvals | Scheduled dry run [34200865149](https://github.com/kdeyarmin/PennTrain/actions/runs/34200865149) started three seconds after creation, has no recorded environment approval, and passed secret-presence, project-link, migration-drift and function-presence checks. | This confirms an unattended successful run with usable `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, but the connection cannot read their environment-versus-repository scope or the current required-reviewer setting. |
| Deployment-stamp retention | [Run 34261253345](https://github.com/kdeyarmin/PennTrain/actions/runs/34261253345) was created `2026-09-08T18:08:23Z`; its deployment stamp expires `2026-12-07T18:08:23Z`, exactly 90 days later. The upload step does not override retention. | Effective 90-day retention is verified for this stamp. Keep sufficient retention for the deploy gate's last-50-run lookup when changing repository settings. |

- Railway project creation, GitHub connection, and env var entry must be done in the Railway
  dashboard -- not scriptable from this repo.
- Supabase Auth redirect URL and Site URL configuration must be set in the Supabase dashboard.
  The production values: Site URL `https://cmcarebase.com`; Redirect URL
  `https://cmcarebase.com/reset-password`, plus the verified production root URL for enterprise SSO.
- Cloudflare Turnstile Hostname Management must authorize `cmcarebase.com` for the production
  site key. The live widget currently returns `110200` until that dashboard setting is corrected.
- Leaked password protection (Authentication -> Policies) is still disabled and must be toggled on
  manually in the dashboard -- it's an Auth config setting, not something a SQL migration can flip.
- Keep plain Supabase email signup disabled in Authentication -> Providers. Self-service signup
  should go through `signup-organization`, which enforces Turnstile, rate limits, and invite-email
  verification before the org_admin can set a password.
- No linter (ESLint/Biome/etc.) is configured in this repo yet — `pnpm run typecheck` is the
  static-analysis gate. What CI actually runs is much broader than that list used to say: a
  path-filtered matrix of five jobs behind one aggregate `ci-result` check — the ~20 static checks,
  self-tests, typecheck, unit tests, Edge Function `deno check`, both production builds, startup
  and bundle-budget checks (`check:all`); a full migration replay on a local Supabase stack with
  pgTAP, `db lint`, security/performance advisors, generated-types diff and the Playwright
  journeys; migration immutability; the planning-register gate; and a per-push secret scan.
  Add a linter separately if desired.
- Repository-level automation the owner should know exists, all of it opening and closing its own
  GitHub issues: nightly production drift check (`deploy-migrations.yml`, dry-run), daily
  dependency advisory audit of `main`, weekly PA DHS source-freshness check, weekly full-history
  secret scan, and a `[ci] main is red` alert that fires when a failed CI run on `main` means the
  production deploy did not run.
- `pnpm run db:migrate` requires `supabase login` + `supabase link --project-ref <ref>` to have been
  run once first (interactive, not scriptable).
- `SENDGRID_API_KEY` must be set via `supabase secrets set` (step 1.4) for the training-reminder
  emails `dispatch-notifications` sends to actually go out -- without it, those deliveries are
  logged as `skipped` rather than failing loudly. Routing Supabase Auth's own password-reset/
  email-change mail through SendGrid too requires the hosted Send Email hook and matching signing configuration in step 1.6; setting the Edge Function key alone does not change Auth delivery.
