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

The customer never types a quantity into Checkout. For **flat** plans the Checkout handler always sends **quantity = 1**, whether hosted on Supabase or Railway. Usage measurement (`get_organization_billing_usage()`) remains available for reporting and for any custom non-flat contracts.

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

Select the runtime using [the deployment configuration and rollout](DEPLOYMENT.md#railway-provider-runtime-opt-in).
Railway mode runs Checkout/Portal, webhook processing, and quantity synchronization with the
existing shared handlers and database authorization. It keeps provider credentials in Railway
server variables. The default Supabase mode remains available; blank/invalid runtime flags fail
closed. These instructions do not assert that production activation or live checks are complete.

| Billing configuration | Railway provider mode | Supabase compatibility mode |
| --- | --- | --- |
| Browser Checkout/Portal | Same-origin `/api/providers/create-billing-session`; current Supabase Bearer session | Existing SDK invocation of `create-billing-session` |
| Dedicated Stripe webhook | `https://cmcarebase.com/api/providers/stripe-billing-webhook` | `https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/stripe-billing-webhook` |
| Stripe key, endpoint signing secret, portal configuration | Railway server variables | Supabase Edge Function environment |
| Supabase service-role key | Railway server variable for this same CM Train project | Injected by Supabase into Edge Functions |
| Scheduled/manual quantity sync | Existing Edge URL forwards after nonsecret `BILLING_RUNTIME=railway` is enabled; existing cron shared secret must match Railway | Existing Edge worker; `BILLING_RUNTIME` unset or `supabase` |

1. Apply forward migrations (including `20260731131807_flat_self_serve_pricing.sql`) and confirm Train/CareBase primary prices show **flat** $239 / $499 in **Admin > Packages & billing**.
2. Use a separate test environment with test-mode credentials and four **flat** recurring test Prices (Train month/year, CareBase month/year). Never put test IDs or keys into production.
3. Map each immutable `price_...` ID to its matching cadence in the same environment. Production uses the verified live mappings above.
4. Create a dedicated PennTrain Stripe Customer Portal configuration with only its products and supported plan changes, payment-method updates, invoice history, cancellation policy, and proration behavior. Save its `bpc_...` ID as the server-only `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`. Manage billing fails closed when this is unset or malformed; it never selects the shared account default or a browser-supplied configuration.
5. Configure `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, and the existing `CRON_SHARED_SECRET` in the selected server runtime. In Railway mode also install the same CM Train project's service-role key and the other required settings from `DEPLOYMENT.md`; Supabase does not inject credentials into Railway. Keep the cron secret consistent with the existing Supabase Edge setting and Vault `cron_shared_secret`. Do not copy Stripe credentials into Supabase for Railway mode. Use `BILLING_RETURN_URL_ORIGINS` for exact approved origins where needed; otherwise the existing fallback through `PUBLIC_APP_URL`, `SIGNUP_REDIRECT_ORIGINS`, and the canonical `https://cmcarebase.com` applies. The caller's `Origin` never extends this allowlist. Missing required configuration fails closed; Railway-mode server startup rejects absent server settings before promotion. Presence alone does not prove that credentials or webhook delivery work.
6. **Configure and verify the dedicated PennTrain Stripe webhook before any Checkout runs.** Use the selected runtime's exact URL above, keep delivery disabled while installing that endpoint's own signing secret, and enable it only when the matching handler is ready. Subscribe to the Checkout, `customer.subscription.*`, and `invoice.*` events the processor handles, using the same API version as `STRIPE_API_VERSION`. Do not alter the existing Base44 webhook for the other application. Send a supported signed test event and confirm its processing receipt in `app_private.stripe_billing_events`; reject invalid signatures. Without a working endpoint, a real Stripe subscription can exist without reconciliation into `billing_subscriptions`.
7. After Railway readiness is verified, set Supabase's nonsecret `BILLING_RUNTIME=railway` if using that runtime. Confirm both the scheduled **Billing quantity synchronization** job and operator-triggered dispatch use their existing Edge URLs and record correlated, succeeded runs; for flat plans they must keep quantity at 1. Do not retry an ambiguous forwarder timeout before checking the durable run result. For rollback, disable this forwarder before rolling back Railway, as described in `DEPLOYMENT.md`.
8. Run Checkout for Train and CareBase (monthly and annual). Verify the subscription item quantity is **1**, the invoice amount matches the flat fee, and — now that step 6 is done — that the subscription actually reconciled into `billing_subscriptions` rather than only existing in Stripe.
9. Repeat with live Price IDs on an internal organization before accepting real customers.
