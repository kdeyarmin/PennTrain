// Resident 360 care header (program plan Phase 1a) -- display contract for
// public.get_resident_care_header(). Pure: label maps, risk emphasis, and staleness only.
//
// Every coded field defaults to "not assessed" / "not documented" server-side rather than NULL, and
// this module renders those states explicitly. A blank header cell reads as "no risk" to a person
// scanning it at 3am; "Not assessed" reads as what it is -- an open question. That distinction is
// the whole reason these fields are enumerated instead of free text.

export type CareHeaderTone = "neutral" | "attention" | "critical";

export interface ResidentCareHeader {
  generatedAt: string;
  resident: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    photoDocumentId: string | null;
    room: string | null;
    status: string;
    admissionDate: string;
    dischargeDate: string | null;
    hospice: boolean;
    sdcu: boolean;
  };
  facility: { id: string; name: string; facilityType: string | null } | null;
  care: {
    levelOfCare: string;
    transferAssistance: string;
    ambulationStatus: string;
    fallRisk: string;
    elopementRisk: string;
    cognitiveStatus: string;
    codeStatus: string;
    advanceDirectiveStatus: string;
    allergies: string[];
    foodAllergies: string[];
    mobilitySummary: string | null;
    supervisionRequirements: string | null;
    asOf: string | null;
  };
  diet: {
    dietOrder: string | null;
    textureConsistency: string;
    liquidConsistency: string;
    asOf: string | null;
  } | null;
  hospital: {
    state: HospitalState;
    episodeId: string | null;
    destination: string | null;
    since: string | null;
    expectedReturnAt: string | null;
  };
  lastAssessment: { completedOn: string; label: string } | null;
  supportPlan: {
    id: string;
    versionNumber: number;
    state: string;
    effectiveDate: string | null;
    reviewDueDate: string | null;
  } | null;
  /**
   * An approved plan whose effective date has passed while it is still not active -- the scheduled
   * promotion did not run. Null in the normal case.
   *
   * Reported separately from `supportPlan` because that is the plan IN FORCE: the header prefers the
   * active row, which is right for "what governs care today" and is precisely why a stalled newer
   * version had no way to surface.
   */
  pendingActivation: {
    id: string;
    versionNumber: number;
    effectiveDate: string;
  } | null;
}

export type HospitalState = "in_facility" | "out_at_hospital" | "returned_reconciliation_incomplete";

export const LEVEL_OF_CARE_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  independent: "Independent",
  prompting_cueing: "Prompting / cueing",
  some_physical_assistance: "Some physical assistance",
  total_physical_assistance: "Total physical assistance",
};

export const TRANSFER_ASSISTANCE_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  independent: "Independent",
  supervision: "Supervision",
  one_person: "One-person assist",
  two_person: "Two-person assist",
  mechanical_lift: "Mechanical lift",
};

export const AMBULATION_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  independent: "Independent",
  cane: "Cane",
  walker: "Walker",
  rollator: "Rollator",
  wheelchair: "Wheelchair",
  bedfast: "Bedfast",
};

export const FALL_RISK_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

export const ELOPEMENT_RISK_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  none: "None",
  monitored: "Monitored",
  high: "High",
};

export const COGNITIVE_STATUS_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  no_impairment: "No impairment",
  mild_impairment: "Mild impairment",
  moderate_impairment: "Moderate impairment",
  severe_impairment: "Severe impairment",
};

export const CODE_STATUS_LABELS: Record<string, string> = {
  not_documented: "Not documented",
  full_code: "Full code",
  dnr: "DNR",
  dnr_dni: "DNR / DNI",
  polst_on_file: "POLST on file",
};

export const TEXTURE_LABELS: Record<string, string> = {
  regular: "Regular",
  soft_and_bite_sized: "Soft & bite-sized",
  minced_and_moist: "Minced & moist",
  pureed: "Pureed",
  liquidized: "Liquidized",
  other: "Other",
};

export const LIQUID_LABELS: Record<string, string> = {
  thin: "Thin",
  slightly_thick: "Slightly thick",
  mildly_thick: "Mildly thick",
  moderately_thick: "Moderately thick",
  extremely_thick: "Extremely thick",
  other: "Other",
};

const HOSPITAL_LABELS: Record<HospitalState, string> = {
  in_facility: "In facility",
  out_at_hospital: "Out at hospital",
  returned_reconciliation_incomplete: "Returned — reconciliation open",
};

/** Values that mean "nobody has answered this yet" rather than "answered: no risk". */
const UNANSWERED = new Set(["not_assessed", "not_documented"]);

/** Values that should draw the eye on a header scanned in seconds. */
const CRITICAL_VALUES = new Set(["high", "two_person", "mechanical_lift", "severe_impairment", "bedfast"]);
const ATTENTION_VALUES = new Set(["moderate", "monitored", "moderate_impairment", "total_physical_assistance"]);

export function careValueTone(value: string): CareHeaderTone {
  if (CRITICAL_VALUES.has(value)) return "critical";
  if (ATTENTION_VALUES.has(value)) return "attention";
  // An unanswered field is an open question, not a safe default -- flag it rather than greying it.
  if (UNANSWERED.has(value)) return "attention";
  return "neutral";
}

export function hospitalStateLabel(state: HospitalState): string {
  return HOSPITAL_LABELS[state] ?? HOSPITAL_LABELS.in_facility;
}

export function hospitalStateTone(state: HospitalState): CareHeaderTone {
  if (state === "out_at_hospital") return "critical";
  if (state === "returned_reconciliation_incomplete") return "attention";
  return "neutral";
}

export interface CareHeaderField {
  key: string;
  label: string;
  value: string;
  tone: CareHeaderTone;
  /** Secondary line -- free-text context the coded value cannot carry. */
  detail?: string;
}

function labeled(map: Record<string, string>, value: string) {
  return map[value] ?? value;
}

function allergyValue(allergies: string[], foodAllergies: string[]) {
  const combined = [...allergies, ...foodAllergies].map((entry) => entry.trim()).filter(Boolean);
  return combined.length ? Array.from(new Set(combined)).join(", ") : "None recorded";
}

/**
 * The ordered header fields. Order is the scan order a nurse or aide actually uses: who and where
 * first, then the things that change how you physically approach the resident, then the things that
 * change what you do in an emergency.
 */
export function careHeaderFields(header: ResidentCareHeader): CareHeaderField[] {
  const { care, diet } = header;
  const allergies = allergyValue(care.allergies, care.foodAllergies);

  return [
    {
      key: "level_of_care",
      label: "Level of care",
      value: labeled(LEVEL_OF_CARE_LABELS, care.levelOfCare),
      tone: careValueTone(care.levelOfCare),
    },
    {
      key: "mobility",
      label: "Mobility",
      value: labeled(AMBULATION_LABELS, care.ambulationStatus),
      tone: careValueTone(care.ambulationStatus),
      detail: care.mobilitySummary ?? undefined,
    },
    {
      key: "transfer",
      label: "Transfer",
      value: labeled(TRANSFER_ASSISTANCE_LABELS, care.transferAssistance),
      tone: careValueTone(care.transferAssistance),
    },
    {
      key: "diet",
      label: "Diet & texture",
      value: diet
        ? [diet.dietOrder || "Diet not specified", labeled(TEXTURE_LABELS, diet.textureConsistency)].join(" · ")
        : "No dietary profile",
      // A missing dietary profile is not the same as "regular diet" and must not read like one.
      tone: diet ? "neutral" : "attention",
      detail: diet ? `Liquids: ${labeled(LIQUID_LABELS, diet.liquidConsistency)}` : undefined,
    },
    {
      key: "allergies",
      label: "Allergies",
      value: allergies,
      tone: allergies === "None recorded" ? "neutral" : "critical",
    },
    {
      key: "fall_risk",
      label: "Fall risk",
      value: labeled(FALL_RISK_LABELS, care.fallRisk),
      tone: careValueTone(care.fallRisk),
    },
    {
      key: "elopement_risk",
      label: "Elopement risk",
      value: labeled(ELOPEMENT_RISK_LABELS, care.elopementRisk),
      tone: careValueTone(care.elopementRisk),
    },
    {
      key: "cognitive_status",
      label: "Cognition",
      value: labeled(COGNITIVE_STATUS_LABELS, care.cognitiveStatus),
      tone: careValueTone(care.cognitiveStatus),
      detail: care.supervisionRequirements ?? undefined,
    },
    {
      key: "code_status",
      label: "Code status",
      value: labeled(CODE_STATUS_LABELS, care.codeStatus),
      tone: careValueTone(care.codeStatus),
    },
  ];
}

/**
 * How many days old the coded care profile is, or null when it has never been reviewed.
 * `now` is injected so this stays deterministic under test.
 */
export function careProfileAgeInDays(asOf: string | null, now: Date = new Date()): number | null {
  if (!asOf) return null;
  const reviewed = new Date(asOf);
  if (Number.isNaN(reviewed.getTime())) return null;
  return Math.floor((now.getTime() - reviewed.getTime()) / 86_400_000);
}

/**
 * PA support plans are reviewed at least annually (55 Pa. Code Ch. 2600/2800), so a care header that
 * has not been touched in a year cannot be presented as current. Mirrors STALE_ASSESSMENT_DAYS in
 * careLevelReview.ts deliberately -- the same regulatory cadence drives both.
 */
export const STALE_CARE_PROFILE_DAYS = 365;

export function isCareProfileStale(asOf: string | null, now: Date = new Date()): boolean {
  const age = careProfileAgeInDays(asOf, now);
  // Never reviewed counts as stale: an all-defaults header is exactly the case worth flagging.
  if (age === null) return true;
  return age >= STALE_CARE_PROFILE_DAYS;
}

export function residentDisplayName(resident: ResidentCareHeader["resident"]): string {
  const preferred = resident.preferredName?.trim();
  const formal = `${resident.lastName}, ${resident.firstName}`;
  return preferred ? `${formal} ("${preferred}")` : formal;
}

export function residentInitials(resident: ResidentCareHeader["resident"]): string {
  return `${resident.firstName.charAt(0)}${resident.lastName.charAt(0)}`.toUpperCase();
}
