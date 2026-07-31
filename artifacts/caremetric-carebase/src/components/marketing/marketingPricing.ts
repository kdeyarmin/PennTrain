/**
 * Single source of truth for public marketing-site pricing copy.
 *
 * Landing, FAQ, Savings, VideoModal, Signup, and the CareBase Guide bot all
 * read from here so a price change can't drift across surfaces. Pure data +
 * string helpers only (no React, no env): faqContent and prerender-heads.mjs
 * may import this through esbuild without a browser context.
 *
 * These are the published self-serve list prices (usage-based: base + included
 * quantity + overage). Facility-count $349/$299 figures in designs/*.dc.html
 * are obsolete prototypes — see designs/README.md.
 */

export const MARKETING_TRIAL_DAYS = 30;

/** CareMetric Train list price (monthly), dollars. */
export const MARKETING_TRAIN_MONTHLY = 239;

/** CareMetric CareBase list price (monthly), dollars. */
export const MARKETING_CAREBASE_MONTHLY = 499;

/** Per-person overage after the included quantity, dollars/month. */
export const MARKETING_OVERAGE_MONTHLY = 4;

/** Active learners (Train) or residents (CareBase) included in the base fee. */
export const MARKETING_INCLUDED_QUANTITY = 25;

export const MARKETING_TRAIN_PRICE_LABEL = `$${MARKETING_TRAIN_MONTHLY}`;
export const MARKETING_CAREBASE_PRICE_LABEL = `$${MARKETING_CAREBASE_MONTHLY}`;
export const MARKETING_OVERAGE_PRICE_LABEL = `$${MARKETING_OVERAGE_MONTHLY}`;

/** e.g. "$239/month" */
export function monthlyPriceLabel(amount: number): string {
  return `$${amount}/month`;
}

/** Annual CareBase list price for a given active-resident count (used by savings worksheet). */
export function carebaseMonthlyPrice(activeResidents: number): number {
  const residents = Number.isFinite(activeResidents) ? Math.max(0, activeResidents) : 0;
  const overage = Math.max(0, residents - MARKETING_INCLUDED_QUANTITY);
  return MARKETING_CAREBASE_MONTHLY + overage * MARKETING_OVERAGE_MONTHLY;
}

export function carebaseAnnualPrice(activeResidents: number): number {
  return carebaseMonthlyPrice(activeResidents) * 12;
}

/** FAQ / bot answer for "how much does it cost?" — keep Landing FAQ teaser in sync. */
export function marketingPricingFaqAnswer(): string {
  return (
    `CareMetric Train starts at ${MARKETING_TRAIN_PRICE_LABEL}/month ` +
    `(${MARKETING_INCLUDED_QUANTITY} active learners included); ` +
    `CareMetric CareBase starts at ${MARKETING_CAREBASE_PRICE_LABEL}/month ` +
    `(${MARKETING_INCLUDED_QUANTITY} active residents included). ` +
    `Each additional person is ${MARKETING_OVERAGE_PRICE_LABEL}/month. ` +
    `See pricing and model your savings.`
  );
}

/** Short line used under video modals and similar chrome. */
export function marketingPlansFromLabel(): string {
  return `Plans from ${MARKETING_TRAIN_PRICE_LABEL}/month · ${MARKETING_TRIAL_DAYS}-day free trial.`;
}

/** Effective date shown on public Privacy Policy and Terms of Service. */
export const MARKETING_LEGAL_EFFECTIVE_DATE = "July 23, 2026";
