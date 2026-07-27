/**
 * Rule-based change detection (program plan Phase 5a).
 *
 * The request is explicit and this module holds the line: **no black-box AI risk score.** Every
 * detection states what changed, the records that say so, the date range, why it matters, the
 * recommended review, and who must respond. A number between 0 and 100 would be easier to render and
 * impossible to defend at survey.
 *
 * Detection runs over records staff already create -- documented exceptions (Phase 4b), unscheduled
 * services (Phase 4c), falls, weights, meals, incidents, and condition changes. Every threshold is a
 * named constant here rather than a magic number buried in a query, so a facility can see what the
 * rule actually is before arguing with it.
 *
 * A detection is a prompt for a human review, never a conclusion. Nothing here writes to a resident
 * record.
 */

export type ChangeSignalKind =
  | "increased_assistance"
  | "multiple_falls"
  | "reduced_meal_intake"
  | "weight_change"
  | "behavior_change"
  | "new_incontinence"
  | "repeated_refusals"
  | "skin_concern"
  | "hospital_visit"
  | "increased_supervision"
  | "repeated_unscheduled_services"
  | "mobility_decline";

export type ChangeSignalSeverity = "high" | "attention";

export interface ChangeSignalEvidence {
  /** What the record is, in words a person would use. */
  label: string;
  at: string | null;
}

export interface ChangeSignal {
  kind: ChangeSignalKind;
  severity: ChangeSignalSeverity;
  /** What changed. */
  title: string;
  /** Why it matters, in the words an administrator would use defending the review. */
  rationale: string;
  /** The records that make it true. Never empty -- a signal without evidence is not a signal. */
  evidence: ChangeSignalEvidence[];
  windowStart: string;
  windowEnd: string;
  recommendedReview: string;
  responsibleRole: string;
}

// --- Thresholds. Named, visible, and asserted in tests. ------------------------------------------

export const FALL_WINDOW_DAYS = 30;
export const FALL_COUNT_THRESHOLD = 2;

export const ASSISTANCE_WINDOW_DAYS = 14;
export const ASSISTANCE_COUNT_THRESHOLD = 3;

export const REFUSAL_WINDOW_DAYS = 14;
export const REFUSAL_COUNT_THRESHOLD = 3;

export const UNSCHEDULED_WINDOW_DAYS = 14;
export const UNSCHEDULED_COUNT_THRESHOLD = 5;

export const SUPERVISION_WINDOW_DAYS = 14;
export const SUPERVISION_COUNT_THRESHOLD = 3;

export const MEAL_WINDOW_DAYS = 7;
/** Proportion of meals with poor intake before it is worth a look. */
export const MEAL_POOR_INTAKE_RATIO = 0.4;
export const MEAL_MINIMUM_RECORDS = 6;

/** Clinically conventional thresholds: 5% in 30 days, 10% in 180. */
export const WEIGHT_SHORT_WINDOW_DAYS = 30;
export const WEIGHT_SHORT_PERCENT = 5;
export const WEIGHT_LONG_WINDOW_DAYS = 180;
export const WEIGHT_LONG_PERCENT = 10;

export interface DetectionServiceException {
  completion_response: string | null;
  documented_assistance_level: string | null;
  service_name: string;
  at: string | null;
}

export interface DetectionUnscheduledService {
  service_kind: string;
  occurred_at: string;
}

export interface DetectionChangeEvent {
  category: string;
  identified_at: string;
  status: string;
}

export interface DetectionIncident {
  incident_type: string;
  occurred_at: string;
}

export interface DetectionMealRecord {
  /** Fraction consumed, 0..1, or null when not recorded. */
  intake_ratio: number | null;
  recorded_at: string;
}

export interface DetectionWeightReading {
  weight_lbs: number;
  measured_at: string;
}

export interface DetectionHospitalEpisode {
  transfer_time: string;
  destination: string | null;
  status: string;
}

export interface ChangeDetectionInput {
  serviceExceptions: DetectionServiceException[];
  unscheduledServices: DetectionUnscheduledService[];
  changeEvents: DetectionChangeEvent[];
  incidents: DetectionIncident[];
  mealRecords: DetectionMealRecord[];
  weightReadings: DetectionWeightReading[];
  hospitalEpisodes: DetectionHospitalEpisode[];
  now?: Date;
}

function withinWindow(at: string | null | undefined, now: Date, days: number): boolean {
  if (!at) return false;
  const time = new Date(at).getTime();
  if (Number.isNaN(time)) return false;
  return time >= now.getTime() - days * 86_400_000 && time <= now.getTime();
}

function windowStart(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function detectResidentChangeSignals(input: ChangeDetectionInput): ChangeSignal[] {
  const now = input.now ?? new Date();
  const signals: ChangeSignal[] = [];
  const nowIso = now.toISOString();

  // --- Increased assistance -----------------------------------------------------------------
  const assistanceRecords = input.serviceExceptions.filter((entry) =>
    entry.completion_response === "completed_with_more_assistance"
    && withinWindow(entry.at, now, ASSISTANCE_WINDOW_DAYS));
  if (assistanceRecords.length >= ASSISTANCE_COUNT_THRESHOLD) {
    signals.push({
      kind: "increased_assistance",
      severity: "high",
      title: `${plural(assistanceRecords.length, "service")} needed more help than planned`,
      rationale: "Repeatedly needing more help than the plan describes means the plan understates what this resident requires, and the staffing built on it is short.",
      evidence: assistanceRecords.slice(0, 5).map((entry) => ({
        label: `${entry.service_name}${entry.documented_assistance_level ? ` — ${entry.documented_assistance_level.replace(/_/g, " ")}` : ""}`,
        at: entry.at,
      })),
      windowStart: windowStart(now, ASSISTANCE_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Mobility and fall-risk review, then a support-plan revision if the level has genuinely changed.",
      responsibleRole: "Facility manager",
    });
  }

  // --- Multiple falls -----------------------------------------------------------------------
  // Counted from incidents AND condition changes: a fall without injury is routinely recorded only
  // as a condition change, so one source alone undercounts.
  const falls: ChangeSignalEvidence[] = [
    ...input.incidents.filter((entry) => /fall/i.test(entry.incident_type) && withinWindow(entry.occurred_at, now, FALL_WINDOW_DAYS))
      .map((entry) => ({ label: `Incident: ${entry.incident_type.replace(/_/g, " ")}`, at: entry.occurred_at })),
    ...input.changeEvents.filter((entry) => entry.category === "fall" && withinWindow(entry.identified_at, now, FALL_WINDOW_DAYS))
      .map((entry) => ({ label: "Condition change: fall", at: entry.identified_at })),
  ];
  if (falls.length >= FALL_COUNT_THRESHOLD) {
    signals.push({
      kind: "multiple_falls",
      severity: "high",
      title: `${plural(falls.length, "fall")} in ${FALL_WINDOW_DAYS} days`,
      rationale: "Repeat falls indicate the current fall-prevention interventions are not working, whatever the plan says.",
      evidence: falls.slice(0, 5),
      windowStart: windowStart(now, FALL_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Mobility and fall-risk review, with the fall interventions in the active plan re-examined.",
      responsibleRole: "Administrator",
    });
  }

  // --- Repeated refusals ---------------------------------------------------------------------
  const refusals = input.serviceExceptions.filter((entry) =>
    entry.completion_response === "resident_refused" && withinWindow(entry.at, now, REFUSAL_WINDOW_DAYS));
  if (refusals.length >= REFUSAL_COUNT_THRESHOLD) {
    signals.push({
      kind: "repeated_refusals",
      severity: "attention",
      title: `${plural(refusals.length, "service refusal")} in ${REFUSAL_WINDOW_DAYS} days`,
      rationale: "Refusals are the earliest signal that a plan no longer fits the resident — the care may be right in principle and wrong in how, when, or by whom it is offered.",
      evidence: refusals.slice(0, 5).map((entry) => ({ label: `Refused: ${entry.service_name}`, at: entry.at })),
      windowStart: windowStart(now, REFUSAL_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Talk to the resident about what they are refusing and why, then revise the plan's approach rather than repeating it.",
      responsibleRole: "Facility manager",
    });
  }

  // --- Repeated unscheduled services ----------------------------------------------------------
  const unscheduled = input.unscheduledServices.filter((entry) =>
    withinWindow(entry.occurred_at, now, UNSCHEDULED_WINDOW_DAYS));
  if (unscheduled.length >= UNSCHEDULED_COUNT_THRESHOLD) {
    const byKind = new Map<string, number>();
    for (const entry of unscheduled) byKind.set(entry.service_kind, (byKind.get(entry.service_kind) ?? 0) + 1);
    signals.push({
      kind: "repeated_unscheduled_services",
      severity: "attention",
      title: `${plural(unscheduled.length, "unscheduled service")} in ${UNSCHEDULED_WINDOW_DAYS} days`,
      rationale: "Care being given repeatedly outside the plan is care the plan should contain — and staffing should be counting.",
      evidence: [...byKind.entries()].slice(0, 5).map(([kind, count]) => ({
        label: `${kind.replace(/_/g, " ")} × ${count}`,
        at: null,
      })),
      windowStart: windowStart(now, UNSCHEDULED_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Support-plan review, and a care-level review if the extra care is sustained.",
      responsibleRole: "Administrator",
    });
  }

  // --- Increased supervision ------------------------------------------------------------------
  const supervision = input.unscheduledServices.filter((entry) =>
    (entry.service_kind === "increased_supervision" || entry.service_kind === "additional_redirection")
    && withinWindow(entry.occurred_at, now, SUPERVISION_WINDOW_DAYS));
  if (supervision.length >= SUPERVISION_COUNT_THRESHOLD) {
    signals.push({
      kind: "increased_supervision",
      severity: "attention",
      title: `${plural(supervision.length, "extra supervision episode")} in ${SUPERVISION_WINDOW_DAYS} days`,
      rationale: "Supervision that staff are providing but the plan does not require is invisible to scheduling, so nobody is staffed for it.",
      evidence: supervision.slice(0, 5).map((entry) => ({
        label: entry.service_kind.replace(/_/g, " "),
        at: entry.occurred_at,
      })),
      windowStart: windowStart(now, SUPERVISION_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Cognitive and behavioral review.",
      responsibleRole: "Facility manager",
    });
  }

  // --- Reduced meal intake --------------------------------------------------------------------
  const meals = input.mealRecords.filter((entry) =>
    entry.intake_ratio !== null && withinWindow(entry.recorded_at, now, MEAL_WINDOW_DAYS));
  const poorMeals = meals.filter((entry) => (entry.intake_ratio ?? 1) < 0.5);
  // Requires a minimum sample: two poor meals out of three is noise, not a trend.
  if (meals.length >= MEAL_MINIMUM_RECORDS && poorMeals.length / meals.length >= MEAL_POOR_INTAKE_RATIO) {
    signals.push({
      kind: "reduced_meal_intake",
      severity: "high",
      title: `${poorMeals.length} of ${meals.length} recorded meals under half eaten`,
      rationale: "Sustained poor intake precedes weight loss, dehydration, and hospitalization, and it is visible in records days before it is visible in the resident.",
      evidence: poorMeals.slice(0, 5).map((entry) => ({
        label: `Intake ${Math.round((entry.intake_ratio ?? 0) * 100)}%`,
        at: entry.recorded_at,
      })),
      windowStart: windowStart(now, MEAL_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Nutritional review.",
      responsibleRole: "Facility manager",
    });
  }

  // --- Weight change ---------------------------------------------------------------------------
  const weights = [...input.weightReadings]
    .filter((entry) => !Number.isNaN(new Date(entry.measured_at).getTime()) && entry.weight_lbs > 0)
    .sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime());
  if (weights.length >= 2) {
    const latest = weights[0];
    for (const [days, percent] of [
      [WEIGHT_SHORT_WINDOW_DAYS, WEIGHT_SHORT_PERCENT],
      [WEIGHT_LONG_WINDOW_DAYS, WEIGHT_LONG_PERCENT],
    ] as const) {
      // Compare against the oldest reading inside the window, which is the baseline the window is about.
      const inWindow = weights.filter((entry) => withinWindow(entry.measured_at, now, days));
      const baseline = inWindow[inWindow.length - 1];
      if (!baseline || baseline === latest) continue;
      const delta = latest.weight_lbs - baseline.weight_lbs;
      const changePercent = Math.abs(delta) / baseline.weight_lbs * 100;
      if (changePercent >= percent) {
        signals.push({
          kind: "weight_change",
          severity: "high",
          title: `${delta < 0 ? "Weight loss" : "Weight gain"} of ${changePercent.toFixed(1)}% in ${days} days`,
          rationale: `A ${percent}% change over ${days} days is the conventional threshold for clinical review; it is reported here as a measurement, not a diagnosis.`,
          evidence: [
            { label: `Latest ${latest.weight_lbs} lb`, at: latest.measured_at },
            { label: `Baseline ${baseline.weight_lbs} lb`, at: baseline.measured_at },
          ],
          windowStart: windowStart(now, days),
          windowEnd: nowIso,
          recommendedReview: "Nutritional review, and provider notification if the change is unexplained.",
          responsibleRole: "Facility manager",
        });
        break; // One weight signal is enough; the shorter window wins.
      }
    }
  }

  // --- Signals lifted straight from recorded condition changes ---------------------------------
  const categoryRules: {
    category: string;
    kind: ChangeSignalKind;
    title: string;
    rationale: string;
    review: string;
    severity: ChangeSignalSeverity;
  }[] = [
    {
      category: "behavioral_change", kind: "behavior_change", severity: "attention",
      title: "Behaviour change recorded",
      rationale: "A behaviour change is often the first observable sign of pain, infection, or an unmet need the resident cannot articulate.",
      review: "Cognitive and behavioral review.",
    },
    {
      category: "continence_change", kind: "new_incontinence", severity: "attention",
      title: "Continence change recorded",
      rationale: "New incontinence is a change of condition, not a care preference, and it changes both the plan and the staffing it implies.",
      review: "Continence and toileting review.",
    },
    {
      category: "skin_concern", kind: "skin_concern", severity: "high",
      title: "Skin concern recorded",
      rationale: "Skin breakdown escalates quickly and is among the most commonly cited findings at survey.",
      review: "Provider notification and a documented monitoring schedule.",
    },
    {
      category: "mobility_decline", kind: "mobility_decline", severity: "high",
      title: "Mobility decline recorded",
      rationale: "Declining mobility raises fall risk and transfer needs at the same time, and the plan usually reflects neither yet.",
      review: "Mobility and fall-risk review.",
    },
  ];
  for (const rule of categoryRules) {
    const matches = input.changeEvents.filter((entry) =>
      entry.category === rule.category && withinWindow(entry.identified_at, now, FALL_WINDOW_DAYS));
    if (!matches.length) continue;
    signals.push({
      kind: rule.kind,
      severity: rule.severity,
      title: rule.title,
      rationale: rule.rationale,
      evidence: matches.slice(0, 5).map((entry) => ({
        label: `Condition change: ${entry.category.replace(/_/g, " ")} (${entry.status})`,
        at: entry.identified_at,
      })),
      windowStart: windowStart(now, FALL_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: rule.review,
      responsibleRole: "Facility manager",
    });
  }

  // --- Hospital visit ---------------------------------------------------------------------------
  const hospitalVisits = input.hospitalEpisodes.filter((entry) =>
    entry.status !== "canceled" && withinWindow(entry.transfer_time, now, FALL_WINDOW_DAYS));
  if (hospitalVisits.length) {
    signals.push({
      kind: "hospital_visit",
      severity: "high",
      title: `${plural(hospitalVisits.length, "hospital transfer")} in ${FALL_WINDOW_DAYS} days`,
      rationale: "A hospital stay almost always changes medications, diet, or mobility, and the plan predates all of it until somebody reconciles.",
      evidence: hospitalVisits.slice(0, 5).map((entry) => ({
        label: `Transfer to ${entry.destination ?? "hospital"}`,
        at: entry.transfer_time,
      })),
      windowStart: windowStart(now, FALL_WINDOW_DAYS),
      windowEnd: nowIso,
      recommendedReview: "Hospital-return review, then a support-plan revision if anything changed.",
      responsibleRole: "Administrator",
    });
  }

  const severityRank: Record<ChangeSignalSeverity, number> = { high: 2, attention: 1 };
  return signals.sort((a, b) => {
    const bySeverity = severityRank[b.severity] - severityRank[a.severity];
    return bySeverity !== 0 ? bySeverity : (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
  });
}

/**
 * Counts only. Deliberately NOT a score: the request rules out a black-box risk number, and a
 * weighted total would become one the moment somebody sorted by it.
 */
export function summarizeChangeSignals(signals: ChangeSignal[]) {
  return {
    total: signals.length,
    high: signals.filter((signal) => signal.severity === "high").length,
    attention: signals.filter((signal) => signal.severity === "attention").length,
  };
}
