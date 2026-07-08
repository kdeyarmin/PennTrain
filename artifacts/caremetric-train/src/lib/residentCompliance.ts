// Shared across ResidentDetail.tsx, Residents.tsx, and ResidentComplianceReport.tsx so the three
// don't drift -- item-type labels and status-badge styling for the resident RASP/ASP compliance
// registry (Tier 3.5/3.6).


export type StateApprovedFormInfo = {
  label: string;
  url: string;
  sourceLabel: string;
};

const DHS_PCH_FORMS = {
  preadmission: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Preadmission-Screening.pdf",
  dme: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-25-personal-care-homes-dme-reupload.pdf",
  rasp: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Resident_Assessment_Support_Plan_RASP.pdf",
};

const DHS_ALR_FORMS = {
  preadmission: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Preadmission_Screening_Form.pdf",
  dme: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-07-24-assisted-living-residences-dme.pdf",
  asp: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Assessment_Support_Plan_Form.pdf",
};

const DHS_FORMS_INDEX_URL = "https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-forms";

// Day-counts dropped from these labels on purpose: PCH's initial assessment is due 15 days after
// admission, while ALR's is normally due 30 days *before* admission (opposite direction) -- a
// hardcoded "15-Day"/"30-Day" prefix would be actively wrong for whichever facility type it
// doesn't match. The row's own due_date carries the real deadline.
export const ITEM_TYPE_LABELS: Record<string, string> = {
  preadmission_screening: "Preadmission Screening",
  initial_assessment_15day: "Initial Assessment",
  support_plan_30day: "Support Plan",
  annual_reassessment: "Annual Reassessment",
  medical_evaluation: "Medical Evaluation",
  significant_change_reassessment: "Significant Change Reassessment",
};

// RASP = PA DHS's name for the Personal Care Home (Ch. 2600) form; ALR's equivalent under Ch. 2800
// is called "ASP" (no "R") -- distinct forms, not just a labeling difference.
export function getComplianceFormLabel(facilityType: string | undefined): string {
  if (facilityType === "PCH") return "RASP";
  if (facilityType === "ALR") return "ASP";
  return "Resident Compliance";
}

// Names the specific DHS-prescribed form each item type requires as evidence -- every item type
// maps to a real state form (see documentTemplates.ts's FE-03 "Official DHS Forms Index"), so this
// covers all six, not just the four the digital RASP/ASP editor drafts. Used by the "attach the
// state form" completion dialog so the prompt names the actual document staff need in hand instead
// of a generic "upload a file."
export function getRequiredStateFormLabel(itemType: string, facilityType: string | undefined): string {
  return getRequiredStateFormInfo(itemType, facilityType).label;
}

// Returns the official PA DHS-published form the user must complete/upload for the compliance
// item. The URLs intentionally point at pa.gov/DHS assets (or the DHS forms index as a fallback),
// not CareMetric-generated templates, because these completion workflows are only valid when the
// actual state-approved form is attached.
export function getRequiredStateFormInfo(itemType: string, facilityType: string | undefined): StateApprovedFormInfo {
  if (facilityType !== "PCH" && facilityType !== "ALR") {
    return { label: "PA DHS state-approved resident compliance form", url: DHS_FORMS_INDEX_URL, sourceLabel: "PA DHS PCH/ALR Compliance Forms index" };
  }

  const isAlr = facilityType === "ALR";
  const forms = isAlr ? DHS_ALR_FORMS : DHS_PCH_FORMS;
  const facilityLabel = isAlr ? "Assisted Living Facility (ALF)" : "Personal Care Home";
  }
  if (itemType === "preadmission_screening") {
    return { label: "Preadmission Screening", url: forms.preadmission, sourceLabel: `PA DHS ${facilityLabel} Preadmission Screening form` };
  }
  if (facilityType === "PCH") {
    return { label: "RASP (Resident Assessment-Support Plan)", url: DHS_PCH_FORMS.rasp, sourceLabel: "PA DHS Personal Care Home RASP form" };
  }
  if (facilityType === "ALR") {
    return { label: "ASP (Assessment-Support Plan)", url: DHS_ALR_FORMS.asp, sourceLabel: "PA DHS Assisted Living Residence ASP form" };
  }
  return { label: "PA DHS state-approved resident compliance form", url: DHS_FORMS_INDEX_URL, sourceLabel: "PA DHS PCH/ALR Compliance Forms index" };
}

// Lower rank = worse. Used to roll many items (one resident, or a whole facility) up into a
// single "worst status" badge.
const STATUS_RANK: Record<string, number> = {
  expired: 0,
  missing: 1,
  due_soon: 2,
  compliant: 3,
  not_applicable: 4,
};

export function worstComplianceStatus(statuses: string[]): string {
  if (!statuses.length) return "not_applicable";
  return statuses.reduce((worst, s) => ((STATUS_RANK[s] ?? 99) < (STATUS_RANK[worst] ?? 99) ? s : worst));
}

export function complianceStatusBadgeClassName(status: string): string {
  return status === "compliant" ? "bg-success text-success-foreground hover:bg-success/80"
    : status === "due_soon" ? "bg-warning text-warning-foreground hover:bg-warning/80"
    : status === "expired" ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
    : status === "not_applicable" ? "bg-muted text-muted-foreground"
    : "bg-muted text-muted-foreground"; // missing
}

// Postgres `date` columns come back as a bare "YYYY-MM-DD" string. new Date(that) parses it as UTC
// midnight, so toLocaleDateString() in a timezone west of UTC renders the previous calendar day.
// Building the Date from local year/month/day components instead avoids the conversion entirely.
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}
