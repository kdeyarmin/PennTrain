import { describe, expect, it } from "vitest";
import {
  collectedByMonth,
  collectedSince,
  effectiveSubscriptionStates,
  monthlyRecurringRevenue,
  outstandingInvoices,
  type RevenueBillingAccount,
  type RevenueInvoice,
  type RevenuePrice,
  type StoredRevenueSubscription,
} from "./platformRevenue";

function price(overrides: Partial<RevenuePrice> & { stripe_price_id: string }): RevenuePrice {
  return {
    base_amount_cents: 49900,
    billing_metric: "flat",
    currency: "usd",
    included_quantity: 0,
    pricing_model: "flat",
    recurring_interval: "month",
    unit_amount_cents: null,
    interval_count: 1,
    ...overrides,
  };
}

function invoice(overrides: Partial<RevenueInvoice>): RevenueInvoice {
  return { provider_status: "paid", currency: "usd", amount_paid: 0, amount_remaining: 0, paid_at: null, ...overrides };
}

describe("monthly recurring revenue", () => {
  const prices = [
    price({ stripe_price_id: "price_carebase_month" }),
    price({ stripe_price_id: "price_train_month", base_amount_cents: 23900 }),
    price({ stripe_price_id: "price_carebase_year", base_amount_cents: 499000, recurring_interval: "year" }),
    price({ stripe_price_id: "price_custom", pricing_model: "custom" }),
  ];

  it("adds billed subscriptions and spreads annual prices over twelve months", () => {
    const result = monthlyRecurringRevenue(
      [
        { id: "a", billing_state: "active" },
        { id: "b", billing_state: "past_due" },
        { id: "c", billing_state: "active" },
      ],
      [
        { subscription_id: "a", stripe_price_id: "price_carebase_month", quantity: 1 },
        { subscription_id: "b", stripe_price_id: "price_train_month", quantity: 1 },
        { subscription_id: "c", stripe_price_id: "price_carebase_year", quantity: 1 },
      ],
      prices,
    );
    // 499 + 239 + 4990/12 (415.83) = 1153.83
    expect(result).toEqual({ cents: 115383, counted: 3, unpriced: 0, behind: 1 });
  });

  it("leaves out trials, comped and canceled tenants", () => {
    const result = monthlyRecurringRevenue(
      [
        { id: "t", billing_state: "trial" },
        { id: "f", billing_state: "comped" },
        { id: "x", billing_state: "canceled" },
      ],
      [
        { subscription_id: "t", stripe_price_id: "price_carebase_month", quantity: 1 },
        { subscription_id: "f", stripe_price_id: "price_carebase_month", quantity: 1 },
        { subscription_id: "x", stripe_price_id: "price_carebase_month", quantity: 1 },
      ],
      prices,
    );
    expect(result).toEqual({ cents: 0, counted: 0, unpriced: 0, behind: 0 });
  });

  it("counts a billed subscription it cannot price instead of guessing", () => {
    const result = monthlyRecurringRevenue(
      [
        { id: "missing", billing_state: "active" },
        { id: "custom", billing_state: "active" },
        { id: "noitems", billing_state: "grace" },
        { id: "eur", billing_state: "active" },
      ],
      [
        { subscription_id: "missing", stripe_price_id: "price_unknown", quantity: 1 },
        { subscription_id: "custom", stripe_price_id: "price_custom", quantity: 1 },
        { subscription_id: "eur", stripe_price_id: "price_eur", quantity: 1 },
      ],
      [...prices, price({ stripe_price_id: "price_eur", currency: "eur" })],
    );
    expect(result).toEqual({ cents: 0, counted: 0, unpriced: 4, behind: 0 });
  });

  it("uses the shared overage calculator for metered prices", () => {
    const result = monthlyRecurringRevenue(
      [{ id: "m", billing_state: "active" }],
      [{ subscription_id: "m", stripe_price_id: "price_overage", quantity: 30 }],
      [price({ stripe_price_id: "price_overage", pricing_model: "flat_plus_overage", billing_metric: "active_resident", included_quantity: 25, unit_amount_cents: 400 })],
    );
    expect(result.cents).toBe(49900 + 5 * 400);
  });
});

describe("effective subscription state", () => {
  const EARLY = "2026-10-01T12:00:00Z";
  const LATE = "2026-10-05T12:00:00Z";
  const sub = (id: string, billing_state: string, account = "acct", at = EARLY): StoredRevenueSubscription =>
    ({ id, billing_state, billing_account_id: account, provider_event_created_at: at });
  const account = (billing_state: string, at: string | null, state_source = "stripe", id = "acct"): RevenueBillingAccount =>
    ({ id, billing_state, state_source, provider_event_created_at: at });

  it("uses a newer invoice payment on the account over a stale suspended or past-due snapshot", () => {
    expect(effectiveSubscriptionStates([sub("s", "suspended")], [account("active", LATE)])).toEqual([{ id: "s", billing_state: "active" }]);
    expect(effectiveSubscriptionStates([sub("s", "past_due")], [account("active", LATE)])).toEqual([{ id: "s", billing_state: "active" }]);
  });

  it("keeps the subscription's own state when the account evidence is older or the same event", () => {
    expect(effectiveSubscriptionStates([sub("s", "past_due", "acct", LATE)], [account("active", EARLY)])).toEqual([{ id: "s", billing_state: "past_due" }]);
    expect(effectiveSubscriptionStates([sub("s", "grace", "acct", LATE)], [account("active", LATE)])).toEqual([{ id: "s", billing_state: "grace" }]);
    expect(effectiveSubscriptionStates([sub("s", "active")], [account("active", null)])).toEqual([{ id: "s", billing_state: "active" }]);
  });

  it("does not apply a manual comp or suspension as payment evidence", () => {
    expect(effectiveSubscriptionStates([sub("s", "active")], [account("comped", LATE, "manual_comp")])).toEqual([{ id: "s", billing_state: "active" }]);
    expect(effectiveSubscriptionStates([sub("s", "suspended")], [account("suspended", LATE, "manual_suspension")])).toEqual([{ id: "s", billing_state: "suspended" }]);
  });

  it("does not spread one account's event across several live subscriptions", () => {
    const result = effectiveSubscriptionStates([sub("a", "suspended"), sub("b", "active")], [account("past_due", LATE)]);
    expect(result).toEqual([{ id: "a", billing_state: "suspended" }, { id: "b", billing_state: "active" }]);
  });

  it("feeds recurring revenue, so a recovered subscription is counted and not marked behind", () => {
    const states = effectiveSubscriptionStates([sub("s", "suspended")], [account("active", LATE)]);
    const result = monthlyRecurringRevenue(
      states,
      [{ subscription_id: "s", stripe_price_id: "price_m", quantity: 1 }],
      [price({ stripe_price_id: "price_m" })],
    );
    expect(result).toEqual({ cents: 49900, counted: 1, unpriced: 0, behind: 0 });
  });
});

describe("collected and outstanding", () => {
  const invoices = [
    invoice({ amount_paid: 49900, paid_at: "2026-10-03T15:00:00Z" }),
    invoice({ amount_paid: 23900, paid_at: "2026-09-14T15:00:00Z" }),
    invoice({ amount_paid: 49900, paid_at: "2026-05-14T15:00:00Z" }),
    invoice({ amount_paid: 10000, paid_at: "2026-10-05T15:00:00Z", currency: "eur" }),
    invoice({ provider_status: "open", amount_remaining: 49900 }),
    invoice({ provider_status: "open", amount_remaining: 0 }),
    invoice({ provider_status: "void", amount_remaining: 23900 }),
  ];

  it("sums money received since a date, USD only", () => {
    expect(collectedSince(invoices, Date.parse("2026-09-16T00:00:00Z"))).toBe(49900);
    expect(collectedSince(invoices, Date.parse("2026-09-01T00:00:00Z"))).toBe(49900 + 23900);
  });

  it("counts only open invoices that still have a balance", () => {
    expect(outstandingInvoices(invoices)).toEqual({ cents: 49900, count: 1 });
  });

  it("buckets payments into the last six calendar months, oldest first", () => {
    const months = collectedByMonth(invoices, new Date(2026, 9, 16), 6);
    expect(months.map((month) => month.key)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(months.map((month) => month.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(months.map((month) => month.cents)).toEqual([49900, 0, 0, 0, 23900, 49900]);
  });

  it("crosses a year boundary", () => {
    const months = collectedByMonth([], new Date(2027, 1, 10), 4);
    expect(months.map((month) => month.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
