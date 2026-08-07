import { describe, expect, it } from "vitest";
import { addFacilityCalendarDays, facilityToday } from "./dateUtils";
import {
  careHeaderFields,
  careProfileAgeInDays,
  careValueTone,
  hospitalStateLabel,
  hospitalStateTone,
  isCareProfileStale,
  residentDisplayName,
  residentInitials,
  STALE_CARE_PROFILE_DAYS,
  type ResidentCareHeader,
} from "./residentCareHeader";

// Noon Eastern so facilityToday(NOW) is stably 2026-07-25.
const NOW = new Date("2026-07-25T16:00:00.000Z");

function header(overrides: Partial<ResidentCareHeader> = {}): ResidentCareHeader {
  return {
    generatedAt: NOW.toISOString(),
    resident: {
      id: "r1",
      firstName: "Ada",
      lastName: "Byron",
      preferredName: null,
      photoDocumentId: null,
      room: "204",
      status: "active",
      admissionDate: "2025-01-04",
      dischargeDate: null,
      hospice: false,
      sdcu: false,
    },
    facility: { id: "f1", name: "Maple Court", facilityType: "PCH" },
    care: {
      levelOfCare: "not_assessed",
      transferAssistance: "not_assessed",
      ambulationStatus: "not_assessed",
      fallRisk: "not_assessed",
      elopementRisk: "not_assessed",
      cognitiveStatus: "not_assessed",
      codeStatus: "not_documented",
      advanceDirectiveStatus: "unknown",
      allergies: [],
      foodAllergies: [],
      mobilitySummary: null,
      supervisionRequirements: null,
      asOf: null,
    },
    diet: null,
    hospital: { state: "in_facility", episodeId: null, destination: null, since: null, expectedReturnAt: null },
    lastAssessment: null,
    supportPlan: null,
    ...overrides,
  };
}

describe("careValueTone", () => {
  it("treats an unanswered field as attention, not as a safe default", () => {
    // The whole point of the enumeration: blank must never read as "no risk".
    expect(careValueTone("not_assessed")).toBe("attention");
    expect(careValueTone("not_documented")).toBe("attention");
  });

  it("marks the values that change how staff physically approach the resident", () => {
    expect(careValueTone("high")).toBe("critical");
    expect(careValueTone("two_person")).toBe("critical");
    expect(careValueTone("mechanical_lift")).toBe("critical");
    expect(careValueTone("bedfast")).toBe("critical");
    expect(careValueTone("severe_impairment")).toBe("critical");
  });

  it("keeps genuinely answered low-risk values neutral", () => {
    expect(careValueTone("independent")).toBe("neutral");
    expect(careValueTone("none")).toBe("neutral");
    expect(careValueTone("low")).toBe("neutral");
    expect(careValueTone("full_code")).toBe("neutral");
  });
});

describe("careHeaderFields", () => {
  it("returns the nine coded fields in scan order", () => {
    const fields = careHeaderFields(header());
    expect(fields.map((field) => field.key)).toEqual([
      "level_of_care", "mobility", "transfer", "diet", "allergies",
      "fall_risk", "elopement_risk", "cognitive_status", "code_status",
    ]);
  });

  it("labels a missing dietary profile as missing rather than as a regular diet", () => {
    const [diet] = careHeaderFields(header()).filter((field) => field.key === "diet");
    expect(diet.value).toBe("No dietary profile");
    expect(diet.tone).toBe("attention");
  });

  it("renders diet order, texture, and liquid consistency when a profile exists", () => {
    const fields = careHeaderFields(header({
      diet: {
        dietOrder: "Mechanical soft",
        textureConsistency: "minced_and_moist",
        liquidConsistency: "mildly_thick",
        asOf: "2026-06-01",
      },
    }));
    const diet = fields.find((field) => field.key === "diet")!;
    expect(diet.value).toBe("Mechanical soft · Minced & moist");
    expect(diet.detail).toBe("Liquids: Mildly thick");
    expect(diet.tone).toBe("neutral");
  });

  it("merges non-food and food allergies, de-duplicated, and flags them critical", () => {
    const fields = careHeaderFields(header({
      care: { ...header().care, allergies: ["Penicillin", "Latex"], foodAllergies: ["Peanuts", "Latex"] },
    }));
    const allergies = fields.find((field) => field.key === "allergies")!;
    expect(allergies.value).toBe("Penicillin, Latex, Peanuts");
    expect(allergies.tone).toBe("critical");
  });

  it("reports no recorded allergies neutrally", () => {
    const allergies = careHeaderFields(header()).find((field) => field.key === "allergies")!;
    expect(allergies.value).toBe("None recorded");
    expect(allergies.tone).toBe("neutral");
  });

  it("carries free-text mobility and supervision context as the secondary line", () => {
    const fields = careHeaderFields(header({
      care: {
        ...header().care,
        mobilitySummary: "Steady with walker on flat surfaces only",
        supervisionRequirements: "Redirect at shift change",
      },
    }));
    expect(fields.find((field) => field.key === "mobility")!.detail).toBe("Steady with walker on flat surfaces only");
    expect(fields.find((field) => field.key === "cognitive_status")!.detail).toBe("Redirect at shift change");
  });
});

describe("hospital state", () => {
  it("labels and tones each state", () => {
    expect(hospitalStateLabel("in_facility")).toBe("In facility");
    expect(hospitalStateTone("in_facility")).toBe("neutral");
    expect(hospitalStateLabel("out_at_hospital")).toBe("Out at hospital");
    expect(hospitalStateTone("out_at_hospital")).toBe("critical");
    expect(hospitalStateLabel("returned_reconciliation_incomplete")).toBe("Returned — reconciliation open");
    expect(hospitalStateTone("returned_reconciliation_incomplete")).toBe("attention");
  });
});

describe("care profile staleness", () => {
  it("treats a never-reviewed profile as stale", () => {
    expect(careProfileAgeInDays(null, NOW)).toBeNull();
    expect(isCareProfileStale(null, NOW)).toBe(true);
  });

  it("computes age in whole days", () => {
    expect(careProfileAgeInDays("2026-07-15T12:00:00.000Z", NOW)).toBe(10);
  });

  it("goes stale exactly at the annual review cadence", () => {
    // Facility calendar: age is whole America/New_York days, not wall-clock ms.
    const today = facilityToday(NOW);
    const justUnder = `${addFacilityCalendarDays(today, -(STALE_CARE_PROFILE_DAYS - 1))}T16:00:00.000Z`;
    const atThreshold = `${addFacilityCalendarDays(today, -STALE_CARE_PROFILE_DAYS)}T16:00:00.000Z`;
    expect(isCareProfileStale(justUnder, NOW)).toBe(false);
    expect(isCareProfileStale(atThreshold, NOW)).toBe(true);
  });

  it("does not crash on an unparseable timestamp", () => {
    expect(careProfileAgeInDays("not-a-date", NOW)).toBeNull();
    expect(isCareProfileStale("not-a-date", NOW)).toBe(true);
  });
});

describe("resident naming", () => {
  it("formats last, first and appends a preferred name when present", () => {
    expect(residentDisplayName(header().resident)).toBe("Byron, Ada");
    expect(residentDisplayName({ ...header().resident, preferredName: "Addie" })).toBe('Byron, Ada ("Addie")');
  });

  it("ignores a whitespace-only preferred name", () => {
    expect(residentDisplayName({ ...header().resident, preferredName: "   " })).toBe("Byron, Ada");
  });

  it("builds initials for the photo fallback", () => {
    expect(residentInitials(header().resident)).toBe("AB");
  });
});
