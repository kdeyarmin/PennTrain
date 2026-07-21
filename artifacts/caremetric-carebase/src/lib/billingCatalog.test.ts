import { describe, expect, it } from "vitest";
import {
  billingPriceSummary,
  estimatedBillingAmountCents,
  measuredBillingQuantity,
  resolvedBillingQuantity,
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

  it("describes and estimates a base-plus-overage price", () => {
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
});
