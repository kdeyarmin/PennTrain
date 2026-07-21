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

export function receivableAgingSummary(data: FinancialWorkspace | undefined, asOfIsoDate: string): ReceivableAgingSummary {
  const buckets = agingBucketDefinitions.map(({ key, label }) => ({ key, label, amount: 0 }));
  for (const statement of data?.statements ?? []) {
    const balanceDue = normalizeAmount(statement.balance_due);
    if (balanceDue <= 0) continue;
    const daysPastDue = daysBetween(statement.due_date, asOfIsoDate);
    const definition = agingBucketDefinitions.find((bucket) => daysPastDue >= bucket.min && (bucket.max === undefined || daysPastDue <= bucket.max));
    const target = buckets.find((bucket) => bucket.key === (definition?.key ?? "current"));
    if (target) target.amount = normalizeAmount(target.amount + balanceDue);
  }
  const openStatements = (data?.statements ?? []).filter((statement) => normalizeAmount(statement.balance_due) > 0);
  const oldestOpenDueDate = openStatements.map((statement) => statement.due_date).sort()[0] ?? null;
  const highestRiskBucket = [...buckets].reverse().find((bucket) => bucket.amount > 0)?.key ?? null;
  return {
    buckets,
    totalOpen: normalizeAmount(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)),
    oldestOpenDueDate,
    highestRiskBucket,
  };
}
