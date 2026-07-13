// The "ALR" code is a stored value (database column, RLS policies, migrations, existing rows) --
// never rename it without a real migration. What changes is the LABEL: this org calls the facility
// type "Assisted Living Facility (ALF)", not "Assisted Living Residence (ALR)" -- every user-facing
// string (marketing copy, UI labels, dropdown options) should say ALF, never ALR or "Residence".
export type FacilityType = "PCH" | "ALR" | "NH" | "HHA" | "HOS" | "GH";

export const FACILITY_TYPES: { value: FacilityType; label: string }[] = [
  { value: "PCH", label: "Personal Care Home (PCH)" },
  { value: "ALR", label: "Assisted Living Facility (ALF)" },
  { value: "NH", label: "Skilled Nursing Facility (SNF/NH)" },
  { value: "HHA", label: "Home Health Agency (HHA)" },
  { value: "HOS", label: "Hospice Agency (HOS)" },
  { value: "GH", label: "Group Home (GH)" },
];

export function facilityTypeLabel(facilityType: string | null | undefined): string {
  if (!facilityType) return "Unknown";
  return FACILITY_TYPES.find(({ value }) => value === facilityType)?.label ?? facilityType;
}

// Facility types this app's PCH/ALR-specific regulatory modules (resident RASP/ASP tracking,
// medication-admin practicums, the administrator-qualification course, fire-drill logging) have
// working content for -- see the resident_compliance_rule_packs migration and ROADMAP.md. Nav
// items and routes for those modules are hidden for every other facility type (NH, HHA, HOS, GH)
// rather than shown with nothing in them.
export const PCH_ALR_ONLY_FACILITY_TYPES: readonly FacilityType[] = ["PCH", "ALR"];

/** True if any of `candidates` is in `facilityTypes` (always false while `facilityTypes` is undefined/loading). */
export function hasAnyFacilityType(facilityTypes: Set<string> | undefined, candidates: readonly string[]): boolean {
  if (!facilityTypes) return false;
  return candidates.some(c => facilityTypes.has(c));
}

const FACILITY_TYPE_BADGE_CLASSES: Record<FacilityType, string> = {
  PCH: "border-blue-200 text-blue-700 bg-blue-50",
  ALR: "border-violet-200 text-violet-700 bg-violet-50",
  NH: "border-amber-200 text-amber-700 bg-amber-50",
  HHA: "border-teal-200 text-teal-700 bg-teal-50",
  HOS: "border-rose-200 text-rose-700 bg-rose-50",
  GH: "border-lime-200 text-lime-700 bg-lime-50",
};

export function facilityTypeBadgeClass(facilityType: string | null | undefined): string {
  return FACILITY_TYPE_BADGE_CLASSES[facilityType as FacilityType] ?? "border-slate-200 text-slate-600 bg-slate-50";
}
