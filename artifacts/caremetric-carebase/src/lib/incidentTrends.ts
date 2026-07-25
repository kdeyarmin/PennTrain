/**
 * Incident and quality trends (program plan Phase 6c).
 *
 * EVERY BUCKET CARRIES ITS SOURCE RECORDS. The plan's rule for this phase is that every chart
 * element opens the records behind it, because an un-drillable number in a compliance product is a
 * liability -- it cannot be defended in a survey, and nobody can tell a real pattern from a coding
 * artefact. So a `TrendBucket` is not a count with a label; it is a list of incident ids that
 * happens to know its own size.
 *
 * That is also why the bucketing happens here rather than in SQL. Incidents are low-volume -- a
 * facility records tens per quarter, not millions -- so the read path returns the rows and this
 * module groups them. An aggregation RPC would have to return the ids anyway to stay drillable, at
 * which point it is the same payload with the grouping logic moved somewhere untestable.
 *
 * NO SCORES. There is deliberately no composite "risk index" here, in either direction: not for a
 * resident, not for a facility. The request is explicit that a black-box number is not wanted, and a
 * weighted blend of counts is exactly that with arithmetic in front of it. Every number below is a
 * count of things that happened, and the records are one click away.
 */

const TIME_ZONE = "America/New_York";
const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hour: "numeric", hour12: false,
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export interface TrendIncidentLike {
  id: string;
  incident_type: string;
  pathway_key: string | null;
  severity: string;
  status: string;
  occurred_at: string;
  location_detail: string | null;
  resident_id: string | null;
  resident_display: string | null;
  root_cause: string | null;
  reportability_status: string;
  administrator_approved_at: string | null;
  closed_at: string | null;
}

export interface TrendCorrectiveActionLike {
  incident_id: string | null;
  status: string;
  due_date: string;
  completed_date: string | null;
  verification_notes: string | null;
}

export interface TrendBucket {
  key: string;
  label: string;
  count: number;
  /** The records behind the number. Never omitted -- see the module note. */
  incidentIds: string[];
}

export interface TrendSeries {
  key: string;
  title: string;
  /** What this series is for, in the words someone would use presenting it. */
  purpose: string;
  buckets: TrendBucket[];
  total: number;
}

/**
 * Shifts, as PA facilities actually run them. Boundaries are named constants rather than inline
 * numbers because a facility on a different rotation will need to change them, and a magic `14` in
 * three places is how that change gets made in two.
 */
export const SHIFT_BOUNDARIES = { dayStartHour: 7, eveningStartHour: 15, nightStartHour: 23 };

export type ShiftKey = "day" | "evening" | "night";

export const SHIFT_LABELS: Record<ShiftKey, string> = {
  day: "Day (7a–3p)",
  evening: "Evening (3p–11p)",
  night: "Night (11p–7a)",
};

export function shiftOf(occurredAt: string): ShiftKey | null {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  const hour = Number(hourFormatter.format(date));
  if (!Number.isFinite(hour)) return null;
  // Intl with hour12:false renders midnight as 24 in some environments.
  const normalized = hour === 24 ? 0 : hour;
  if (normalized >= SHIFT_BOUNDARIES.dayStartHour && normalized < SHIFT_BOUNDARIES.eveningStartHour) return "day";
  if (normalized >= SHIFT_BOUNDARIES.eveningStartHour && normalized < SHIFT_BOUNDARIES.nightStartHour) return "evening";
  return "night";
}

/** The PA calendar day an incident falls on, as YYYY-MM-DD. */
export function facilityDayOf(occurredAt: string): string | null {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function groupBy(
  incidents: TrendIncidentLike[],
  keyOf: (incident: TrendIncidentLike) => string | null,
  labelOf: (key: string) => string,
): TrendBucket[] {
  const map = new Map<string, string[]>();
  for (const incident of incidents) {
    const key = keyOf(incident);
    if (key === null) continue;
    const existing = map.get(key);
    if (existing) existing.push(incident.id);
    else map.set(key, [incident.id]);
  }
  return [...map.entries()]
    .map(([key, incidentIds]) => ({ key, label: labelOf(key), count: incidentIds.length, incidentIds }))
    // Largest first: the point of a trend view is what to look at, not alphabetical browsing.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function series(
  key: string, title: string, purpose: string, buckets: TrendBucket[],
): TrendSeries {
  return { key, title, purpose, buckets, total: buckets.reduce((sum, b) => sum + b.count, 0) };
}

function humanizeKey(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Pathways that describe a fall. `pathway_key` is the honest signal; type alone cannot tell. */
const FALL_PATHWAYS = new Set(["fall"]);
const BEHAVIORAL_PATHWAYS = new Set(["behavioral_event"]);
const TRANSFER_PATHWAYS = new Set(["emergency_transfer"]);
const INJURY_PATHWAYS = new Set(["injury", "skin_tear", "fall"]);

function isFall(incident: TrendIncidentLike): boolean {
  return incident.pathway_key !== null && FALL_PATHWAYS.has(incident.pathway_key);
}

export interface IncidentTrendInput {
  incidents: TrendIncidentLike[];
  correctiveActions: TrendCorrectiveActionLike[];
  now?: Date;
}

/**
 * Days after an incident occurred before an unapproved investigation counts as overdue. Named and
 * exported so the number is arguable rather than buried.
 */
export const INVESTIGATION_DUE_DAYS = 7;

export interface IncidentTrends {
  series: TrendSeries[];
  /** Residents with more than one incident in the window -- the repeat signal, as a plain count. */
  repeatResidents: TrendBucket[];
  overdueInvestigations: TrendBucket;
  correctiveActionEffectiveness: {
    total: number;
    completed: number;
    verified: number;
    overdue: number;
    /** Completed AND verified, as a percentage of all actions. Null when there are none. */
    verifiedRate: number | null;
  };
}

export function buildIncidentTrends(input: IncidentTrendInput): IncidentTrends {
  const { incidents, correctiveActions } = input;
  const now = input.now ?? new Date();
  const falls = incidents.filter(isFall);

  const allSeries: TrendSeries[] = [
    series("falls_by_shift", "Falls by shift",
      "A shift that accounts for most falls is a staffing and routine question, not a resident question.",
      groupBy(falls, (incident) => shiftOf(incident.occurred_at), (key) => SHIFT_LABELS[key as ShiftKey] ?? key)),

    series("falls_by_location", "Falls by location",
      "A location that repeats points at the environment, which is the part a facility can actually change.",
      groupBy(falls, (incident) => incident.location_detail?.trim() || "Not recorded", (key) => key)),

    series("falls_by_resident", "Falls by resident",
      "Repeated falls for one resident is the clearest signal that a support plan no longer fits.",
      groupBy(falls, (incident) => incident.resident_id, (key) =>
        falls.find((f) => f.resident_id === key)?.resident_display ?? "Unnamed resident")),

    series("injuries_by_type", "Injuries by kind",
      "Separates a skin tear from a fracture, which the state's single significant-injury type cannot.",
      groupBy(
        incidents.filter((i) => i.pathway_key !== null && INJURY_PATHWAYS.has(i.pathway_key)),
        (incident) => incident.pathway_key, humanizeKey,
      )),

    series("medication_events", "Medication-related events by month",
      "Medication events cluster around process changes, so the shape over time matters more than the count.",
      groupBy(
        incidents.filter((i) => i.incident_type === "medication_error"),
        (incident) => facilityDayOf(incident.occurred_at)?.slice(0, 7) ?? null,
        (key) => key,
      )),

    series("elopement_concerns", "Elopement and missing-resident events",
      "Both pathways record against one state type, and separating them shows whether the resident left the building.",
      groupBy(
        incidents.filter((i) => i.incident_type === "elopement"),
        (incident) => incident.pathway_key ?? "unspecified", humanizeKey,
      )),

    series("behavioral_events", "Behavioral events by shift",
      "Behaviour that concentrates on one shift is usually about routine and staffing, not the resident.",
      groupBy(
        incidents.filter((i) => i.pathway_key !== null && BEHAVIORAL_PATHWAYS.has(i.pathway_key)),
        (incident) => shiftOf(incident.occurred_at),
        (key) => SHIFT_LABELS[key as ShiftKey] ?? key,
      )),

    series("emergency_transfers", "Emergency transfers by month",
      "Rising transfers can mean acuity has outgrown the level of care the facility is licensed for.",
      groupBy(
        incidents.filter((i) => i.pathway_key !== null && TRANSFER_PATHWAYS.has(i.pathway_key)),
        (incident) => facilityDayOf(incident.occurred_at)?.slice(0, 7) ?? null,
        (key) => key,
      )),

    series("root_causes", "Recorded root causes",
      "Causes that repeat verbatim are the ones a corrective action has not actually addressed.",
      groupBy(
        incidents.filter((i) => (i.root_cause ?? "").trim().length > 0),
        (incident) => incident.root_cause!.trim().toLowerCase(),
        (key) => key.replace(/^./, (c) => c.toUpperCase()),
      )),
  ];

  // Repeat incidents: residents appearing more than once in the window, any incident kind.
  const byResident = groupBy(
    incidents.filter((incident) => incident.resident_id !== null),
    (incident) => incident.resident_id,
    (key) => incidents.find((i) => i.resident_id === key)?.resident_display ?? "Unnamed resident",
  );
  const repeatResidents = byResident.filter((bucket) => bucket.count > 1);

  const overdueCutoff = now.getTime() - INVESTIGATION_DUE_DAYS * 24 * 3_600_000;
  const overdue = incidents.filter((incident) => {
    if (incident.administrator_approved_at || incident.status === "closed") return false;
    const occurred = new Date(incident.occurred_at).getTime();
    return Number.isFinite(occurred) && occurred < overdueCutoff;
  });

  const live = correctiveActions.filter((action) => action.status !== "cancelled");
  const completed = live.filter((action) => action.status === "completed" || action.completed_date !== null);
  const verified = completed.filter((action) => (action.verification_notes ?? "").trim().length > 0);
  const overdueActions = live.filter((action) => {
    if (action.status === "completed" || action.completed_date) return false;
    const due = new Date(`${action.due_date}T23:59:59`).getTime();
    return Number.isFinite(due) && due < now.getTime();
  });

  return {
    // A series with nothing in it is noise on a page someone is trying to read.
    series: allSeries.filter((entry) => entry.total > 0),
    repeatResidents,
    overdueInvestigations: {
      key: "overdue_investigations",
      label: `Investigations open past ${INVESTIGATION_DUE_DAYS} days`,
      count: overdue.length,
      incidentIds: overdue.map((incident) => incident.id),
    },
    correctiveActionEffectiveness: {
      total: live.length,
      completed: completed.length,
      verified: verified.length,
      overdue: overdueActions.length,
      // Verified, not merely completed: an action nobody checked is a claim, not a correction.
      verifiedRate: live.length === 0 ? null : Math.round((verified.length / live.length) * 100),
    },
  };
}
