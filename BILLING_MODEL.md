# CareMetric subscription model

## Decision

CareMetric self-serve plans use a **flat monthly (or annual) subscription fee** — not per-person overages and not facility-count pricing. The catalog is a **tier ladder** that bundles the operational pillars (`train`, `workforce`, `compliance`, `billing`, `carebase`):

| Tier | Bundled modules | Launch offer | Annual offer |
|---|---|---|---|
| CareMetric Train | Train | **$239/month** flat (unlimited active learners) | **$2,390/year** flat |
| CareMetric Essentials | Train + Compliance | $299/month flat (inactive / not launched) | $2,990/year flat |
| CareMetric Professional | Train + Compliance + Workforce + Billing | $399/month flat (inactive / not launched) | $3,990/year flat |
| CareMetric CareBase | All pillars (full care operations) | **$499/month** flat (unlimited residents & staff) | **$4,990/year** flat |
| CareMetric Portfolio | All pillars | Custom annual contract | Custom annual contract |

Published marketing and product billing both use the **Train $239** and **CareBase $499** flat fees. Essentials and Professional remain in the database as inactive ladder rungs. Platform administrators manage amounts in **Admin > Packages & billing**. A production **flat** Stripe Price ID must be attached before a self-serve configuration is checkout-ready.

Single source of truth for public marketing copy: `artifacts/caremetric-carebase/src/components/marketing/marketingPricing.ts`. Product amounts live in `packages` / `package_billing_prices` (see migration `20260731131807_flat_self_serve_pricing.sql`).

## Why this model fits the product

- **Predictable budgets.** Operators know the monthly fee without counting learners or residents for the invoice.
- **Adoption is free.** Adding staff, auditors, collaborators, or residents does not increase the self-serve price.
- **Packages differ by product scope.** Train is training/compliance tracking; CareBase is the full operations suite — not a larger seat bucket.
- **Annual pricing improves retention and cash flow.** The seeded 16.67% discount is approximately two months free and remains editable.
- **Portfolio contracts preserve enterprise flexibility.** Multi-facility organizations often need implementation, data migration, negotiated commitments, and tailored support that should not be forced through self-serve checkout.

## Market signals reviewed

- CareAcademy publicly lists care-training tiers around a few hundred dollars per month. This supports a meaningful platform fee: <https://careacademy.com/pricing/>
- ALChartsPlus prices assisted-living operations in a way that avoids per-user fees for day-to-day staff collaboration: <https://www.alchartsplus.com/>
- Quiltt prices its senior-living Pro product near $499 monthly or $4,990 annually for community-level software: <https://www.quiltt.com/pricing>
- Stripe supports flat recurring Prices for simple subscriptions. CareMetric uses Stripe Billing Prices and hosted Checkout: <https://docs.stripe.com/products-prices/pricing-models>

## Configuration model

`packages` owns customer positioning, product modules, recommendation state, trial length, annual discount, and whether sales contact is required. Launch self-serve packages use `pricing_strategy = flat_rate`.

`package_billing_prices` owns each effective-dated monthly or annual price configuration:

- billing metric: **flat** for launch self-serve (active learner / resident / facility remain available for custom contracts);
- pricing model: **flat** for launch self-serve (legacy `flat_plus_overage` / graduated / volume remain supported for special contracts);
- display base amount; included quantity and unit amount are zero/null for flat plans;
- minimum/maximum quantity = 1 for flat plans;
- active/primary status and optional Stripe Price ID.

Display amounts make the catalog understandable inside CareMetric. The immutable Stripe Price remains the invoicing source of truth. When pricing changes, archive the prior row and Stripe Price, then add a replacement so existing subscriptions and reconciliation history remain stable.

## Canonical billable quantities

The customer never types a quantity into Checkout. For **flat** plans the Checkout Edge Function always sends **quantity = 1**. Usage measurement (`get_organization_billing_usage()`) remains available for reporting and for any custom non-flat contracts.

| Metric | CareMetric measurement | Used for self-serve launch? |
|---|---|---|
| Flat | One subscription | **Yes** (Train, CareBase) |
| Active learner | Active employee roster (demo excluded) | Custom / legacy only |
| Active resident | Active residents (demo excluded) | Custom / legacy only |
| Active user | Active signed-in profiles | Custom only |
| Facility | Active non-sandbox facilities | Custom only |

The monitored `billing-quantity-sync` job still runs for mapped subscriptions; for flat plans it keeps Stripe quantity at 1. Roster changes do not change the self-serve invoice.

## Customer and administrator experience

- Organization administrators compare the active catalog, switch between monthly and annual pricing, and see a pre-tax recurring estimate equal to the flat fee.
- New customers continue through hosted Stripe Checkout only when the selected cadence has an active primary `price_...` mapping on a **flat** Stripe Price.
- The free trial is a single budget. Signup stamps `organizations.trial_ends_at` from `platform_settings.default_trial_days`; Checkout forwards only remaining trial days.
- Customers with an existing trialing, active, grace, or past-due Stripe subscription are sent to the Stripe Customer Portal rather than creating a duplicate subscription.
- Platform administrators manage the catalog under **Admin > Packages & billing**. Defaults create flat-rate packages and flat billing configurations.

## Stripe Price mapping for the launch catalog

Create each self-serve Price as a **simple recurring flat** Stripe Price (not graduated tiers). The owner connected live account `acct_19pJ0MCEZXcVOdjd` on 2026-09-09. Its PennTrain products are `prod_penntrain_train_flat_20260909` and `prod_penntrain_carebase_flat_20260909`; the existing CareMetric AI catalog and Base44 webhook serve a different application. The four prices below were created and re-read in that account. Migration `20260909052131_remap_penntrain_prices_to_connected_live_account.sql` installs them only when the four original rows and absence of provider billing are verified under locks.

| CareMetric configuration | Stripe interval | Stripe amount | Live Price ID |
|---|---|---|---|
| Train monthly | Monthly | **$239** flat | `price_1UDdvDCEZXcVOdjdznrMHQt4` |
| Train annual | Yearly | **$2,390** flat | `price_1UDdvICEZXcVOdjdvcbLyuFa` |
| CareBase monthly | Monthly | **$499** flat | `price_1UDdvOCEZXcVOdjd6rdSYEDT` |
| CareBase annual | Yearly | **$4,990** flat | `price_1UDdvVCEZXcVOdjdfzqBmbFo` |

Essentials and Professional (if reactivated) use the same flat structure at $299 / $399 monthly.

Use `quantity = 1` in Stripe Checkout for flat plans. Keep Stripe's tax behavior, currency, and interval aligned with the CareMetric display record.

> **Ops note:** If an older graduated Price (`price_...`) was already mapped under the previous base+$4 overage model, archive that CareMetric row (the flat migration does this when a Stripe ID is present) and attach a **new** flat Stripe Price to the replacement draft. Never mutate an existing Stripe Price.

## Operational guardrails

1. Create the Stripe Product and **flat** recurring Price with the same cadence and amount shown in CareMetric.
2. Paste the resulting `price_...` ID into the active primary billing configuration.
3. Test Checkout and the Customer Portal in Stripe test mode.
4. Activate only after the display amount and Stripe Price agree.
5. Never reuse or mutate a historical Stripe Price for a price change; create a new Price and effective-dated CareMetric row.
6. Revisit the launch amounts after the first 10 paying customers using conversion, support burden, gross margin, and churn data.

## Production activation checklist

1. Apply forward migrations (including `20260731131807_flat_self_serve_pricing.sql`) and confirm Train/CareBase primary prices show **flat** $239 / $499 in **Admin > Packages & billing**.
2. Use a separate test environment with test-mode credentials and four **flat** recurring test Prices (Train month/year, CareBase month/year). Never put test IDs or keys into production.
3. Map each immutable `price_...` ID to its matching cadence in the same environment. Production uses the verified live mappings above.
4. Create a dedicated PennTrain Stripe Customer Portal configuration with only its products and supported plan changes, payment-method updates, invoice history, cancellation policy, and proration behavior. Save its `bpc_...` ID as the server-only `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`. Manage billing fails closed when this is unset or malformed; it never selects the shared account default or a browser-supplied configuration.
5. Set the Edge Function secrets an operator actually owns: `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, and `CRON_SHARED_SECRET` (also added to Supabase Vault as `cron_shared_secret`). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are populated by the platform and need no action — they appear in `supabase secrets list` already, so do not treat their presence as evidence the Stripe ones are set. Optionally set `BILLING_RETURN_URL_ORIGINS` to the exact production and approved staging origins; it is not strictly required, because `resolvePhase2BillingReturnOrigins` falls back through `PUBLIC_APP_URL` and `SIGNUP_REDIRECT_ORIGINS` to a `https://cmcarebase.com` default, but unset means the allowlist is whatever that chain resolves to and a deploy served from any other origin has its Checkout and Portal redirects refused with `400 invalid_return_url` (the caller-controlled request `Origin` header never extends the allowlist). **Both Stripe secrets and the portal configuration are required:** without `STRIPE_SECRET_KEY` both Checkout and the Customer Portal answer `503 billing_not_configured` and the hourly `billing-quantity-sync` job answers `503 billing_sync_not_configured`; without `STRIPE_BILLING_WEBHOOK_SECRET`, new Checkout returns `503 billing_not_configured` before any provider call, and the webhook rejects **every** Stripe event with `400 invalid_signature`. Existing portal access remains available if its key and explicit configuration are set. Without `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, Manage billing returns `503 billing_not_configured`. A present secret alone does not prove a valid registered webhook; verify delivery before the first Checkout.
6. **Configure and verify the Stripe webhook endpoint now, before any Checkout runs.** Point it at `/functions/v1/stripe-billing-webhook` on the target project, subscribe it to the Checkout, `customer.subscription.*` and `invoice.*` events the processor handles, and pin it to the same API version `STRIPE_API_VERSION` sends. Send a test event from the Stripe dashboard and confirm a row lands in `app_private.stripe_billing_events` with `processing_status` set. This step is deliberately ahead of Checkout testing: a Checkout run with no working endpoint creates a real subscription in Stripe that never reconciles into `billing_subscriptions`, which is the failure this checklist exists to prevent — and because nothing schedules the webhook, a missing signing secret raises no alert on its own. A missing `STRIPE_SECRET_KEY`, by contrast, surfaces without you: the hourly sync records a failed run and the watchdog reports the job stale.
7. Run Checkout for Train and CareBase (monthly and annual). Verify the subscription item quantity is **1**, the invoice amount matches the flat fee, and — now that step 6 is done — that the subscription actually reconciled into `billing_subscriptions` rather than only existing in Stripe.
8. Repeat with live Price IDs on an internal organization before accepting real customers.
9. Confirm the **Billing quantity synchronization** system job runs and records a succeeded run; for flat plans it should keep quantity at 1.
