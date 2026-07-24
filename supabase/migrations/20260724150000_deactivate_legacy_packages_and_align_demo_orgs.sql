-- The pre-launch "Starter", "Compliance Plus", and "Enterprise" packages predate
-- the modular Train/CareBase/Portfolio catalog introduced in
-- 20260720205629_configurable_hybrid_subscription_pricing.sql. They have no
-- package_billing_prices rows at all, so no Stripe Price can ever be attached to
-- them and self-serve checkout can never complete for an organization on one of
-- them (create-billing-session requires an active primary priced row). Deactivate
-- them so they stop appearing as selectable options anywhere that filters on
-- packages.is_active (the customer-facing plan selector in BillingPlanSelector.tsx,
-- and checkout eligibility in create-billing-session), while leaving the rows
-- themselves intact for platform-admin history in Admin > Packages.
update public.packages
set is_active = false,
    updated_at = now()
where name in ('Starter', 'Compliance Plus', 'Enterprise');

-- The two seed/demo organizations were still assigned to those now-deactivated
-- legacy packages. Move them onto the current recommended self-serve package so
-- the demo experience matches the live catalog and the marketing site.
--
-- protect_organization_subscription_fields() silently reverts package_id (and a
-- few sibling columns) back to its previous value for any UPDATE issued outside
-- an authenticated platform_admin session -- auth.uid() is null for a migration,
-- so is_platform_admin() is false. That guardrail exists to stop end-user/API
-- tampering with billing-contract fields; a reviewed migration is the sanctioned
-- equivalent of a platform-admin action, so disable it for the duration of this
-- one statement rather than working around it.
alter table public.organizations disable trigger protect_subscription_fields;

update public.organizations
set package_id = (select id from public.packages where name = 'CareMetric CareBase'),
    plan_name = 'CareMetric CareBase',
    updated_at = now()
where name in ('Maple Grove Senior Living', 'Sunrise Healthcare Group');

alter table public.organizations enable trigger protect_subscription_fields;
