/**
 * Exception-based documentation follow-ups (program plan Phase 4b).
 *
 * Routine care documentation should be one tap. Only exceptions ask for more, and what they ask has
 * to be worth the interruption: every question here exists because a downstream consumer needs the
 * answer, not because a form felt incomplete.
 *
 *   - "Temporary or ongoing" and "what level was required" are what turn a pile of exceptions into
 *     the `documented_assistance_exceeds_plan` conflict (Phase 3b) instead of a free-text note
 *     nobody can aggregate.
 *   - "Was a supervisor notified" is the notification evidence a surveyor asks for by name.
 *   - "Should a change-of-condition report be created" hands to the existing structured
 *     change-of-condition workflow rather than starting a parallel one.
 *
 * The response vocabulary is `serviceDeliveryContract.ts`'s, defined with the requirement that owns
 * it. This module owns only what happens *after* a response is chosen.
 */
import {
  COMPLETION_RESPONSE_LABELS, isExceptionResponse, type CompletionResponse,
} from "./serviceDeliveryContract";

export type FollowUpFieldType = "single_select" | "boolean" | "long_text";

export interface FollowUpOption {
  value: string;
  label: string;
}

export interface FollowUpField {
  key: string;
  label: string;
  type: FollowUpFieldType;
  options?: FollowUpOption[];
  required?: boolean;
  helper?: string;
}

/** Assistance levels share the care header's transfer vocabulary so the two can be compared. */
const ASSISTANCE_LEVEL_OPTIONS: FollowUpOption[] = [
  { value: "supervision", label: "Supervision" },
  { value: "one_person", label: "One-person assist" },
  { value: "two_person", label: "Two-person assist" },
  { value: "mechanical_lift", label: "Mechanical lift" },
];

const PERSISTENCE_OPTIONS: FollowUpOption[] = [
  { value: "temporary", label: "Temporary — one-off today" },
  { value: "ongoing", label: "Ongoing — expect it again" },
];

const SUPERVISOR_FIELD: FollowUpField = {
  key: "supervisor_notified",
  label: "Supervisor notified",
  type: "boolean",
};

const CHANGE_OF_CONDITION_FIELD: FollowUpField = {
  key: "change_of_condition_suggested",
  label: "Should a change-of-condition report be started?",
  type: "boolean",
  helper: "Opens the change-of-condition form with this task attached.",
};

/**
 * Follow-up questions per response. `completed_as_planned` deliberately has none: if the routine
 * path costs more than one tap, staff will pick it for everything and the exception data becomes
 * worthless.
 */
const FOLLOW_UPS: Record<CompletionResponse, FollowUpField[]> = {
  completed_as_planned: [],
  completed_with_more_assistance: [
    {
      key: "assistance_level",
      label: "What level of help was actually needed?",
      type: "single_select",
      options: ASSISTANCE_LEVEL_OPTIONS,
      required: true,
    },
    {
      key: "persistence",
      label: "Temporary or ongoing?",
      type: "single_select",
      options: PERSISTENCE_OPTIONS,
      required: true,
    },
    SUPERVISOR_FIELD,
    CHANGE_OF_CONDITION_FIELD,
  ],
  partially_completed: [
    { key: "what_was_done", label: "What was completed", type: "long_text", required: true },
    { key: "what_remains", label: "What still needs doing", type: "long_text", required: true },
    SUPERVISOR_FIELD,
  ],
  resident_refused: [
    { key: "refusal_words", label: "What the resident said or did", type: "long_text", required: true },
    {
      key: "reoffered",
      label: "Was it offered again?",
      type: "boolean",
      helper: "A single refusal is a moment; a refused re-offer is a pattern.",
    },
    SUPERVISOR_FIELD,
    CHANGE_OF_CONDITION_FIELD,
  ],
  resident_unavailable: [
    {
      key: "reason",
      label: "Where was the resident?",
      type: "single_select",
      options: [
        { value: "appointment", label: "At an appointment" },
        { value: "with_visitor", label: "With a visitor" },
        { value: "activity", label: "At an activity" },
        { value: "out_of_facility", label: "Out of the facility" },
        { value: "not_found", label: "Could not be located" },
      ],
      required: true,
    },
    {
      key: "rescheduled",
      label: "Was the service rescheduled?",
      type: "boolean",
    },
  ],
  not_completed: [
    { key: "reason", label: "Why it was not done", type: "long_text", required: true },
    SUPERVISOR_FIELD,
  ],
  concern_observed: [
    { key: "concern", label: "What you observed", type: "long_text", required: true },
    SUPERVISOR_FIELD,
    CHANGE_OF_CONDITION_FIELD,
  ],
};

export function followUpFieldsFor(response: string): FollowUpField[] {
  return FOLLOW_UPS[response as CompletionResponse] ?? [];
}

export function responseRequiresFollowUp(response: string): boolean {
  return followUpFieldsFor(response).some((field) => field.required);
}

export type FollowUpAnswers = Record<string, unknown>;

export interface FollowUpIssue {
  fieldKey: string;
  message: string;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export function validateFollowUp(response: string, answers: FollowUpAnswers): FollowUpIssue[] {
  const issues: FollowUpIssue[] = [];
  for (const field of followUpFieldsFor(response)) {
    const value = answers[field.key];
    if (field.required && isBlank(value)) {
      issues.push({ fieldKey: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (isBlank(value)) continue;
    if (field.type === "single_select" && field.options) {
      const allowed = new Set(field.options.map((option) => option.value));
      if (typeof value !== "string" || !allowed.has(value)) {
        issues.push({ fieldKey: field.key, message: `${field.label} has an unrecognized value.` });
      }
    }
  }
  return issues;
}

/**
 * Whether this documentation should offer to start a change-of-condition report. Only the responses
 * that carry that question can suggest it, and only when the person answered yes -- the app never
 * decides on its own that a resident's condition changed.
 */
export function suggestsChangeOfCondition(response: string, answers: FollowUpAnswers): boolean {
  const hasField = followUpFieldsFor(response).some((field) => field.key === "change_of_condition_suggested");
  return hasField && answers.change_of_condition_suggested === true;
}

export function supervisorWasNotified(answers: FollowUpAnswers): boolean {
  return answers.supervisor_notified === true;
}

/**
 * The assistance level this documentation evidences, if any. Read by the conflict detector, which
 * compares it against the level the plan describes.
 */
export function documentedAssistanceLevel(response: string, answers: FollowUpAnswers): string | null {
  if (response !== "completed_with_more_assistance") return null;
  const level = answers.assistance_level;
  return typeof level === "string" && level ? level : null;
}

/** One-line summary of an exception for a task row or a shift handoff. */
export function summarizeException(response: string, answers: FollowUpAnswers): string {
  if (!isExceptionResponse(response)) {
    return COMPLETION_RESPONSE_LABELS[response as CompletionResponse] ?? response;
  }
  const label = COMPLETION_RESPONSE_LABELS[response as CompletionResponse] ?? response;
  const parts: string[] = [label];
  const level = documentedAssistanceLevel(response, answers);
  if (level) parts.push(level.replace(/_/g, " "));
  if (answers.persistence === "ongoing") parts.push("ongoing");
  if (supervisorWasNotified(answers)) parts.push("supervisor notified");
  return parts.join(" · ");
}

/**
 * Task status to record alongside the response. The status enum drives scheduling and alerting and
 * is deliberately left alone; `completion_response` is the documentation axis. Responses where care
 * was delivered map to `completed` even when they carry an exception, because the task did happen --
 * treating "completed with more assistance" as not-completed would understate delivery and overstate
 * missed care.
 */
export function taskStatusForResponse(response: string): string {
  switch (response) {
    case "resident_refused": return "resident_refused";
    case "resident_unavailable": return "resident_unavailable";
    case "not_completed": return "not_completed";
    default: return "completed";
  }
}
