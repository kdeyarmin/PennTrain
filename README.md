<p align="center">
  <img src="artifacts/caremetric-carebase/public/logo.png" alt="CareMetric CareBase" width="360" />
</p>

# CareMetric CareBase

**[CMCareBase.com](https://cmcarebase.com)**

CareMetric CareBase is a multi-tenant personal care home and assisted living facility management platform for operators that need one system for staff compliance, resident assessments, incidents, inspections, documents, scheduling, and training. It is built directly on Supabase: Postgres with
Row-Level Security, Supabase Auth, Supabase Storage, and Edge Functions. There is no separate API server -- the
React frontend talks to Supabase directly via `supabase-js`.

**Production**: https://cmcarebase.com (Railway-hosted; see `DEPLOYMENT.md`).

The platform can also be licensed or deployed as **CareMetric Train**, a learning-only product with the shared
facility/learner directory. See [`PRODUCT_MODULES.md`](PRODUCT_MODULES.md) for package composition, independent
builds, route segregation, and the database enforcement boundary.

## Implementation roadmap

The canonical program plan for the 29 approved improvements is
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). It defines five
dependency-aware phases, delivery gates, migration and rollout rules, and the
complete recommendation-to-phase crosswalk. Multilingual experience is
explicitly excluded from that program.

ROADMAP.md remains the historical product review and recommendation rationale.


## What's included

- Six-role RBAC (`platform_admin`, `org_admin`, `facility_manager`, `trainer`, `employee`, `auditor`) enforced by
  Postgres Row-Level Security, not application code.
- Core compliance tracking: organizations, facilities, employees, configurable training types, training records,
  medication practicums, live training classes, document uploads (Supabase Storage, signed URLs), alerts, audit
  logs, and a report center.
- An integrated training suite: training-content version/block authoring, quizzes with server-side grading, training assignments and
  progress tracking, certificates (with a public `/verify/:slug` verification route), training plans, and
  competency checklist templates/records.
- A real, generated Compliance Binder PDF (`generate-compliance-binder` Edge Function using `pdf-lib`), replacing
  the earlier print-to-PDF mock.
- Admin user provisioning, role/org management, and bulk CSV employee import, all via Edge Functions running with
  the service-role key behind an authorization check on the caller's own role.
- A platform_admin-only "Viewing as Org X" UX filter for the admin console -- a convenience, not a security
  boundary, since `is_platform_admin()` already grants unrestricted RLS access.

## Run locally

The preferred local environment is the checked-in dev container, which pins Node 24.15.x, pnpm 10.28.x, Deno 2.x,
the Supabase CLI, and OS packages used by the app/test workflow. Open the repo in VS Code or GitHub Codespaces and
choose **Reopen in Container**; the container runs `pnpm install --frozen-lockfile` and `pnpm run doctor` after it is
created.

```bash
pnpm install
pnpm --filter @workspace/caremetric-carebase dev
```

Copy `artifacts/caremetric-carebase/.env.example` to `.env` and fill in your Supabase project URL, publishable
(anon) key, and Cloudflare Turnstile site key. The workspace installs native optional dependencies for the current
developer machine plus linux-x64-glibc CI/deploys via pnpm `supportedArchitectures`.

Useful validation commands inside the dev container:

```bash
pnpm run typecheck
pnpm run test
pnpm run check:edge-functions
pnpm run check:all
pnpm run check:release
```

`check:release` is the local Phase 1 clean-room gate. It starts the pinned
Supabase stack, reapplies every migration, runs pgTAP, linting and advisors,
checks generated type drift, and verifies the application artifact. Docker is
required. CI additionally runs the disposable role, public-verification,
guest, and accessibility journeys in Chromium.

For production deployment (Railway + Supabase), see `DEPLOYMENT.md`.
Phase 1 rollout, recovery, ownership, and pilot procedures are in
[`PHASE1_OPERATIONS.md`](PHASE1_OPERATIONS.md).
Phase 2 hierarchy, workforce, rule, identity, billing, integration, and pilot
procedures are in [`PHASE2_OPERATIONS.md`](PHASE2_OPERATIONS.md).
Phase 3 HRIS, qualification, credential renewal, instructor-led training,
eligibility, and pilot procedures are in
[`PHASE3_OPERATIONS.md`](PHASE3_OPERATIONS.md).
Phase 4 content governance, policy lifecycle, standards interoperability,
adaptive learning, offline safety, and pilot procedures are in
[`PHASE4_OPERATIONS.md`](PHASE4_OPERATIONS.md).
Phase 5 remediation, confidential intake, move-in collaboration, historical
reporting, evidence-room access, and pilot procedures are in
[`PHASE5_OPERATIONS.md`](PHASE5_OPERATIONS.md).

## Database / backend setup

All schema, RLS policies, functions, and storage buckets live in `supabase/migrations/`, applied in order via the
Supabase CLI or `mcp__Supabase__apply_migration`. Edge Function source lives in `supabase/functions/*/index.ts` and
must be declared in `supabase/config.toml` to auto-deploy via the Supabase GitHub integration.

1. Create a Supabase project (Postgres 17+).
2. Apply every migration under `supabase/migrations/` in filename order.
3. Deploy the Edge Functions under `supabase/functions/`.
4. Create environment-specific admin/demo users through the Supabase Admin API, `invite-user`, or
   `signup-organization`. Do not seed reusable passwords from SQL.
5. Run `mcp__Supabase__generate_typescript_types` (or `supabase gen types typescript`) to produce
  `artifacts/caremetric-carebase/src/lib/database.types.ts`.

For proven email/SMS/web-push delivery, deploy `dispatch-notifications`,
`push-subscriptions`, and `send-auth-email`,
configure the hosted Supabase Auth **Send Email** hook to point at `send-auth-email`,
and configure the signed SendGrid Event Webhook plus Twilio status/inbound-message
callbacks to the two notification webhook functions. Set `SENDGRID_API_KEY`,
`NOTIFICATION_FROM_EMAIL`, `SEND_EMAIL_HOOK_SECRET`,
`SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY`, `NOTIFICATION_RECIPIENT_HASH_SECRET`, the
Twilio credentials, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`,
`WEB_PUSH_VAPID_SUBJECT`, and `CRON_SHARED_SECRET` as Supabase Edge Function secrets;
never expose them to the Vite application. The checked-in local hook stanza stays
disabled unless a developer opts in with a base64-encoded
`SEND_EMAIL_HOOK_SECRET_BASE64`. Twilio Advanced Opt-Out should route inbound
STOP/START events to `twilio-notification-webhook?kind=consent`.

## Demo users

The `/demo` page offers one-click role entry when `VITE_DEMO_ACCOUNTS_JSON` contains valid `org_admin`,
`facility_manager`, `trainer`, `employee`, or `auditor` accounts. The parser always rejects `platform_admin`.
Because `VITE_*` values are visible in the browser, every configured account must belong only to an isolated
organization marked `is_demo`; never point this configuration at a customer tenant. Hosted demo users are created
per environment through the Admin API and use deploy-time credentials. The predictable passwords in
`supabase/seed.sql` are only for a disposable local Supabase stack and must never be reused in a hosted environment.

The Sunrise demo baseline includes synthetic staffing, residents, schedules, admissions, service tasks, incidents,
inspections, maintenance, complaints, QAPI, emergency operations, and an evidence-room starter collection. An
organization administrator can restore the baseline from Settings, and a daily job repairs it automatically.
Email, SMS, and push delivery plus demo-initiated Auth user provisioning are blocked for demo organizations.

See `ARCHITECTURE.md` for the full architecture writeup (RLS model, storage buckets, Edge Functions, route map).
