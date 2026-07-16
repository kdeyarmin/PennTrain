import { describe, expect, it } from "vitest";
import { calculateSavingsModel } from "./savingsModel";

describe("calculateSavingsModel", () => {
  it("separates current coordination cost from modeled opportunity", () => {
    const result = calculateSavingsModel({
      weeklyCoordinationHours: 10,
      annualBinderHours: 40,
      loadedHourlyRate: 35,
      monthlyReplaceableToolSpend: 400,
      expectedLaborReductionPercent: 25,
      annualCareBasePrice: 6000,
    });

    expect(result.annualCoordinationHours).toBe(560);
    expect(result.annualLaborCost).toBe(19600);
    expect(result.annualReplaceableToolSpend).toBe(4800);
    expect(result.currentAddressableCost).toBe(24400);
    expect(result.modeledLaborOpportunity).toBe(4900);
    expect(result.grossAnnualOpportunity).toBe(9700);
    expect(result.netAnnualOpportunity).toBe(3700);
  });

  it("clamps negative inputs and percentages above one hundred", () => {
    const result = calculateSavingsModel({
      weeklyCoordinationHours: -10,
      annualBinderHours: 10,
      loadedHourlyRate: 20,
      monthlyReplaceableToolSpend: -50,
      expectedLaborReductionPercent: 250,
      annualCareBasePrice: 0,
    });

    expect(result.annualCoordinationHours).toBe(10);
    expect(result.currentAddressableCost).toBe(200);
    expect(result.grossAnnualOpportunity).toBe(200);
    expect(result.netAnnualOpportunity).toBeNull();
  });
});
