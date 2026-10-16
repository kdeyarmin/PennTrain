import { estimatedBillingAmountCents, type DisplayBillingPrice } from "@/lib/billingCatalog";

/**
 * Platform revenue figures for the admin dashboard, computed from the Stripe-synced billing tables
 * (billing_subscriptions, billing_subscription_items, package_billing_prices, billing_invoices).
 * Pure functions only, so the arithmetic is tested without a database.
 *
 * All amounts are USD cents. The published catalog is USD-only; a price or invoice in another
 * currency is left out of the totals and counted as unpriced rather than added at face value.
 */

/** Subscription states that are still billed every period. Trials and comped tenants pay nothing. */
export const RECURRING_BILLING_STATES: readonly string[] = ["active", "grace", "past_due"];

export interface RevenueSubscription {
  id: string;
  billing_state: string;
}

export interface RevenueSubscriptionItem {
  subscription_id: string;
  stripe_price_id: string;
  quantity: number;
}

export interface RevenuePrice extends DisplayBillingPrice {
  stripe_price_id: string | null;
  interval_count: number;
}

export interface RevenueInvoice {
  provider_status: string;
  currency: string;
  amount_paid: number;
  amount_remaining: number;
  paid_at: string | null;
}

export interface MonthlyRecurringRevenue {
  /** Sum of every billed subscription's price, annual prices spread over twelve months. */
  cents: number;
  /** Billed subscriptions whose price was found and counted. */
  counted: number;
  /** Billed subscriptions left out because their price is missing, custom, or not USD. */
  unpriced: number;
  /** How many of the counted subscriptions are past due or in grace. */
  behind: number;
}

function monthlyCents(price: RevenuePrice, quantity: number): number | null {
  if (price.currency.toLowerCase() !== "usd") return null;
  const amount = estimatedBillingAmountCents(price, quantity);
  if (amount === null) return null;
  const months = (price.recurring_interval === "year" ? 12 : 1) * Math.max(1, price.interval_count);
  return amount / months;
}

export function monthlyRecurringRevenue(
  subscriptions: readonly RevenueSubscription[],
  items: readonly RevenueSubscriptionItem[],
  prices: readonly RevenuePrice[],
): MonthlyRecurringRevenue {
  const priceById = new Map(prices.filter((price) => price.stripe_price_id).map((price) => [price.stripe_price_id as string, price]));
  const itemsBySubscription = new Map<string, RevenueSubscriptionItem[]>();
  for (const item of items) {
    const list = itemsBySubscription.get(item.subscription_id) ?? [];
    list.push(item);
    itemsBySubscription.set(item.subscription_id, list);
  }

  let cents = 0;
  let counted = 0;
  let unpriced = 0;
  let behind = 0;
  for (const subscription of subscriptions) {
    if (!RECURRING_BILLING_STATES.includes(subscription.billing_state)) continue;
    const subscriptionItems = itemsBySubscription.get(subscription.id) ?? [];
    const amounts = subscriptionItems.map((item) => {
      const price = priceById.get(item.stripe_price_id);
      return price ? monthlyCents(price, item.quantity) : null;
    });
    if (amounts.length === 0 || amounts.some((amount) => amount === null)) {
      unpriced += 1;
      continue;
    }
    cents += amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
    counted += 1;
    if (subscription.billing_state !== "active") behind += 1;
  }
  return { cents: Math.round(cents), counted, unpriced, behind };
}

function isUsd(invoice: RevenueInvoice): boolean {
  return invoice.currency.toLowerCase() === "usd";
}

/** Money received on or after `sinceMs`. */
export function collectedSince(invoices: readonly RevenueInvoice[], sinceMs: number): number {
  return invoices.reduce((sum, invoice) => {
    if (!isUsd(invoice) || !invoice.paid_at || invoice.amount_paid <= 0) return sum;
    return Date.parse(invoice.paid_at) >= sinceMs ? sum + invoice.amount_paid : sum;
  }, 0);
}

/** Invoices Stripe has finalized and is still waiting to be paid. */
export function outstandingInvoices(invoices: readonly RevenueInvoice[]): { cents: number; count: number } {
  return invoices.reduce(
    (total, invoice) => invoice.provider_status === "open" && invoice.amount_remaining > 0 && isUsd(invoice)
      ? { cents: total.cents + invoice.amount_remaining, count: total.count + 1 }
      : total,
    { cents: 0, count: 0 },
  );
}

export interface CollectedMonth {
  /** `YYYY-MM` in the viewer's time zone. */
  key: string;
  /** Short month name, e.g. "Oct". */
  label: string;
  cents: number;
}

/** The first moment of the month `monthsBack` months before `now`'s month, in local time. */
export function startOfMonthsAgo(now: Date, monthsBack: number): Date {
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
}

/** Money received per calendar month, oldest first, ending with the current month. */
export function collectedByMonth(invoices: readonly RevenueInvoice[], now: Date, months = 6): CollectedMonth[] {
  const buckets: CollectedMonth[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const start = startOfMonthsAgo(now, back);
    buckets.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleString("en-US", { month: "short" }),
      cents: 0,
    });
  }
  const index = new Map(buckets.map((bucket, i) => [bucket.key, i]));
  for (const invoice of invoices) {
    if (!isUsd(invoice) || !invoice.paid_at || invoice.amount_paid <= 0) continue;
    const paid = new Date(Date.parse(invoice.paid_at));
    const key = `${paid.getFullYear()}-${String(paid.getMonth() + 1).padStart(2, "0")}`;
    const at = index.get(key);
    if (at !== undefined) buckets[at].cents += invoice.amount_paid;
  }
  return buckets;
}
