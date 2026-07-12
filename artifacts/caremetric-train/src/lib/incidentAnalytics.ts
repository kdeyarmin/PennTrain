export interface IncidentAnalyticsRecord {
  id: string;
  incident_type: string;
  severity: string;
  status: string;
  occurred_at: string;
}

export interface IncidentAnalyticsSummary {
  total: number;
  open: number;
  criticalOpen: number;
  majorOrCritical: number;
  reportedLast7Days: number;
  reportedLast30Days: number;
  oldestOpenIncidentId: string | null;
  topIncidentType: string | null;
}

function daysSince(iso: string, today: string): number {
  const occurred = Date.parse(iso);
  const todayTime = Date.parse(`${today}T23:59:59Z`);
  return Math.floor((todayTime - occurred) / 86_400_000);
}

export function summarizeIncidentAnalytics(incidents: IncidentAnalyticsRecord[], today: string): IncidentAnalyticsSummary {
  const openIncidents = incidents.filter((i) => i.status !== "closed");
  const typeCounts = new Map<string, number>();
  for (const incident of incidents) {
    typeCounts.set(incident.incident_type, (typeCounts.get(incident.incident_type) ?? 0) + 1);
  }

  const oldestOpenIncidentId = [...openIncidents]
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0]?.id ?? null;
  const topIncidentType = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  return {
    total: incidents.length,
    open: openIncidents.length,
    criticalOpen: openIncidents.filter((i) => i.severity === "critical").length,
    majorOrCritical: incidents.filter((i) => i.severity === "major" || i.severity === "critical").length,
    reportedLast7Days: incidents.filter((i) => {
      const days = daysSince(i.occurred_at, today);
      return days >= 0 && days <= 7;
    }).length,
    reportedLast30Days: incidents.filter((i) => {
      const days = daysSince(i.occurred_at, today);
      return days >= 0 && days <= 30;
    }).length,
    oldestOpenIncidentId,
    topIncidentType,
  };
}
