// The database migration uses the same baseline for new facilities. These are
// chapter-backed defaults, not a replacement for a facility's recorded decision.
export const RESIDENT_POLICY_DEFAULTS = {
  alf_admission_grace_days: 0,
  alf_contract_timing: "within_24_hours",
  revision_grace_days: 5,
  medication_reportability: "statutory_errors",
};

export function residentRegulatoryPolicy(facilityType: string | null | undefined, saved: unknown): Record<string, string | number> | null {
  if (facilityType !== "PCH" && facilityType !== "ALR") return null;
  return {
    ...RESIDENT_POLICY_DEFAULTS,
    ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, string | number> : {}),
  };
}

export function allowsResidentContractAfterAdmission(facilityType: string | null | undefined, saved: unknown): boolean {
  // 2800.22(a)(5) is an ALR admission rule. Never extend it to Chapter 2600.
  return facilityType === "ALR" && residentRegulatoryPolicy(facilityType, saved)?.alf_contract_timing === "within_24_hours";
}
