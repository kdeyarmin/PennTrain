/**
 * Governed assessment templates (program plan Phase 2b).
 *
 * SCOPE DECISION. `residentAssessmentFormSchema.ts` is a faithful, tested model of the DHS RASP/ASP
 * form that drives the editor, the prefill tools, and PDF generation. Rewriting it into a generic
 * template engine would risk the one state-form workflow that already works, for no gain: its shape
 * is dictated by the DHS form, not by us. So this module sits ALONGSIDE it.
 *
 * Templates come in two kinds, and the split is a real distinction rather than an accident:
 *
 *   - `state_form_backed` -- initial, annual, significant-change, and support plan. These ARE the
 *     RASP/ASP. The template records their governance (citation, required participation, signature
 *     rules, effective dates) and defers their content to residentAssessmentFormSchema.
 *   - `internal_review` -- pre-admission, hospital return, cognitive/behavioral, mobility/fall,
 *     nutritional, and continence. No DHS form prescribes these; they are the facility's own
 *     clinical reviews. They define their own typed fields here.
 *
 * WHY TYPED FIELDS MATTER. Phase 3's field-level conflict detection has to compare an assessment
 * answer against the care header and the support plan ("assessment says two-person transfer; plan
 * says one-person assistance"). That is only computable if the answer lives at a stable, enumerated
 * key whose values share a vocabulary with the care header. `comparesTo` below is that link, and its
 * option values deliberately match the coded values in residentCareHeader.ts.
 *
 * WHAT THIS DOES NOT CHANGE. A digital form is still a drafting and reference aid.
 * `complete_resident_compliance_item()` requires a signed DHS-prescribed document before a
 * compliance item can be marked compliant, and nothing here weakens that. Templates that stand in
 * for a state form say so in `stateFormNotice`.
 */
import type { FacilityType } from "./facilityTypes";
import { findCitation, type PaRegulatoryCitation } from "./paRegulatoryCitations";

export type TemplateKey =
  | "initial_assessment"
  | "annual_assessment"
  | "significant_change_assessment"
  | "support_plan"
  | "preadmission_assessment"
  | "hospital_return_review"
  | "cognitive_behavioral_review"
  | "mobility_fall_review"
  | "nutritional_review"
  | "continence_review";

export type TemplateKind = "state_form_backed" | "internal_review";

export type TemplateFieldType =
  | "single_select"
  | "multi_select"
  | "text"
  | "long_text"
  | "date"
  | "number"
  | "boolean";

/**
 * Care attributes an assessment answer can be compared against. Values map onto the coded fields in
 * residentCareHeader.ts so Phase 3 can compare without a translation layer.
 */
export type ComparableCareAttribute =
  | "level_of_care"
  | "transfer_assistance"
  | "ambulation_status"
  | "fall_risk"
  | "elopement_risk"
  | "cognitive_status"
  | "diet_texture";

export interface TemplateFieldOption {
  value: string;
  label: string;
}

/** A field is asked only when its condition holds. Absent condition means always asked. */
export interface TemplateFieldCondition {
  /** Key of another field in the same template. */
  field: string;
  /** Asked when the referenced field's answer is one of these values. */
  equals?: string[];
  /** Asked when the referenced boolean field is true. */
  isTrue?: boolean;
}

export interface TemplateField {
  /** Stable, addressable key. Never renamed -- stored answers and conflict rules both key on it. */
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: TemplateFieldOption[];
  required?: boolean;
  when?: TemplateFieldCondition;
  /** Inline PA guidance shown next to the field. */
  guidance?: string;
  /** Section number in paRegulatoryCitations, when one governs this field. */
  citation?: string;
  /** Care attribute this answer can be compared against (Phase 3). */
  comparesTo?: ComparableCareAttribute;
  min?: number;
  max?: number;
  unit?: string;
}

export interface TemplateSection {
  key: string;
  title: string;
  description?: string;
  fields: TemplateField[];
}

export interface TemplateSignatureRules {
  assessorSignatureRequired: boolean;
  /** The resident or their designated person must be offered participation. */
  residentParticipationRequired: boolean;
  /** A second reviewer must sign before the record is final. */
  clinicalReviewRequired: boolean;
  note?: string;
}

export interface AssessmentTemplate {
  key: TemplateKey;
  kind: TemplateKind;
  title: string;
  purpose: string;
  facilityTypes: FacilityType[];
  version: number;
  effectiveFrom: string;
  /** Section governing this instrument, when one does. */
  citation?: string;
  /** Copy shown when a DHS-prescribed form, not this record, is what satisfies the requirement. */
  stateFormNotice?: string;
  signature: TemplateSignatureRules;
  sections: TemplateSection[];
}

// ---------------------------------------------------------------------------
// Shared option vocabularies
// ---------------------------------------------------------------------------
// These deliberately mirror the coded values in residentCareHeader.ts. A test asserts they stay in
// step; drifting apart would silently break every conflict rule that compares the two.

const TRANSFER_OPTIONS: TemplateFieldOption[] = [
  { value: "independent", label: "Independent" },
  { value: "supervision", label: "Supervision" },
  { value: "one_person", label: "One-person assist" },
  { value: "two_person", label: "Two-person assist" },
  { value: "mechanical_lift", label: "Mechanical lift" },
];

const AMBULATION_OPTIONS: TemplateFieldOption[] = [
  { value: "independent", label: "Independent" },
  { value: "cane", label: "Cane" },
  { value: "walker", label: "Walker" },
  { value: "rollator", label: "Rollator" },
  { value: "wheelchair", label: "Wheelchair" },
  { value: "bedfast", label: "Bedfast" },
];

const RISK_OPTIONS: TemplateFieldOption[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
];

const ELOPEMENT_OPTIONS: TemplateFieldOption[] = [
  { value: "none", label: "None" },
  { value: "monitored", label: "Monitored" },
  { value: "high", label: "High" },
];

const COGNITIVE_OPTIONS: TemplateFieldOption[] = [
  { value: "no_impairment", label: "No impairment" },
  { value: "mild_impairment", label: "Mild impairment" },
  { value: "moderate_impairment", label: "Moderate impairment" },
  { value: "severe_impairment", label: "Severe impairment" },
];

const TEXTURE_OPTIONS: TemplateFieldOption[] = [
  { value: "regular", label: "Regular" },
  { value: "soft_and_bite_sized", label: "Soft & bite-sized" },
  { value: "minced_and_moist", label: "Minced & moist" },
  { value: "pureed", label: "Pureed" },
  { value: "liquidized", label: "Liquidized" },
  { value: "other", label: "Other" },
];

const YES_NO_UNKNOWN: TemplateFieldOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

const PCH_AND_ALF: FacilityType[] = ["PCH", "ALR"];

const STATE_FORM_NOTICE =
  "Preparing this record does not satisfy the requirement on its own. Attach the signed "
  + "DHS-prescribed form to the compliance item to complete it.";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const STATE_FORM_TEMPLATES: AssessmentTemplate[] = [
  {
    key: "initial_assessment",
    kind: "state_form_backed",
    title: "Initial assessment",
    purpose: "First full assessment of the resident's needs after (PCH) or before (ALF) admission.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    citation: "2600.225",
    stateFormNotice: STATE_FORM_NOTICE,
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: true,
      clinicalReviewRequired: false,
      note: "Content is captured on the RASP/ASP form itself.",
    },
    sections: [],
  },
  {
    key: "annual_assessment",
    kind: "state_form_backed",
    title: "Annual assessment",
    purpose: "Yearly reassessment of the resident's needs.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    citation: "2600.225",
    stateFormNotice: STATE_FORM_NOTICE,
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: true,
      clinicalReviewRequired: false,
    },
    sections: [],
  },
  {
    key: "significant_change_assessment",
    kind: "state_form_backed",
    title: "Significant-change assessment",
    purpose: "Reassessment triggered by a significant change in the resident's condition.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    citation: "2600.225",
    stateFormNotice: STATE_FORM_NOTICE,
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: true,
      clinicalReviewRequired: false,
    },
    sections: [],
  },
  {
    key: "support_plan",
    kind: "state_form_backed",
    title: "Support plan (RASP/ASP)",
    purpose: "The plan of services derived from the assessment.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    citation: "2600.227",
    stateFormNotice: STATE_FORM_NOTICE,
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: true,
      clinicalReviewRequired: true,
    },
    sections: [],
  },
];

const INTERNAL_REVIEW_TEMPLATES: AssessmentTemplate[] = [
  {
    key: "preadmission_assessment",
    kind: "internal_review",
    title: "Pre-admission assessment",
    purpose: "Confirms the facility can meet the prospective resident's needs before admission.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    citation: "2600.224",
    stateFormNotice:
      "The DHS Preadmission Screening form is what satisfies the requirement. This review records "
      + "the facility's own admission decision alongside it.",
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: false,
      clinicalReviewRequired: true,
    },
    sections: [
      {
        key: "needs",
        title: "Presenting needs",
        fields: [
          {
            key: "transfer_assistance",
            label: "Transfer assistance required",
            type: "single_select",
            options: TRANSFER_OPTIONS,
            required: true,
            comparesTo: "transfer_assistance",
            guidance: "Record what the person needs today, not what the facility is staffed to give.",
          },
          {
            key: "ambulation_status",
            label: "Mobility",
            type: "single_select",
            options: AMBULATION_OPTIONS,
            required: true,
            comparesTo: "ambulation_status",
          },
          {
            key: "cognitive_status",
            label: "Cognitive status",
            type: "single_select",
            options: COGNITIVE_OPTIONS,
            required: true,
            comparesTo: "cognitive_status",
          },
          {
            key: "elopement_risk",
            label: "Elopement risk",
            type: "single_select",
            options: ELOPEMENT_OPTIONS,
            required: true,
            comparesTo: "elopement_risk",
          },
          {
            key: "secured_unit_indicated",
            label: "Is a secured dementia unit indicated?",
            type: "boolean",
            when: { field: "elopement_risk", equals: ["monitored", "high"] },
            guidance: "Asked because an elopement risk was recorded above.",
          },
        ],
      },
      {
        key: "decision",
        title: "Admission decision",
        fields: [
          {
            key: "can_meet_needs",
            label: "Can the facility meet these needs?",
            type: "single_select",
            options: YES_NO_UNKNOWN,
            required: true,
            citation: "2600.224",
          },
          {
            key: "unmet_needs_detail",
            label: "Which needs cannot be met, and why",
            type: "long_text",
            required: true,
            when: { field: "can_meet_needs", equals: ["no", "unknown"] },
            guidance: "A documented reason is what makes a declined admission defensible.",
          },
        ],
      },
    ],
  },
  {
    key: "hospital_return_review",
    kind: "internal_review",
    title: "Hospital-return review",
    purpose: "Reconciles what changed during a hospital stay before the resident resumes their plan.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    signature: {
      assessorSignatureRequired: true,
      residentParticipationRequired: false,
      clinicalReviewRequired: true,
    },
    sections: [
      {
        key: "paperwork",
        title: "Discharge information",
        fields: [
          { key: "discharge_paperwork_received", label: "Discharge paperwork received", type: "boolean", required: true },
          {
            key: "discharge_paperwork_missing_detail",
            label: "What is missing, and who is chasing it",
            type: "long_text",
            required: true,
            when: { field: "discharge_paperwork_received", isTrue: false },
          },
          { key: "new_diagnoses", label: "New diagnoses", type: "long_text" },
          { key: "new_restrictions", label: "New restrictions", type: "long_text" },
        ],
      },
      {
        key: "changes",
        title: "Changes to care",
        fields: [
          { key: "medication_changes_reviewed", label: "Medication changes reviewed", type: "boolean", required: true },
          {
            key: "diet_texture",
            label: "Diet texture on return",
            type: "single_select",
            options: TEXTURE_OPTIONS,
            required: true,
            comparesTo: "diet_texture",
            guidance: "A texture change that never reaches the dietary profile is a choking risk.",
          },
          {
            key: "transfer_assistance",
            label: "Transfer assistance on return",
            type: "single_select",
            options: TRANSFER_OPTIONS,
            required: true,
            comparesTo: "transfer_assistance",
          },
          {
            key: "fall_risk",
            label: "Fall risk on return",
            type: "single_select",
            options: RISK_OPTIONS,
            required: true,
            comparesTo: "fall_risk",
          },
          { key: "skin_findings", label: "Skin findings", type: "long_text" },
        ],
      },
      {
        key: "followup",
        title: "Follow-up",
        fields: [
          { key: "support_plan_revision_required", label: "Does the support plan need revision?", type: "boolean", required: true },
          {
            key: "support_plan_revision_reason",
            label: "What needs to change in the plan",
            type: "long_text",
            required: true,
            when: { field: "support_plan_revision_required", isTrue: true },
          },
          { key: "followup_appointments", label: "Follow-up appointments", type: "long_text" },
        ],
      },
    ],
  },
  {
    key: "cognitive_behavioral_review",
    kind: "internal_review",
    title: "Cognitive and behavioral review",
    purpose: "Structured review of cognition, behaviour, and the supervision they call for.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    signature: { assessorSignatureRequired: true, residentParticipationRequired: false, clinicalReviewRequired: false },
    sections: [
      {
        key: "cognition",
        title: "Cognition",
        fields: [
          {
            key: "cognitive_status",
            label: "Cognitive status",
            type: "single_select",
            options: COGNITIVE_OPTIONS,
            required: true,
            comparesTo: "cognitive_status",
          },
          {
            key: "orientation_concerns",
            label: "Orientation concerns observed",
            type: "multi_select",
            options: [
              { value: "time", label: "Time" },
              { value: "place", label: "Place" },
              { value: "person", label: "Person" },
              { value: "situation", label: "Situation" },
            ],
          },
          {
            key: "elopement_risk",
            label: "Elopement risk",
            type: "single_select",
            options: ELOPEMENT_OPTIONS,
            required: true,
            comparesTo: "elopement_risk",
          },
        ],
      },
      {
        key: "behaviour",
        title: "Behaviour",
        fields: [
          { key: "behaviour_change_observed", label: "Behaviour change observed", type: "boolean", required: true },
          {
            key: "behaviour_description",
            label: "What was observed, when, and how often",
            type: "long_text",
            required: true,
            when: { field: "behaviour_change_observed", isTrue: true },
            guidance: "Describe the behaviour and its trigger, not a label for the resident.",
          },
          {
            key: "supervision_level_indicated",
            label: "Supervision level indicated",
            type: "single_select",
            options: [
              { value: "routine", label: "Routine" },
              { value: "increased", label: "Increased checks" },
              { value: "continuous", label: "Continuous" },
            ],
            required: true,
            when: { field: "behaviour_change_observed", isTrue: true },
          },
        ],
      },
    ],
  },
  {
    key: "mobility_fall_review",
    kind: "internal_review",
    title: "Mobility and fall-risk review",
    purpose: "Reviews mobility, transfer needs, and the interventions the fall risk calls for.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    signature: { assessorSignatureRequired: true, residentParticipationRequired: false, clinicalReviewRequired: false },
    sections: [
      {
        key: "mobility",
        title: "Mobility",
        fields: [
          {
            key: "ambulation_status",
            label: "Ambulation",
            type: "single_select",
            options: AMBULATION_OPTIONS,
            required: true,
            comparesTo: "ambulation_status",
          },
          {
            key: "transfer_assistance",
            label: "Transfer assistance",
            type: "single_select",
            options: TRANSFER_OPTIONS,
            required: true,
            comparesTo: "transfer_assistance",
          },
          { key: "assistive_device_in_reach", label: "Assistive device kept within reach", type: "boolean" },
        ],
      },
      {
        key: "falls",
        title: "Fall risk",
        fields: [
          {
            key: "fall_risk",
            label: "Fall risk",
            type: "single_select",
            options: RISK_OPTIONS,
            required: true,
            comparesTo: "fall_risk",
          },
          {
            key: "falls_last_90_days",
            label: "Falls in the last 90 days",
            type: "number",
            min: 0,
            max: 100,
            required: true,
          },
          {
            key: "fall_intervention_summary",
            label: "Fall-prevention interventions in place",
            type: "long_text",
            required: true,
            when: { field: "fall_risk", equals: ["moderate", "high"] },
            guidance: "A documented fall risk with no intervention is the most common support-plan gap at survey.",
          },
        ],
      },
    ],
  },
  {
    key: "nutritional_review",
    kind: "internal_review",
    title: "Nutritional review",
    purpose: "Reviews diet, texture, intake, and weight trend.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    signature: { assessorSignatureRequired: true, residentParticipationRequired: false, clinicalReviewRequired: false },
    sections: [
      {
        key: "diet",
        title: "Diet",
        fields: [
          {
            key: "diet_texture",
            label: "Texture consistency",
            type: "single_select",
            options: TEXTURE_OPTIONS,
            required: true,
            comparesTo: "diet_texture",
          },
          { key: "diet_order", label: "Diet order", type: "text" },
          { key: "assistance_with_meals", label: "Assistance required at meals", type: "boolean", required: true },
        ],
      },
      {
        key: "intake",
        title: "Intake and weight",
        fields: [
          {
            key: "intake_concern",
            label: "Intake concern",
            type: "single_select",
            options: [
              { value: "none", label: "None" },
              { value: "reduced", label: "Reduced" },
              { value: "refusing", label: "Frequently refusing" },
            ],
            required: true,
          },
          {
            key: "intake_concern_detail",
            label: "What has been observed",
            type: "long_text",
            required: true,
            when: { field: "intake_concern", equals: ["reduced", "refusing"] },
          },
          { key: "weight_change_lbs", label: "Weight change since last review", type: "number", min: -200, max: 200, unit: "lb" },
        ],
      },
    ],
  },
  {
    key: "continence_review",
    kind: "internal_review",
    title: "Continence and toileting review",
    purpose: "Reviews continence status and the toileting support it calls for.",
    facilityTypes: PCH_AND_ALF,
    version: 1,
    effectiveFrom: "2026-07-25",
    signature: { assessorSignatureRequired: true, residentParticipationRequired: false, clinicalReviewRequired: false },
    sections: [
      {
        key: "continence",
        title: "Continence",
        fields: [
          {
            key: "bladder_continence",
            label: "Bladder continence",
            type: "single_select",
            options: [
              { value: "continent", label: "Continent" },
              { value: "occasionally_incontinent", label: "Occasionally incontinent" },
              { value: "frequently_incontinent", label: "Frequently incontinent" },
              { value: "incontinent", label: "Incontinent" },
            ],
            required: true,
          },
          {
            key: "bowel_continence",
            label: "Bowel continence",
            type: "single_select",
            options: [
              { value: "continent", label: "Continent" },
              { value: "occasionally_incontinent", label: "Occasionally incontinent" },
              { value: "frequently_incontinent", label: "Frequently incontinent" },
              { value: "incontinent", label: "Incontinent" },
            ],
            required: true,
          },
          {
            key: "new_incontinence",
            label: "Is this a new change?",
            type: "boolean",
            required: true,
            when: { field: "bladder_continence", equals: ["frequently_incontinent", "incontinent"] },
            guidance: "New incontinence is a change of condition, not just a care preference.",
          },
        ],
      },
      {
        key: "toileting",
        title: "Toileting support",
        fields: [
          {
            key: "scheduled_toileting",
            label: "Scheduled toileting in place",
            type: "boolean",
            required: true,
          },
          {
            key: "toileting_interval_hours",
            label: "Toileting interval",
            type: "number",
            min: 1,
            max: 12,
            unit: "hours",
            required: true,
            when: { field: "scheduled_toileting", isTrue: true },
          },
          {
            key: "requests_assistance_reliably",
            label: "Reliably requests assistance",
            type: "boolean",
            required: true,
            guidance: "A resident who forgets to ask needs cueing built into the plan, not just availability.",
          },
        ],
      },
    ],
  },
];

export const ASSESSMENT_TEMPLATES: AssessmentTemplate[] = [
  ...STATE_FORM_TEMPLATES,
  ...INTERNAL_REVIEW_TEMPLATES,
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getTemplate(key: string): AssessmentTemplate | undefined {
  return ASSESSMENT_TEMPLATES.find((template) => template.key === key);
}

export function templatesForFacility(facilityType: string | null | undefined): AssessmentTemplate[] {
  if (!facilityType) return [];
  return ASSESSMENT_TEMPLATES.filter((template) =>
    (template.facilityTypes as string[]).includes(facilityType));
}

export function internalReviewTemplates(facilityType: string | null | undefined): AssessmentTemplate[] {
  return templatesForFacility(facilityType).filter((template) => template.kind === "internal_review");
}

export function templateCitation(template: AssessmentTemplate): PaRegulatoryCitation | undefined {
  return template.citation ? findCitation(template.citation) : undefined;
}

/** Every field in a template, flattened, in section order. */
export function templateFields(template: AssessmentTemplate): TemplateField[] {
  return template.sections.flatMap((section) => section.fields);
}

// ---------------------------------------------------------------------------
// Conditional visibility and validation
// ---------------------------------------------------------------------------

export type TemplateAnswers = Record<string, unknown>;

/**
 * Whether a conditional field should be asked given the current answers. An unanswered controlling
 * field hides its dependants: asking "what needs cannot be met" before "can you meet these needs"
 * is answered would demand a justification for a decision nobody has made.
 */
export function isFieldVisible(field: TemplateField, answers: TemplateAnswers): boolean {
  if (!field.when) return true;
  const controlling = answers[field.when.field];
  if (field.when.isTrue !== undefined) {
    return controlling === field.when.isTrue;
  }
  if (field.when.equals) {
    return typeof controlling === "string" && field.when.equals.includes(controlling);
  }
  return true;
}

export function visibleFields(template: AssessmentTemplate, answers: TemplateAnswers): TemplateField[] {
  return templateFields(template).filter((field) => isFieldVisible(field, answers));
}

export type ValidationIssueKind = "missing_required" | "out_of_range" | "unknown_option";

export interface TemplateValidationIssue {
  fieldKey: string;
  label: string;
  kind: ValidationIssueKind;
  message: string;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Missing-field validation. Only visible fields are checked -- a hidden conditional field is not a
 * gap, and reporting it as one would make the form impossible to finish.
 */
export function validateTemplateAnswers(
  template: AssessmentTemplate,
  answers: TemplateAnswers,
): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  for (const field of visibleFields(template, answers)) {
    const value = answers[field.key];

    if (field.required && isBlank(value)) {
      issues.push({
        fieldKey: field.key,
        label: field.label,
        kind: "missing_required",
        message: `${field.label} is required.`,
      });
      continue;
    }
    if (isBlank(value)) continue;

    if (field.type === "number" && typeof value === "number") {
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        issues.push({
          fieldKey: field.key,
          label: field.label,
          kind: "out_of_range",
          message: `${field.label} must be between ${field.min ?? "−∞"} and ${field.max ?? "∞"}${field.unit ? ` ${field.unit}` : ""}.`,
        });
      }
    }

    if (field.options && (field.type === "single_select" || field.type === "multi_select")) {
      const allowed = new Set(field.options.map((option) => option.value));
      const chosen = field.type === "multi_select"
        ? (Array.isArray(value) ? value : [])
        : [value];
      for (const entry of chosen) {
        if (typeof entry !== "string" || !allowed.has(entry)) {
          issues.push({
            fieldKey: field.key,
            label: field.label,
            kind: "unknown_option",
            message: `${field.label} has an unrecognized value.`,
          });
          break;
        }
      }
    }
  }
  return issues;
}

export function isTemplateComplete(template: AssessmentTemplate, answers: TemplateAnswers): boolean {
  return validateTemplateAnswers(template, answers).length === 0;
}

export interface TemplateProgress {
  answered: number;
  total: number;
  percent: number;
}

/** Progress over currently-visible fields, so answering a question that reveals more is not a regression in the count alone. */
export function templateProgress(template: AssessmentTemplate, answers: TemplateAnswers): TemplateProgress {
  const fields = visibleFields(template, answers);
  const answered = fields.filter((field) => !isBlank(answers[field.key])).length;
  return {
    answered,
    total: fields.length,
    percent: fields.length === 0 ? 0 : Math.round((answered / fields.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// Phase 3 hand-off
// ---------------------------------------------------------------------------

export interface ComparableAnswer {
  attribute: ComparableCareAttribute;
  fieldKey: string;
  label: string;
  value: string;
  templateKey: TemplateKey;
}

/**
 * The answers a conflict rule can compare against the care header or the support plan. Returned as
 * data rather than compared here: Phase 3 owns what counts as a conflict, this module only owns
 * which answers are comparable at all.
 */
export function comparableAnswers(
  template: AssessmentTemplate,
  answers: TemplateAnswers,
): ComparableAnswer[] {
  return visibleFields(template, answers)
    .filter((field): field is TemplateField & { comparesTo: ComparableCareAttribute } => Boolean(field.comparesTo))
    .map((field) => ({
      attribute: field.comparesTo,
      fieldKey: field.key,
      label: field.label,
      value: typeof answers[field.key] === "string" ? (answers[field.key] as string) : "",
      templateKey: template.key,
    }))
    .filter((entry) => entry.value !== "");
}
