import { describe, expect, it } from "vitest";
import {
  MARKETING_CAREBASE_MONTHLY,
  MARKETING_INCLUDED_QUANTITY,
  MARKETING_OVERAGE_MONTHLY,
  MARKETING_TRAIN_MONTHLY,
  MARKETING_TRIAL_DAYS,
  carebaseAnnualPrice,
  carebaseMonthlyPrice,
  marketingPlansFromLabel,
  marketingPricingFaqAnswer,
} from "./marketingPricing";

describe("marketingPricing", () => {
  it("keeps the published self-serve list prices stable", () => {
    expect(MARKETING_TRAIN_MONTHLY).toBe(239);
    expect(MARKETING_CAREBASE_MONTHLY).toBe(499);
    expect(MARKETING_OVERAGE_MONTHLY).toBe(4);
    expect(MARKETING_INCLUDED_QUANTITY).toBe(25);
    expect(MARKETING_TRIAL_DAYS).toBe(30);
  });

  it("prices CareBase monthly as base + overage after the included quantity", () => {
    expect(carebaseMonthlyPrice(25)).toBe(499);
    expect(carebaseMonthlyPrice(40)).toBe(499 + 15 * 4);
    expect(carebaseMonthlyPrice(0)).toBe(499);
    expect(carebaseAnnualPrice(40)).toBe((499 + 15 * 4) * 12);
  });

  it("builds FAQ and chrome copy from the same numbers", () => {
    const faq = marketingPricingFaqAnswer();
    expect(faq).toContain("$239/month");
    expect(faq).toContain("$499/month");
    expect(faq).toContain("$4/month");
    expect(faq).toContain("25 active learners");
    expect(faq).toContain("25 active residents");
    expect(marketingPlansFromLabel()).toBe("Plans from $239/month · 30-day free trial.");
  });
});
