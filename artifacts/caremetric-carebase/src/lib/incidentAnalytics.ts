import { facilityDaysUntil, facilityToday } from "./dateUtils";

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

// `today` is a FACILITY calendar day, and the incidents it is compared against are real
// timestamptz instants -- so the end of that day has to be the facility's, not `T23:59:59Z`.
// In Pennsylvania that literal is 19:59:59 local, so an incident reported at 20:30 was AHEAD of
// "the end of today": daysSince returned -1, and both recency filters below are `days >= 0`, so
// an evening incident silently dropped out of "reported in the last 7 days" and "last 30 days"
// until the UTC date rolled over. The counts were understated for the incidents most likely to
// still be unresolved.
function daysSince(iso: string, today: string): number {
  // Facility calendar dates only — DST-safe age for PA America/New_York days.
  const occurredDay = facilityToday(new Date(iso));
  if (!DATE_ONLY.test(occurredDay) || !DATE_ONLY.test(today)) return Number.NaN;
  const until = facilityDaysUntil(occurredDay, new Date(`${today}T16:00:00Z`));
  return until === null ? Number.NaN : -until;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
