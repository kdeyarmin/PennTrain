/**
 * The one savings model (RELEASE_READINESS_PLAN 4.3, platform L2/L3/L4).
 *
 * Until this file was wired up there were three of them and they disagreed:
 *
 *   1. THIS FILE, which nothing imported -- dead code carrying a third formula.
 *   2. `pages/marketing/Savings.tsx` and `supabase/functions/email-savings-model`, which priced the
 *      year at `carebaseMonthlyPrice() * 12` = $5,988, while the catalog and
 *      `marketingPricing.MARKETING_CAREBASE_ANNUAL` sell the annual plan at $4,990. Every public
 *      "net savings", "ROI" and "payback" number was computed against a price the company does not
 *      charge, overstating the cost of the product by $998 a year.
 *   3. `pages/app/ValueCenter.tsx`, whose activity-based estimate annualised labour value and
 *      retired software spend and then never subtracted the subscription at all, so its "value"
 *      was a gross figure presented where the other two showed a net one.
 *
 * They are one model now: `reconcileAnnualValue` is the only place a gross annual opportunity is
 * turned into net / ROI / payback, `CAREBASE_ANNUAL_LIST_PRICE` is the only price any of them
 * charges against, and `calculateSavingsModel` is what the public worksheet computes.
 */
import {
  MARKETING_CAREBASE_ANNUAL,
  MARKETING_CAREBASE_MONTHLY,
} from "@/components/marketing/marketingPricing";

/** Flat CareBase list price per month, dollars. */
export const CAREBASE_MONTHLY_LIST_PRICE = MARKETING_CAREBASE_MONTHLY;

/**
 * What a year of CareBase actually costs at list, dollars.
 *
 * The annual plan is sold as a flat $4,990 (roughly two months free against monthly x 12). A model
 * that quotes an annual figure quotes this one; `monthly x 12` is not a price this product has.
 */
export const CAREBASE_ANNUAL_LIST_PRICE = MARKETING_CAREBASE_ANNUAL;

/** How a 30-day observation window is turned into an annual figure. */
export const DAYS_PER_YEAR = 365;

export interface AnnualValueReconciliation {
  /** Gross opportunity before the subscription, dollars per year. */
  grossAnnualOpportunity: number;
  /** The subscription netted out, dollars per year. */
  annualCareBasePrice: number;
  /** Gross minus the subscription; null when no price was supplied. */
  netAnnualOpportunity: number | null;
  modeledRoiPercent: number | null;
  modeledPaybackMonths: number | null;
}

/**
 * Net an annual gross opportunity against the subscription. The single arithmetic every surface
 * shares -- the public worksheet, the emailed model, and the in-app Value Center.
 */
export function reconcileAnnualValue(
  grossAnnualOpportunity: number,
  annualCareBasePrice: number = CAREBASE_ANNUAL_LIST_PRICE,
): AnnualValueReconciliation {
  const gross = nonNegative(grossAnnualOpportunity);
  const price = nonNegative(annualCareBasePrice);
  const hasPrice = price > 0;
  return {
    grossAnnualOpportunity: gross,
    annualCareBasePrice: price,
    netAnnualOpportunity: hasPrice ? gross - price : null,
    modeledRoiPercent: hasPrice ? ((gross - price) / price) * 100 : null,
    modeledPaybackMonths: hasPrice && gross > 0 ? (price / gross) * 12 : null,
  };
}

/** Annualise a figure observed over `windowDays` days. */
export function annualizeObservedValue(value: number, windowDays: number): number {
  const observed = nonNegative(value);
  const days = nonNegative(windowDays);
  return days > 0 ? (observed * DAYS_PER_YEAR) / days : 0;
}

export interface SavingsInputs {
  weeklyCoordinationHours: number;
  annualBinderHours: number;
  loadedHourlyRate: number;
  monthlyReplaceableToolSpend: number;
  expectedLaborReductionPercent: number;
  annualCareBasePrice: number;
}

export interface SavingsResult {
  annualCoordinationHours: number;
  annualLaborCost: number;
  annualReplaceableToolSpend: number;
  currentAddressableCost: number;
  modeledLaborOpportunity: number;
  grossAnnualOpportunity: number;
  netAnnualOpportunity: number | null;
  modeledRoiPercent: number | null;
  modeledPaybackMonths: number | null;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateSavingsModel(inputs: SavingsInputs): SavingsResult {
  const weeklyCoordinationHours = nonNegative(inputs.weeklyCoordinationHours);
  const annualBinderHours = nonNegative(inputs.annualBinderHours);
  const loadedHourlyRate = nonNegative(inputs.loadedHourlyRate);
  const monthlyReplaceableToolSpend = nonNegative(inputs.monthlyReplaceableToolSpend);
  const expectedLaborReductionPercent = Math.min(
    100,
    nonNegative(inputs.expectedLaborReductionPercent),
  );
  const annualCareBasePrice = nonNegative(inputs.annualCareBasePrice);

  const annualCoordinationHours = weeklyCoordinationHours * 52 + annualBinderHours;
  const annualLaborCost = annualCoordinationHours * loadedHourlyRate;
  const annualReplaceableToolSpend = monthlyReplaceableToolSpend * 12;
  const currentAddressableCost = annualLaborCost + annualReplaceableToolSpend;
  const modeledLaborOpportunity = annualLaborCost * (expectedLaborReductionPercent / 100);
  const grossAnnualOpportunity = modeledLaborOpportunity + annualReplaceableToolSpend;

  const reconciled = reconcileAnnualValue(grossAnnualOpportunity, annualCareBasePrice);

  return {
    annualCoordinationHours,
    annualLaborCost,
    annualReplaceableToolSpend,
    currentAddressableCost,
    modeledLaborOpportunity,
    grossAnnualOpportunity,
    netAnnualOpportunity: reconciled.netAnnualOpportunity,
    modeledRoiPercent: reconciled.modeledRoiPercent,
    modeledPaybackMonths: reconciled.modeledPaybackMonths,
  };
}
