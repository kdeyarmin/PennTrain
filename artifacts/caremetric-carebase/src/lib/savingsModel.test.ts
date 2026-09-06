import { describe, expect, it } from "vitest";
import { MARKETING_CAREBASE_ANNUAL } from "@/components/marketing/marketingPricing";
import {
  CAREBASE_ANNUAL_LIST_PRICE,
  CAREBASE_MONTHLY_LIST_PRICE,
  annualizeObservedValue,
  calculateSavingsModel,
  reconcileAnnualValue,
} from "./savingsModel";

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
    expect(result.modeledRoiPercent).toBeCloseTo(61.67, 2);
    expect(result.modeledPaybackMonths).toBeCloseTo(7.42, 2);
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
    expect(result.modeledRoiPercent).toBeNull();
    expect(result.modeledPaybackMonths).toBeNull();
  });

  it("does not claim payback when the modeled gross opportunity is zero", () => {
    const result = calculateSavingsModel({
      weeklyCoordinationHours: 0,
      annualBinderHours: 0,
      loadedHourlyRate: 0,
      monthlyReplaceableToolSpend: 0,
      expectedLaborReductionPercent: 0,
      annualCareBasePrice: 6000,
    });

    expect(result.modeledRoiPercent).toBe(-100);
    expect(result.modeledPaybackMonths).toBeNull();
  });
});

describe("one model across the worksheet, the emailed copy and the Value Center", () => {
  it("prices the year at the annual list price, not monthly x 12", () => {
    // The defect this file now prevents: /savings and email-savings-model both charged
    // 499 x 12 = 5988 against a plan the catalog sells for 4990
    // (RELEASE_READINESS_PLAN 4.3, platform L2).
    expect(CAREBASE_ANNUAL_LIST_PRICE).toBe(MARKETING_CAREBASE_ANNUAL);
    expect(CAREBASE_ANNUAL_LIST_PRICE).toBe(4990);
    expect(CAREBASE_ANNUAL_LIST_PRICE).not.toBe(CAREBASE_MONTHLY_LIST_PRICE * 12);
  });

  it("nets, scores and pays back through one function", () => {
    const reconciled = reconcileAnnualValue(9970);
    expect(reconciled.annualCareBasePrice).toBe(4990);
    expect(reconciled.netAnnualOpportunity).toBe(4980);
    expect(reconciled.modeledRoiPercent).toBeCloseTo(99.8, 1);
    expect(reconciled.modeledPaybackMonths).toBeCloseTo(6.008, 2);
  });

  it("gives calculateSavingsModel and the Value Center the identical arithmetic", () => {
    const gross = 20000;
    const viaWorksheet = calculateSavingsModel({
      weeklyCoordinationHours: 0,
      annualBinderHours: 0,
      loadedHourlyRate: 0,
      monthlyReplaceableToolSpend: gross / 12,
      expectedLaborReductionPercent: 0,
      annualCareBasePrice: CAREBASE_ANNUAL_LIST_PRICE,
    });
    const viaValueCenter = reconcileAnnualValue(gross, CAREBASE_ANNUAL_LIST_PRICE);
    expect(viaWorksheet.netAnnualOpportunity).toBe(viaValueCenter.netAnnualOpportunity);
    expect(viaWorksheet.modeledRoiPercent).toBe(viaValueCenter.modeledRoiPercent);
    expect(viaWorksheet.modeledPaybackMonths).toBe(viaValueCenter.modeledPaybackMonths);
  });

  it("annualises a 30-day observation window over a real year", () => {
    expect(annualizeObservedValue(300, 30)).toBeCloseTo(3650, 6);
    expect(annualizeObservedValue(300, 0)).toBe(0);
    expect(annualizeObservedValue(-5, 30)).toBe(0);
  });
});
