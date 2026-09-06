/**
 * What "no package" actually entitles an organization to (RELEASE_READINESS_PLAN 4.3, platform L1).
 *
 * `feature_definitions.modules.carebase` has `default_value = true`, and
 * `app_private.has_product_module` short-circuits every other module key on it:
 *
 *     -- CareBase includes every operational pillar (Train, Workforce, Compliance, Billing).
 *     if public.has_effective_entitlement(v_org_id, 'modules.carebase', 1, now()) then
 *       return true;
 *     end if;
 *
 * An organization with `package_id = null` therefore resolves `modules.carebase` from the DEFAULT
 * and is entitled to the whole suite for as long as its billing state is one of
 * trial/active/grace/comped. That is deliberate -- it is what makes a self-signup trial usable on
 * day one, and removing it is an entitlement change, not a copy change. But the admin control said
 * "No package", which reads as "entitled to nothing", so the one screen that decides what a tenant
 * can reach described the opposite of what it does.
 *
 * These strings are the honest label. The default itself is untouched.
 */

/** Option/placeholder label for `organizations.package_id = null`. */
export const NO_PACKAGE_LABEL = "No package — full CareBase suite (default)";

/** Short form for tight cells where the parenthetical does not fit. */
export const NO_PACKAGE_SHORT_LABEL = "No package (full suite)";

/** The sentence shown next to the control that sets it. */
export const NO_PACKAGE_HELP =
  "Leaving this unset does not restrict the tenant. The `modules.carebase` entitlement defaults to " +
  "on, and CareBase includes Train, Workforce, Compliance and Billing, so an organization with no " +
  "package reaches every module its billing state allows. Assign a package to narrow that.";
