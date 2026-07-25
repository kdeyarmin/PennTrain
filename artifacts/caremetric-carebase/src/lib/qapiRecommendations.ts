/**
 * QAPI project recommendations (program plan Phase 6d).
 *
 * WHAT A RECOMMENDATION IS HERE. A named pattern, the threshold it crossed, and the exact records
 * that crossed it. Nothing is scored, ranked by a learned weight, or expressed as a probability --
 * the request is explicit that a black-box number is not wanted, and "priority: 0.83" is that number
 * wearing a different hat. A person reading one of these can check it against the source records in
 * a minute, and disagree with the threshold rather than with an oracle.
 *
 * WHY THRESHOLDS ARE EXPORTED CONSTANTS. Three falls in ninety days is a defensible starting point,
 * not a law. Naming each one makes it arguable in review and adjustable per facility later, instead
 * of being a bare integer buried three call-frames down.
 *
 * DUPLICATE PREVENTION MIRRORS THE EXISTING CONVENTION. `create_qapi_project` already dedups an
 * incident escalation on (source_type, source_id), and IncidentQapiEscalation relies on that. A
 * pattern is not a row, though, so it has no uuid to put in `source_id`; it gets its own
 * `qapi_projects.pattern_key` column with a matching partial unique index. Suppression here keeps
 * the list a list of things to do; the index is what actually prevents the duplicate.
 */
import type { IncidentTrends, TrendBucket } from "./incidentTrends";

export type QapiRecommendationKey =
  | "repeated_falls_resident"
  | "repeated_falls_location"
  | "repeated_falls_shift"
  | "repeated_medication_events"
  | "increased_emergency_transfers"
  | "repeated_root_cause"
  | "corrective_actions_unverified"
  | "overdue_investigations";

export interface QapiRecommendation {
  key: QapiRecommendationKey;
  /** Stable identity for this specific pattern instance, used to suppress an already-open project. */
  patternId: string;
  title: string;
  /** The finding, stated as a fact with its number in it. */
  finding: string;
  /** Why this pattern is worth a project rather than a note. */
  rationale: string;
  /** The threshold that was crossed, so a reader can disagree with it explicitly. */
  threshold: string;
  /** The records behind the recommendation. A recommendation with none is a bug, not a hunch. */
  incidentIds: string[];
  suggestedProblemStatement: string;
}

export const QAPI_THRESHOLDS = {
  /** Falls by one resident within the window before the support plan is presumed to need work. */
  fallsPerResident: 3,
  /** Falls in one location before the environment is the more likely explanation than the residents. */
  fallsPerLocation: 4,
  /** Falls on one shift, AND that shift holding a majority, before staffing is worth examining. */
  fallsPerShift: 5,
  /** Medication events in the window. Deliberately low: these are process failures, not accidents. */
  medicationEvents: 3,
  /** Emergency transfers in the window, which can mean acuity has outgrown the licence. */
  emergencyTransfers: 4,
  /** The same root cause recorded this many times means the last correction did not hold. */
  repeatedRootCause: 3,
  /** Unverified completed corrective actions before verification itself is the problem. */
  unverifiedActions: 3,
  /** Investigations open past their due window before the process is the problem. */
  overdueInvestigations: 3,
} as const;

export interface ExistingQapiProjectLike {
  id: string;
  status: string;
  /** Set when the project was opened from a recommendation; matches `QapiRecommendation.patternId`. */
  pattern_key: string | null;
}

const CLOSED_PROJECT_STATUSES = new Set(["closed", "canceled"]);

function bucketsOver(buckets: TrendBucket[], threshold: number): TrendBucket[] {
  return buckets.filter((bucket) => bucket.count >= threshold);
}

/**
 * `now` is not a parameter: every input is already a completed count over a window the caller chose.
 * Passing a clock here would imply this function re-decides the window, which it must not.
 */
export function buildQapiRecommendations({
  trends, windowLabel, existingProjects = [],
}: {
  trends: IncidentTrends;
  /** Human description of the period the trends cover, e.g. "the last 90 days". */
  windowLabel: string;
  existingProjects?: ExistingQapiProjectLike[];
}): QapiRecommendation[] {
  const series = (key: string) => trends.series.find((entry) => entry.key === key);
  const recommendations: QapiRecommendation[] = [];

  for (const bucket of bucketsOver(series("falls_by_resident")?.buckets ?? [], QAPI_THRESHOLDS.fallsPerResident)) {
    recommendations.push({
      key: "repeated_falls_resident",
      patternId: `repeated_falls_resident:${bucket.key}`,
      title: `Repeated falls — ${bucket.label}`,
      finding: `${bucket.label} has ${bucket.count} recorded falls in ${windowLabel}.`,
      rationale: "Repeated falls for one resident is the clearest sign a support plan no longer matches the person it describes.",
      threshold: `${QAPI_THRESHOLDS.fallsPerResident} or more falls by one resident`,
      incidentIds: bucket.incidentIds,
      suggestedProblemStatement:
        `${bucket.label} experienced ${bucket.count} falls in ${windowLabel}. The current support plan interventions have not prevented recurrence.`,
    });
  }

  for (const bucket of bucketsOver(series("falls_by_location")?.buckets ?? [], QAPI_THRESHOLDS.fallsPerLocation)) {
    // A location bucket that was never recorded tells you about documentation, not about the place.
    if (bucket.label === "Not recorded") continue;
    recommendations.push({
      key: "repeated_falls_location",
      patternId: `repeated_falls_location:${bucket.key}`,
      title: `Falls concentrated in ${bucket.label}`,
      finding: `${bucket.count} falls in ${windowLabel} occurred in ${bucket.label}.`,
      rationale: "A location that repeats points at the environment, which is the part a facility can actually change.",
      threshold: `${QAPI_THRESHOLDS.fallsPerLocation} or more falls in one location`,
      incidentIds: bucket.incidentIds,
      suggestedProblemStatement:
        `${bucket.count} falls in ${windowLabel} occurred in ${bucket.label}, suggesting an environmental or routine factor rather than individual resident condition.`,
    });
  }

  const shiftSeries = series("falls_by_shift");
  if (shiftSeries) {
    for (const bucket of bucketsOver(shiftSeries.buckets, QAPI_THRESHOLDS.fallsPerShift)) {
      // A shift only stands out if it holds most of the falls. Without this, a busy quarter
      // recommends a staffing project for whichever shift happens to be largest.
      if (bucket.count * 2 <= shiftSeries.total) continue;
      recommendations.push({
        key: "repeated_falls_shift",
        patternId: `repeated_falls_shift:${bucket.key}`,
        title: `Falls concentrated on ${bucket.label}`,
        finding: `${bucket.count} of ${shiftSeries.total} falls in ${windowLabel} occurred on ${bucket.label}.`,
        rationale: "A shift holding most of the falls is a staffing and routine question, not a resident question.",
        threshold: `${QAPI_THRESHOLDS.fallsPerShift} or more falls on one shift, and that shift holding more than half`,
        incidentIds: bucket.incidentIds,
        suggestedProblemStatement:
          `${bucket.count} of ${shiftSeries.total} falls in ${windowLabel} occurred on ${bucket.label}, indicating a shift-specific staffing or routine factor.`,
      });
    }
  }

  const medication = series("medication_events");
  if (medication && medication.total >= QAPI_THRESHOLDS.medicationEvents) {
    recommendations.push({
      key: "repeated_medication_events",
      patternId: "repeated_medication_events",
      title: "Medication-related events",
      finding: `${medication.total} medication-related events recorded in ${windowLabel}.`,
      rationale: "Medication events are process failures. The threshold is deliberately low because the system that allowed a near miss is the one that allows the next real error.",
      threshold: `${QAPI_THRESHOLDS.medicationEvents} or more events in the window`,
      incidentIds: medication.buckets.flatMap((bucket) => bucket.incidentIds),
      suggestedProblemStatement:
        `${medication.total} medication-related events occurred in ${windowLabel}, indicating a medication administration process that is not reliably preventing error.`,
    });
  }

  const transfers = series("emergency_transfers");
  if (transfers && transfers.total >= QAPI_THRESHOLDS.emergencyTransfers) {
    recommendations.push({
      key: "increased_emergency_transfers",
      patternId: "increased_emergency_transfers",
      title: "Emergency transfers",
      finding: `${transfers.total} emergency transfers in ${windowLabel}.`,
      rationale: "Rising transfers can mean resident acuity has outgrown the level of care the facility is licensed to provide — a question worth asking deliberately rather than discovering at a survey.",
      threshold: `${QAPI_THRESHOLDS.emergencyTransfers} or more transfers in the window`,
      incidentIds: transfers.buckets.flatMap((bucket) => bucket.incidentIds),
      suggestedProblemStatement:
        `${transfers.total} residents required emergency transfer in ${windowLabel}. Review whether acuity, recognition of change, or response protocols are the driver.`,
    });
  }

  for (const bucket of bucketsOver(series("root_causes")?.buckets ?? [], QAPI_THRESHOLDS.repeatedRootCause)) {
    recommendations.push({
      key: "repeated_root_cause",
      patternId: `repeated_root_cause:${bucket.key}`,
      title: `Recurring root cause — ${bucket.label}`,
      finding: `"${bucket.label}" was recorded as the root cause of ${bucket.count} incidents in ${windowLabel}.`,
      rationale: "The same cause recorded repeatedly means the corrective action taken last time did not hold. That is a system question, and it is exactly what QAPI is for.",
      threshold: `${QAPI_THRESHOLDS.repeatedRootCause} or more incidents sharing a root cause`,
      incidentIds: bucket.incidentIds,
      suggestedProblemStatement:
        `"${bucket.label}" has been identified as the root cause of ${bucket.count} incidents in ${windowLabel}, indicating prior corrective actions have not been effective or sustained.`,
    });
  }

  const effectiveness = trends.correctiveActionEffectiveness;
  const unverified = effectiveness.completed - effectiveness.verified;
  if (unverified >= QAPI_THRESHOLDS.unverifiedActions) {
    recommendations.push({
      key: "corrective_actions_unverified",
      patternId: "corrective_actions_unverified",
      title: "Corrective actions closed without verification",
      finding: `${unverified} corrective actions were marked complete with no verification recorded.`,
      rationale: "An action nobody checked is a claim, not a correction. If this is the norm, the incident process is producing paperwork rather than change.",
      threshold: `${QAPI_THRESHOLDS.unverifiedActions} or more unverified completions`,
      // These come from corrective_actions, not incidents; the surface links to the actions instead.
      incidentIds: [],
      suggestedProblemStatement:
        `${unverified} corrective actions were closed without recorded verification, so their effectiveness is unknown.`,
    });
  }

  if (trends.overdueInvestigations.count >= QAPI_THRESHOLDS.overdueInvestigations) {
    recommendations.push({
      key: "overdue_investigations",
      patternId: "overdue_investigations",
      title: "Investigations running past their due window",
      finding: `${trends.overdueInvestigations.count} investigations are open past the expected completion window.`,
      rationale: "Late investigations lose the evidence they depend on — memories, and the chance to see the scene as it was.",
      threshold: `${QAPI_THRESHOLDS.overdueInvestigations} or more overdue investigations`,
      incidentIds: trends.overdueInvestigations.incidentIds,
      suggestedProblemStatement:
        `${trends.overdueInvestigations.count} incident investigations remain open past the expected completion window, delaying corrective action.`,
    });
  }

  // Suppress anything already carrying an open project, reusing the existing dedupe convention.
  const claimed = new Set(
    existingProjects
      // A closed or cancelled project does not suppress the pattern: if it is still happening after
      // the project closed, that is precisely when somebody needs to see it again.
      .filter((project) => !CLOSED_PROJECT_STATUSES.has(project.status))
      .map((project) => project.pattern_key)
      .filter((key): key is string => key !== null),
  );
  return recommendations.filter((entry) => !claimed.has(entry.patternId));
}
