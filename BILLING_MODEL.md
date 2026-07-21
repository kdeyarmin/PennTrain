# CareMetric subscription model

## Decision

CareMetric should use a **base subscription with included usage and a value-aligned overage**, with monthly and annual cadences:

| Package | Product access | Recommended value metric | Launch offer | Annual offer |
|---|---|---|---|---|
| CareMetric Train | Train | Monthly active learner | $239/month includes 25 active learners, then $4/additional active learner | $2,390/year includes 25, then $40/additional active learner/year |
| CareMetric CareBase | CareBase + Train | Active resident | $499/month includes 25 active residents, then $4/additional active resident | $4,990/year includes 25, then $40/additional active resident/year |
| CareMetric Portfolio | CareBase + Train | Negotiated facility/resident commitment | Custom annual contract | Custom annual contract |

The amounts are launch hypotheses, not code constants. Platform administrators manage them in **Admin > Packages & billing**. A production Stripe Price ID must be attached before a self-serve configuration is checkout-ready.

## Why this model fits the product

- **Train creates value per learner.** Counting monthly active learners aligns price with delivered training while avoiding charges for archived or seasonal records.
- **CareBase creates value around resident operations.** Active-resident pricing is easier to budget than charging every administrator, caregiver, auditor, and family collaborator. It also avoids discouraging staff adoption.
- **The base fee captures platform value.** Compliance automation, audit evidence, support, content governance, reporting, and integrations have value even at low usage.
- **Included quantities reduce billing anxiety.** Small operators get a predictable starting price; larger operators scale smoothly.
- **Annual pricing improves retention and cash flow.** The seeded 16.67% discount is approximately two months free and remains editable.
- **Portfolio contracts preserve enterprise flexibility.** Multi-facility organizations often need implementation, data migration, negotiated commitments, and tailored support that should not be forced through self-serve checkout.

## Market signals reviewed

- CareAcademy publicly lists care-training tiers at $239, $383, and $419 per month, and uses per-seat add-ons. This supports a meaningful platform base plus learner-linked expansion pricing: <https://careacademy.com/pricing/>
- TalentLMS uses user bands, offers pricing based on monthly unique logins for its flexible model, and advertises a 20% annual discount. This supports active-learner measurement and an annual incentive: <https://www.talentlms.com/prices>
- ALChartsPlus prices assisted-living operations by active resident count and explicitly avoids per-user fees. This supports resident rather than staff-user pricing for CareBase: <https://www.alchartsplus.com/>
- Quiltt prices its senior-living Pro product per community at $499 monthly or $4,990 annually. This supports a facility-level base and the approximate two-month annual discount: <https://www.quiltt.com/pricing>
- Stripe supports flat, per-seat, tiered, and fixed-fee-plus-overage subscription models. CareMetric uses Stripe Billing Prices and hosted Checkout rather than manual renewals: <https://docs.stripe.com/products-prices/pricing-models>

## Configuration model

`packages` owns customer positioning, product modules, recommendation state, trial length, annual discount, and whether sales contact is required.

`package_billing_prices` owns each effective-dated monthly or annual price configuration:

- billing metric: flat, active learner, active user, active resident, or facility;
- pricing model: flat, per-unit, graduated, volume, base plus overage, or custom;
- display base amount, included quantity, and display unit amount;
- minimum and maximum quantities;
- active/primary status and optional Stripe Price ID.

Display amounts make the catalog understandable inside CareMetric. The immutable Stripe Price remains the invoicing source of truth. When pricing changes, archive the prior row and Stripe Price, then add a replacement so existing subscriptions and reconciliation history remain stable.

## Canonical billable quantities

The customer never types a quantity into Checkout. `get_organization_billing_usage()` measures the organization, the plan page previews that measurement, and the Checkout Edge Function measures it again immediately before creating the Stripe session. A browser-supplied value cannot reduce the charge.

| Metric | CareMetric measurement |
|---|---|
| Active learner | Employee records with `status = active`; synthetic demo employees are excluded |
| Active user | Active signed-in profiles belonging to the organization |
| Active resident | Resident records with `status = active`; synthetic demo residents are excluded |
| Facility | Active, non-sandbox facilities |
| Flat | One subscription |

The active learner metric intentionally counts the training roster, including learners who do not need their own login. CareBase uses active residents, so adding staff, auditors, or collaborators does not increase the CareBase price. If the measured count is below a price's minimum, the minimum is sent to Stripe. If it exceeds the self-service maximum, Checkout stops and routes the organization to contract pricing.

After Checkout, the monitored `billing-quantity-sync` job repeats the same measurement hourly and updates a mapped Stripe subscription item only when its quantity changed. It uses `proration_behavior = none`: roster changes do not create surprise mid-cycle charges or credits, and the latest synchronized snapshot applies to the next recurring invoice. The signed Stripe webhook remains authoritative for provider state; the worker's durable system-job run makes failed or out-of-range synchronization visible to platform operations.

## Customer and administrator experience

- Organization administrators compare the active catalog, switch between monthly and annual pricing, see included units and overage, review their live measured quantities, and see a pre-tax recurring estimate.
- New customers continue through hosted Stripe Checkout only when the selected cadence has an active primary `price_...` mapping.
- Customers with an existing trialing, active, grace, or past-due Stripe subscription are sent to the Stripe Customer Portal rather than creating a duplicate subscription.
- Platform administrators use the same plan view for any selected organization and manage the catalog under **Admin > Packages & billing**.
- Draft display prices remain visible to platform administrators, but customer Checkout stays disabled until the Stripe Price ID is connected.

## Stripe Price mapping for the launch catalog

Create each self-serve Price as a recurring, graduated-tier Stripe Price. The first tier implements the base fee and included quantity; the second implements overage.

| CareMetric configuration | Stripe interval | Tier 1 through 25 | Tier 2 above 25 |
|---|---|---|---|
| Train monthly | Monthly | `$239` flat amount and `$0` per unit | `$4` per unit |
| Train annual | Yearly | `$2,390` flat amount and `$0` per unit | `$40` per unit |
| CareBase monthly | Monthly | `$499` flat amount and `$0` per unit | `$4` per unit |
| CareBase annual | Yearly | `$4,990` flat amount and `$0` per unit | `$40` per unit |

Use `quantity = actual active records` in Stripe. A quantity from 1 through 25 bills only the first-tier flat amount; higher quantities add second-tier unit charges. Keep Stripe's tax behavior, currency, interval, tiers, and trial configuration aligned with the CareMetric display record.

## Operational guardrails

1. Create the Stripe Product and recurring Price with the same cadence, quantity behavior, and tiers shown in CareMetric.
2. Paste the resulting `price_...` ID into the active primary billing configuration.
3. Test Checkout and the Customer Portal in Stripe test mode.
4. Activate the configuration only after the display amounts and Stripe Price agree.
5. Never reuse or mutate a historical Stripe Price for a price change; create a new Price and effective-dated CareMetric row.
6. Revisit the launch amounts after the first 10 paying customers using conversion, support burden, gross margin, active learner/resident distributions, and churn data.

## Production activation checklist

1. Apply the forward migration and confirm the three packages and four draft self-serve prices appear in **Admin > Packages & billing**.
2. Create the four graduated recurring Prices in Stripe test mode using the tier table above.
3. Paste each immutable `price_...` ID into its matching monthly or annual CareMetric price and save it as active and primary.
4. Configure the Stripe Customer Portal with the products, allowed plan changes, payment-method updates, invoice history, cancellation policy, and proration behavior the business wants to support.
5. Set the Edge Function secrets `STRIPE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SHARED_SECRET`; add the same cron secret to Supabase Vault as `cron_shared_secret`, and set `BILLING_RETURN_URL_ORIGINS` to the exact production and approved staging origins.
6. Run one Checkout below the included quantity, one above it, one annual Checkout, one Customer Portal return, and one maximum-quantity rejection. Verify the resulting subscription item quantity and invoice tiers in Stripe.
7. Configure and verify the existing Stripe webhook endpoint before accepting live Checkout sessions, then repeat the test set with live Price IDs and a real internal organization.
8. Confirm the **Billing quantity synchronization** system job runs hourly, then add and discharge test learners/residents and verify Stripe reflects the new quantities without generating prorations.
