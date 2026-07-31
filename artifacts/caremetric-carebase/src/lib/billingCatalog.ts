export type BillingMetric = "flat" | "active_learner" | "active_user" | "active_resident" | "facility";

export interface OrganizationBillingUsage {
  activeLearners: number;
  activeUsers: number;
  activeResidents: number;
  facilities: number;
}

export interface DisplayBillingPrice {
  base_amount_cents: number;
  billing_metric: string;
  currency: string;
  included_quantity: number;
  pricing_model: string;
  recurring_interval: string;
  unit_amount_cents: number | null;
}

/** Minimal shape shared by admin Packages rows and the org plan picker. */
export interface SelectableBillingPrice {
  package_id: string;
  recurring_interval: string;
  is_active: boolean;
  is_primary: boolean;
  effective_from: string;
  effective_to: string | null;
  billing_metric: string;
  pricing_model: string;
  base_amount_cents: number;
  currency: string;
  included_quantity: number;
  unit_amount_cents: number | null;
}

export const BILLING_METRIC_DEFINITIONS: ReadonlyArray<{
  value: BillingMetric;
  label: string;
  unit: string;
}> = [
  { value: "flat", label: "Flat subscription", unit: "subscription" },
  { value: "active_learner", label: "Active learner", unit: "learner" },
  { value: "active_user", label: "Active user", unit: "user" },
  { value: "active_resident", label: "Active resident", unit: "resident" },
  { value: "facility", label: "Active facility", unit: "facility" },
];

export function billingMetricDefinition(metric: string) {
  return BILLING_METRIC_DEFINITIONS.find((definition) => definition.value === metric)
    ?? BILLING_METRIC_DEFINITIONS[0];
}

export function isFlatBillingPrice(
  price: Pick<DisplayBillingPrice, "billing_metric" | "pricing_model"> | null | undefined,
): boolean {
  if (!price) return false;
  return price.billing_metric === "flat" || price.pricing_model === "flat";
}

/**
 * Active primary price for a package cadence at a point in time.
 * Shared by Admin → Packages and the org plan picker so filters cannot drift.
 */
export function selectPrimaryBillingPrice<T extends SelectableBillingPrice>(
  prices: readonly T[],
  packageId: string,
  interval: "month" | "year",
  nowMs = Date.now(),
): T | undefined {
  return prices
    .filter((price) => price.package_id === packageId
      && price.recurring_interval === interval
      && price.is_active
      && price.is_primary
      && Date.parse(price.effective_from) <= nowMs
      && (!price.effective_to || Date.parse(price.effective_to) > nowMs))
    .sort((left, right) => Date.parse(right.effective_from) - Date.parse(left.effective_from))[0];
}

export function measuredBillingQuantity(metric: string, usage: OrganizationBillingUsage): number {
  if (metric === "active_learner") return usage.activeLearners;
  if (metric === "active_user") return usage.activeUsers;
  if (metric === "active_resident") return usage.activeResidents;
  if (metric === "facility") return usage.facilities;
  return 1;
}

export function resolvedBillingQuantity(
  metric: string,
  usage: OrganizationBillingUsage,
  minimumQuantity: number,
): number {
  if (metric === "flat") return 1;
  return Math.max(measuredBillingQuantity(metric, usage), minimumQuantity);
}

export function formatBillingMoney(cents: number | null, currency = "usd"): string {
  if (cents === null) return "Custom";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function pluralize(unit: string, quantity: number): string {
  return quantity === 1 ? unit : `${unit}s`;
}

export function billingPriceSummary(price: DisplayBillingPrice): string {
  const metric = billingMetricDefinition(price.billing_metric);
  const cadence = price.recurring_interval === "year" ? "year" : "month";
  const base = `${formatBillingMoney(price.base_amount_cents, price.currency)}/${cadence}`;
  if (isFlatBillingPrice(price)) return base;
  const included = price.included_quantity > 0
    ? ` includes ${price.included_quantity} ${pluralize(metric.unit, price.included_quantity)}`
    : "";
  const overage = price.unit_amount_cents === null
    ? ""
    : `, then ${formatBillingMoney(price.unit_amount_cents, price.currency)}/${metric.unit}`;
  return `${base}${included}${overage}`;
}

export function estimatedBillingAmountCents(price: DisplayBillingPrice, quantity: number): number | null {
  if (price.pricing_model === "custom") return null;
  if (isFlatBillingPrice(price)) return price.base_amount_cents;
  if (price.pricing_model === "flat_plus_overage") {
    if (price.unit_amount_cents === null) return price.base_amount_cents;
    return price.base_amount_cents
      + Math.max(0, quantity - price.included_quantity) * price.unit_amount_cents;
  }
  if (price.pricing_model === "per_unit" && price.unit_amount_cents !== null) {
    return price.base_amount_cents + quantity * price.unit_amount_cents;
  }
  return null;
}
