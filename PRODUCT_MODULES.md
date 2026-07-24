# CareMetric product modules

CareMetric is one multi-tenant platform with a shared account and directory shell, sold and deployed as independently entitled products. The former single `carebase` product is decomposed into operational pillars so facilities can buy a tier below the full care-operations suite.

| Product | Entitlement | Includes |
|---|---|---|
| Shared core | implicit | Authentication, account security, organizations, facilities, the employee **and resident** directories, staff credential/administrator records, users, settings, notifications, and support |
| CareMetric Train | `modules.train` | Online courses, course assignments, learning plans, training records, certificates, live learning sessions, and governed learning content |
| CareMetric Workforce | `modules.workforce` | Scheduling and shifts, competencies, background and exclusion screening, staff qualification lifecycle, and the credentialing workflow surfaces |
| CareMetric Compliance | `modules.compliance` | Inspection readiness, survey day, violations, complaints, state/DHS forms, evidence room, QAPI, policy documents/attestations, the regulatory copilot, and resident compliance |
| CareMetric Billing | `modules.billing` | Resident financial operations: rate agreements, monthly charges, statements, receivables aging, payments, and resident personal funds |
| CareMetric CareBase | `modules.carebase` | The all-inclusive care-operations suite (resident care delivery, assessments, medication, dietary, admissions, incidents, emergency, maintenance, documents, and reporting). **CareBase always includes Train, Workforce, Compliance, and Billing.** |

The **cross-pillar record backbone is shared core, not a pillar.** The resident directory (`residents`, `resident_contacts`) and the staff credential/administrator records (`employee_credentials`, `employee_credential_documents`, `administrator_profiles`, `administrator_ce_entries`) are read by both the Compliance and Workforce surfaces as well as the core directory pages, so they live in the shared shell like the employee directory. Only the credentialing *workflow routes* are gated to Workforce; the underlying records render consistently across every care tier.

## Access decision

`artifacts/caremetric-carebase/src/lib/productModules.ts` is the frontend product manifest. It classifies every authenticated route as `core`, `train`, `workforce`, `compliance`, `billing`, or `carebase`. `ProductModuleAccessProvider` resolves the signed-in organization’s typed entitlements through `get_effective_entitlements`, intersects them with the modules included in the current build, and exposes one decision to routes, navigation, search, favorites, recents, and landing-page redirects. Because the CareBase bundle includes every pillar, `withModuleDependencies` expands a `carebase` entitlement to `train + workforce + compliance + billing`, so an existing CareBase customer keeps every route.

The database is authoritative. `app_private.product_module_resources` classifies every RLS-protected business table into a pillar, and `app_private.product_module_storage_buckets` classifies every private file bucket. Restrictive `product_module_entitlement` RLS policies compose with the existing tenant/role/facility and object-ownership policies, so both the original authorization rule and the commercial module entitlement must pass. The shared core tables are intentionally absent from the table registry and explicitly identified in the bucket registry.

`app_private.has_product_module(key)` grants a pillar whenever the organization holds that pillar **or** the all-inclusive `modules.carebase` entitlement. Two consequences follow. First, a table shared between a pillar and Care Operations is classified into the pillar and CareBase customers still reach it (CareBase ⊇ pillar). Second, a blocked SELECT under Postgres RLS returns zero rows rather than erroring, so a lower tier degrades gracefully on a shared page instead of crashing — writes remain blocked by the policy's `WITH CHECK`. The safe classification direction is therefore: move a table into a pillar only when the pillar's tier should see it, and leave anything genuinely ambiguous in `carebase`.

Public certificate, passport, guest-access, marketing, and signup paths keep their existing public policies. Platform administrators retain their cross-tenant support boundary. The service role is unaffected.

## Package composition

Platform administrators configure product access in **Admin → Packages**. The package editor writes each `modules.*` flag into the package feature document, which the existing compatibility trigger versions into typed `package_entitlements`. Enabling the CareBase bundle in the editor forces every pillar on (mirroring the `enforce_carebase_bundle` trigger). Organization-specific contract grants continue to take precedence through the existing entitlement engine.

The customer-facing catalog is a **tier ladder** — the pillar modules are the entitlement building blocks, and each seeded tier bundles a fixed set:

| Tier | `train` | `compliance` | `workforce` | `billing` | `carebase` | Value metric |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **CareMetric Train** | ✓ | | | | | active learner |
| **CareMetric Essentials** | ✓ | ✓ | | | | active resident |
| **CareMetric Professional** | ✓ | ✓ | ✓ | ✓ | | active resident |
| **CareMetric CareBase** | ✓ | ✓ | ✓ | ✓ | ✓ | active resident |
| **CareMetric Portfolio** | ✓ | ✓ | ✓ | ✓ | ✓ | negotiated |

A platform administrator can still compose any custom pillar combination (for example, Billing-only) with the module toggles; the tiers are the default retail catalog.

See [`BILLING_MODEL.md`](BILLING_MODEL.md) for the launch price hypotheses, market signals, Stripe mapping, and repricing guardrails. Platform administrators can revise package positioning and effective-dated monthly/annual billing configurations in **Admin → Packages & billing** without a deploy.

The three new pillar definitions default to `false`, so a Train-only facility never silently gains a pillar. Existing packages keep full access because `modules.carebase` (and the legacy `true` defaults for Train/CareBase) still resolve to every pillar through the dependency above, preventing a rollout from removing current customer access.

Organization administrators compare the active configurations under **Enterprise foundation > Billing & plans**. The plan view measures the configured value metric automatically and uses hosted Stripe Checkout for a new subscription or the Stripe Customer Portal for an existing one. The Checkout server repeats the database measurement so client input cannot under-report the billable quantity.

## Independent deployments

`VITE_CAREMETRIC_MODULES` is an optional comma-separated build-time allow-list. Commercial entitlements and the build allow-list are intersected; a build can never grant a module that the organization did not purchase.

```dotenv
# Standalone CareMetric Train service
VITE_CAREMETRIC_MODULES=train

# Full CareMetric CareBase service (Train is included automatically)
VITE_CAREMETRIC_MODULES=carebase
```

Use a separate Railway service/domain when a facility needs a dedicated product deployment. Both services may safely use the same Supabase project because organization entitlements and RLS remain the data boundary.

## Adding a future product module

1. Add the module definition and dependency rules in `artifacts/caremetric-carebase/src/lib/productModules.ts`.
2. Classify its route prefixes there and add unit tests for list, detail, and self-service routes.
3. Add a typed `modules.<name>` feature definition and package terms in a forward-only migration.
4. Reclassify every affected table in `app_private.product_module_resources`; the restrictive policy must exist before exposing the route.
5. Add explicit module assertions inside any `SECURITY DEFINER` RPC or Edge Function that bypasses table RLS.
6. Verify a package with the module off cannot reach its route, navigation/search entry, direct table data, privileged commands, or storage objects.

Notification delivery is not a frontend discovery surface. Any notification that can disclose module-specific content must perform its own server-side entitlement and tenant checks before enqueueing or dispatching provider payloads.

Do not use `organization_settings.hidden_navigation_sections` as authorization. That preference is cosmetic; product entitlements and database policies are the access boundary.
