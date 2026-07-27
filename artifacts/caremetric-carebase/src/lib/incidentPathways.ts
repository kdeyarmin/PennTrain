/**
 * Type-specific incident investigation pathways (program plan Phase 6a).
 *
 * THE UNTANGLING THIS DEPENDS ON. `incidents.incident_type` is the PA *reportable-event* list
 * (death, elopement, abuse allegation, medication error, significant injury, assault, fire,
 * environmental emergency, neglect allegation, other), and `auto_create_incident_notifications`
 * keys required state notifications off it. Operationally, facilities also manage falls, injuries,
 * skin tears, behavioral events, emergency transfers, property loss, and staff-resident altercations
 * -- none of which are automatically reportable and all of which need investigating.
 *
 * So the two concepts are separated: the TYPE drives which questions are asked, and reportability
 * becomes a determination made during the investigation. The alternative -- widening the type list
 * and letting the notification trigger keep firing off it -- would either invent state notifications
 * for a bruise or, worse, leave a reportable fall with a head strike silently un-notified.
 *
 * QUESTIONS REUSE THE ASSESSMENT TEMPLATE MODEL. `TemplateField`, conditional visibility, and
 * validation all come from assessmentTemplates.ts. A second question-rendering system would be the
 * most expensive avoidable duplication in this program.
 */
import {
  fieldsIn, isFieldVisible, validateSectionAnswers, visibleFieldsIn,
  type TemplateAnswers, type TemplateField, type TemplateSection, type TemplateValidationIssue,
} from "./assessmentTemplates";

export type IncidentPathwayKey =
  | "fall"
  | "medication_event"
  | "elopement"
  | "missing_resident"
  | "abuse_allegation"
  | "injury"
  | "skin_tear"
  | "behavioral_event"
  | "emergency_transfer"
  | "property_loss"
  | "death"
  | "staff_resident_altercation";

/**
 * Whether an incident of this kind is a PA reportable event by default. `presumed` means the
 * existing notification automation already treats it as reportable and this pathway must not change
 * that; `determination_required` means a human decides during Stage 3.
 */
export type ReportabilityPosture = "presumed_reportable" | "determination_required";

export interface IncidentPathway {
  key: IncidentPathwayKey;
  label: string;
  /** What this pathway is for, shown when picking one. */
  purpose: string;
  reportability: ReportabilityPosture;
  /**
   * The `incidents.incident_type` value this pathway records against. Several operational pathways
   * map onto one legacy reportable type -- a skin tear and a fracture are both `significant_injury`
   * to the state, and asking the same questions about them would be useless.
   */
  incidentType: string;
  version: number;
  sections: TemplateSection[];
}

const YES_NO_UNKNOWN = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

const NOTIFICATION_FIELDS: TemplateField[] = [
  {
    key: "physician_notified",
    label: "Physician notified",
    type: "boolean",
    required: true,
    guidance: "Provider notification is a required step, and 'not yet' is an answer — leaving it blank is not.",
  },
  {
    key: "designated_person_notified",
    label: "Designated person / family notified",
    type: "boolean",
    required: true,
  },
];

/**
 * The fall pathway is the reference implementation: every question the request names, in the order
 * someone actually reconstructs a fall.
 */
const FALL_SECTIONS: TemplateSection[] = [
  {
    key: "circumstances",
    title: "What happened",
    fields: [
      {
        key: "witnessed",
        label: "Witnessed or unwitnessed?",
        type: "single_select",
        options: [
          { value: "witnessed", label: "Witnessed" },
          { value: "unwitnessed", label: "Unwitnessed" },
          { value: "found_on_floor", label: "Found on floor" },
        ],
        required: true,
        guidance: "An unwitnessed fall changes what can be concluded about mechanism and head strike.",
      },
      { key: "location", label: "Location", type: "text", required: true },
      { key: "activity_before", label: "What the resident was doing beforehand", type: "long_text", required: true },
      {
        key: "footwear",
        label: "Footwear",
        type: "single_select",
        options: [
          { value: "appropriate", label: "Appropriate footwear" },
          { value: "socks", label: "Socks / stockings only" },
          { value: "barefoot", label: "Barefoot" },
          { value: "unknown", label: "Unknown" },
        ],
        required: true,
      },
      {
        key: "assistive_device_present",
        label: "Assistive device present and within reach?",
        type: "single_select",
        options: [
          { value: "present_in_reach", label: "Present and in reach" },
          { value: "present_out_of_reach", label: "Present but out of reach" },
          { value: "not_present", label: "Not present" },
          { value: "not_applicable", label: "Does not use one" },
        ],
        required: true,
        guidance: "A device out of reach is functionally no device, and it is a routine finding after an unwitnessed fall.",
      },
      { key: "environmental_condition", label: "Environmental conditions (lighting, floor, clutter)", type: "long_text" },
    ],
  },
  {
    key: "injury",
    title: "Injury",
    fields: [
      {
        key: "injury_observed",
        label: "Injury observed?",
        type: "single_select",
        options: YES_NO_UNKNOWN,
        required: true,
      },
      {
        key: "injury_description",
        label: "Describe the injury",
        type: "long_text",
        required: true,
        when: { field: "injury_observed", equals: ["yes"] },
      },
      {
        key: "head_strike",
        label: "Head strike suspected or confirmed?",
        type: "single_select",
        options: YES_NO_UNKNOWN,
        required: true,
        guidance: "An unwitnessed fall with an unknown head strike is treated as a possible head strike until ruled out.",
      },
      {
        key: "anticoagulant_therapy",
        label: "Is the resident on anticoagulant therapy?",
        type: "single_select",
        options: YES_NO_UNKNOWN,
        required: true,
        when: { field: "head_strike", equals: ["yes", "unknown"] },
        guidance: "A head strike on anticoagulants changes the urgency of evaluation.",
      },
      {
        key: "emergency_evaluation",
        label: "Emergency evaluation obtained?",
        type: "single_select",
        options: [
          { value: "none", label: "None needed" },
          { value: "on_site", label: "On-site assessment" },
          { value: "emergency_department", label: "Sent to emergency department" },
        ],
        required: true,
      },
    ],
  },
  {
    key: "notification",
    title: "Notification",
    fields: NOTIFICATION_FIELDS,
  },
  {
    key: "follow_up",
    title: "Response and follow-up",
    fields: [
      { key: "immediate_intervention", label: "Immediate intervention taken", type: "long_text", required: true },
      {
        key: "prior_falls_90_days",
        label: "Prior falls in the last 90 days",
        type: "number",
        min: 0,
        max: 100,
        required: true,
        guidance: "Counting them here is what turns a single event into a recognised pattern.",
      },
      {
        key: "support_plan_impact",
        label: "Does the support plan need to change?",
        type: "single_select",
        options: YES_NO_UNKNOWN,
        required: true,
      },
      {
        key: "support_plan_change",
        label: "What needs to change in the plan",
        type: "long_text",
        required: true,
        when: { field: "support_plan_impact", equals: ["yes"] },
      },
      { key: "monitoring_plan", label: "Follow-up monitoring", type: "long_text", required: true },
    ],
  },
];

function basicSections(
  whatHappened: TemplateField[],
  followUp: TemplateField[] = [],
): TemplateSection[] {
  return [
    { key: "circumstances", title: "What happened", fields: whatHappened },
    { key: "notification", title: "Notification", fields: NOTIFICATION_FIELDS },
    {
      key: "follow_up",
      title: "Response and follow-up",
      fields: [
        { key: "immediate_intervention", label: "Immediate intervention taken", type: "long_text", required: true },
        ...followUp,
        { key: "monitoring_plan", label: "Follow-up monitoring", type: "long_text" },
      ],
    },
  ];
}

export const INCIDENT_PATHWAYS: IncidentPathway[] = [
  {
    key: "fall", label: "Fall", purpose: "A resident fell, was lowered, or was found on the floor.",
    reportability: "determination_required", incidentType: "significant_injury", version: 1,
    sections: FALL_SECTIONS,
  },
  {
    key: "medication_event", label: "Medication-related event",
    purpose: "A medication error, near miss, or adverse reaction.",
    reportability: "presumed_reportable", incidentType: "medication_error", version: 1,
    sections: basicSections([
      {
        key: "error_category", label: "What went wrong", type: "single_select",
        options: [
          { value: "wrong_resident", label: "Wrong resident" },
          { value: "wrong_medication", label: "Wrong medication" },
          { value: "wrong_dose", label: "Wrong dose" },
          { value: "wrong_time", label: "Wrong time" },
          { value: "omitted", label: "Dose omitted" },
          { value: "adverse_reaction", label: "Adverse reaction" },
        ],
        required: true,
      },
      { key: "medication_involved", label: "Medication involved", type: "text", required: true },
      {
        key: "reached_resident", label: "Did it reach the resident?", type: "single_select",
        options: YES_NO_UNKNOWN, required: true,
        guidance: "A near miss is still worth investigating; the system that allowed it is the same.",
      },
    ], [
      { key: "pharmacy_notified", label: "Pharmacy notified", type: "boolean" },
    ]),
  },
  {
    key: "elopement", label: "Elopement",
    purpose: "A resident left the facility unsupervised.",
    reportability: "presumed_reportable", incidentType: "elopement", version: 1,
    sections: basicSections([
      { key: "last_seen_at", label: "When last seen", type: "text", required: true },
      { key: "found_at", label: "When and where found", type: "long_text", required: true },
      { key: "exit_point", label: "How the resident left", type: "long_text", required: true },
      {
        key: "elopement_risk_documented", label: "Was an elopement risk already documented?",
        type: "single_select", options: YES_NO_UNKNOWN, required: true,
        guidance: "A known risk with no intervention in the plan is a different finding from an unforeseen event.",
      },
    ]),
  },
  {
    key: "missing_resident", label: "Missing resident",
    purpose: "A resident could not be located within the facility.",
    reportability: "determination_required", incidentType: "elopement", version: 1,
    sections: basicSections([
      { key: "last_seen_at", label: "When last seen", type: "text", required: true },
      { key: "search_conducted", label: "Search conducted", type: "long_text", required: true },
      { key: "found_at", label: "When and where found", type: "long_text", required: true },
    ]),
  },
  {
    key: "abuse_allegation", label: "Abuse allegation",
    purpose: "An allegation of abuse, neglect, or exploitation.",
    reportability: "presumed_reportable", incidentType: "abuse_allegation", version: 1,
    sections: basicSections([
      {
        key: "allegation_source", label: "Who raised it", type: "single_select",
        options: [
          { value: "resident", label: "Resident" },
          { value: "family", label: "Family or designated person" },
          { value: "staff", label: "Staff" },
          { value: "other", label: "Other" },
        ],
        required: true,
      },
      { key: "allegation_detail", label: "What was alleged", type: "long_text", required: true },
      {
        key: "accused_separated", label: "Has the accused been separated from residents?",
        type: "single_select", options: YES_NO_UNKNOWN, required: true,
        guidance: "Immediate protection of the resident comes before the investigation, and is documented first.",
      },
    ]),
  },
  {
    key: "injury", label: "Injury",
    purpose: "An injury of unknown or non-fall origin.",
    reportability: "determination_required", incidentType: "significant_injury", version: 1,
    sections: basicSections([
      { key: "injury_description", label: "Describe the injury", type: "long_text", required: true },
      { key: "body_location", label: "Body location", type: "text", required: true },
      {
        key: "origin_known", label: "Is the origin known?", type: "single_select",
        options: YES_NO_UNKNOWN, required: true,
        guidance: "An injury of unknown origin has its own reporting considerations — do not assume a mechanism.",
      },
    ]),
  },
  {
    key: "skin_tear", label: "Skin tear",
    purpose: "A skin tear or abrasion.",
    reportability: "determination_required", incidentType: "significant_injury", version: 1,
    sections: basicSections([
      { key: "body_location", label: "Body location", type: "text", required: true },
      {
        key: "category", label: "Category", type: "single_select",
        options: [
          { value: "type_1", label: "Type 1 — no skin loss" },
          { value: "type_2", label: "Type 2 — partial flap loss" },
          { value: "type_3", label: "Type 3 — total flap loss" },
        ],
        required: true,
      },
      { key: "suspected_cause", label: "Suspected cause", type: "long_text", required: true },
    ]),
  },
  {
    key: "behavioral_event", label: "Behavioral event",
    purpose: "Behaviour that put the resident or others at risk.",
    reportability: "determination_required", incidentType: "other", version: 1,
    sections: basicSections([
      { key: "behaviour_description", label: "What was observed", type: "long_text", required: true },
      { key: "trigger", label: "Apparent trigger", type: "long_text" },
      {
        key: "others_affected", label: "Were other residents affected?", type: "single_select",
        options: YES_NO_UNKNOWN, required: true,
      },
      {
        key: "intervention_used", label: "Intervention used", type: "single_select",
        options: [
          { value: "redirection", label: "Redirection" },
          { value: "environmental", label: "Environmental change" },
          { value: "one_to_one", label: "One-to-one supervision" },
          { value: "prn_medication", label: "PRN medication" },
        ],
        required: true,
      },
    ]),
  },
  {
    key: "emergency_transfer", label: "Emergency transfer",
    purpose: "A resident was transferred out urgently.",
    reportability: "determination_required", incidentType: "significant_injury", version: 1,
    sections: basicSections([
      { key: "reason", label: "Reason for transfer", type: "long_text", required: true },
      { key: "destination", label: "Destination", type: "text", required: true },
      { key: "transport_method", label: "Transport", type: "text", required: true },
      {
        key: "documents_sent", label: "Were current documents and medication information sent?",
        type: "single_select", options: YES_NO_UNKNOWN, required: true,
      },
    ]),
  },
  {
    key: "property_loss", label: "Property loss or damage",
    purpose: "Resident property was lost, damaged, or stolen.",
    reportability: "determination_required", incidentType: "other", version: 1,
    sections: basicSections([
      { key: "item_description", label: "Item", type: "text", required: true },
      { key: "estimated_value", label: "Estimated value", type: "text" },
      {
        key: "suspected_theft", label: "Is theft suspected?", type: "single_select",
        options: YES_NO_UNKNOWN, required: true,
        guidance: "Suspected theft changes this from a property matter to a potential abuse allegation.",
      },
    ]),
  },
  {
    key: "death", label: "Death",
    purpose: "A resident died.",
    reportability: "presumed_reportable", incidentType: "death", version: 1,
    sections: basicSections([
      { key: "found_or_witnessed", label: "Circumstances", type: "long_text", required: true },
      {
        key: "expected", label: "Was the death expected?", type: "single_select",
        options: YES_NO_UNKNOWN, required: true,
        guidance: "An expected death on hospice and an unexpected death carry different review obligations.",
      },
      { key: "coroner_contacted", label: "Coroner or medical examiner contacted", type: "boolean" },
    ]),
  },
  {
    key: "staff_resident_altercation", label: "Staff-resident altercation",
    purpose: "A physical or verbal altercation involving a staff member.",
    reportability: "presumed_reportable", incidentType: "abuse_allegation", version: 1,
    sections: basicSections([
      { key: "altercation_description", label: "What happened", type: "long_text", required: true },
      {
        key: "staff_separated", label: "Has the staff member been separated from residents?",
        type: "single_select", options: YES_NO_UNKNOWN, required: true,
      },
      { key: "witnesses", label: "Witnesses", type: "long_text" },
    ]),
  },
];

export function getIncidentPathway(key: string): IncidentPathway | undefined {
  return INCIDENT_PATHWAYS.find((pathway) => pathway.key === key);
}

export function pathwayFields(pathway: IncidentPathway): TemplateField[] {
  return fieldsIn(pathway.sections);
}

export function visiblePathwayFields(pathway: IncidentPathway, answers: TemplateAnswers): TemplateField[] {
  return visibleFieldsIn(pathway.sections, answers);
}

export function isPathwayFieldVisible(field: TemplateField, answers: TemplateAnswers): boolean {
  return isFieldVisible(field, answers);
}

export function validatePathwayAnswers(
  pathway: IncidentPathway,
  answers: TemplateAnswers,
): TemplateValidationIssue[] {
  return validateSectionAnswers(pathway.sections, answers);
}

export function isPathwayComplete(pathway: IncidentPathway, answers: TemplateAnswers): boolean {
  return validatePathwayAnswers(pathway, answers).length === 0;
}

/**
 * Whether the pathway's answers themselves suggest the event is reportable, as a PROMPT for the
 * reportability determination — never as the determination itself. A person decides; this only makes
 * sure they are asked at the right moment.
 */
export function reportabilityPrompts(pathway: IncidentPathway, answers: TemplateAnswers): string[] {
  const prompts: string[] = [];
  if (pathway.reportability === "presumed_reportable") {
    prompts.push(`${pathway.label} is normally a reportable event — confirm the notification requirements.`);
  }
  if (answers.head_strike === "yes" || answers.head_strike === "unknown") {
    prompts.push("A confirmed or possible head strike may make this a reportable significant injury.");
  }
  if (answers.emergency_evaluation === "emergency_department") {
    prompts.push("The resident was sent to an emergency department, which commonly meets the reporting threshold.");
  }
  if (answers.origin_known === "no" || answers.origin_known === "unknown") {
    prompts.push("An injury of unknown origin carries its own reporting considerations.");
  }
  if (answers.suspected_theft === "yes") {
    prompts.push("Suspected theft may need to be handled as an allegation rather than a property matter.");
  }
  return prompts;
}
