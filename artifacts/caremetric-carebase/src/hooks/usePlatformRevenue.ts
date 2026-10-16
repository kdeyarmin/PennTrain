import { useQuery } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  collectedByMonth,
  collectedSince,
  effectiveSubscriptionStates,
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
/** PostgREST caps a response (1,000 rows by default); totals page until a page comes back empty. */
const PAGE_SIZE = 1000;
/** Keeps `in (...)` filters to a bounded URL length. */
const ID_BATCH_SIZE = 100;

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

type Page<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

/** Every row of an id-ordered query, advancing by the rows actually returned. */
export async function readAllPages<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    from += data.length;
  }
}

/** Every row matching a list of ids, in bounded `in (...)` batches. */
export async function readAllByIds<T>(ids: readonly string[], page: (batch: string[], from: number, to: number) => Page<T>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let offset = 0; offset < unique.length; offset += ID_BATCH_SIZE) {
    const batch = unique.slice(offset, offset + ID_BATCH_SIZE);
    rows.push(...await readAllPages((from, to) => page(batch, from, to)));
  }
  return rows;
}

const INVOICE_TOTAL_COLUMNS = "id, provider_status, currency, amount_paid, amount_remaining, paid_at";

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
        // Live Stripe subscriptions, the same candidates `get_managed_billing_subscriptions`
        // considers. Suspended and trial rows are read too: newer account evidence can show
        // they are paying (see effectiveSubscriptionStates).
        readAllPages((from, to) => supabase
          .from("billing_subscriptions")
          .select("id, billing_account_id, billing_state, provider_event_created_at")
          .eq("is_provider_placeholder", false)
          .not("provider_status", "in", "(canceled,incomplete_expired)")
          .in("billing_state", ["trial", "active", "grace", "past_due", "suspended"])
          .order("id")
          .range(from, to)),
        readAllPages((from, to) => supabase
          .from("billing_invoices")
          .select(INVOICE_TOTAL_COLUMNS)
          .gte("paid_at", paidSince)
          .order("id")
          .range(from, to)),
        readAllPages((from, to) => supabase
          .from("billing_invoices")
          .select(INVOICE_TOTAL_COLUMNS)
          .eq("provider_status", "open")
          .gt("amount_remaining", 0)
          .order("id")
          .range(from, to)),
        // Newest by Stripe's own issue time; created_at is when the webhook stored the row, so
        // a late first delivery of an old invoice would otherwise jump the queue.
        supabase
          .from("billing_invoices")
          .select("id, organization_id, provider_status, currency, amount_due, amount_paid, amount_remaining, issued_at, created_at, hosted_invoice_url, organizations(name)")
          .order("issued_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id")
          .limit(RECENT_INVOICE_LIMIT)
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          }),
      ]);

      const [accounts, items] = await Promise.all([
        readAllByIds(subscriptions.map((subscription) => subscription.billing_account_id), (batch, from, to) => supabase
          .from("billing_accounts")
          .select("id, billing_state, state_source, provider_event_created_at")
          .in("id", batch)
          .order("id")
          .range(from, to)),
        readAllByIds(subscriptions.map((subscription) => subscription.id), (batch, from, to) => supabase
          .from("billing_subscription_items")
          .select("id, subscription_id, stripe_price_id, quantity")
          .in("subscription_id", batch)
          .order("id")
          .range(from, to)),
      ]);
      const prices = await readAllByIds(items.map((item) => item.stripe_price_id), (batch, from, to) => supabase
        .from("package_billing_prices")
        .select("id, stripe_price_id, base_amount_cents, billing_metric, currency, included_quantity, pricing_model, recurring_interval, interval_count, unit_amount_cents")
        .in("stripe_price_id", batch)
        .order("id")
        .range(from, to));

      return {
        recurring: monthlyRecurringRevenue(effectiveSubscriptionStates(subscriptions, accounts), items, prices),
        collectedLast30DaysCents: collectedSince(paidInvoices, now.getTime() - 30 * DAY_MS),
        outstanding: outstandingInvoices(openInvoices),
        collectedByMonth: collectedByMonth(paidInvoices, now, REVENUE_CHART_MONTHS),
        recentInvoices: recentInvoices.map((invoice) => ({
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
