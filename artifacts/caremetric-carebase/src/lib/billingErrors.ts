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
