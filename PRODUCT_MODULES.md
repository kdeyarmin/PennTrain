# CareMetric product modules

CareMetric is one multi-tenant platform with a shared account and directory shell, sold and deployed as independently entitled products.

| Product | Entitlement | Includes |
|---|---|---|
| Shared core | implicit | Authentication, account security, organizations, facilities, employees/learners, users, settings, notifications, and support |
| CareMetric Train | `modules.train` | Online courses, course assignments, learning plans, training records, certificates, live learning sessions, and governed learning content |
| CareMetric CareBase | `modules.carebase` | Resident records/forms, workforce operations, credentialing, scheduling, incidents, inspections, maintenance, compliance, documents, evidence, reporting, and operational workflows; CareBase always includes Train |

## Access decision

`artifacts/caremetric-carebase/src/lib/productModules.ts` is the frontend product manifest. It classifies every authenticated route as `core`, `train`, or `carebase`. `ProductModuleAccessProvider` resolves the signed-in organization’s typed entitlements through `get_effective_entitlements`, intersects them with the modules included in the current build, and exposes one decision to routes, navigation, search, notifications, favorites, recents, and landing-page redirects.

The database is authoritative. `app_private.product_module_resources` classifies every existing RLS-protected business table, and `app_private.product_module_storage_buckets` classifies every private file bucket. Restrictive `product_module_entitlement` RLS policies compose with the existing tenant/role/facility and object-ownership policies, so both the original authorization rule and the commercial module entitlement must pass. The shared core tables are intentionally absent from the table registry and explicitly identified in the bucket registry.

Public certificate, passport, guest-access, marketing, and signup paths keep their existing public policies. Platform administrators retain their cross-tenant support boundary. The service role is unaffected.

## Package composition

Platform administrators configure product access in **Admin → Packages**. The package editor writes `modules.train` and `modules.carebase` into the package feature document, which the existing compatibility trigger versions into typed `package_entitlements`. Organization-specific contract grants continue to take precedence through the existing entitlement engine.

The migration seeds two selectable packages:

- **CareMetric Train**: Train on, CareBase off.
- **CareMetric CareBase**: Train on, CareBase on.

Existing packages inherit both modules through the feature definitions’ `true` defaults, preventing a rollout from removing current customer access.

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

1. Add the module definition and dependency rules in `src/lib/productModules.ts`.
2. Classify its route prefixes there and add unit tests for list, detail, and self-service routes.
3. Add a typed `modules.<name>` feature definition and package terms in a forward-only migration.
4. Reclassify every affected table in `app_private.product_module_resources`; the restrictive policy must exist before exposing the route.
5. Add explicit module assertions inside any `SECURITY DEFINER` RPC or Edge Function that bypasses table RLS.
6. Verify a package with the module off cannot reach its route, navigation/search entry, direct table data, privileged commands, or storage objects.

Do not use `organization_settings.hidden_navigation_sections` as authorization. That preference is cosmetic; product entitlements and database policies are the access boundary.
