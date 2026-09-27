import type { ClinicalChartSummary, ClinicalObservation, ObservationType } from "@/hooks/useClinicalObservations";

export const OBSERVATION_CONFIG: Record<
  ObservationType,
  { label: string; shortLabel?: string; unit: string; secondaryLabel?: string; loinc?: string }
> = {
  blood_pressure: { label: "Blood pressure", shortLabel: "BP", unit: "mm[Hg]", secondaryLabel: "Diastolic", loinc: "85354-9" },
  heart_rate: { label: "Heart rate", shortLabel: "Pulse", unit: "/min", loinc: "8867-4" },
  respiratory_rate: { label: "Respiratory rate", shortLabel: "Resp", unit: "/min", loinc: "9279-1" },
  temperature: { label: "Temperature", shortLabel: "Temp", unit: "Cel", loinc: "8310-5" },
  spo2: { label: "Oxygen saturation (SpO₂)", shortLabel: "SpO₂", unit: "%", loinc: "59408-5" },
  weight: { label: "Weight", shortLabel: "Weight", unit: "kg", loinc: "29463-7" },
  height: { label: "Height", shortLabel: "Height", unit: "cm", loinc: "8302-2" },
  bmi: { label: "Body mass index", shortLabel: "BMI", unit: "kg/m2", loinc: "39156-5" },
  blood_glucose: { label: "Blood glucose", shortLabel: "Glucose", unit: "mg/dL", loinc: "2339-0" },
  pain_score: { label: "Pain score (0–10)", shortLabel: "Pain", unit: "{score}", loinc: "72514-3" },
  o2_flow: { label: "Oxygen flow", shortLabel: "O₂ flow", unit: "L/min", loinc: "3151-8" },
  custom: { label: "Custom observation", unit: "" },
};

export const OBSERVATION_ORDER: ObservationType[] = [
  "blood_pressure", "heart_rate", "respiratory_rate", "temperature", "spo2",
  "blood_glucose", "pain_score", "o2_flow", "weight", "height", "bmi", "custom",
];

export interface ObservationFormValues {
  observationType: ObservationType;
  valueNumeric: string;
  valueSecondary: string;
  valueText: string;
  customLabel: string;
}

/** UCUM codes are what the chart stores. People at the bedside do not read "Cel" as Celsius. */
const OBSERVATION_UNIT_LABELS: Record<string, string> = {
  Cel: "°C",
  "mm[Hg]": "mmHg",
  "kg/m2": "kg/m²",
};

export function formatObservationUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  return OBSERVATION_UNIT_LABELS[unit] ?? unit;
}

/** Only visible inputs can satisfy the form or become charted values. */
export function hasObservationFormValue(input: ObservationFormValues): boolean {
  if (input.observationType === "custom") {
    return Boolean(input.customLabel.trim() && (input.valueNumeric.trim() || input.valueText.trim()));
  }
  if (input.observationType === "blood_pressure") {
    return Boolean(input.valueNumeric.trim() && input.valueSecondary.trim());
  }
  return Boolean(input.valueNumeric.trim());
}

/**
 * Same bounds as `app_private.assert_plausible_observation_reading`. A reading the
 * server will refuse should fail here, before a draft is queued.
 */
export function observationReadingError(type: ObservationType, value: number | null, secondary: number | null): string | null {
  if (value === null) return null;
  if (type === "blood_pressure") {
    if (secondary === null) return "Blood pressure needs both a systolic and a diastolic reading.";
    if (value < 30 || value > 300 || secondary < 15 || secondary > 220 || secondary >= value) {
      return "Blood pressure readings must be plausible millimeters of mercury, with diastolic lower than systolic.";
    }
  }
  if (type === "spo2" && (value < 0 || value > 100)) return "Oxygen saturation must be between 0 and 100 percent.";
  if (type === "temperature" && (value < 25 || value > 45)) {
    return "Enter temperature in Celsius (for example 36.8), not Fahrenheit.";
  }
  if (type === "pain_score" && (value < 0 || value > 10)) return "Pain score must be between 0 and 10.";
  if (type !== "custom" && value < 0) return "This reading cannot be negative.";
  return null;
}

/** Shared by the manager and caregiver charts so their entry rules cannot drift. */
export function parseObservationFormValues(input: ObservationFormValues) {
  const custom = input.observationType === "custom";
  const valueText = custom ? input.valueText.trim() || null : null;
  const customLabel = custom ? input.customLabel.trim() || null : null;
  if (custom && !customLabel) throw new Error("Enter a label for the custom observation.");
  if (!hasObservationFormValue(input)) {
    throw new Error(custom ? "Enter a numeric or text value." : "Enter a numeric reading.");
  }
  const parseNumber = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("Enter a valid number.");
    return parsed;
  };
  const valueNumeric = parseNumber(input.valueNumeric);
  const valueSecondary = OBSERVATION_CONFIG[input.observationType].secondaryLabel
    ? parseNumber(input.valueSecondary) : null;
  const readingError = observationReadingError(input.observationType, valueNumeric, valueSecondary);
  if (readingError) throw new Error(readingError);
  return {
    valueNumeric,
    valueSecondary,
    valueText,
    customLabel,
  };
}

/**
 * The readings a direct-care employee actually takes at the bedside, in the order they are usually
 * taken. These get one-tap buttons on the caregiver surface; everything else stays behind the full
 * picker. Deliberately short -- the value of this list comes from what it leaves out.
 */
export const QUICK_OBSERVATION_TYPES: ObservationType[] = [
  "blood_pressure", "heart_rate", "temperature", "spo2", "pain_score",
];

/**
 * Server-derived flags that warrant stopping the caregiver to re-check the entry. The thresholds
 * themselves live only in record_clinical_observation (20260725110000_clinical_observations_native.sql);
 * this reads the flag that function already computed rather than keeping a second copy that could drift.
 */
export function isCriticalFlag(flag: string): boolean {
  return flag === "critical_high" || flag === "critical_low";
}

export function abnormalBadge(flag: string): { className: string; label: string } | null {
  switch (flag) {
    case "critical_high":
      return { className: "border-red-300 bg-red-100 text-red-800", label: "Critical high" };
    case "critical_low":
      return { className: "border-red-300 bg-red-100 text-red-800", label: "Critical low" };
    case "high":
      return { className: "border-amber-300 bg-amber-50 text-amber-800", label: "High" };
    case "low":
      return { className: "border-amber-300 bg-amber-50 text-amber-800", label: "Low" };
    case "normal":
      return { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Normal" };
    default:
      return null;
  }
}

export function observationValue(observation: ClinicalObservation): string {
  const config = OBSERVATION_CONFIG[observation.observation_type as ObservationType];
  const unit = observation.unit ?? config?.unit ?? "";
  const unitSuffix = formatObservationUnit(unit);
  const suffix = unitSuffix && unit !== "{score}" ? ` ${unitSuffix}` : "";
  if (observation.observation_type === "blood_pressure" && observation.value_numeric != null) {
    const diastolic = observation.value_secondary != null ? `/${observation.value_secondary}` : "";
    return `${observation.value_numeric}${diastolic}${suffix}`;
  }
  if (observation.value_numeric != null) return `${observation.value_numeric}${suffix}`;
  return observation.value_text ?? "—";
}

export function observationTitle(observation: ClinicalObservation): string {
  if (observation.observation_type === "custom") {
    return observation.custom_label ?? "Custom observation";
  }
  return OBSERVATION_CONFIG[observation.observation_type as ObservationType]?.label ?? observation.observation_type;
}

export type SummaryVital = ClinicalChartSummary["latestVitals"][number];

export function summaryVitalTitle(type: string): string {
  return OBSERVATION_CONFIG[type as ObservationType]?.label ?? type.replace(/_/gu, " ");
}

export function summaryVitalValue(vital: SummaryVital): string {
  const unit = vital.unit ?? OBSERVATION_CONFIG[vital.observation_type as ObservationType]?.unit ?? "";
  const unitSuffix = formatObservationUnit(unit);
  const suffix = unitSuffix && unit !== "{score}" ? ` ${unitSuffix}` : "";
  if (vital.observation_type === "blood_pressure" && vital.value_numeric != null) {
    const diastolic = vital.value_secondary != null ? `/${vital.value_secondary}` : "";
    return `${vital.value_numeric}${diastolic}${suffix}`;
  }
  if (vital.value_numeric != null) return `${vital.value_numeric}${suffix}`;
  return vital.value_text ?? "—";
}

export function titleCase(value: string): string {
  const spaced = value.replace(/_/gu, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface ClinicalChartResidentOption {
  id: string;
  first_name: string;
  last_name: string;
  room: string | null;
  facility_id: string;
}

export function filterResidentOptions(
  options: readonly ClinicalChartResidentOption[],
  query: string,
): ClinicalChartResidentOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((resident) =>
    `${resident.first_name} ${resident.last_name}`.toLowerCase().includes(q)
    || (resident.room ?? "").toLowerCase().includes(q));
}
