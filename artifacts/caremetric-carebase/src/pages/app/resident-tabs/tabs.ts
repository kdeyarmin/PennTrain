// Resident 360 tab registry (program plan Phase 1b).
//
// Data-driven so a later phase adds a tab by adding a row here, not by restructuring the shell.
// Every tab is a separate lazy chunk: the resident route previously shipped the administrative
// master, the agreement workspace, the portal workspace, and the support-plan section in one
// eagerly-loaded chunk that sat at 90% of its budget before this program added anything.

export interface ResidentTabDefinition {
  /** URL value in ?tab=, and the stable id the shell keys on. */
  id: string;
  label: string;
  /** Tabs that only make sense for a PCH/ALF rule-pack facility. */
  trackedFacilityOnly?: boolean;
  /** Tabs only a manager-tier role can open. */
  requiresManage?: boolean;
}

export const RESIDENT_TABS: ResidentTabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "care", label: "Care & services" },
  { id: "assessments", label: "Assessments" },
  { id: "support-plan", label: "Support plan", trackedFacilityOnly: true },
  { id: "incidents", label: "Incidents & changes" },
  { id: "appointments", label: "Appointments" },
  { id: "documents", label: "Documents" },
  { id: "financial", label: "Financial & agreements" },
  { id: "timeline", label: "Timeline" },
];

/**
 * Empty, and that is the point: every tab the request named is now built.
 *
 * Appointments was the last entry. It was held back deliberately because `resident_appointments`
 * had a schema, a scheduling RPC, and an outcome RPC that no application code had ever called, so a
 * tab over it would have read as "no appointments" rather than "not built". Migration
 * `20260804010000` supplied the three write paths the table was missing -- preparation readiness,
 * new-order acknowledgement, and follow-up closure -- and `AppointmentsTab.tsx` renders them.
 *
 * Kept rather than deleted: a later phase that defers a tab needs somewhere to say so, and
 * `tabs.test.ts` asserts that anything listed here carries a real blocker.
 */
export const PLANNED_TABS: { label: string; blockedBy: string }[] = [];

export function visibleResidentTabs({
  isTrackedFacilityType,
  canManage,
}: {
  isTrackedFacilityType: boolean;
  canManage: boolean;
}): ResidentTabDefinition[] {
  return RESIDENT_TABS.filter((tab) => {
    if (tab.trackedFacilityOnly && !isTrackedFacilityType) return false;
    if (tab.requiresManage && !canManage) return false;
    return true;
  });
}

/**
 * Resolve the tab from the URL. An unknown or now-hidden tab (a bookmark from a role or facility
 * type that no longer applies) falls back to Overview rather than rendering nothing.
 */
export function resolveResidentTab(
  requested: string | null | undefined,
  available: ResidentTabDefinition[],
): string {
  if (requested && available.some((tab) => tab.id === requested)) return requested;
  return available[0]?.id ?? "overview";
}
