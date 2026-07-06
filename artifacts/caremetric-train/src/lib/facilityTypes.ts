export type FacilityType = "PCH" | "ALR" | "NH" | "HHA" | "HOS" | "GH";

export const FACILITY_TYPES: { value: FacilityType; label: string }[] = [
  { value: "PCH", label: "PCH" },
  { value: "ALR", label: "ALR" },
  { value: "NH", label: "NH" },
  { value: "HHA", label: "HHA" },
  { value: "HOS", label: "HOS" },
  { value: "GH", label: "GH" },
];

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
