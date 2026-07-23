/**
 * Public display pricing for the marketing site — the single place the
 * advertised per-facility prices and trial length live. Values come from the
 * approved marketing designs (designs/*.dc.html); change them here and every
 * page (pricing cards, FAQ answers, savings calculator) stays in sync.
 *
 * Kept dependency-free (pure data) like marketingMeta.ts so build-time
 * tooling could bundle it for Node if ever needed.
 */

/** Free-trial length, in days. */
export const TRIAL_DAYS = 14;

/** Single-facility price, USD per facility per month. */
export const STARTER_PRICE_MONTHLY = 349;

/** Multi-site (3+ facilities) price, USD per facility per month. */
export const GROWTH_PRICE_MONTHLY = 299;

/** "$349" — formatted for copy. */
export const STARTER_PRICE = `$${STARTER_PRICE_MONTHLY}`;

/** "$299" — formatted for copy. */
export const GROWTH_PRICE = `$${GROWTH_PRICE_MONTHLY}`;

/** The one inbox marketing copy points at. */
export const CONTACT_EMAIL = "hello@caremetric.ai";
