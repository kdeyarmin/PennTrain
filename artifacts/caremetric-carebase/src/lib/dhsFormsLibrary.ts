/**
 * Static catalog of the official PA DHS/BHSL PCH & ALR compliance forms, mirrored from
 * https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-forms
 * (verified 2026-07-13). Every url below is the live pa.gov-hosted PDF -- this app never rehosts
 * a copy, since DHS revises these forms periodically (several filenames carry their own revision
 * dates) and a mirrored copy would silently go stale. Category grouping mirrors the source page's
 * own PCH / ALR / Model Forms / Additional Resources structure rather than re-deriving facility-type
 * applicability from regulatory first principles.
 *
 * Category and form titles say "Assisted Living Facility (ALF)" per this org's terminology
 * convention (see facilityTypes.ts) even where DHS's own page/filenames say "Assisted Living
 * Residence" / "ALR" -- the stored facilityTypes code stays "ALR" to match the rest of the app.
 */
import type { FacilityType } from "./facilityTypes";

export const DHS_FORM_CATEGORIES = [
  "Personal Care Home (PCH) Required Forms",
  "Assisted Living Facility (ALF) Required Forms",
  "Model Forms (Optional/Recommended)",
  "Additional Resources & Guidance",
] as const;

export type DhsFormCategory = (typeof DHS_FORM_CATEGORIES)[number];

export interface DhsFormAutoFill {
  /** Button/link label shown next to the download link. */
  label: string;
  /** In-app route where this form's auto-fill or prefill workflow lives. */
  path: string;
}

export interface DhsForm {
  id: string;
  title: string;
  category: DhsFormCategory;
  facilityTypes: FacilityType[];
  description: string;
  url: string;
  format: "PDF" | "Online Application";
  /** Present when CareMetric can auto-fill or prefill the official PDF from stored data. */
  autoFill?: DhsFormAutoFill;
}

const STATE_FORMS_CENTER: DhsFormAutoFill = { label: "Open in State Forms", path: "/app/state-forms" };
const INCIDENTS: DhsFormAutoFill = { label: "Open in Incidents", path: "/app/incidents" };

export const DHS_FORMS: DhsForm[] = [
  // ---------- Application (shared) ----------
  {
    id: "application-for-licensure",
    title: "Application for Licensure",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH", "ALR"],
    description: "Initial licensure application for a new Personal Care Home or Assisted Living Facility (ALF).",
    url: "https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/app-for-license",
    format: "Online Application",
  },

  // ---------- PCH Required Forms ----------
  {
    id: "pch-reportable-incident",
    title: "Reportable Incident Form",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Report a reportable incident to DHS/BHSL within the required time frame.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Homes-Reportable_Incident_Form-Effective-October-1-2016.pdf",
    format: "PDF",
    autoFill: INCIDENTS,
  },
  {
    id: "pch-waiver-of-regulation",
    title: "Request For Waiver Of Regulation",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Request an exemption from a specific 55 Pa. Code Chapter 2600 regulation.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Homes-Request_For_Waiver_Of_Regulation.pdf",
    format: "PDF",
  },
  {
    id: "pch-preadmission-screening",
    title: "Preadmission Screening",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Assess whether a prospective resident's needs can be met before admission.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Preadmission-Screening.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "pch-dme",
    title: "Documentation of Medical Evaluation (DME)",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Physician/CRNP/PA documentation of the medical evaluation required at admission and annually.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-25-personal-care-homes-dme-reupload.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "pch-rasp",
    title: "Resident Assessment-Support Plan (RASP)",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Individual assessment and support plan documenting each resident's care needs.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Resident_Assessment_Support_Plan_RASP.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "pch-resident-rights-en",
    title: "Resident Rights Poster (English)",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Required facility posting of resident rights under 55 Pa. Code Chapter 2600.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-04-11-pch-resident-rights-poster.pdf",
    format: "PDF",
  },
  {
    id: "pch-resident-rights-es",
    title: "Resident Rights Poster (Spanish)",
    category: "Personal Care Home (PCH) Required Forms",
    facilityTypes: ["PCH"],
    description: "Spanish-language resident rights posting.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-11-07-pch-residence-rights-poster-spanish.pdf",
    format: "PDF",
  },

  // ---------- Assisted Living Facility (ALF) Required Forms ----------
  {
    id: "alf-dme",
    title: "Assisted Living Facility (ALF) — Documentation of Medical Evaluation",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Physician/CRNP/PA documentation of the medical evaluation required at admission and annually.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-24-assisted-living-residences-dme.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "alf-preadmission-screening",
    title: "Assisted Living Facility (ALF) — Preadmission Screening Form",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Assess whether a prospective resident's needs can be met before admission.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Preadmission_Screening_Form.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "alf-asp",
    title: "Assisted Living Facility (ALF) — Assessment-Support Plan (ASP) Form",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Individual assessment and support plan documenting each resident's care needs.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Assessment_Support_Plan_Form.pdf",
    format: "PDF",
    autoFill: STATE_FORMS_CENTER,
  },
  {
    id: "alf-excludable-condition",
    title: "Assisted Living Facility (ALF) — Request to Admit a Resident with an Excludable Condition",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Seek approval to admit or retain a resident with a condition that would otherwise exclude them.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Request_to_Admit_a_Resident_with_an_Excludable_Condition_Form.pdf",
    format: "PDF",
  },
  {
    id: "alf-reportable-incident",
    title: "Assisted Living Facility (ALF) — Reportable Incident Form",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Report a reportable incident to DHS/BHSL within the required time frame.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assited_Living-Reportable_Incident_Form_Effective_October_1_2016.pdf",
    format: "PDF",
    autoFill: INCIDENTS,
  },
  {
    id: "alf-waiver-of-regulation",
    title: "Assisted Living Facility (ALF) — Request for Waiver of Regulation",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Request an exemption from a specific 55 Pa. Code Chapter 2800 regulation.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Request_for-Waiver-of-Regulation-Form.pdf",
    format: "PDF",
  },
  {
    id: "alf-resident-rights-en",
    title: "Assisted Living Facility (ALF) Resident Rights Poster (English)",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Required facility posting of resident rights under 55 Pa. Code Chapter 2800.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-04-11-alr-resident-rights-poster.pdf",
    format: "PDF",
  },
  {
    id: "alf-resident-rights-es",
    title: "Assisted Living Facility (ALF) Resident Rights Poster (Spanish)",
    category: "Assisted Living Facility (ALF) Required Forms",
    facilityTypes: ["ALR"],
    description: "Spanish-language resident rights posting.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-11-7-alr-residence-rights-poster-spanish.pdf",
    format: "PDF",
  },

  // ---------- Model Forms (Optional/Recommended) ----------
  {
    id: "model-financial-transactions",
    title: "Record of Financial Transactions",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for tracking resident financial transactions the facility manages.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Record_of_Financial_Transactions.pdf",
    format: "PDF",
  },
  {
    id: "model-cash-distribution",
    title: "Cash Distribution Record",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for documenting cash disbursed to or for a resident.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Cash_Distribution_Record.pdf",
    format: "PDF",
  },
  {
    id: "model-quarterly-financial-summary",
    title: "Quarterly Financial Summary",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for the quarterly summary of resident funds managed by the facility.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Quarterly_Financial_Summary.pdf",
    format: "PDF",
  },
  {
    id: "model-record-of-training",
    title: "Record of Training",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for logging individual staff training completion.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Record_of_Training.pdf",
    format: "PDF",
  },
  {
    id: "model-staff-training-plan",
    title: "Staff Training Plan",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for planning required staff training topics and schedule.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Staff_Training_Plan.pdf",
    format: "PDF",
  },
  {
    id: "model-fire-drill-record",
    title: "Fire Drill Record",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for logging fire drills, including shift, participation, and follow-up.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Fire_Drill_Record.pdf",
    format: "PDF",
  },
  {
    id: "model-resident-home-contract",
    title: "Resident-Home Contract",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model resident admission agreement covering services, fees, and facility rules.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Adult_Residential_Licensing-Resident_Home_Agreement.pdf",
    format: "PDF",
  },
  {
    id: "model-addendum-c-rent-rebates",
    title: "Addendum C to Resident-Home Contract (Rent Rebates)",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model addendum documenting rent rebate/credit arrangements.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Addendum_C_To_Resident_Home_Contract-Rent-Rebates.pdf",
    format: "PDF",
  },
  {
    id: "model-medication-administration-record",
    title: "Medication Administration Record",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model MAR for tracking medication administration.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Medication_Administration_Record.pdf",
    format: "PDF",
  },
  {
    id: "model-fire-safety-inspection-drill",
    title: "Supervised Fire Drill and Fire-Safety Inspection Document",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form pairing a supervised fire drill with a fire-safety inspection checklist.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Model_Fire_Safety_Inspection_and_Supervised_Drill_Document.pdf",
    format: "PDF",
  },
  {
    id: "model-evacuation-time-designation",
    title: "Evacuation Time Designation Document",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH", "ALR"],
    description: "Model form for documenting each resident's designated evacuation time/assistance needs.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Model_Evacuation_Time_Designation_Document.pdf",
    format: "PDF",
  },
  {
    id: "pch-entrance-conference-guide",
    title: "Personal Care Home Entrance Conference Guide",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["PCH"],
    description: "DHS's interview guide for what surveyors ask at the entrance conference.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Entrance_Conference_Guide.pdf",
    format: "PDF",
  },
  {
    id: "alf-entrance-conference-guide",
    title: "Assisted Living Facility (ALF) Entrance Conference Guide",
    category: "Model Forms (Optional/Recommended)",
    facilityTypes: ["ALR"],
    description: "DHS's interview guide for what surveyors ask at the entrance conference.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Entrance_Conference_Guide.pdf",
    format: "PDF",
  },

  // ---------- Additional Resources & Guidance ----------
  {
    id: "act-70-abuse-reporting",
    title: "Mandatory Abuse Reporting Form (Act 70)",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH", "ALR"],
    description: "Older Adults Protective Services Act mandatory reporting form for suspected abuse, neglect, or exploitation.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/about/fraud-and-abuse/documents/Act-70-Form.pdf",
    format: "PDF",
  },
  {
    id: "influenza-awareness-act",
    title: "Influenza Awareness Act",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH", "ALR"],
    description: "Required influenza awareness/immunization documentation under the Influenza Awareness Act.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Influenza_Awareness_Act.pdf",
    format: "PDF",
  },
  {
    id: "influenza-awareness-poster",
    title: "Influenza Awareness Poster",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH", "ALR"],
    description: "Required facility posting under the Influenza Awareness Act.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/health/documents/topics/documents/diseases-and-conditions/flu/Flu%20poster_for%20law.pdf",
    format: "PDF",
  },
  {
    id: "faqs-unlicensed-pch",
    title: "FAQs About Unlicensed Personal Care Homes",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH"],
    description: "DHS guidance distinguishing licensed PCH operation from unlicensed care arrangements.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Frequently_Asked_Questions-About_Unlicensed_Personal_Care_Homes.pdf",
    format: "PDF",
  },
  {
    id: "self-inspection-capacity-increase-tool",
    title: "Self-Inspection for Capacity Increase Tool",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH", "ALR"],
    description: "Self-assessment tool to use before requesting an increase in licensed capacity.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Self-Inspection_for_Capacity_Increase_Tool.pdf",
    format: "PDF",
  },
  {
    id: "procedures-capacity-increase",
    title: "Procedures for Self-Inspection to Increase Maximum Capacity",
    category: "Additional Resources & Guidance",
    facilityTypes: ["PCH", "ALR"],
    description: "DHS procedures for the self-inspection process required to increase maximum licensed capacity.",
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Procedures_for_Self-Inspection_to_Increase_Maximum_Capacity.pdf",
    format: "PDF",
  },
];

export const DHS_FORMS_SOURCE_URL =
  "https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-forms";
export const DHS_FORMS_LAST_VERIFIED = "2026-07-13";
export const DHS_FORMS_WORD_FORMAT_EMAIL = "ra-pwarlheadquarters@pa.gov";

export function getFormsByCategory(category: DhsFormCategory): DhsForm[] {
  return DHS_FORMS.filter((f) => f.category === category);
}

export function searchDhsForms(query: string): DhsForm[] {
  const q = query.trim().toLowerCase();
  if (!q) return DHS_FORMS;
  return DHS_FORMS.filter(
    (f) =>
      f.title.toLowerCase().includes(q) ||
      f.description.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.facilityTypes.some((ft) => ft.toLowerCase().includes(q) || (ft === "ALR" && q.includes("alf"))),
  );
}

export function dhsFormFacilityTypeLabel(facilityType: FacilityType): string {
  return facilityType === "ALR" ? "ALF" : facilityType;
}
