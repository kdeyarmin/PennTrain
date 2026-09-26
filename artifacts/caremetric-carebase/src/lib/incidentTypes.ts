/** Reportable categories in 55 Pa. Code 2600.16(a) / 2800.16(a). */
export const INCIDENT_TYPE_OPTIONS = [
  "death", "suspicious_death", "suicide_attempt", "elopement", "abuse_allegation",
  "sexual_abuse", "neglect_allegation", "medication_error", "significant_injury",
  "serious_bodily_injury", "assault", "resident_rights_violation", "misuse_of_funds",
  "communicable_disease_outbreak", "food_poisoning", "fire", "environmental_emergency",
  "emergency_services", "unscheduled_closure", "bankruptcy", "criminal_conviction",
  "utility_termination_notice", "health_safety_violation", "inadequate_staffing", "other",
] as const;

export function incidentTypesForFacility(facilityType: string | undefined) {
  return INCIDENT_TYPE_OPTIONS.filter(type => type !== "inadequate_staffing" || facilityType === "ALR");
}

export const INCIDENT_NOTIFICATION_TYPE_OPTIONS = [
  "state_hotline", "family_guardian", "resident", "resident_family", "designated_person",
  "law_enforcement", "licensing_agency", "protective_services", "department_of_aging",
  "prescriber", "supervision_plan", "written_report", "other",
] as const;
