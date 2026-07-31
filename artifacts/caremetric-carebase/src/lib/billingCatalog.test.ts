import { describe, expect, it } from "vitest";
import {
  billingPriceSummary,
  estimatedBillingAmountCents,
  isFlatBillingPrice,
  measuredBillingQuantity,
  resolvedBillingQuantity,
  selectPrimaryBillingPrice,
  type OrganizationBillingUsage,
} from "./billingCatalog";

const usage: OrganizationBillingUsage = {
  activeLearners: 31,
  activeUsers: 12,
  activeResidents: 27,
  facilities: 2,
};

describe("billing catalog", () => {
  it("maps each value metric to its canonical organization usage", () => {
    expect(measuredBillingQuantity("active_learner", usage)).toBe(31);
    expect(measuredBillingQuantity("active_user", usage)).toBe(12);
    expect(measuredBillingQuantity("active_resident", usage)).toBe(27);
    expect(measuredBillingQuantity("facility", usage)).toBe(2);
    expect(measuredBillingQuantity("flat", usage)).toBe(1);
  });

  it("applies the configured minimum without changing flat subscriptions", () => {
    expect(resolvedBillingQuantity("active_resident", { ...usage, activeResidents: 0 }, 1)).toBe(1);
    expect(resolvedBillingQuantity("flat", usage, 20)).toBe(1);
  });

  it("describes and estimates a flat self-serve subscription", () => {
    const train = {
      base_amount_cents: 23_900,
      billing_metric: "flat",
      currency: "usd",
      included_quantity: 0,
      pricing_model: "flat",
      recurring_interval: "month",
      unit_amount_cents: null,
    };
    const carebase = {
      base_amount_cents: 49_900,
      billing_metric: "flat",
      currency: "usd",
      included_quantity: 0,
      pricing_model: "flat",
      recurring_interval: "month",
      unit_amount_cents: null,
    };
    expect(billingPriceSummary(train)).toBe("$239/month");
    expect(billingPriceSummary(carebase)).toBe("$499/month");
    expect(estimatedBillingAmountCents(train, 31)).toBe(23_900);
    expect(estimatedBillingAmountCents(carebase, 200)).toBe(49_900);
  });

  it("still estimates legacy base-plus-overage prices when configured", () => {
    const price = {
      base_amount_cents: 23_900,
      billing_metric: "active_learner",
      currency: "usd",
      included_quantity: 25,
      pricing_model: "flat_plus_overage",
      recurring_interval: "month",
      unit_amount_cents: 400,
    };
    expect(billingPriceSummary(price)).toBe("$239/month includes 25 learners, then $4/learner");
    expect(estimatedBillingAmountCents(price, 31)).toBe(26_300);
  });

  it("picks the newest active primary price for a cadence", () => {
    const prices = [
      {
        package_id: "pkg-1",
        recurring_interval: "month",
        is_active: true,
        is_primary: true,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        billing_metric: "flat",
        pricing_model: "flat",
        base_amount_cents: 23_900,
        currency: "usd",
        included_quantity: 0,
        unit_amount_cents: null,
      },
      {
        package_id: "pkg-1",
        recurring_interval: "month",
        is_active: true,
        is_primary: true,
        effective_from: "2026-06-01T00:00:00.000Z",
        effective_to: null,
        billing_metric: "flat",
        pricing_model: "flat",
        base_amount_cents: 24_900,
        currency: "usd",
        included_quantity: 0,
        unit_amount_cents: null,
      },
      {
        package_id: "pkg-1",
        recurring_interval: "year",
        is_active: true,
        is_primary: true,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        billing_metric: "flat",
        pricing_model: "flat",
        base_amount_cents: 239_000,
        currency: "usd",
        included_quantity: 0,
        unit_amount_cents: null,
      },
    ] as const;
    const monthly = selectPrimaryBillingPrice(prices, "pkg-1", "month", Date.parse("2026-07-01T00:00:00.000Z"));
    expect(monthly?.base_amount_cents).toBe(24_900);
    const annual = selectPrimaryBillingPrice(prices, "pkg-1", "year", Date.parse("2026-07-01T00:00:00.000Z"));
    expect(annual?.base_amount_cents).toBe(239_000);
  });

  it("detects flat billing prices", () => {
    expect(isFlatBillingPrice({ billing_metric: "flat", pricing_model: "flat" })).toBe(true);
    expect(isFlatBillingPrice({ billing_metric: "active_learner", pricing_model: "flat_plus_overage" })).toBe(false);
  });
});
