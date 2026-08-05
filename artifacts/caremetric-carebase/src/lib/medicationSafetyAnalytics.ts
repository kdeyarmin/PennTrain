export type MedicationEventType = "omission" | "wrong_dose" | "wrong_resident" | "wrong_medication" | "wrong_time" | "documentation_error" | "adverse_reaction" | "refusal" | "near_miss" | "other";

export interface MedicationIncidentLike {
  id: string;
  incident_type?: string | null;
  status?: string | null;
  severity?: string | null;
  occurred_at?: string | null;
  final_report_submitted_at?: string | null;
  facility_id?: string | null;
}
export interface MedicationCorrectiveActionLike {
  id: string;
  status?: string | null;
  due_date?: string | null;
  incident_id?: string | null;
}

export interface MedicationSafetyEvent {
  incidentId: string;
  eventType: MedicationEventType;
  status: "open" | "closed";
  occurredAt: string | null;
  followUpOverdue: boolean;
  retrainingRecommended: boolean;
}

export interface MedicationSafetySummary {
  totalEvents: number;
  unresolvedFollowUps: number;
  overdueFollowUps: number;
  retrainingRecommendations: number;
  byType: Record<MedicationEventType, number>;
  events: MedicationSafetyEvent[];
}

// Two different tables, two different status vocabularies -- one shared set could only ever be
// right about one of them, and it was wrong about the other.
//
//   incidents.status          check (status in ('reported','investigating','closed'))
//   corrective_actions.status check (status in ('open','in_progress','completed','overdue','cancelled'))
//
// The single set that used to serve both was {"closed","resolved","completed"}: it covered the
// incident side, but on the corrective-action side it matched only 'completed' and so treated a
// CANCELLED action as still outstanding. A cancelled action with a past due_date therefore counted
// toward overdueFollowUps and, through followUpOverdue, raised a retraining recommendation for an
// incident whose follow-up had been deliberately called off. The SQL that computes the same number
// for the operations snapshot has always excluded both terminal states
// (`c.status not in ('completed','cancelled')`, 20260713233413_operations_command_center_snapshot.sql),
// so the dashboard and this module disagreed about the same corrective action.
//
// "resolved" appeared in the old set and is not a legal value in either table -- dropped rather
// than carried forward into both.
const INCIDENT_CLOSED = new Set(["closed"]);
const CORRECTIVE_ACTION_SETTLED = new Set(["completed", "cancelled"]);

// Returns null for incidents that are not medication-related at all, and
// "other" for medication incidents without a recognizable subtype -- notably
// the canonical `medication_error` incident type, which must still be counted
// in the safety summary rather than dropped.
export function classifyMedicationEvent(incidentType: string | null | undefined): MedicationEventType | null {
  const value = (incidentType ?? "").toLowerCase();
  if (!/(med|medication|drug|dose|mar|insulin|refusal|adverse|near miss)/.test(value)) return null;
  if (/near miss/.test(value)) return "near_miss";
  if (/refusal/.test(value)) return "refusal";
  if (/adverse|reaction/.test(value)) return "adverse_reaction";
  if (/document|mar/.test(value)) return "documentation_error";
  if (/wrong time|late|early/.test(value)) return "wrong_time";
  if (/wrong resident/.test(value)) return "wrong_resident";
  if (/wrong (med|medication)|wrong drug/.test(value)) return "wrong_medication";
  if (/wrong dose|dose error/.test(value)) return "wrong_dose";
  if (/omit|missed/.test(value)) return "omission";
  return "other";
}

export function buildMedicationSafetySummary({ incidents, correctiveActions, today }: { incidents: MedicationIncidentLike[]; correctiveActions: MedicationCorrectiveActionLike[]; today: string }): MedicationSafetySummary {
  const medIncidents = incidents.filter((incident) => classifyMedicationEvent(incident.incident_type) !== null);
  const actionsByIncident = new Map<string, MedicationCorrectiveActionLike[]>();
  for (const action of correctiveActions) {
    if (!action.incident_id) continue;
    const list = actionsByIncident.get(action.incident_id) ?? [];
    list.push(action);
    actionsByIncident.set(action.incident_id, list);
  }

  const byType = {
    omission: 0, wrong_dose: 0, wrong_resident: 0, wrong_medication: 0, wrong_time: 0,
    documentation_error: 0, adverse_reaction: 0, refusal: 0, near_miss: 0, other: 0,
  } satisfies Record<MedicationEventType, number>;

  const events = medIncidents.map((incident) => {
    const eventType = classifyMedicationEvent(incident.incident_type) ?? "other";
    byType[eventType] += 1;
    const actions = actionsByIncident.get(incident.id) ?? [];
    const isClosed = INCIDENT_CLOSED.has(incident.status ?? "") && Boolean(incident.final_report_submitted_at);
    const followUpOverdue = actions.some((action) => !CORRECTIVE_ACTION_SETTLED.has(action.status ?? "") && Boolean(action.due_date && action.due_date < today));
    return {
      incidentId: incident.id,
      eventType,
      status: isClosed ? "closed" : "open",
      occurredAt: incident.occurred_at ?? null,
      followUpOverdue,
      retrainingRecommended: followUpOverdue || ["wrong_dose", "wrong_medication", "wrong_resident", "documentation_error"].includes(eventType),
    } satisfies MedicationSafetyEvent;
  });

  return {
    totalEvents: events.length,
    unresolvedFollowUps: events.filter((event) => event.status === "open").length,
    overdueFollowUps: events.filter((event) => event.followUpOverdue).length,
    retrainingRecommendations: events.filter((event) => event.retrainingRecommended).length,
    byType,
    events,
  };
}
