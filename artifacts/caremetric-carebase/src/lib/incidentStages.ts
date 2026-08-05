import { facilityToday } from "./dateUtils";

/**
 * Incident follow-through (program plan Phase 6b).
 *
 * WHAT WAS ACTUALLY MISSING. `incidents` already had a three-value `status`
 * (reported / investigating / closed), a findings field, a root cause field, corrective actions,
 * external notifications with deadlines, and a final-report gate on closure. What it had no model of
 * was the *order* of the work: nothing said that a reportability determination has to happen before
 * an investigation is worth writing up, that a resident's assessment and support plan have to be
 * revisited after an event that changed their condition, or that somebody has to approve the whole
 * thing before it closes. `status = 'investigating'` covered nine distinct pieces of work.
 *
 * So this module owns the eleven stages as a derived checklist over rows that already exist plus a
 * small number of new columns. Nothing here stores state: given an incident and its related rows it
 * says which stages are done, which is next, and what is blocking closure. The same definition drives
 * the incident page, the work queue, and the tests.
 *
 * SEQUENCE IS ADVISORY EXCEPT WHERE IT IS NOT. Stages list prerequisites, and a stage whose
 * prerequisites are unmet reports `waiting` -- but only `closure` is genuinely gated server-side.
 * Real incidents do not proceed tidily: a corrective action often starts the same hour as the event,
 * long before anyone writes a root cause. Blocking that would push the work off the system rather
 * than order it.
 */

export type IncidentStageKey =
  | "immediate_response"
  | "notifications"
  | "reportability_review"
  | "investigation"
  | "root_cause"
  | "corrective_action"
  | "assessment_review"
  | "support_plan_review"
  | "qapi_consideration"
  | "administrator_approval"
  | "closure";

export type IncidentStageStatus =
  | "complete"
  | "in_progress"
  | "not_started"
  | "not_applicable"
  | "waiting"
  | "overdue";

export type ReportabilityStatus = "pending_review" | "reportable" | "not_reportable";

export type QapiConsideration = "pending" | "linked" | "not_indicated";

export interface IncidentStage {
  key: IncidentStageKey;
  label: string;
  /** Why the stage exists, in the words someone would use defending the closure to a surveyor. */
  why: string;
  status: IncidentStageStatus;
  /** What still has to happen, when the stage is not complete. */
  outstanding: string | null;
  /** Stages that should ordinarily precede this one. */
  prerequisites: IncidentStageKey[];
  responsibleRole: string;
  /** True when this stage must be complete before the incident can be closed. */
  blocksClosure: boolean;
}

export interface IncidentRowLike {
  id: string;
  incident_type: string;
  status: string;
  severity: string;
  occurred_at: string;
  resident_id: string | null;
  narrative: string | null;
  pathway_key: string | null;
  pathway_answers: Record<string, unknown> | null;
  pathway_completed_at: string | null;
  immediate_response: string | null;
  reportability_status: string;
  reportability_determined_at: string | null;
  reportability_rationale: string | null;
  investigation_started_at: string | null;
  investigation_findings: string | null;
  root_cause: string | null;
  root_cause_method: string | null;
  qapi_consideration: string;
  qapi_project_id: string | null;
  administrator_approved_at: string | null;
  final_report_submitted_at: string | null;
  closed_at: string | null;
}

export interface IncidentNotificationLike {
  notification_type: string;
  status: string;
  due_at: string;
  completed_at: string | null;
}

export interface CorrectiveActionLike {
  status: string;
  due_date: string;
  completed_date: string | null;
  verification_notes: string | null;
}

export interface IncidentStageInput {
  incident: IncidentRowLike;
  notifications: IncidentNotificationLike[];
  correctiveActions: CorrectiveActionLike[];
  /**
   * Whether a post-incident assessment review has been finalized. Comes from
   * `resident_assessment_reviews`, outside the incident row, so the caller supplies it rather than
   * this module guessing.
   */
  assessmentReviewFinalized: boolean;
  /** Whether a support plan version was created or revised after the incident occurred. */
  supportPlanRevisedAfterIncident: boolean;
  now?: Date;
}

/**
 * Severities at which a resident's assessment and support plan must be revisited. A minor event with
 * no injury does not force a reassessment; asserting otherwise would make the requirement noise, and
 * noise is what gets ignored.
 */
export const REVIEW_REQUIRED_SEVERITIES = new Set(["major", "critical"]);

/**
 * Incident kinds for which `auto_create_incident_notifications` files a state-hotline (and, for
 * abuse and assault, a law-enforcement) notification on insert -- 55 Pa. Code 2600.16/2800.16.
 * Every type the reporting form offers except `other`, which is a catch-all no obligation can be
 * inferred from.
 *
 * Mirrored from the trigger's preset table (20260705144728) because the filing form has to know,
 * before the row exists, whether a notification is already coming: its high-severity gate demanded
 * a manually-added notification and would otherwise refuse to file a critical death or abuse
 * allegation until the reporter hand-entered the very row the database was about to create.
 */
export const AUTO_NOTIFIED_INCIDENT_TYPES = new Set([
  "death", "abuse_allegation", "neglect_allegation", "assault", "elopement",
  "medication_error", "significant_injury", "fire", "environmental_emergency",
]);

/** Incident kinds that always warrant a QAPI look regardless of severity. */
export const QAPI_ALWAYS_CONSIDERED_TYPES = new Set([
  "abuse_allegation", "neglect_allegation", "death", "elopement", "medication_error",
]);

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function firstOf(...statuses: (IncidentStageStatus | null)[]): IncidentStageStatus {
  for (const status of statuses) if (status) return status;
  return "not_started";
}

/** Whether the resident-facing review stages apply to this incident at all. */
export function reviewStagesApply(incident: IncidentRowLike): boolean {
  return incident.resident_id !== null && REVIEW_REQUIRED_SEVERITIES.has(incident.severity);
}

/** Whether QAPI has to be considered — considered, not necessarily opened. */
export function qapiConsiderationApplies(incident: IncidentRowLike): boolean {
  return QAPI_ALWAYS_CONSIDERED_TYPES.has(incident.incident_type)
    || REVIEW_REQUIRED_SEVERITIES.has(incident.severity);
}

function notificationStage(
  incident: IncidentRowLike,
  notifications: IncidentNotificationLike[],
  now: Date,
): { status: IncidentStageStatus; outstanding: string | null } {
  if (notifications.length === 0) {
    // No notification rows and nothing determined yet is genuinely unknown, not done. Once a human
    // has determined the event is not reportable, having none is the correct end state.
    if (incident.reportability_status === "not_reportable") {
      return { status: "not_applicable", outstanding: null };
    }
    return {
      status: incident.reportability_status === "pending_review" ? "waiting" : "not_started",
      outstanding: "No external notifications have been recorded for this incident.",
    };
  }

  // `not_required` is a notification a person determined was not needed, with the rationale written
  // onto the row. It is settled work, not outstanding work.
  const open = notifications.filter(
    (entry) => !["completed", "not_required"].includes(entry.status) && !entry.completed_at,
  );
  if (open.length === 0) {
    const anyRequired = notifications.some((entry) => entry.status !== "not_required");
    return anyRequired
      ? { status: "complete", outstanding: null }
      : { status: "not_applicable", outstanding: null };
  }

  const overdue = open.filter((entry) => {
    const due = new Date(entry.due_at);
    return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
  });
  const label = `${open.length} notification${open.length === 1 ? "" : "s"} outstanding`;
  if (overdue.length > 0) {
    return {
      status: "overdue",
      outstanding: `${label}, ${overdue.length} past the required deadline.`,
    };
  }
  return {
    status: notifications.length > open.length ? "in_progress" : "not_started",
    outstanding: `${label}.`,
  };
}

function correctiveActionStage(
  actions: CorrectiveActionLike[],
  now: Date,
): { status: IncidentStageStatus; outstanding: string | null } {
  if (actions.length === 0) {
    return {
      status: "not_started",
      outstanding: "No corrective action has been recorded. Recording that none is needed is also an answer.",
    };
  }
  const live = actions.filter((action) => action.status !== "cancelled");
  if (live.length === 0) return { status: "not_applicable", outstanding: null };

  const open = live.filter((action) => action.status !== "completed" && !action.completed_date);
  if (open.length === 0) {
    const unverified = live.filter((action) => trimmed(action.verification_notes).length === 0);
    if (unverified.length > 0) {
      return {
        status: "in_progress",
        outstanding: `${unverified.length} completed action${unverified.length === 1 ? " has" : "s have"} no verification recorded.`,
      };
    }
    return { status: "complete", outstanding: null };
  }
  // Bare Postgres `date` values: compare as facility calendar days, not browser-local midnight.
  const today = facilityToday(now);
  const overdue = open.filter((action) => {
    if (!action.due_date || !/^\d{4}-\d{2}-\d{2}$/.test(action.due_date)) return false;
    return action.due_date < today;
  });
  if (overdue.length > 0) {
    return { status: "overdue", outstanding: `${overdue.length} corrective action${overdue.length === 1 ? " is" : "s are"} past due.` };
  }
  return { status: "in_progress", outstanding: `${open.length} corrective action${open.length === 1 ? "" : "s"} still open.` };
}

/**
 * The eleven stages, in order, with each one's status derived from evidence rather than from a
 * status field somebody remembered to advance.
 */
export function buildIncidentStages(input: IncidentStageInput): IncidentStage[] {
  const { incident, notifications, correctiveActions } = input;
  const now = input.now ?? new Date();
  const closed = incident.status === "closed";
  const reviewsApply = reviewStagesApply(incident);
  const qapiApplies = qapiConsiderationApplies(incident);

  const immediateResponse = trimmed(incident.immediate_response).length > 0;
  const pathwayComplete = Boolean(incident.pathway_completed_at);
  const reportabilityDecided = incident.reportability_status !== "pending_review";
  const findings = trimmed(incident.investigation_findings).length > 0;
  const rootCause = trimmed(incident.root_cause).length > 0;

  const notificationResult = notificationStage(incident, notifications, now);
  const correctiveResult = correctiveActionStage(correctiveActions, now);

  const stages: IncidentStage[] = [
    {
      key: "immediate_response",
      label: "Immediate response",
      why: "What was done for the resident in the first minutes is the part a late write-up can never reconstruct.",
      status: immediateResponse ? "complete" : "not_started",
      outstanding: immediateResponse ? null : "Record what was done for the resident immediately.",
      prerequisites: [],
      responsibleRole: "Reporting staff member",
      blocksClosure: true,
    },
    {
      key: "notifications",
      label: "Required notifications",
      why: "Notification deadlines run from the event, not from when the investigation gets going.",
      status: notificationResult.status,
      outstanding: notificationResult.outstanding,
      // Deliberately no prerequisites. A two-hour hotline deadline must never render as "waiting on
      // earlier work" because nobody has typed up the immediate response yet. The one real
      // dependency -- that an undetermined event has no notification list yet -- is handled inside
      // notificationStage, which reports `waiting` for exactly that case and no other.
      prerequisites: [],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "reportability_review",
      label: "Reportability determination",
      why: "Whether this is a reportable event is a judgement someone makes and signs, not a property of the type picked at intake.",
      status: reportabilityDecided ? "complete" : "not_started",
      outstanding: reportabilityDecided
        ? null
        : "Determine whether this event is reportable and record the reasoning.",
      // Also no prerequisites: this determination is what tells everyone whether the notification
      // clock is running, so it cannot sit behind other paperwork.
      prerequisites: [],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "investigation",
      label: "Investigation",
      why: "The pathway questions are what make one investigation comparable to the next.",
      status: firstOf(
        pathwayComplete && findings ? "complete" : null,
        pathwayComplete || findings || incident.investigation_started_at ? "in_progress" : null,
        "not_started",
      ),
      outstanding: pathwayComplete && findings
        ? null
        : !incident.pathway_key
          ? "Choose the investigation pathway for this kind of event."
          : !pathwayComplete
            ? "Finish the pathway questions."
            : "Record the investigation findings.",
      prerequisites: ["immediate_response"],
      responsibleRole: "Investigator",
      blocksClosure: true,
    },
    {
      key: "root_cause",
      label: "Root cause",
      why: "A cause named as 'resident was unsteady' explains nothing and prevents nothing.",
      status: rootCause && trimmed(incident.root_cause_method).length > 0
        ? "complete"
        : rootCause ? "in_progress" : "not_started",
      outstanding: rootCause
        ? trimmed(incident.root_cause_method).length > 0 ? null : "Record which method produced this root cause."
        : "Record the root cause and the method used to reach it.",
      prerequisites: ["investigation"],
      responsibleRole: "Investigator",
      blocksClosure: true,
    },
    {
      key: "corrective_action",
      label: "Corrective action",
      why: "An action with no completion and no verification is a plan, not a correction.",
      status: correctiveResult.status,
      outstanding: correctiveResult.outstanding,
      prerequisites: ["root_cause"],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "assessment_review",
      label: "Resident assessment review",
      why: "An event serious enough to investigate is serious enough to ask whether the assessment still describes this resident.",
      status: !reviewsApply
        ? "not_applicable"
        : input.assessmentReviewFinalized ? "complete" : "not_started",
      outstanding: !reviewsApply || input.assessmentReviewFinalized
        ? null
        : "Finalize an assessment review for this resident.",
      prerequisites: ["investigation"],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "support_plan_review",
      label: "Support plan review",
      why: "A plan unchanged after a major event is either correct or unread, and the record cannot tell which unless someone says so.",
      status: !reviewsApply
        ? "not_applicable"
        : input.supportPlanRevisedAfterIncident ? "complete" : "not_started",
      outstanding: !reviewsApply || input.supportPlanRevisedAfterIncident
        ? null
        : "Revise the support plan or record that it was reviewed and needs no change.",
      prerequisites: ["assessment_review"],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "qapi_consideration",
      label: "QAPI consideration",
      why: "The point of a quality programme is that individual events are examined for the pattern behind them.",
      status: !qapiApplies
        ? "not_applicable"
        : incident.qapi_consideration === "pending" ? "not_started" : "complete",
      outstanding: !qapiApplies || incident.qapi_consideration !== "pending"
        ? null
        : "Link this incident to a QAPI project, or record that one is not indicated.",
      prerequisites: ["root_cause"],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "administrator_approval",
      label: "Administrator approval",
      why: "Someone accountable has to read the whole file and say it is complete.",
      status: incident.administrator_approved_at ? "complete" : "not_started",
      outstanding: incident.administrator_approved_at ? null : "Approve the completed investigation.",
      prerequisites: [
        "notifications", "reportability_review", "investigation", "root_cause",
        "corrective_action", "assessment_review", "support_plan_review", "qapi_consideration",
      ],
      responsibleRole: "Administrator",
      blocksClosure: true,
    },
    {
      key: "closure",
      label: "Closure",
      why: "Closure records the final report submission; it is the one stage the database itself refuses to skip.",
      status: closed
        ? "complete"
        : incident.final_report_submitted_at ? "in_progress" : "not_started",
      outstanding: closed
        ? null
        : incident.final_report_submitted_at ? "Close the incident." : "Record the final report submission.",
      prerequisites: ["administrator_approval"],
      responsibleRole: "Administrator",
      blocksClosure: false,
    },
  ];

  // A stage whose prerequisites are unmet and which has not itself started reports `waiting`, so the
  // page shows one clear next action instead of eleven simultaneous demands.
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  for (const stage of stages) {
    if (stage.status !== "not_started") continue;
    const blocked = stage.prerequisites.some((key) => {
      const prior = byKey.get(key);
      return prior !== undefined && prior.status !== "complete" && prior.status !== "not_applicable";
    });
    if (blocked) stage.status = "waiting";
  }

  return stages;
}

export interface IncidentFollowThroughState {
  stages: IncidentStage[];
  /** Stages that must be complete before closure and are not. */
  blockingClosure: IncidentStage[];
  canClose: boolean;
  /** The single stage a person should act on next, or null when nothing is outstanding. */
  nextAction: IncidentStage | null;
  completedCount: number;
  applicableCount: number;
  overdueCount: number;
}

export function buildIncidentFollowThrough(input: IncidentStageInput): IncidentFollowThroughState {
  const stages = buildIncidentStages(input);
  const applicable = stages.filter((stage) => stage.status !== "not_applicable");
  const blockingClosure = stages.filter(
    (stage) => stage.blocksClosure && stage.status !== "complete" && stage.status !== "not_applicable",
  );
  const nextAction = stages.find(
    (stage) => stage.status === "overdue",
  ) ?? stages.find(
    (stage) => stage.status === "in_progress" || stage.status === "not_started",
  ) ?? null;

  return {
    stages,
    blockingClosure,
    canClose: blockingClosure.length === 0 && Boolean(input.incident.final_report_submitted_at),
    nextAction,
    completedCount: applicable.filter((stage) => stage.status === "complete").length,
    applicableCount: applicable.length,
    overdueCount: stages.filter((stage) => stage.status === "overdue").length,
  };
}

export const INCIDENT_STAGE_STATUS_LABELS: Record<IncidentStageStatus, string> = {
  complete: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
  not_applicable: "Not required",
  waiting: "Waiting on earlier work",
  overdue: "Overdue",
};

export const REPORTABILITY_STATUS_LABELS: Record<ReportabilityStatus, string> = {
  pending_review: "Determination pending",
  reportable: "Reportable",
  not_reportable: "Not reportable",
};

export const ROOT_CAUSE_METHODS = [
  { value: "five_whys", label: "Five whys" },
  { value: "fishbone", label: "Cause-and-effect (fishbone)" },
  { value: "timeline", label: "Timeline reconstruction" },
  { value: "process_review", label: "Process review" },
] as const;
