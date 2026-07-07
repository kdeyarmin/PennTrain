// Shared across ResidentDetail.tsx, Residents.tsx, and ResidentComplianceReport.tsx so the three
// don't drift -- item-type labels and status-badge styling for the resident RASP/ASP compliance
// registry (Tier 3.5/3.6).

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
  if (itemType === "medical_evaluation") return "DME (Documentation of Medical Evaluation)";
  if (itemType === "preadmission_screening") return "Preadmission Screening";
  return getComplianceFormLabel(facilityType);
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
