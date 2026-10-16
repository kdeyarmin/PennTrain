import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  RECURRING_BILLING_STATES,
  collectedByMonth,
  collectedSince,
  monthlyRecurringRevenue,
  outstandingInvoices,
  startOfMonthsAgo,
  type CollectedMonth,
  type MonthlyRecurringRevenue,
} from "@/lib/platformRevenue";

/** Months shown in the collected-revenue chart, including the current one. */
export const REVENUE_CHART_MONTHS = 6;
const RECENT_INVOICE_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlatformRecentInvoice {
  id: string;
  organizationId: string;
  organizationName: string | null;
  status: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  issuedAt: string | null;
  createdAt: string;
  hostedInvoiceUrl: string | null;
}

export interface PlatformRevenue {
  recurring: MonthlyRecurringRevenue;
  collectedLast30DaysCents: number;
  outstanding: { cents: number; count: number };
  collectedByMonth: CollectedMonth[];
  recentInvoices: PlatformRecentInvoice[];
}

const INVOICE_TOTAL_COLUMNS = "provider_status, currency, amount_paid, amount_remaining, paid_at";

/**
 * Revenue for the platform dashboard, read from the Stripe-synced billing tables. Platform
 * administrators can read every tenant's rows through the existing `*_read` policies
 * (20260711200648_phase2_billing_and_entitlements.sql); nothing here writes.
 */
export function useGetPlatformRevenue() {
  return useQuery({
    queryKey: ["platform-revenue"],
    queryFn: async (): Promise<PlatformRevenue> => {
      const now = new Date();
      const chartStart = startOfMonthsAgo(now, REVENUE_CHART_MONTHS - 1);
      const paidSince = new Date(Math.min(chartStart.getTime(), now.getTime() - 30 * DAY_MS)).toISOString();

      const [subscriptions, paidInvoices, openInvoices, recentInvoices] = await Promise.all([
        supabase
          .from("billing_subscriptions")
          .select("id, billing_state")
          .eq("is_provider_placeholder", false)
          .in("billing_state", [...RECURRING_BILLING_STATES]),
        supabase.from("billing_invoices").select(INVOICE_TOTAL_COLUMNS).gte("paid_at", paidSince),
        supabase.from("billing_invoices").select(INVOICE_TOTAL_COLUMNS).eq("provider_status", "open").gt("amount_remaining", 0),
        supabase
          .from("billing_invoices")
          .select("id, organization_id, provider_status, currency, amount_due, amount_paid, amount_remaining, issued_at, created_at, hosted_invoice_url, organizations(name)")
          .order("created_at", { ascending: false })
          .limit(RECENT_INVOICE_LIMIT),
      ]);
      if (subscriptions.error) throw subscriptions.error;
      if (paidInvoices.error) throw paidInvoices.error;
      if (openInvoices.error) throw openInvoices.error;
      if (recentInvoices.error) throw recentInvoices.error;

      const subscriptionIds = subscriptions.data.map((subscription) => subscription.id);
      const items = subscriptionIds.length === 0
        ? []
        : await supabase
          .from("billing_subscription_items")
          .select("subscription_id, stripe_price_id, quantity")
          .in("subscription_id", subscriptionIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          });

      const priceIds = [...new Set(items.map((item) => item.stripe_price_id))];
      const prices = priceIds.length === 0
        ? []
        : await supabase
          .from("package_billing_prices")
          .select("stripe_price_id, base_amount_cents, billing_metric, currency, included_quantity, pricing_model, recurring_interval, interval_count, unit_amount_cents")
          .in("stripe_price_id", priceIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          });

      return {
        recurring: monthlyRecurringRevenue(subscriptions.data, items, prices),
        collectedLast30DaysCents: collectedSince(paidInvoices.data, now.getTime() - 30 * DAY_MS),
        outstanding: outstandingInvoices(openInvoices.data),
        collectedByMonth: collectedByMonth(paidInvoices.data, now, REVENUE_CHART_MONTHS),
        recentInvoices: recentInvoices.data.map((invoice) => ({
          id: invoice.id,
          organizationId: invoice.organization_id,
          organizationName: invoice.organizations?.name ?? null,
          status: invoice.provider_status,
          currency: invoice.currency,
          amountDue: invoice.amount_due,
          amountPaid: invoice.amount_paid,
          amountRemaining: invoice.amount_remaining,
          issuedAt: invoice.issued_at,
          createdAt: invoice.created_at,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
        })),
      };
    },
  });
}
