// Shape of resident_assessment_forms.content (jsonb) plus the data-driven section/item lists that
// both the editor UI and PDF generation walk. Field/section structure mirrors the real DHS
// RASP (PCH) and ASP (ALR) forms directly -- reusing DHS's own structure is the compliance
// argument for why a custom-rendered layout is acceptable in place of DHS's own PDF (both forms'
// "Instructions for Use" pages state facilities may substitute their own form as long as it
// captures every required DHS element: 55 Pa Code 2600.225(b)/227(b) for RASP, the parallel Ch.
// 2800 clause for ASP).
//
// This is the one place in the app that stores real clinical/functional-assessment content -- the
// no-EHR posture governing every other resident-compliance table does not apply here, by
// deliberate, explicit product decision (see Tier 3.6 plan, Phase 6).

export type FormType = "RASP" | "ASP";
export type AssessmentReason = "initial" | "annual" | "significant_change" | "department_request";

export const REASON_OPTIONS: { value: AssessmentReason; label: string }[] = [
  { value: "initial", label: "Initial" },
  { value: "annual", label: "Annual" },
  { value: "significant_change", label: "Significant Change" },
  { value: "department_request", label: "Department Request" },
];

// Section 1 "Degree Codes" (Personal Care Needs, Supervision, Mobility) -- Independent through
// Total Physical Assistance.
export const CARE_DEGREE_OPTIONS = [
  { value: "A", label: "A — Independent" },
  { value: "B", label: "B — Prompting/Cueing" },
  { value: "C", label: "C — Some Physical Assistance" },
  { value: "D", label: "D — Total Physical Assistance" },
  { value: "E", label: "E — Not Applicable" },
];

// Section 3 "Degree Codes" (Mental Health, Behavioral Health, Cognitive Functioning) -- a
// different scale from Section 1's, despite sharing the same A-E letters.
export const BEHAVIORAL_DEGREE_OPTIONS = [
  { value: "A", label: "A — No Problem" },
  { value: "B", label: "B — Minimal Problem" },
  { value: "C", label: "C — Moderate Problem" },
  { value: "D", label: "D — Severe Problem" },
  { value: "E", label: "E — Not Applicable" },
];

export const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "other", label: "Other" },
  { value: "na", label: "N/A" },
];

// RASP (PCH) has 5 Responsible Party codes; ASP (ALR) adds a 6th (SHCP).
export const RESPONSIBLE_PARTY_OPTIONS_RASP = [
  { value: "DCS", label: "Direct-Care Staff on Duty" },
  { value: "F", label: "Family Member" },
  { value: "CM", label: "Case Manager" },
  { value: "NA", label: "Not Applicable" },
  { value: "O", label: "Other" },
];
export const RESPONSIBLE_PARTY_OPTIONS_ASP = [
  ...RESPONSIBLE_PARTY_OPTIONS_RASP.slice(0, 3),
  { value: "SHCP", label: "Supplemental Health Care Provider" },
  ...RESPONSIBLE_PARTY_OPTIONS_RASP.slice(3),
];

export function responsiblePartyOptions(formType: FormType) {
  return formType === "ASP" ? RESPONSIBLE_PARTY_OPTIONS_ASP : RESPONSIBLE_PARTY_OPTIONS_RASP;
}

export interface SectionItem {
  key: string;
  label: string;
}

// Section 1: Personal Care Needs -- 22 ADL/IADL items, identical between RASP and ASP.
export const ADL_ITEMS: SectionItem[] = [
  { key: "eating", label: "Eating" },
  { key: "drinking", label: "Drinking" },
  { key: "transferring", label: "Transferring In/Out of Bed or Chair" },
  { key: "toileting", label: "Toileting" },
  { key: "bladderManagement", label: "Bladder Management" },
  { key: "bowelManagement", label: "Bowel Management" },
  { key: "ambulating", label: "Ambulating" },
  { key: "hygiene", label: "Personal Hygiene" },
  { key: "managingHealthCare", label: "Managing Health Care" },
  { key: "securingHealthCare", label: "Securing Health Care" },
  { key: "turningPositioning", label: "Turning/Positioning in Bed or Chair" },
  { key: "laundry", label: "Doing Laundry" },
  { key: "shopping", label: "Shopping" },
  { key: "securingTransportation", label: "Securing/Using Transportation" },
  { key: "managingFinances", label: "Managing Finances" },
  { key: "telephoneUsage", label: "Using the Telephone" },
  { key: "makingAppointments", label: "Making/Keeping Appointments" },
  { key: "caringForPossessions", label: "Caring for Personal Possessions" },
  { key: "writtenCorrespondence", label: "Written Correspondence" },
  { key: "socialLeisureActivities", label: "Social/Leisure Activities" },
  { key: "prostheticDevice", label: "Using a Prosthetic Device" },
  { key: "obtainingClothing", label: "Obtaining Clean Seasonal Clothing" },
];

// Section 3: Mental Health, Behavioral Health, Cognitive Functioning -- RASP has 11 items (incl. a
// generic "Behavioral" item); ASP has 12 (swaps that for "Orientation to Time, Place, and Person"
// and adds "Ability to Safely Use Key-Locking Devices").
export const BEHAVIORAL_ITEMS_SHARED: SectionItem[] = [
  { key: "irritability", label: "Irritability" },
  { key: "judgment", label: "Judgment" },
  { key: "agitation", label: "Agitation" },
  { key: "aggression", label: "Aggression" },
  { key: "hallucinations", label: "Hallucinations" },
  { key: "communicationOfNeeds", label: "Communication of Needs" },
  { key: "understandingInstructions", label: "Understanding Instructions" },
  { key: "shortTermMemory", label: "Short-Term Memory" },
  { key: "longTermMemory", label: "Long-Term Memory" },
  { key: "poisonousMaterials", label: "Ability to Use and Avoid Poisonous Materials" },
];
export const BEHAVIORAL_ITEMS_RASP: SectionItem[] = [
  { key: "behavioral", label: "Behavioral" },
  ...BEHAVIORAL_ITEMS_SHARED,
];
export const BEHAVIORAL_ITEMS_ASP: SectionItem[] = [
  { key: "orientation", label: "Orientation to Time, Place, and Person" },
  ...BEHAVIORAL_ITEMS_SHARED,
  { key: "keyLockingDevices", label: "Ability to Safely Use Key-Locking Devices" },
];
export function behavioralItems(formType: FormType): SectionItem[] {
  return formType === "ASP" ? BEHAVIORAL_ITEMS_ASP : BEHAVIORAL_ITEMS_RASP;
}

// Section 2: Sensory needs -- 5 senses, both forms.
export const SENSORY_ITEMS: SectionItem[] = [
  { key: "vision", label: "Vision" },
  { key: "hearing", label: "Hearing" },
  { key: "communication", label: "Communication" },
  { key: "olfactory", label: "Olfactory (Smell)" },
  { key: "tactile", label: "Tactile (Touch)" },
];

// Section 4: Social and Recreational Needs -- 5 items, both forms.
export const SOCIAL_ITEMS: SectionItem[] = [
  { key: "interests", label: "Hobbies/Interests" },
  { key: "solitaryActivities", label: "Enjoyable Solitary Activities" },
  { key: "groupActivities", label: "Enjoyable Group Activities" },
  { key: "religiousAffiliation", label: "Religious Affiliation" },
  { key: "nonParticipationReason", label: "Reason for Non-Participation (if applicable)" },
];

// One assessment/support-plan answer, shared by every ADL and behavioral item. ASP doubles the
// degree rating into Preliminary/All-Other tiers (Ch. 2800's mandatory preliminary-then-final
// cycle); RASP uses a single degree rating.
export interface DegreeItemAnswer {
  degree: string;
  degreePreliminary: string;
  degreeAllOther: string;
  serviceNeedNotApplicable: boolean;
  serviceNeedDescription: string;
  planNotApplicable: boolean;
  planDescription: string;
  planFrequency: string;
  planFrequencyOther: string;
  planResponsibleParty: string;
  planResponsiblePartyOther: string;
}
export function emptyDegreeItemAnswer(): DegreeItemAnswer {
  return {
    degree: "", degreePreliminary: "", degreeAllOther: "",
    serviceNeedNotApplicable: false, serviceNeedDescription: "",
    planNotApplicable: false, planDescription: "",
    planFrequency: "", planFrequencyOther: "",
    planResponsibleParty: "", planResponsiblePartyOther: "",
  };
}

// A simpler answer shape for Section 4 (social/recreational) and the sensory sub-items, which
// don't carry a degree rating.
export interface SimpleNeedAnswer {
  applicable: boolean;
  description: string;
  planDescription: string;
  planFrequency: string;
  planFrequencyOther: string;
  planResponsibleParty: string;
  planResponsiblePartyOther: string;
}
export function emptySimpleNeedAnswer(): SimpleNeedAnswer {
  return {
    applicable: true, description: "", planDescription: "",
    planFrequency: "", planFrequencyOther: "",
    planResponsibleParty: "", planResponsiblePartyOther: "",
  };
}

export interface DiagnosisRow {
  description: string;
  planDescription: string;
  planFrequency: string;
  planFrequencyOther: string;
  planResponsibleParty: string;
  planResponsiblePartyOther: string;
}
export function emptyDiagnosisRow(): DiagnosisRow {
  return { description: "", planDescription: "", planFrequency: "", planFrequencyOther: "", planResponsibleParty: "", planResponsiblePartyOther: "" };
}
export const MAX_DIAGNOSIS_ROWS = 8;
export const MAX_DENTAL_DIETARY_ROWS = 2;

export interface InformalSupportRow {
  name: string;
  relationship: string;
  phone: string;
}

export interface ParticipantRow {
  name: string;
  relationshipToResident: string;
  signedDate: string;
  copyRequested: boolean;
  copyProvided: "yes" | "no" | "na";
  noSignatureReason: string;
}
export function emptyParticipantRow(): ParticipantRow {
  return { name: "", relationshipToResident: "", signedDate: "", copyRequested: false, copyProvided: "na", noSignatureReason: "" };
}

export interface ResidentAssessmentFormContent {
  residentInfo: {
    comments: string;
  };
  assessmentInfo: {
    lastAssessmentDate: string;
    lastSupportPlanDate: string;
    assessmentReason: AssessmentReason | "";
    supportPlanReason: AssessmentReason | "";
    changeDescription: string;
  };
  section1: {
    items: Record<string, DegreeItemAnswer>;
    supervision: { level: string; needsDescription: string; planDescription: string; planResponsibleParty: string; planResponsiblePartyOther: string };
    mobility: { level: string; needsDescription: string; planDescription: string; planResponsibleParty: string; planResponsiblePartyOther: string };
    medications: { level: string; needsDescription: string; planDescription: string; planResponsibleParty: string; planResponsiblePartyOther: string };
  };
  section2: {
    physicalDiagnoses: DiagnosisRow[];
    noPhysicalDiagnoses: boolean;
    dental: DiagnosisRow[];
    noDental: boolean;
    dietary: DiagnosisRow[];
    noDietary: boolean;
    sensory: Record<string, SimpleNeedAnswer>;
  };
  section3: {
    psychologicalDiagnoses: DiagnosisRow[];
    noPsychologicalDiagnoses: boolean;
    items: Record<string, DegreeItemAnswer>;
  };
  section4: {
    items: Record<string, SimpleNeedAnswer>;
  };
  summary: {
    overallWellness: string;
  };
  participation: {
    assessorName: string;
    assessorTitle: string;
    assessorSignedDate: string;
    participants: ParticipantRow[];
  };
}

function itemsFor(keys: SectionItem[]): Record<string, DegreeItemAnswer> {
  return Object.fromEntries(keys.map((i) => [i.key, emptyDegreeItemAnswer()]));
}
function simpleItemsFor(keys: SectionItem[]): Record<string, SimpleNeedAnswer> {
  return Object.fromEntries(keys.map((i) => [i.key, emptySimpleNeedAnswer()]));
}

// Which resident_compliance_items item types the digital form applies to -- preadmission_screening
// and medical_evaluation are separate DHS forms/processes this schema doesn't model, so they only
// ever get the plain "mark complete"/"upload document" paths, not "Complete in CareMetric".
export function isDigitalFormEligible(itemType: string): boolean {
  return ["initial_assessment_15day", "annual_reassessment", "significant_change_reassessment", "support_plan_30day"].includes(itemType);
}

export function deriveAssessmentReason(itemType: string): AssessmentReason {
  if (itemType === "annual_reassessment") return "annual";
  if (itemType === "significant_change_reassessment") return "significant_change";
  return "initial";
}

function mergeItemMap<T>(defaults: Record<string, T>, saved: Record<string, T> | undefined): Record<string, T> {
  const result = {} as Record<string, T>;
  for (const key of Object.keys(defaults)) {
    const savedAnswer = saved?.[key];
    result[key] = savedAnswer ? { ...defaults[key], ...savedAnswer } : defaults[key];
  }
  return result;
}

// A saved form's content may predate a later schema_version bump (e.g. a new ADL/behavioral item
// added to the item lists after the form was started) -- a shallow top-level spread only backfills
// missing top-level keys, not keys nested inside section1.items/section2.sensory/section3.items/
// section4.items, so a genuinely new item key would be `undefined` and crash the editor/PDF walk.
// This merges each item map key-by-key against the full default shape, and merges the fixed-shape
// sub-objects (supervision/mobility/medications, summary, participation, etc.) shallowly since
// those don't grow new keys the same way the item maps do.
export function mergeContentWithDefaults(
  defaults: ResidentAssessmentFormContent,
  saved: Partial<ResidentAssessmentFormContent> | null | undefined,
): ResidentAssessmentFormContent {
  if (!saved) return defaults;
  return {
    ...defaults,
    ...saved,
    residentInfo: { ...defaults.residentInfo, ...saved.residentInfo },
    assessmentInfo: { ...defaults.assessmentInfo, ...saved.assessmentInfo },
    section1: {
      ...defaults.section1,
      ...saved.section1,
      items: mergeItemMap(defaults.section1.items, saved.section1?.items),
      supervision: { ...defaults.section1.supervision, ...saved.section1?.supervision },
      mobility: { ...defaults.section1.mobility, ...saved.section1?.mobility },
      medications: { ...defaults.section1.medications, ...saved.section1?.medications },
    },
    section2: {
      ...defaults.section2,
      ...saved.section2,
      sensory: mergeItemMap(defaults.section2.sensory, saved.section2?.sensory),
    },
    section3: {
      ...defaults.section3,
      ...saved.section3,
      items: mergeItemMap(defaults.section3.items, saved.section3?.items),
    },
    section4: {
      ...defaults.section4,
      ...saved.section4,
      items: mergeItemMap(defaults.section4.items, saved.section4?.items),
    },
    summary: { ...defaults.summary, ...saved.summary },
    participation: { ...defaults.participation, ...saved.participation },
  };
}

export function createEmptyContent(formType: FormType): ResidentAssessmentFormContent {
  return {
    residentInfo: { comments: "" },
    assessmentInfo: { lastAssessmentDate: "", lastSupportPlanDate: "", assessmentReason: "", supportPlanReason: "", changeDescription: "" },
    section1: {
      items: itemsFor(ADL_ITEMS),
      supervision: { level: "", needsDescription: "", planDescription: "", planResponsibleParty: "", planResponsiblePartyOther: "" },
      mobility: { level: "", needsDescription: "", planDescription: "", planResponsibleParty: "", planResponsiblePartyOther: "" },
      medications: { level: "", needsDescription: "", planDescription: "", planResponsibleParty: "", planResponsiblePartyOther: "" },
    },
    section2: {
      physicalDiagnoses: [], noPhysicalDiagnoses: false,
      dental: [], noDental: false,
      dietary: [], noDietary: false,
      sensory: simpleItemsFor(SENSORY_ITEMS),
    },
    section3: {
      psychologicalDiagnoses: [], noPsychologicalDiagnoses: false,
      items: itemsFor(behavioralItems(formType)),
    },
    section4: { items: simpleItemsFor(SOCIAL_ITEMS) },
    summary: { overallWellness: "" },
    participation: { assessorName: "", assessorTitle: "", assessorSignedDate: "", participants: [] },
  };
}

// Which of the editor's 6 tabs a piece of content belongs to -- used to flag unanswered sections
// without blocking save/finalize/PDF export. A facility can still have a legitimate reason to
// finalize with gaps (e.g. a resident refuses part of the assessment), so this is advisory only:
// surfaced as a badge/banner in the editor and a notice on the generated PDF, never a hard stop.
export type FormSectionKey = "info" | "section1" | "section2" | "section3" | "section4" | "summary";
export const SECTION_LABELS: Record<FormSectionKey, string> = {
  info: "Resident & Assessment Info",
  section1: "Personal Care, Supervision, Mobility, Meds",
  section2: "Medical, Dental, Dietary, Sensory",
  section3: "Mental / Behavioral / Cognitive",
  section4: "Social & Recreational",
  summary: "Summary & Participation",
};

function degreeItemAnswered(item: DegreeItemAnswer, formType: FormType): boolean {
  const degreeAnswered = formType === "ASP" ? !!item.degreePreliminary && !!item.degreeAllOther : !!item.degree;
  const needAnswered = item.serviceNeedNotApplicable || !!item.serviceNeedDescription.trim();
  const planAnswered = item.planNotApplicable || !!item.planDescription.trim();
  return degreeAnswered && needAnswered && planAnswered;
}

function simpleNeedAnswered(item: SimpleNeedAnswer): boolean {
  return item.applicable === false || !!item.description.trim();
}

function diagnosisRowsAnswered(rows: DiagnosisRow[], none: boolean): boolean {
  return none || (rows.length > 0 && rows.every((r) => !!r.description.trim()));
}

// Deliberately mirrors what a preparer would reasonably need to have typed before signing off --
// not a check against every optional field (e.g. participants/comments are opt-in, so their
// absence doesn't flag the summary tab).
export function getIncompleteSections(content: ResidentAssessmentFormContent, formType: FormType): FormSectionKey[] {
  const incomplete: FormSectionKey[] = [];

  if (!content.assessmentInfo.assessmentReason || !content.assessmentInfo.supportPlanReason) {
    incomplete.push("info");
  }

  const section1Answered =
    (["supervision", "mobility", "medications"] as const).every((key) =>
      !!content.section1[key].needsDescription.trim() && !!content.section1[key].planDescription.trim())
    && ADL_ITEMS.every((item) => degreeItemAnswered(content.section1.items[item.key], formType));
  if (!section1Answered) incomplete.push("section1");

  const section2Answered =
    diagnosisRowsAnswered(content.section2.physicalDiagnoses, content.section2.noPhysicalDiagnoses)
    && diagnosisRowsAnswered(content.section2.dental, content.section2.noDental)
    && diagnosisRowsAnswered(content.section2.dietary, content.section2.noDietary)
    && SENSORY_ITEMS.every((item) => simpleNeedAnswered(content.section2.sensory[item.key]));
  if (!section2Answered) incomplete.push("section2");

  const section3Answered =
    diagnosisRowsAnswered(content.section3.psychologicalDiagnoses, content.section3.noPsychologicalDiagnoses)
    && behavioralItems(formType).every((item) => degreeItemAnswered(content.section3.items[item.key], formType));
  if (!section3Answered) incomplete.push("section3");

  const section4Answered = SOCIAL_ITEMS.every((item) => simpleNeedAnswered(content.section4.items[item.key]));
  if (!section4Answered) incomplete.push("section4");

  const summaryAnswered =
    !!content.summary.overallWellness.trim()
    && !!content.participation.assessorName.trim()
    && !!content.participation.assessorTitle.trim()
    && !!content.participation.assessorSignedDate.trim();
  if (!summaryAnswered) incomplete.push("summary");

  return incomplete;
}
