import { describe, expect, it } from "vitest";
import {
  MARKETING_CAREBASE_MONTHLY,
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
    expect(MARKETING_TRIAL_DAYS).toBe(30);
  });

  it("prices CareBase as a flat monthly fee regardless of resident count", () => {
    expect(carebaseMonthlyPrice()).toBe(499);
    expect(carebaseMonthlyPrice(25)).toBe(499);
    expect(carebaseMonthlyPrice(40)).toBe(499);
    expect(carebaseMonthlyPrice(0)).toBe(499);
    expect(carebaseAnnualPrice(40)).toBe(499 * 12);
    expect(carebaseAnnualPrice()).toBe(499 * 12);
  });

  it("builds FAQ and chrome copy from the same numbers", () => {
    const faq = marketingPricingFaqAnswer();
    expect(faq).toContain("$239/month");
    expect(faq).toContain("$499/month");
    expect(faq).toContain("unlimited");
    expect(faq).toContain("no per-person overages");
    // No legacy overage rate in the answer (avoid bare "$4" — it is a prefix of "$499").
    expect(faq).not.toMatch(/\$4\/month/);
    expect(faq).not.toContain("25 active");
    expect(marketingPlansFromLabel()).toBe("Plans from $239/month · 30-day free trial.");
  });
});
