# Enterprise Operations Control Plane Runbook

This runbook describes how reviewers and operators should validate the Enterprise
Operations tab and its backing database objects before release.

## Scope and boundaries

- The Enterprise Operations tab reuses the existing Enterprise Foundation control
  plane. It does not create a separate platform-admin subsystem, resident portal,
  family portal, prospect portal, billing ledger, or provider-secret UI.
- Provider credentials, webhook signing secrets, SFTP credentials, and managed
  integration secrets must remain in Supabase secrets, Edge Function secrets, or
  approved backend secret storage. They must not be copied into React state,
  browser-visible configuration, analytics payloads, or support-ticket notes.
- Release flags, entitlements, rollout cohorts, and kill switches remain separate
  concepts. None of them replaces PostgreSQL authorization, RLS policies, or RPC
  authorization checks.
- Generated binary artifacts, including regenerated PDFs, screenshots, archives,
  and built assets, must not be included in this PR. If a local build rewrites
  `artifacts/caremetric-carebase/public/CareMetric-CareBase-User-Manual.pdf`,
  restore it from `origin/main` before creating the pull request.

## Review checklist

1. Apply migrations in a local Supabase stack or CI database.
2. Sign in as `platform_admin` and verify `/admin/enterprise` loads the
   Operations tab without exposing provider secrets.
3. Sign in as `org_admin` and verify `/app/enterprise` is scoped to the current
   organization and cannot request another organization by UUID.
4. If a facility filter is added later, verify facility managers can only save
   snapshots for assigned facilities.
5. Click **Save reproducible snapshot** and confirm:
   - a row is inserted into `enterprise_analytics_snapshots`;
   - the row has a checksum;
   - attempting to update or delete that row is blocked by the immutable-history
     trigger;
   - a matching `audit_logs` row exists with action
     `enterprise_snapshot_saved`.
6. Create or seed failed `enterprise_integration_jobs` and
   `enterprise_import_batches` records and verify the Operations tab shows them
   in the recovery queues.
7. Confirm every displayed metric includes a value, denominator or explicit
   non-percentage basis, date basis, data freshness, and drill-down source.

## Required checks

Run these before requesting final review:

```bash
pnpm run typecheck
pnpm run test
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  VITE_SUPABASE_ANON_KEY=dummy \
  VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
  pnpm --filter @workspace/caremetric-carebase run build
git diff --check
```

When Docker and Deno are available, also run:

```bash
pnpm run check:edge-functions
pnpm run check:database
pnpm run check:all
pnpm run check:release
```

## Recovery notes

- Re-running **Save reproducible snapshot** with unchanged source data returns the
  existing checksum-backed snapshot rather than mutating historical evidence.
- Failed imports must remain in preview/partial/failed states until an authorized
  operator reviews validation and mapping errors. Do not manually patch active
  resident, employee, facility, asset, or inventory records to work around import
  failures.
- Dead-lettered integration jobs should be replayed only after validating the
  provider contract version, idempotency key, replay window, and reconciliation
  counts.
