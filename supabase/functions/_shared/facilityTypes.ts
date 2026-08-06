// Mirrors artifacts/caremetric-carebase/src/lib/facilityTypes.ts's facilityTypeLabel -- this org's
// convention (see /CLAUDE.md) is "Assisted Living Facility (ALF)" in every user-facing string,
// never "ALR" or "Assisted Living Residence", even though the stored facility_type value itself
// stays "ALR". Kept in step with that file by comment cross-reference rather than a shared import
// -- edge functions' Deno runtime and the Vite app are separate deploy targets.

const FACILITY_TYPE_LABELS: Record<string, string> = {
  PCH: "Personal Care Home (PCH)",
  ALR: "Assisted Living Facility (ALF)",
  NH: "Skilled Nursing Facility (SNF/NH)",
  HHA: "Home Health Agency (HHA)",
  HOS: "Hospice Agency (HOS)",
  GH: "Group Home (GH)",
};

export function facilityTypeLabel(facilityType: string | null | undefined): string {
  if (!facilityType) return "Unknown";
  return FACILITY_TYPE_LABELS[facilityType] ?? facilityType;
}
