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
  if (price.billing_metric === "flat" || price.pricing_model === "flat") return base;
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
  if (price.billing_metric === "flat" || price.pricing_model === "flat") return price.base_amount_cents;
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
