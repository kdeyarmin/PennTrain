export interface ResidentRosterRecord {
  id: string;
  status: string;
  admission_date: string | null;
  facility_id: string;
}

export interface ResidentComplianceAnalyticsItem {
  resident_id: string;
  status: string;
  due_date: string | null;
}

export interface ResidentComplianceAnalyticsSummary {
  residents: number;
  activeResidents: number;
  residentsWithOpenItems: number;
  expiredItems: number;
  missingItems: number;
  dueSoonItems: number;
  dueWithin14Days: number;
  newestAdmissionResidentId: string | null;
}

function daysUntil(date: string, today: string): number {
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const dateTime = Date.parse(`${date}T00:00:00Z`);
  return Math.ceil((dateTime - todayTime) / 86_400_000);
}

export function summarizeResidentComplianceAnalytics(
  residents: ResidentRosterRecord[],
  complianceItems: ResidentComplianceAnalyticsItem[],
  today: string,
): ResidentComplianceAnalyticsSummary {
  const residentIds = new Set(residents.map((r) => r.id));
  const scopedItems = complianceItems.filter((item) => residentIds.has(item.resident_id));
  const openItems = scopedItems.filter((item) => item.status === "expired" || item.status === "missing" || item.status === "due_soon");
  const residentsWithOpenItems = new Set(openItems.map((item) => item.resident_id)).size;
  const dueWithin14Days = scopedItems.filter((item) => {
    if (!item.due_date || item.status === "compliant" || item.status === "not_applicable") return false;
    const days = daysUntil(item.due_date, today);
    return days >= 0 && days <= 14;
  }).length;
  const newestAdmissionResidentId = [...residents]
    .filter((r) => !!r.admission_date)
    .sort((a, b) => (b.admission_date ?? "").localeCompare(a.admission_date ?? ""))[0]?.id ?? null;

  return {
    residents: residents.length,
    activeResidents: residents.filter((r) => r.status === "active").length,
    residentsWithOpenItems,
    expiredItems: scopedItems.filter((item) => item.status === "expired").length,
    missingItems: scopedItems.filter((item) => item.status === "missing").length,
    dueSoonItems: scopedItems.filter((item) => item.status === "due_soon").length,
    dueWithin14Days,
    newestAdmissionResidentId,
  };
}
