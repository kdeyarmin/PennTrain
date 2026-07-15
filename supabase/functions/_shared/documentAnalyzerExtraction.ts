// Shared contract between the analyze-state-form worker and its tests: the forced tool
// schema the extraction model must call, defensive validation of whatever the model
// returns, and the review-routing decision. The model's output is never trusted directly
// -- every field is re-validated and length-capped here before it reaches the job row,
// and nothing the model returns can mark a form approved: approval is a separate
// human-only RPC.

export const EXTRACTION_TOOL_NAME = "emit_state_form_extraction";

// Current-template labels the extraction should map a historical form onto. Mirrors the
// labels in artifacts/caremetric-carebase/src/lib/residentCompliance.ts (a Deno edge
// function cannot import from the frontend package -- keep in sync).
export const CURRENT_STATE_FORM_TEMPLATES = [
  "RASP (Resident Assessment-Support Plan)",
  "ASP (Assessment-Support Plan)",
  "Preadmission Screening",
  "DME (Documentation of Medical Evaluation)",
  "Unknown / other historical form",
] as const;

export const EXTRACTION_ISSUE_FIELDS = [
  "resident_name",
  "facility_name",
  "state_form_template",
  "review_due_date",
  "admission_date",
  "notes",
  "document",
] as const;

export const EXTRACTION_TOOL_SCHEMA = {
  type: "object",
  properties: {
    resident_name: {
      type: "string",
      description: "The resident's full name exactly as written on the form. Empty string if not present or illegible.",
    },
    facility_name: {
      type: "string",
      description: "The facility name exactly as written on the form. Empty string if not present or illegible.",
    },
    state_form_template: {
      type: "string",
      description: `The current template this historical form corresponds to. One of: ${CURRENT_STATE_FORM_TEMPLATES.join("; ")}.`,
    },
    review_due_date: {
      type: "string",
      description: "The review/reassessment due date exactly as written on the form (any format). Empty string if not present.",
    },
    admission_date: {
      type: "string",
      description: "The admission date in YYYY-MM-DD format if it is clearly legible on the form; otherwise an empty string. Never guess.",
    },
    page_count: {
      type: "integer",
      description: "The number of pages in the document.",
    },
    confidence: {
      type: "integer",
      description: "Overall transcription confidence from 0 to 100, considering scan quality and handwriting legibility.",
    },
    notes: {
      type: "string",
      description: "A faithful transcription of the handwritten notes, corrections, and free-text answers on the form. Mark illegible passages as [illegible]. Do not summarize or paraphrase.",
    },
    issues: {
      type: "array",
      description: "One entry per field that a human reviewer must verify: illegible or ambiguous handwriting, missing required information, stale dates, or internal contradictions. Empty array only when nothing needs verification.",
      items: {
        type: "object",
        properties: {
          field: {
            type: "string",
            description: `Which draft field the issue concerns. One of: ${EXTRACTION_ISSUE_FIELDS.join(", ")}.`,
          },
          message: { type: "string", description: "What the reviewer should check and why." },
          suggested_value: {
            type: "string",
            description: "A suggested replacement value for the field, only when one is directly supported by the document. Empty string otherwise.",
          },
          severity: { type: "string", enum: ["warning", "info"] },
        },
        required: ["field", "message", "severity"],
      },
    },
    grounding_checklist: {
      type: "object",
      description: "Mandatory self-check that every extracted value is grounded in the document.",
      properties: {
        only_transcribed_visible_content: { type: "boolean" },
        flagged_all_uncertain_fields: { type: "boolean" },
        no_invented_values: { type: "boolean" },
      },
      required: [
        "only_transcribed_visible_content",
        "flagged_all_uncertain_fields",
        "no_invented_values",
      ],
    },
  },
  required: [
    "resident_name",
    "facility_name",
    "state_form_template",
    "review_due_date",
    "admission_date",
    "page_count",
    "confidence",
    "notes",
    "issues",
    "grounding_checklist",
  ],
};

export interface ExtractionIssue {
  field: string;
  message: string;
  suggested_value: string | null;
  severity: "warning" | "info";
}

export interface GroundingChecklist {
  only_transcribed_visible_content: boolean;
  flagged_all_uncertain_fields: boolean;
  no_invented_values: boolean;
}

export interface StateFormExtraction {
  resident_name: string;
  facility_name: string;
  state_form_template: string;
  review_due_date: string;
  /** YYYY-MM-DD, or null when absent/illegible/malformed. */
  admission_date: string | null;
  page_count: number | null;
  confidence: number;
  notes: string;
  issues: ExtractionIssue[];
  grounding_checklist: GroundingChecklist;
}

const MAX_ISSUES = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The regex alone admits calendar-impossible strings ("2026-02-30") that Postgres would
// reject when the finish RPC casts to date -- deterministically failing every retry.
function isRealCalendarDate(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLength);
}

function cleanInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/**
 * Validates the model's tool input into a safe, length-capped extraction. Returns null
 * when the payload is structurally unusable (the worker records a retryable failure);
 * recoverable oddities (bad date format, out-of-range page count, unknown issue fields)
 * degrade to null/trimmed values instead of failing the whole extraction.
 */
export function validateExtractionInput(input: unknown): StateFormExtraction | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;

  const residentName = cleanString(raw.resident_name, 300);
  const facilityName = cleanString(raw.facility_name, 300);
  const stateFormTemplate = cleanString(raw.state_form_template, 300);
  const reviewDueDate = cleanString(raw.review_due_date, 100);
  const notes = cleanString(raw.notes, 20_000);
  const confidence = cleanInteger(raw.confidence, 0, 100);
  if (
    residentName === null || facilityName === null || stateFormTemplate === null
    || reviewDueDate === null || notes === null || confidence === null
  ) {
    return null;
  }

  const checklistRaw = raw.grounding_checklist as Partial<GroundingChecklist> | null | undefined;
  if (
    typeof checklistRaw !== "object" || checklistRaw === null
    || typeof checklistRaw.only_transcribed_visible_content !== "boolean"
    || typeof checklistRaw.flagged_all_uncertain_fields !== "boolean"
    || typeof checklistRaw.no_invented_values !== "boolean"
  ) {
    return null;
  }

  if (!Array.isArray(raw.issues)) return null;
  const issues: ExtractionIssue[] = [];
  for (const item of raw.issues.slice(0, MAX_ISSUES)) {
    if (typeof item !== "object" || item === null) continue;
    const issue = item as Record<string, unknown>;
    const field = cleanString(issue.field, 60);
    const message = cleanString(issue.message, 500);
    if (!field || !message) continue;
    const suggested = cleanString(issue.suggested_value, 2_000);
    issues.push({
      field,
      message,
      suggested_value: suggested ? suggested : null,
      severity: issue.severity === "info" ? "info" : "warning",
    });
  }

  const admissionRaw = cleanString(raw.admission_date, 10) ?? "";
  const admissionDate = ISO_DATE.test(admissionRaw) && isRealCalendarDate(admissionRaw)
    ? admissionRaw
    : null;

  return {
    resident_name: residentName,
    facility_name: facilityName,
    state_form_template: stateFormTemplate,
    review_due_date: reviewDueDate,
    admission_date: admissionDate,
    page_count: cleanInteger(raw.page_count, 1, 600),
    confidence,
    notes,
    issues,
    grounding_checklist: {
      only_transcribed_visible_content: checklistRaw.only_transcribed_visible_content,
      flagged_all_uncertain_fields: checklistRaw.flagged_all_uncertain_fields,
      no_invented_values: checklistRaw.no_invented_values,
    },
  };
}

export const READY_CONFIDENCE_THRESHOLD = 90;

/**
 * Routes a validated extraction to "ready" or "needs_review". A form is ready only when
 * the model reported high confidence, raised no reviewer issues, passed its own grounding
 * checklist, and every field required for approval is present. Either way a human must
 * still approve before export -- this only decides which queue lane the row lands in.
 */
export function decideExtractionStatus(extraction: StateFormExtraction): "ready" | "needs_review" {
  const checklist = extraction.grounding_checklist;
  const grounded = checklist.only_transcribed_visible_content
    && checklist.flagged_all_uncertain_fields
    && checklist.no_invented_values;
  const complete = extraction.resident_name.length > 0
    && extraction.facility_name.length > 0
    && extraction.state_form_template.length > 0
    && extraction.review_due_date.length > 0;
  if (grounded && complete && extraction.issues.length === 0
    && extraction.confidence >= READY_CONFIDENCE_THRESHOLD) {
    return "ready";
  }
  return "needs_review";
}
