// Bridges the Reports page's client-side report catalog and the Phase 5 saved-reports
// schema: a saved "view" stores the card id plus the page's filter state in
// saved_report_versions.filters, and the card's UI category maps onto the schema's
// coarse report_type domain enum.

export interface SavedReportViewConfig {
  reportId: string;
  facilityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

const DOMAIN_BY_CATEGORY: Record<string, string> = {
  Compliance: "compliance",
  Training: "compliance",
  Practicum: "compliance",
  Hours: "compliance",
  Staff: "compliance",
  Documents: "compliance",
  Credentials: "qualification",
  Incidents: "incident",
  Inspections: "compliance",
};

export function reportCategoryToDomain(category: string): string {
  return DOMAIN_BY_CATEGORY[category] ?? "compliance";
}

export function buildSavedViewFilters(config: SavedReportViewConfig): Record<string, string> {
  const filters: Record<string, string> = { reportId: config.reportId };
  if (config.facilityId && config.facilityId !== "all") filters.facilityId = config.facilityId;
  if (config.dateFrom) filters.dateFrom = config.dateFrom;
  if (config.dateTo) filters.dateTo = config.dateTo;
  return filters;
}

/** Defensive parse of a stored filters jsonb; null when it isn't a usable view config. */
export function parseSavedViewFilters(raw: unknown): SavedReportViewConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.reportId !== "string" || value.reportId.length === 0) return null;
  const optional = (key: string) => (typeof value[key] === "string" && value[key] ? (value[key] as string) : undefined);
  return {
    reportId: value.reportId,
    facilityId: optional("facilityId"),
    dateFrom: optional("dateFrom"),
    dateTo: optional("dateTo"),
  };
}
