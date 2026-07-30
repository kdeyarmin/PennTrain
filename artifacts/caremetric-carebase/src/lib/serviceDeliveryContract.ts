/**
 * Service delivery contract (program plan Phase 3c).
 *
 * A support-plan intervention becomes a thing staff actually do only once it says HOW it is done:
 * what kind of task it is, who is qualified to do it, what counts as completing it, what to do when
 * the resident refuses, and when to escalate. `resident_service_requirements` already carried
 * frequency, time window, role, two-staff, and documentation mode; this module owns the vocabulary
 * for the rest, so the seeds, the RPC, and the UI cannot drift apart.
 *
 * The completion responses here are the same seven the request names for exception-based
 * documentation. They are defined now, with the requirement that owns them, so that the floor phase
 * wires an existing vocabulary into the task instance rather than inventing a second one.
 */

export type ServiceTaskKind =
  | "scheduled_care"
  | "shift_task"
  | "weekly_task"
  | "as_needed"
  | "observation"
  | "manager_review"
  | "documentation_requirement";

export const SERVICE_TASK_KINDS: ServiceTaskKind[] = [
  "scheduled_care",
  "shift_task",
  "weekly_task",
  "as_needed",
  "observation",
  "manager_review",
  "documentation_requirement",
];

export const SERVICE_TASK_KIND_LABELS: Record<ServiceTaskKind, string> = {
  scheduled_care: "Scheduled care",
  shift_task: "Shift task",
  weekly_task: "Weekly task",
  as_needed: "As needed",
  observation: "Observation",
  manager_review: "Manager review",
  documentation_requirement: "Documentation requirement",
};

export const SERVICE_TASK_KIND_DESCRIPTIONS: Record<ServiceTaskKind, string> = {
  scheduled_care: "Hands-on care due in a specific time window.",
  shift_task: "Done once per shift, any time within it.",
  weekly_task: "Done once in the week, not tied to a shift.",
  as_needed: "No due window; recorded when it happens.",
  observation: "Watch and record; no care is delivered.",
  manager_review: "A manager reviews something, not a floor task.",
  documentation_requirement: "Paperwork the plan requires, with no care attached.",
};

/**
 * Task kinds that have no due window, so a missed-window alert would be meaningless for them.
 * Scheduling and the floor queue both need to know this before generating instances.
 */
export function taskKindHasDueWindow(kind: string): boolean {
  return kind === "scheduled_care" || kind === "shift_task" || kind === "weekly_task";
}

/** Kinds a direct-care employee performs, as opposed to work that belongs to a manager. */
export function isFloorTaskKind(kind: string): boolean {
  return ["scheduled_care", "shift_task", "weekly_task", "as_needed", "observation"].includes(kind);
}

export type CompletionResponse =
  | "completed_as_planned"
  | "completed_with_more_assistance"
  | "partially_completed"
  | "resident_refused"
  | "resident_unavailable"
  | "not_completed"
  | "concern_observed";

export const COMPLETION_RESPONSES: CompletionResponse[] = [
  "completed_as_planned",
  "completed_with_more_assistance",
  "partially_completed",
  "resident_refused",
  "resident_unavailable",
  "not_completed",
  "concern_observed",
];

export const COMPLETION_RESPONSE_LABELS: Record<CompletionResponse, string> = {
  completed_as_planned: "Completed as planned",
  completed_with_more_assistance: "Completed with more assistance",
  partially_completed: "Partially completed",
  resident_refused: "Resident refused",
  resident_unavailable: "Resident unavailable",
  not_completed: "Not completed",
  concern_observed: "Concern observed",
};

/**
 * The manager workspace originally wrote the task status directly while Floor wrote the structured
 * completion response. Accept both vocabularies at the shared boundary so every surface reaches the
 * same server-side response RPC and therefore the same Needs Attention and change-detection logic.
 */
export function completionResponseForServiceOutcome(outcome: string): CompletionResponse {
  if ((COMPLETION_RESPONSES as string[]).includes(outcome)) return outcome as CompletionResponse;
  switch (outcome) {
    case "completed":
    case "completed_late":
    case "completed_by_other":
      return "completed_as_planned";
    case "resident_refused":
      return "resident_refused";
    case "resident_unavailable":
      return "resident_unavailable";
    case "not_completed":
      return "not_completed";
    default:
      throw new Error(`Unsupported service outcome: ${outcome}`);
  }
}

/**
 * Responses that are exceptions: the ones that require follow-up documentation and that feed the
 * change detector. "Completed as planned" is the only response that closes a task with nothing more
 * to say -- which is the whole point of exception-based documentation.
 */
const EXCEPTION_RESPONSES = new Set<string>([
  "completed_with_more_assistance",
  "partially_completed",
  "resident_refused",
  "resident_unavailable",
  "not_completed",
  "concern_observed",
]);

export function isExceptionResponse(response: string): boolean {
  return EXCEPTION_RESPONSES.has(response);
}

/** The default response set: everything, since any service can hit any of these outcomes. */
export const DEFAULT_COMPLETION_RESPONSES: CompletionResponse[] = [...COMPLETION_RESPONSES];

/**
 * Observation and documentation tasks cannot be "refused" by a resident in the way care can, and
 * offering that response invites staff to record something that did not happen. Narrow the set for
 * those kinds rather than presenting all seven everywhere.
 */
export function defaultResponsesForKind(kind: string): CompletionResponse[] {
  if (kind === "manager_review" || kind === "documentation_requirement") {
    return ["completed_as_planned", "partially_completed", "not_completed"];
  }
  if (kind === "observation") {
    return ["completed_as_planned", "resident_unavailable", "not_completed", "concern_observed"];
  }
  return DEFAULT_COMPLETION_RESPONSES;
}

export interface ServiceDeliveryContract {
  taskKind: string;
  requiredQualificationKey: string | null;
  acceptableCompletionResponses: string[];
  refusalHandling: string | null;
  escalationConditions: string | null;
  escalateAfterExceptions: number | null;
  effectiveFrom: string;
  expiresOn: string | null;
}

export type ContractIssueKind =
  | "unknown_task_kind"
  | "unknown_response"
  | "empty_responses"
  | "missing_refusal_handling"
  | "invalid_qualification_key"
  | "invalid_escalation_threshold"
  | "end_before_start";

export interface ContractIssue {
  kind: ContractIssueKind;
  message: string;
}

/** Same shape certification_definitions.qualification_key enforces. */
const QUALIFICATION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,99}$/;

/**
 * Validates a delivery contract. Mirrors the check constraints on
 * `resident_service_requirements` -- the server is the authority; this exists so the UI can say
 * what is wrong before the write fails.
 */
export function validateServiceDeliveryContract(contract: ServiceDeliveryContract): ContractIssue[] {
  const issues: ContractIssue[] = [];

  if (!(SERVICE_TASK_KINDS as string[]).includes(contract.taskKind)) {
    issues.push({ kind: "unknown_task_kind", message: `"${contract.taskKind}" is not a recognized task kind.` });
  }

  if (contract.acceptableCompletionResponses.length === 0) {
    issues.push({
      kind: "empty_responses",
      message: "A service with no acceptable completion responses can never be closed by staff.",
    });
  }
  for (const response of contract.acceptableCompletionResponses) {
    if (!(COMPLETION_RESPONSES as string[]).includes(response)) {
      issues.push({ kind: "unknown_response", message: `"${response}" is not a recognized completion response.` });
      break;
    }
  }

  // If refusal is an allowed outcome, the plan has to say what happens next. "Resident refused" with
  // no instruction leaves the aide to invent one at the bedside.
  if (contract.acceptableCompletionResponses.includes("resident_refused")
    && !contract.refusalHandling?.trim()) {
    issues.push({
      kind: "missing_refusal_handling",
      message: "This service allows a refusal but does not say what staff should do when one happens.",
    });
  }

  if (contract.requiredQualificationKey !== null
    && !QUALIFICATION_KEY_PATTERN.test(contract.requiredQualificationKey)) {
    issues.push({
      kind: "invalid_qualification_key",
      message: `"${contract.requiredQualificationKey}" is not a valid qualification key.`,
    });
  }

  if (contract.escalateAfterExceptions !== null
    && (!Number.isInteger(contract.escalateAfterExceptions)
      || contract.escalateAfterExceptions < 1
      || contract.escalateAfterExceptions > 50)) {
    issues.push({
      kind: "invalid_escalation_threshold",
      message: "The escalation threshold must be a whole number between 1 and 50.",
    });
  }

  if (contract.expiresOn && contract.expiresOn < contract.effectiveFrom) {
    issues.push({ kind: "end_before_start", message: "The end date is before the effective date." });
  }

  return issues;
}

export function isServiceDeliveryContractValid(contract: ServiceDeliveryContract): boolean {
  return validateServiceDeliveryContract(contract).length === 0;
}

/** One-line summary of a contract for a service row. */
export function describeServiceDeliveryContract(contract: ServiceDeliveryContract): string {
  const parts: string[] = [
    SERVICE_TASK_KIND_LABELS[contract.taskKind as ServiceTaskKind] ?? contract.taskKind,
  ];
  if (contract.requiredQualificationKey) parts.push(`requires ${contract.requiredQualificationKey}`);
  if (contract.escalateAfterExceptions) parts.push(`escalates after ${contract.escalateAfterExceptions} exceptions`);
  if (contract.expiresOn) parts.push(`ends ${contract.expiresOn}`);
  return parts.join(" · ");
}
