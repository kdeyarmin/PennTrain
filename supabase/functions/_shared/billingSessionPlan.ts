import {
  phase2CheckoutTrialDays,
  phase2MeasuredBillingQuantity,
  resolvePhase2BillingQuantity,
  resolvePhase2BillingReturnOrigins,
  validatePhase2BillingReturnUrl,
} from "./phase2Billing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BillingSessionPlanError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status=status; this.code=code; }
}

export type BillingSessionPlan = {
  kind: "checkout" | "portal";
  path: string;
  values: Record<string, unknown>;
  checkoutConfiguration: { billingMetric: string; billingInterval: "month" | "year"; quantity: number } | null;
  sourceSnapshot: { account: unknown; price: unknown; organization: unknown };
};

/** Native callers must finish their existing authorization before resolving a plan.
 * This function reads current native billing rules and does not call Stripe or write data.
 * The interactive handler and central adapter share these exact provider parameters.
 */
export async function planBillingSession({admin,profile,organizationId,body,getEnv,nowIso}: {
  // The two Supabase SDK runtimes expose equivalent query builders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  profile: { role: string; email?: string | null };
  organizationId: string;
  body: { action?: "checkout" | "portal"; packageId?: string; billingInterval?: "month" | "year";
    successUrl?: string; cancelUrl?: string; returnUrl?: string };
  getEnv: (name: string) => string | undefined;
  nowIso: () => string;
}): Promise<BillingSessionPlan> {
  const action = body.action ?? "checkout";
  if (!(["checkout", "portal"] as string[]).includes(action)) {
    throw new BillingSessionPlanError(400, "invalid_action");
  }
  // An API key alone can create a payable subscription whose events cannot
  // reconcile locally. Keep new checkout closed until its signing secret is set.
  if (action === "checkout" && !(getEnv("STRIPE_BILLING_WEBHOOK_SECRET") ?? "").trim()) {
    throw new BillingSessionPlanError(503, "billing_not_configured");
  }

  // Return URLs are validated against configured origins only; the request
  // Origin header is caller-controlled and must not extend the allowlist.
  const configuredOrigins = resolvePhase2BillingReturnOrigins(
    getEnv("BILLING_RETURN_URL_ORIGINS") ?? "",
    [
      getEnv("PUBLIC_APP_URL"),
      ...((getEnv("SIGNUP_REDIRECT_ORIGINS") ?? "").split(",")),
    ],
  );
  const { data: account, error: accountError } = await admin.from("billing_accounts")
    .select("id, stripe_customer_id, billing_state").eq("organization_id", organizationId).maybeSingle();
  // A failed lookup is not a new customer. Checkout must not create another
  // Stripe customer when the existing customer's database row is unavailable.
  if (accountError) {
    throw new BillingSessionPlanError(503, "billing_state_unavailable");
  }
  let path: string;
  let values: Record<string, unknown>;
  let priceSnapshot: unknown = null;
  let organizationSnapshot: unknown = null;
  let kind: "checkout" | "portal";
  let checkoutConfiguration: {
    billingMetric: string;
    billingInterval: "month" | "year";
    quantity: number;
  } | null = null;
  if (action === "portal") {
    if (!account?.stripe_customer_id) throw new BillingSessionPlanError(409, "billing_customer_missing");
    const returnUrl = body.returnUrl;
    if (!returnUrl || !validatePhase2BillingReturnUrl(returnUrl, configuredOrigins)) {
      throw new BillingSessionPlanError(400, "invalid_return_url");
    }
    // This Stripe account serves multiple applications. Never let a missing
    // PennTrain configuration fall back to another application's default portal.
    const portalConfigurationId = (getEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") ?? "").trim();
    if (!/^bpc_[A-Za-z0-9]+$/.test(portalConfigurationId)) {
      throw new BillingSessionPlanError(503, "billing_not_configured");
    }
    path = "/v1/billing_portal/sessions";
    values = { customer: account.stripe_customer_id, return_url: returnUrl, configuration: portalConfigurationId };
    kind = "portal";
  } else {
    if (!body.packageId || !UUID.test(body.packageId)) {
      throw new BillingSessionPlanError(400, "package_required");
    }
    const billingInterval = body.billingInterval ?? "month";
    if (billingInterval !== "month" && billingInterval !== "year") {
      throw new BillingSessionPlanError(400, "invalid_billing_interval");
    }
    const { data: existingSubscription, error: existingSubscriptionError } = await admin
      .from("billing_subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      // A paused/unpaid/incomplete provider subscription can still become
      // payable. A missing provider status is uncertainty, not permission to
      // create another subscription. Retain the existing local-state floor.
      .or("billing_state.in.(trial,active,grace,past_due),and(stripe_subscription_id.not.is.null,provider_status.not.in.(canceled,incomplete_expired)),and(stripe_subscription_id.not.is.null,provider_status.is.null)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingSubscriptionError) {
      throw new BillingSessionPlanError(503, "billing_state_unavailable");
    }
    if (existingSubscription) {
      throw new BillingSessionPlanError(409, "existing_subscription_requires_portal");
    }
    const { data: price, error: priceError } = await admin.from("package_billing_prices")
      .select("stripe_price_id, currency, interval_count, billing_metric, pricing_model, minimum_quantity, maximum_quantity, packages!inner(is_active, trial_days)")
      .eq("package_id", body.packageId).eq("is_active", true)
      .eq("is_primary", true).eq("recurring_interval", billingInterval)
      .not("stripe_price_id", "is", null)
      .eq("packages.is_active", true)
      .lte("effective_from", nowIso())
      .or(`effective_to.is.null,effective_to.gt.${nowIso()}`)
      .order("effective_from", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (priceError || !price) throw new BillingSessionPlanError(409, "active_price_missing");
    priceSnapshot = price;
    // Flat self-serve plans always check out at quantity 1. Usage measurement is
    // only required for metered metrics; a broken usage RPC must not block flat checkout.
    let quantity: number;
    if (price.billing_metric === "flat" || price.pricing_model === "flat") {
      quantity = 1;
    } else {
      const { data: usageRows, error: usageError } = await admin.rpc(
        "get_organization_billing_usage",
        { p_organization_id: organizationId },
      );
      const usage = Array.isArray(usageRows) ? usageRows[0] : null;
      if (usageError || !usage) {
        throw new BillingSessionPlanError(503, "billing_usage_unavailable");
      }
      const measuredQuantity = phase2MeasuredBillingQuantity(price.billing_metric, {
        active_learners: Number(usage.active_learners),
        active_users: Number(usage.active_users),
        active_residents: Number(usage.active_residents),
        facilities: Number(usage.facilities),
      });
      if (measuredQuantity === null) {
        throw new BillingSessionPlanError(503, "invalid_billing_usage");
      }
      const resolved = resolvePhase2BillingQuantity(
        price.billing_metric,
        Math.max(measuredQuantity, price.minimum_quantity),
        price.minimum_quantity,
        price.maximum_quantity,
      );
      if (resolved === null) {
        throw new BillingSessionPlanError(409, "billing_quantity_outside_self_service_range");
      }
      quantity = resolved;
    }
    if (!body.successUrl || !body.cancelUrl ||
      !validatePhase2BillingReturnUrl(body.successUrl, configuredOrigins) ||
      !validatePhase2BillingReturnUrl(body.cancelUrl, configuredOrigins)) {
      throw new BillingSessionPlanError(400, "invalid_return_url");
    }
    const packageConfiguration = Array.isArray(price.packages) ? price.packages[0] : price.packages;
    const configuredTrialDays = typeof packageConfiguration?.trial_days === "number"
      ? packageConfiguration.trial_days
      : 0;
    // One trial budget (PT-052): the in-app trial stamped at signup and the
    // Stripe trial must not stack. Checkout forwards only the days still
    // remaining on organizations.trial_ends_at; a consumed or never-stamped
    // window starts billing immediately.
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("trial_ends_at")
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError) {
      throw new BillingSessionPlanError(503, "billing_state_unavailable");
    }
    if (!organization) {
      throw new BillingSessionPlanError(403, "invalid_organization");
    }
    organizationSnapshot = organization;
    const trialDays = phase2CheckoutTrialDays(
      typeof organization.trial_ends_at === "string" ? organization.trial_ends_at : null,
      configuredTrialDays,
    );
    // Never bind the platform operator's email to a tenant's first Stripe
    // customer; Checkout collects the payer email instead. An existing
    // customer must not also receive customer_email (Stripe rejects both).
    const bindCustomerEmail = !account?.stripe_customer_id && profile.role !== "platform_admin";
    path = "/v1/checkout/sessions";
    values = {
        mode: "subscription",
        client_reference_id: organizationId,
        customer: account?.stripe_customer_id ?? undefined,
        customer_email: bindCustomerEmail ? profile.email : undefined,
        // Always collect a card so a remaining in-app trial converts when it
        // ends instead of pausing for a missing payment method. Do not send
        // customer_update.address=auto: Stripe rejects it unless
        // billing_address_collection is required, which would fail first
        // checkout on a tenant that already has a customer id.
        payment_method_collection: "always",
        success_url: body.successUrl,
        cancel_url: body.cancelUrl,
        line_items: [{ price: price.stripe_price_id, quantity }],
        metadata: {
          organization_id: organizationId,
          package_id: body.packageId,
          billing_metric: price.billing_metric,
          billing_interval: billingInterval,
          billable_quantity_source: "database_snapshot",
        },
        subscription_data: {
          metadata: {
            organization_id: organizationId,
            package_id: body.packageId,
            billing_metric: price.billing_metric,
            billing_interval: billingInterval,
            billable_quantity_source: "database_snapshot",
          },
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        },
      };

    checkoutConfiguration = { billingMetric: price.billing_metric, billingInterval, quantity };
    kind = "checkout";
  }


  return {kind,path,values,checkoutConfiguration,sourceSnapshot:{account,price:priceSnapshot,organization:organizationSnapshot}};
}
