// Structured billing-session error codes (PT-058). The create-billing-session
// edge function answers failures as { error: { code } }; without this mapping
// the UI only ever showed "Edge Function returned a non-2xx status code".

export class BillingSessionError extends Error {
  readonly code: string | null;

  constructor(code: string | null, fallbackMessage: string) {
    super(billingSessionErrorCopy(code)?.description ?? fallbackMessage);
    this.name = "BillingSessionError";
    this.code = code;
  }
}

export interface BillingSessionErrorCopy {
  title: string;
  description: string;
  /** In-app route the user can act on (MFA setup lives at /account/security). */
  actionPath?: string;
  actionLabel?: string;
}

const BILLING_SESSION_ERROR_COPY: Record<string, BillingSessionErrorCopy> = {
  aal2_required: {
    title: "Multi-factor authentication required",
    description:
      "Billing changes require multi-factor authentication. Set up MFA under Account Security, then try again.",
    actionPath: "/account/security",
    actionLabel: "Open Account Security",
  },
  fresh_aal2_required: {
    title: "Recent verification required",
    description:
      "Billing changes require a recent multi-factor verification. Re-verify under Account Security, then try again.",
    actionPath: "/account/security",
    actionLabel: "Open Account Security",
  },
  existing_subscription_requires_portal: {
    title: "Use the billing portal",
    description:
      "This organization already has a subscription. Use Manage billing to change plans, quantities, or payment details.",
  },
  billing_quantity_outside_self_service_range: {
    title: "Contract pricing required",
    description:
      "The measured usage is outside this plan's self-service range. Contact CareMetric for contract pricing.",
  },
  active_price_missing: {
    title: "Plan not ready for checkout",
    description:
      "This plan has no active checkout price configured yet. Choose another plan or contact CareMetric.",
  },
  billing_not_configured: {
    title: "Billing is not available",
    description:
      "Checkout is temporarily unavailable. Try again later or contact CareMetric support.",
  },
  billing_customer_missing: {
    title: "Billing portal unavailable",
    description:
      "No Stripe customer is linked to this organization yet. Start checkout on a plan first, or contact CareMetric.",
  },
  billing_usage_unavailable: {
    title: "Usage could not be measured",
    description:
      "We could not measure billable usage for this organization. Refresh and try again, or contact CareMetric.",
  },
  billing_state_unavailable: {
    title: "Billing state unavailable",
    description:
      "We could not load this organization's subscription state. Refresh and try again.",
  },
  invalid_return_url: {
    title: "Return URL not allowed",
    description:
      "Checkout could not start because the return address is not on the approved list. Contact CareMetric if this continues.",
  },
  stripe_request_failed: {
    title: "Stripe request failed",
    description:
      "The payment provider did not accept this request. Try again in a moment or contact CareMetric.",
  },
  package_required: {
    title: "Choose a plan",
    description: "Select a package before starting checkout.",
  },
  invalid_organization: {
    title: "Organization not found",
    description: "This organization is not available for billing. Refresh and try again.",
  },
  invalid_billing_interval: {
    title: "Invalid billing interval",
    description: "Choose monthly or annual billing, then try again.",
  },
  forbidden: {
    title: "Permission required",
    description: "You need organization administrator access to change billing.",
  },
};

export function billingSessionErrorCopy(code: string | null | undefined): BillingSessionErrorCopy | null {
  if (!code) return null;
  return BILLING_SESSION_ERROR_COPY[code] ?? null;
}

/**
 * Resolve toast copy for a failed billing-session mutation. Falls back to the
 * raw error message (or a generic line) when the failure carried no known code.
 */
export function billingSessionFailureCopy(error: unknown, fallbackTitle: string): BillingSessionErrorCopy {
  if (error instanceof BillingSessionError) {
    const copy = billingSessionErrorCopy(error.code);
    if (copy) return copy;
  }
  return {
    title: fallbackTitle,
    description: error instanceof Error ? error.message : "Unknown error",
  };
}
