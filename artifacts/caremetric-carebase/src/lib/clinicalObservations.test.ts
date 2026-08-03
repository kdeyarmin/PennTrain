import { describe, expect, it } from "vitest";
import type { ClinicalObservation } from "@/hooks/useClinicalObservations";
import {
  OBSERVATION_CONFIG,
  OBSERVATION_ORDER,
  abnormalBadge,
  filterResidentOptions,
  observationTitle,
  observationValue,
  summaryVitalTitle,
  summaryVitalValue,
  titleCase,
  type ClinicalChartResidentOption,
  type SummaryVital,
} from "./clinicalObservations";

function observation(overrides: Partial<ClinicalObservation> = {}): ClinicalObservation {
  return {
    id: "obs-1",
    organization_id: "org-1",
    facility_id: "fac-1",
    resident_id: "res-1",
    observation_type: "heart_rate",
    observed_at: "2026-08-01T12:00:00Z",
    value_numeric: 72,
    value_secondary: null,
    value_text: null,
    unit: null,
    custom_label: null,
    loinc_code: null,
    note: null,
    abnormal_flag: "normal",
    source: "native",
    entered_in_error: false,
    error_reason: null,
    fhir_observation_id: null,
    recorded_by_name: null,
    recorded_by_profile_id: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    ...overrides,
  } as unknown as ClinicalObservation;
}

describe("abnormalBadge", () => {
  it("maps each known flag to a className/label pair", () => {
    expect(abnormalBadge("critical_high")).toEqual({ className: "border-red-300 bg-red-100 text-red-800", label: "Critical high" });
    expect(abnormalBadge("critical_low")).toEqual({ className: "border-red-300 bg-red-100 text-red-800", label: "Critical low" });
    expect(abnormalBadge("high")).toEqual({ className: "border-amber-300 bg-amber-50 text-amber-800", label: "High" });
    expect(abnormalBadge("low")).toEqual({ className: "border-amber-300 bg-amber-50 text-amber-800", label: "Low" });
    expect(abnormalBadge("normal")).toEqual({ className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Normal" });
  });

  it("returns null for an unrecognized flag", () => {
    expect(abnormalBadge("unknown")).toBeNull();
    expect(abnormalBadge("")).toBeNull();
  });
});

describe("observationValue", () => {
  it("formats blood pressure with a systolic/diastolic pair", () => {
    const value = observationValue(
      observation({ observation_type: "blood_pressure", value_numeric: 120, value_secondary: 80, unit: "mm[Hg]" }),
    );
    expect(value).toBe("120/80 mm[Hg]");
  });

  it("falls back to the observation type's configured unit when the row has none", () => {
    const value = observationValue(observation({ observation_type: "heart_rate", value_numeric: 72, unit: null }));
    expect(value).toBe("72 /min");
  });

  it("omits the unit suffix for the pain-score placeholder unit", () => {
    const value = observationValue(observation({ observation_type: "pain_score", value_numeric: 4, unit: null }));
    expect(value).toBe("4");
  });

  it("falls back to text value when numeric is absent", () => {
    const value = observationValue(
      observation({ observation_type: "custom", value_numeric: null, value_text: "Peak flow 400" }),
    );
    expect(value).toBe("Peak flow 400");
  });

  it("falls back to an em dash when neither numeric nor text is present", () => {
    const value = observationValue(observation({ observation_type: "custom", value_numeric: null, value_text: null }));
    expect(value).toBe("—");
  });
});

describe("observationTitle", () => {
  it("uses the custom label for custom observations", () => {
    expect(observationTitle(observation({ observation_type: "custom", custom_label: "Peak flow" }))).toBe("Peak flow");
  });

  it("falls back to a generic label when a custom observation has no label", () => {
    expect(observationTitle(observation({ observation_type: "custom", custom_label: null }))).toBe("Custom observation");
  });

  it("uses the configured label for a known observation type", () => {
    expect(observationTitle(observation({ observation_type: "heart_rate" }))).toBe("Heart rate");
  });
});

describe("titleCase", () => {
  it("capitalizes the first letter and replaces underscores with spaces", () => {
    expect(titleCase("care_conference")).toBe("Care conference");
    expect(titleCase("signed")).toBe("Signed");
  });
});

describe("summaryVitalTitle", () => {
  it("uses the configured label for a known type", () => {
    expect(summaryVitalTitle("blood_pressure")).toBe("Blood pressure");
  });

  it("falls back to a humanized form of the raw type", () => {
    expect(summaryVitalTitle("future_observation_type")).toBe("future observation type");
  });
});

describe("summaryVitalValue", () => {
  function vital(overrides: Partial<SummaryVital> = {}): SummaryVital {
    return {
      observation_type: "heart_rate",
      value_numeric: 72,
      value_secondary: null,
      value_text: null,
      unit: null,
      abnormal_flag: "normal",
      observed_at: "2026-08-01T12:00:00Z",
      ...overrides,
    };
  }

  it("formats blood pressure with a systolic/diastolic pair", () => {
    expect(summaryVitalValue(vital({ observation_type: "blood_pressure", value_numeric: 118, value_secondary: 76, unit: "mm[Hg]" })))
      .toBe("118/76 mm[Hg]");
  });

  it("formats a plain numeric value, falling back to the configured unit", () => {
    expect(summaryVitalValue(vital({ value_numeric: 68, unit: null }))).toBe("68 /min");
  });

  it("falls back to an em dash when no value is present", () => {
    expect(summaryVitalValue(vital({ value_numeric: null, value_text: null }))).toBe("—");
  });
});

describe("OBSERVATION_ORDER / OBSERVATION_CONFIG parity", () => {
  it("orders exactly the same set of observation types the config defines", () => {
    expect([...OBSERVATION_ORDER].sort()).toEqual(Object.keys(OBSERVATION_CONFIG).sort());
  });
});

describe("filterResidentOptions", () => {
  const residents: ClinicalChartResidentOption[] = [
    { id: "1", first_name: "Alice", last_name: "Nguyen", room: "12A", facility_id: "fac-1" },
    { id: "2", first_name: "Bob", last_name: "Smith", room: "7", facility_id: "fac-1" },
    { id: "3", first_name: "Cara", last_name: "Alvarez", room: null, facility_id: "fac-1" },
  ];

  it("returns every resident for an empty query", () => {
    expect(filterResidentOptions(residents, "")).toEqual(residents);
    expect(filterResidentOptions(residents, "   ")).toEqual(residents);
  });

  it("matches case-insensitively on first or last name", () => {
    expect(filterResidentOptions(residents, "nguyen")).toEqual([residents[0]]);
    expect(filterResidentOptions(residents, "ALICE")).toEqual([residents[0]]);
  });

  it("matches on room", () => {
    expect(filterResidentOptions(residents, "12A")).toEqual([residents[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterResidentOptions(residents, "zzz")).toEqual([]);
  });

  it("tolerates residents with no room assigned", () => {
    expect(filterResidentOptions(residents, "cara")).toEqual([residents[2]]);
  });
});
