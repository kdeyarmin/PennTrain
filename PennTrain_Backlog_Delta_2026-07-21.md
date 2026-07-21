# PennTrain backlog delta — 2026-07-21

**Companion report:** `PennTrain_Comprehensive_Review_2026-07-21.md`
**Scope:** new work only. PT-001..PT-034 remain in the 2026-07-20 backlog and are not restated here.

## PT-035 — Make billing quantity sync provider-idempotent and locally reconcilable

**Labels:** `priority:P1`, `area:billing`, `area:edge-functions`, `stripe`, `reliability`
**Outcome:** Stripe subscription item quantity changes are represented by a durable local operation before provider mutation, reused across retries, and reconciled after partial failure.

**Status:** partially mitigated on this branch by using stable item/quantity idempotency keys; a durable provider-operation ledger is still required for full closure.

**Evidence**

- `supabase/functions/sync-billing-quantities/index.ts` updates Stripe first, then updates local item and subscription rows.
- The idempotency key includes per-run `correlationId`, so a retry after local persistence failure can produce a fresh Stripe operation for the same intended quantity.

**Implementation slice**

1. Add a `billing_provider_operations` table or equivalent ledger keyed by provider object, target quantity, operation type, and stable idempotency key.
2. Insert/claim the operation before calling Stripe and reuse the same key until terminal success/failure.
3. After local persistence failure, read the current Stripe item and reconcile CareBase state rather than blindly re-mutating.
4. Make unresolved operations visible in system jobs/admin billing UI.

**Acceptance criteria**

- Forced local DB failure after a successful Stripe response leaves a durable operation record.
- Retrying reuses the same Stripe idempotency key and converges local rows to provider state.
- Duplicate workers cannot apply conflicting quantities for the same subscription item.
- Operators can see and retry/reconcile stuck operations without exposing Stripe secrets.

**Automated verification:** Edge handler tests with mocked Stripe success + DB failure, duplicate retry, stale target quantity, and provider/current-state reconciliation.

**Effort:** M.

## PT-036 — Remove hard-coded Supabase project URL from billing cron

**Labels:** `priority:P1`, `area:deploy`, `area:billing`, `supabase`
**Outcome:** scheduled billing quantity sync calls the correct Edge Function URL in every environment without editing migration source.

**Status:** implemented on this branch; keep the verification items as acceptance criteria for deployment.

**Evidence**

- `supabase/migrations/20260720205629_configurable_hybrid_subscription_pricing.sql` schedules `https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/sync-billing-quantities` directly.

**Implementation slice**

1. Store the functions base URL in Vault or a documented database setting during environment bootstrap.
2. Have cron SQL read that setting and fail closed/observable if absent.
3. Add deployment smoke tests for local/staging/prod cron target correctness.

**Acceptance criteria**

- Branch/staging/prod projects do not contain another project's URL in `cron.job`.
- Missing URL config produces a visible failed preflight rather than a silently scheduled bad job.
- Deployment docs list the required setting and verification query.

**Automated verification:** SQL/unit check that rejects hard-coded Supabase project refs in migrations; smoke query against `cron.job` in staging.

**Effort:** S.

## PT-037 — Add an execution deadline and resumable batching to billing quantity sync

**Labels:** `priority:P1`, `area:billing`, `area:edge-functions`, `performance`
**Outcome:** the worker stops safely before Edge execution limits and leaves unstarted work pending for the next run.

**Status:** implemented on this branch with batch-size clamping, a request deadline, and deferred pending subscriptions.

**Evidence**

- `sync-billing-quantities` accepts up to 250 subscriptions and processes all selected items with provider calls but no elapsed-time/deadline checks.

**Implementation slice**

1. Establish a monotonic deadline below the platform limit.
2. Claim only enough work to fit the budget, or checkpoint after each item/subscription.
3. Stop before the deadline, mark only attempted work as attempted, and leave the rest pending.
4. Add provider-timeout and large-batch tests.

**Acceptance criteria**

- Simulated slow Stripe calls stop before the configured deadline.
- Unstarted subscriptions retain `pending`/old `quantity_sync_checked_at` and are picked up next run.
- System-job counts distinguish attempted, succeeded, failed, skipped, and deferred.

**Automated verification:** mocked timers/provider latency tests and an integration test with >250 synthetic subscriptions.

**Effort:** M.

## PT-038 — Retire product-module fail-open compatibility mode

**Labels:** `priority:P1`, `area:entitlements`, `area:frontend`, `commercial-controls`
**Outcome:** module entitlement enforcement fails closed after migrations are expected, with an explicit temporary bridge only for controlled rolling deploys.

**Status:** implemented on this branch for the frontend decision; remaining work is deployment telemetry/preflight.

**Evidence**

- `ProductModuleAccessProvider` grants all purchasable modules when no product-module definition rows are returned.

**Implementation slice**

1. Put fail-open behavior behind a clearly named, default-false build/deploy flag.
2. Emit telemetry/admin warnings whenever the bridge is active.
3. Add a release deadline and test that normal environments fail closed when module rows are absent.
4. Provide a migration/seed preflight that checks `modules.train` and `modules.carebase` definitions.

**Acceptance criteria**

- Fresh/staging/prod builds without the explicit bridge deny non-core modules if definitions are missing.
- Platform admins retain support access.
- Operators see a clear configuration error instead of silent all-module access.

**Automated verification:** unit tests for normal fail-closed, bridge fail-open, RPC error, loading, and platform-admin paths.

**Effort:** S.

## PT-039 — Generate server-side product-module coverage tests

**Labels:** `priority:P1`, `area:database`, `area:entitlements`, `rls`
**Outcome:** every non-core tenant table and storage bucket classified in the module registry is enforced by RLS/storage policy or an equivalent server-side guard.

**Evidence**

- #227 adds `app_private.product_module_resources` and bucket classifications, but the registry alone does not prove historical RLS policies call `app_private.has_product_module`.

**Implementation slice**

1. Build a SQL/pgTAP test that enumerates registry rows and policy definitions.
2. Fail if a classified table/bucket has no effective module check and no documented exception.
3. Add negative tests for direct URL/API access to a CareBase table from a Train-only org.

**Acceptance criteria**

- Train-only org cannot read/write CareBase-classified resources by direct API.
- Missing module check on a new classified table fails CI.
- Documented core exceptions are explicit and reviewed.

**Automated verification:** pgTAP policy coverage plus direct PostgREST/storage negative tests.

**Effort:** M.

## PT-040 — Surface billing catalog query failures in the plan selector

**Labels:** `priority:P2`, `area:billing`, `area:frontend`, `ux`
**Outcome:** billing admins and tenant admins can distinguish empty pricing from failed package, price, organization, usage, or account queries.

**Status:** implemented on this branch for package, price, organization, and billing-account query failures; add component tests next.

**Evidence**

- `BillingPlanSelector` renders usage loading/error state but uses package and price query data with `?? []`, which can make failures appear like an empty catalog.

**Implementation slice**

1. Add an aggregate billing query-state component.
2. Block checkout/portal actions when any required query failed.
3. Add retry affordances and tests for package/price/account/usage failures.

**Acceptance criteria**

- Package/pricing query failure displays a destructive error with retry.
- Empty active catalog displays distinct intentional empty-state copy.
- Checkout cannot start with partial or failed catalog data.

**Automated verification:** component tests with each query in error/loading/empty/success state.

**Effort:** S.

## PT-041 — Correct product-module documentation around notifications

**Labels:** `priority:P2`, `area:docs`, `area:entitlements`, `area:notifications`
**Outcome:** documentation accurately states which surfaces are actually filtered by module entitlements and which still require server-side work.

**Status:** implemented on this branch.

**Evidence**

- `PRODUCT_MODULES.md` says the module access decision reaches notifications, but #227 changed route/navigation/search/header code, not notification delivery authorization.

**Implementation slice**

1. Update docs to separate frontend discovery surfaces from backend delivery surfaces.
2. If notification entitlement filtering is desired, add it as implementation work with tests.
3. Link to the generated server-side module coverage test once PT-039 lands.

**Acceptance criteria**

- Docs no longer claim notification enforcement unless provider dispatch is proven.
- Any remaining roadmap wording is clearly labeled future work.

**Automated verification:** doc/source consistency grep for entitlement claims, plus tests if implementation is added.

**Effort:** S.

## PT-042 — Restore post-#228 bundle headroom

**Labels:** `priority:P2`, `area:frontend`, `performance`, `build`
**Outcome:** largest JS chunk and all-JS totals return below 90% of configured budget without simply raising caps.

**Evidence**

- 2026-07-21 `pnpm run check:bundle` reports largest chunk 474.0 KiB (92.9% of 510 KiB) and all JS 3,404.5 KiB (92.0% of 3,700 KiB).

**Implementation slice**

1. Inspect shell imports introduced or expanded by #227/#228.
2. Lazy-load admin-only billing components and heavy UI paths.
3. Add a bundle analyzer artifact to CI for warning-threshold branches.

**Acceptance criteria**

- Largest JS and all-JS are below 90% on a clean production build.
- No user-visible regression in route loading.
- New shell imports are reviewed in PRs touching `App.tsx`, layout, providers, or global navigation.

**Automated verification:** `pnpm --filter @workspace/caremetric-carebase run build` and `pnpm run check:bundle` with warning-free output.

**Effort:** M.
