/**
 * Single source of truth for public marketing-site pricing copy.
 *
 * Landing, FAQ, Savings, VideoModal, Signup, and the CareBase Guide bot all
 * read from here so a price change can't drift across surfaces. Pure data +
 * string helpers only (no React, no env): faqContent and prerender-heads.mjs
 * may import this through esbuild without a browser context.
 *
 * Published self-serve list prices are **flat monthly fees** — no per-person
 * overage and no included-quantity caps. Facility-count $349/$299 figures and
 * older base+$4 overage models in designs/*.dc.html are obsolete prototypes —
 * see designs/README.md.
 */

export const MARKETING_TRIAL_DAYS = 30;

/** CareMetric Train list price (monthly), dollars — flat, unlimited learners. */
export const MARKETING_TRAIN_MONTHLY = 239;

/** CareMetric CareBase list price (monthly), dollars — flat, unlimited residents & staff. */
export const MARKETING_CAREBASE_MONTHLY = 499;

/** Annual flat list prices (≈ two months free vs monthly × 12). */
export const MARKETING_TRAIN_ANNUAL = 2390;
export const MARKETING_CAREBASE_ANNUAL = 4990;

export const MARKETING_TRAIN_PRICE_LABEL = `$${MARKETING_TRAIN_MONTHLY}`;
export const MARKETING_CAREBASE_PRICE_LABEL = `$${MARKETING_CAREBASE_MONTHLY}`;

/** e.g. "$239/month" */
export function monthlyPriceLabel(amount: number): string {
  return `$${amount}/month`;
}

/** Flat CareBase monthly list price (residents count does not affect price). */
export function carebaseMonthlyPrice(_activeResidents?: number): number {
  return MARKETING_CAREBASE_MONTHLY;
}

export function carebaseAnnualPrice(_activeResidents?: number): number {
  return MARKETING_CAREBASE_ANNUAL;
}

export function trainAnnualPrice(): number {
  return MARKETING_TRAIN_ANNUAL;
}

/** FAQ / bot answer for "how much does it cost?" — keep Landing FAQ teaser in sync. */
export function marketingPricingFaqAnswer(): string {
  return (
    `CareMetric Train is ${MARKETING_TRAIN_PRICE_LABEL}/month (unlimited active learners); ` +
    `CareMetric CareBase is ${MARKETING_CAREBASE_PRICE_LABEL}/month (unlimited residents and staff). ` +
    `Flat monthly pricing — no per-person overages. ` +
    `See pricing and model your savings.`
  );
}

/** Short line used under video modals and similar chrome. */
export function marketingPlansFromLabel(): string {
  return `Plans from ${MARKETING_TRAIN_PRICE_LABEL}/month · ${MARKETING_TRIAL_DAYS}-day free trial.`;
}

/**
 * Effective date shown on the public Privacy Policy and Terms of Service.
 *
 * Re-exported from src/lib/legalAgreements.ts rather than written out again: this used to be its
 * own literal ("July 23, 2026") while the platform agreement and BAA the same visitor accepts at
 * signup carried July 14, 2026, so the public pages and the signed documents disagreed about when
 * the terms took effect. LEGAL_EFFECTIVE_DATE is the anchored one -- SERVICE_AGREEMENT_VERSION and
 * BAA_VERSION embed the same 2026-07-14 stamp and are recorded per organization at signup.
 */
export { LEGAL_EFFECTIVE_DATE as MARKETING_LEGAL_EFFECTIVE_DATE } from "../../lib/legalAgreements";
