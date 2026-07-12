export interface CredentialAnalyticsRecord {
  id: string;
  employee_id: string;
  credential_type: string;
  credential_label: string | null;
  status: string;
  expiration_date: string | null;
  warning_days: number | null;
  last_verified_date?: string | null;
}

export interface CredentialAnalyticsSummary {
  total: number;
  compliant: number;
  missing: number;
  expired: number;
  dueSoon: number;
  unverified: number;
  expiringWithin30Days: number;
  employeesWithGaps: number;
  topRiskCredentialIds: string[];
}

function daysUntil(date: string, today: string): number {
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const dateTime = Date.parse(`${date}T00:00:00Z`);
  return Math.ceil((dateTime - todayTime) / 86_400_000);
}

function riskScore(credential: CredentialAnalyticsRecord, today: string): number {
  let score = 0;
  if (credential.status === "expired") score += 100;
  if (credential.status === "missing") score += 90;
  if (credential.status === "due_soon") score += 50;
  if (!credential.last_verified_date) score += 10;
  if (credential.expiration_date) {
    const days = daysUntil(credential.expiration_date, today);
    if (days < 0) score += 100;
    else if (days <= 7) score += 40;
    else if (days <= 30) score += 25;
    else if (days <= (credential.warning_days ?? 90)) score += 10;
  }
  return score;
}

export function summarizeCredentialAnalytics(credentials: CredentialAnalyticsRecord[], today: string): CredentialAnalyticsSummary {
  const activeRiskCredentials = credentials.filter((c) => c.status !== "not_applicable");
  const employeesWithGaps = new Set(
    activeRiskCredentials
      .filter((c) => c.status === "expired" || c.status === "missing" || c.status === "due_soon")
      .map((c) => c.employee_id),
  ).size;

  const expiringWithin30Days = activeRiskCredentials.filter((c) => {
    if (!c.expiration_date) return false;
    const days = daysUntil(c.expiration_date, today);
    return days >= 0 && days <= 30;
  }).length;

  const topRiskCredentialIds = [...activeRiskCredentials]
    .sort((a, b) => riskScore(b, today) - riskScore(a, today) || (a.expiration_date ?? "9999-12-31").localeCompare(b.expiration_date ?? "9999-12-31"))
    .slice(0, 5)
    .map((c) => c.id);

  return {
    total: credentials.length,
    compliant: credentials.filter((c) => c.status === "compliant").length,
    missing: credentials.filter((c) => c.status === "missing").length,
    expired: credentials.filter((c) => c.status === "expired").length,
    dueSoon: credentials.filter((c) => c.status === "due_soon").length,
    unverified: activeRiskCredentials.filter((c) => !c.last_verified_date).length,
    expiringWithin30Days,
    employeesWithGaps,
    topRiskCredentialIds,
  };
}
