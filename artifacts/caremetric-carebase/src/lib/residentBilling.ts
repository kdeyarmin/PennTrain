import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";

export type MonthlyChargePreview = { category: string; label: string; amount: number };

type AncillaryService = { name?: unknown; amount?: unknown };

function normalizeAmount(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function ancillaryChargePreviews(data: FinancialWorkspace | undefined): MonthlyChargePreview[] {
  const services = data?.rates[0]?.ancillary_services;
  if (!Array.isArray(services)) return [];
  return services.flatMap((service): MonthlyChargePreview[] => {
    if (!service || typeof service !== "object" || Array.isArray(service)) return [];
    const record = service as AncillaryService;
    const amount = normalizeAmount(record.amount);
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Ancillary service";
    return amount > 0 ? [{ category: "ancillary_service", label: name, amount }] : [];
  });
}

export function monthlyChargePreviews(data: FinancialWorkspace | undefined): MonthlyChargePreview[] {
  const rate = data?.rates[0];
  if (!rate) return [];
  return [
    { category: "base_monthly", label: "Base monthly charge", amount: normalizeAmount(rate.base_monthly_charge) },
    { category: "level_of_care", label: "Level-of-care charge", amount: normalizeAmount(rate.level_of_care_charge) },
    { category: "room_rate", label: "Room rate", amount: normalizeAmount(rate.room_rate) },
    ...ancillaryChargePreviews(data),
  ].filter((item) => item.amount > 0);
}


export type AgingBucketKey = "current" | "days1To30" | "days31To60" | "days61To90" | "days90Plus";

export type AgingBucket = { key: AgingBucketKey; label: string; amount: number };

export type ReceivableAgingSummary = {
  buckets: AgingBucket[];
  totalOpen: number;
  oldestOpenDueDate: string | null;
  highestRiskBucket: AgingBucketKey | null;
};

const agingBucketDefinitions: Array<{ key: AgingBucketKey; label: string; min: number; max?: number }> = [
  { key: "current", label: "Current", min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: "days1To30", label: "1–30", min: 1, max: 30 },
  { key: "days31To60", label: "31–60", min: 31, max: 60 },
  { key: "days61To90", label: "61–90", min: 61, max: 90 },
  { key: "days90Plus", label: "90+", min: 91 },
];

function daysBetween(startIsoDate: string, endIsoDate: string) {
  const start = new Date(`${startIsoDate}T00:00:00Z`).getTime();
  const end = new Date(`${endIsoDate}T00:00:00Z`).getTime();
  return Math.floor((end - start) / 86_400_000);
}

/**
 * Open accounts receivable derived from the live transaction ledger.
 *
 * Statements are cumulative immutable snapshots (each balance_due already
 * contains every prior unpaid statement), so summing balance_due across
 * statements double-counts carried balances and never sees post-statement
 * payments. Instead: every open debit is a receivable, the credit pool is
 * applied to the oldest debits first (FIFO), and each open remainder ages from
 * the due date of the earliest statement that billed it. Charges not yet on
 * any statement sit in the "current" bucket with no due date.
 */
export function receivableAgingSummary(data: FinancialWorkspace | undefined, asOfIsoDate: string): ReceivableAgingSummary {
  const buckets = agingBucketDefinitions.map(({ key, label }) => ({ key, label, amount: 0 }));
  const transactions = data?.transactions ?? [];
  const statements = [...(data?.statements ?? [])]
    .sort((left, right) => left.period_end.localeCompare(right.period_end));

  const debits = transactions
    .filter((transaction) => transaction.entry_side === "debit" && normalizeAmount(transaction.amount) > 0)
    .sort((left, right) => left.effective_on.localeCompare(right.effective_on)
      || (left.posted_at ?? "").localeCompare(right.posted_at ?? ""));
  let creditPool = normalizeAmount(transactions
    .filter((transaction) => transaction.entry_side === "credit")
    .reduce((sum, transaction) => sum + normalizeAmount(transaction.amount), 0));

  // A cumulative statement bills everything effective on or before its period
  // end (older activity is inside its opening balance), so the first statement
  // whose period_end covers the charge sets the demand's due date.
  const billedDueDate = (effectiveOn: string): string | null =>
    statements.find((statement) => statement.period_end >= effectiveOn)?.due_date ?? null;

  let totalOpen = 0;
  let oldestOpenDueDate: string | null = null;
  for (const debit of debits) {
    const amount = normalizeAmount(debit.amount);
    const applied = Math.min(creditPool, amount);
    creditPool = normalizeAmount(creditPool - applied);
    const open = normalizeAmount(amount - applied);
    if (open <= 0) continue;
    totalOpen = normalizeAmount(totalOpen + open);
    const dueDate = billedDueDate(debit.effective_on);
    if (dueDate !== null && (oldestOpenDueDate === null || dueDate < oldestOpenDueDate)) {
      oldestOpenDueDate = dueDate;
    }
    const daysPastDue = dueDate === null ? 0 : daysBetween(dueDate, asOfIsoDate);
    const definition = agingBucketDefinitions.find((bucket) => daysPastDue >= bucket.min && (bucket.max === undefined || daysPastDue <= bucket.max));
    const target = buckets.find((bucket) => bucket.key === (definition?.key ?? "current"));
    if (target) target.amount = normalizeAmount(target.amount + open);
  }

  const highestRiskBucket = [...buckets].reverse().find((bucket) => bucket.amount > 0)?.key ?? null;
  return {
    buckets,
    totalOpen,
    oldestOpenDueDate,
    highestRiskBucket,
  };
}
