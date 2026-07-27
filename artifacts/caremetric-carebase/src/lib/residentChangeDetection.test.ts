import { describe, expect, it } from "vitest";
import {
  ASSISTANCE_COUNT_THRESHOLD, ASSISTANCE_WINDOW_DAYS, detectResidentChangeSignals,
  FALL_COUNT_THRESHOLD, FALL_WINDOW_DAYS, MEAL_MINIMUM_RECORDS, REFUSAL_COUNT_THRESHOLD,
  summarizeChangeSignals, SUPERVISION_COUNT_THRESHOLD, UNSCHEDULED_COUNT_THRESHOLD,
  WEIGHT_SHORT_PERCENT, type ChangeDetectionInput,
} from "./residentChangeDetection";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** A resident where nothing has changed. Each test introduces exactly one signal. */
function quiet(overrides: Partial<ChangeDetectionInput> = {}): ChangeDetectionInput {
  return {
    serviceExceptions: [],
    unscheduledServices: [],
    changeEvents: [],
    incidents: [],
    mealRecords: [],
    weightReadings: [],
    hospitalEpisodes: [],
    now: NOW,
    ...overrides,
  };
}

describe("no false positives", () => {
  it("detects nothing for a resident with no records", () => {
    expect(detectResidentChangeSignals(quiet())).toEqual([]);
  });

  it("detects nothing from routine completions", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: 20 }, (_, i) => ({
        completion_response: "completed_as_planned",
        documented_assistance_level: null,
        service_name: "Toileting",
        at: daysAgo(i % 10),
      })),
    }));
    expect(signals).toEqual([]);
  });
});

describe("every signal is defensible", () => {
  it("gives each signal evidence, a rationale, a review, and an owner", () => {
    const signals = detectResidentChangeSignals(quiet({
      incidents: [
        { incident_type: "fall_with_injury", occurred_at: daysAgo(2) },
        { incident_type: "fall_no_injury", occurred_at: daysAgo(9) },
      ],
      serviceExceptions: Array.from({ length: ASSISTANCE_COUNT_THRESHOLD }, (_, i) => ({
        completion_response: "completed_with_more_assistance",
        documented_assistance_level: "two_person",
        service_name: "Transfer",
        at: daysAgo(i + 1),
      })),
    }));
    expect(signals.length).toBeGreaterThan(1);
    for (const signal of signals) {
      expect(signal.evidence.length).toBeGreaterThan(0);
      expect(signal.rationale.length).toBeGreaterThan(20);
      expect(signal.recommendedReview).toBeTruthy();
      expect(signal.responsibleRole).toBeTruthy();
      expect(signal.windowStart < signal.windowEnd).toBe(true);
    }
  });

  it("summarizes by count, never by score", () => {
    // A weighted total becomes a risk score the moment somebody sorts by it, which the request rules
    // out explicitly.
    const summary = summarizeChangeSignals(detectResidentChangeSignals(quiet({
      incidents: [
        { incident_type: "fall", occurred_at: daysAgo(1) },
        { incident_type: "fall", occurred_at: daysAgo(4) },
      ],
    })));
    expect(Object.keys(summary).sort()).toEqual(["attention", "high", "total"]);
  });
});

describe("increased assistance", () => {
  const exception = (days: number) => ({
    completion_response: "completed_with_more_assistance",
    documented_assistance_level: "two_person",
    service_name: "Transfer",
    at: daysAgo(days),
  });

  it("fires at the threshold", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: ASSISTANCE_COUNT_THRESHOLD }, (_, i) => exception(i + 1)),
    }));
    expect(signals.map((s) => s.kind)).toContain("increased_assistance");
  });

  it("does not fire below it", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: ASSISTANCE_COUNT_THRESHOLD - 1 }, (_, i) => exception(i + 1)),
    }));
    expect(signals.map((s) => s.kind)).not.toContain("increased_assistance");
  });

  it("ignores records outside the window", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: 5 }, () => exception(ASSISTANCE_WINDOW_DAYS + 3)),
    }));
    expect(signals.map((s) => s.kind)).not.toContain("increased_assistance");
  });

  it("names the documented level in the evidence", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: ASSISTANCE_COUNT_THRESHOLD }, (_, i) => exception(i + 1)),
    }));
    expect(signals.find((s) => s.kind === "increased_assistance")!.evidence[0].label).toContain("two person");
  });
});

describe("falls", () => {
  it("counts incidents and condition changes together", () => {
    // A fall without injury is routinely recorded only as a condition change; one source undercounts.
    const signals = detectResidentChangeSignals(quiet({
      incidents: [{ incident_type: "fall_with_injury", occurred_at: daysAgo(3) }],
      changeEvents: [{ category: "fall", identified_at: daysAgo(10), status: "closed" }],
    }));
    const fall = signals.find((s) => s.kind === "multiple_falls")!;
    expect(fall.title).toBe(`2 falls in ${FALL_WINDOW_DAYS} days`);
    expect(fall.evidence).toHaveLength(2);
  });

  it("does not fire on a single fall", () => {
    const signals = detectResidentChangeSignals(quiet({
      incidents: [{ incident_type: "fall", occurred_at: daysAgo(3) }],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("multiple_falls");
    expect(FALL_COUNT_THRESHOLD).toBe(2);
  });

  it("ignores falls outside the window", () => {
    const signals = detectResidentChangeSignals(quiet({
      incidents: [
        { incident_type: "fall", occurred_at: daysAgo(FALL_WINDOW_DAYS + 5) },
        { incident_type: "fall", occurred_at: daysAgo(FALL_WINDOW_DAYS + 9) },
      ],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("multiple_falls");
  });

  it("does not count a non-fall incident", () => {
    const signals = detectResidentChangeSignals(quiet({
      incidents: [
        { incident_type: "medication_error", occurred_at: daysAgo(1) },
        { incident_type: "property_loss", occurred_at: daysAgo(2) },
      ],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("multiple_falls");
  });
});

describe("refusals, unscheduled services, and supervision", () => {
  it("fires on repeated refusals at the threshold", () => {
    const signals = detectResidentChangeSignals(quiet({
      serviceExceptions: Array.from({ length: REFUSAL_COUNT_THRESHOLD }, (_, i) => ({
        completion_response: "resident_refused",
        documented_assistance_level: null,
        service_name: "Bathing",
        at: daysAgo(i + 1),
      })),
    }));
    expect(signals.map((s) => s.kind)).toContain("repeated_refusals");
  });

  it("fires on repeated unscheduled services and groups the evidence by kind", () => {
    const signals = detectResidentChangeSignals(quiet({
      unscheduledServices: Array.from({ length: UNSCHEDULED_COUNT_THRESHOLD }, (_, i) => ({
        service_kind: i % 2 === 0 ? "unscheduled_toileting" : "extra_transfer_assistance",
        occurred_at: daysAgo(i + 1),
      })),
    }));
    const signal = signals.find((s) => s.kind === "repeated_unscheduled_services")!;
    expect(signal.evidence.some((entry) => entry.label.includes("×"))).toBe(true);
  });

  it("fires on increased supervision separately from the general unscheduled count", () => {
    const signals = detectResidentChangeSignals(quiet({
      unscheduledServices: Array.from({ length: SUPERVISION_COUNT_THRESHOLD }, (_, i) => ({
        service_kind: "increased_supervision",
        occurred_at: daysAgo(i + 1),
      })),
    }));
    expect(signals.map((s) => s.kind)).toContain("increased_supervision");
    // Below the general threshold, so the broader signal should not also fire.
    expect(signals.map((s) => s.kind)).not.toContain("repeated_unscheduled_services");
  });
});

describe("meal intake", () => {
  const meal = (ratio: number, days: number) => ({ intake_ratio: ratio, recorded_at: daysAgo(days) });

  it("requires a minimum sample before calling a trend", () => {
    // Two poor meals out of three is noise, not a trend.
    const signals = detectResidentChangeSignals(quiet({
      mealRecords: [meal(0.2, 1), meal(0.3, 2), meal(0.9, 3)],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("reduced_meal_intake");
  });

  it("fires when enough meals are recorded and the ratio is poor", () => {
    const signals = detectResidentChangeSignals(quiet({
      mealRecords: [
        ...Array.from({ length: 4 }, (_, i) => meal(0.25, i + 1)),
        ...Array.from({ length: MEAL_MINIMUM_RECORDS - 4 + 1 }, (_, i) => meal(0.9, i + 1)),
      ],
    }));
    expect(signals.map((s) => s.kind)).toContain("reduced_meal_intake");
  });

  it("ignores meals with no intake recorded", () => {
    const signals = detectResidentChangeSignals(quiet({
      mealRecords: Array.from({ length: 10 }, (_, i) => ({ intake_ratio: null, recorded_at: daysAgo(i + 1) })),
    }));
    expect(signals.map((s) => s.kind)).not.toContain("reduced_meal_intake");
  });

  it("does not fire when the resident is eating well", () => {
    const signals = detectResidentChangeSignals(quiet({
      mealRecords: Array.from({ length: 12 }, (_, i) => meal(0.9, (i % 6) + 1)),
    }));
    expect(signals.map((s) => s.kind)).not.toContain("reduced_meal_intake");
  });
});

describe("weight change", () => {
  it("fires on a loss past the short-window threshold", () => {
    const signals = detectResidentChangeSignals(quiet({
      weightReadings: [
        { weight_lbs: 140, measured_at: daysAgo(1) },
        { weight_lbs: 150, measured_at: daysAgo(25) },
      ],
    }));
    const signal = signals.find((s) => s.kind === "weight_change")!;
    expect(signal.title).toContain("Weight loss");
    expect(signal.title).toContain("6.7%");
  });

  it("fires on a gain too, described as a gain", () => {
    const signals = detectResidentChangeSignals(quiet({
      weightReadings: [
        { weight_lbs: 160, measured_at: daysAgo(1) },
        { weight_lbs: 150, measured_at: daysAgo(20) },
      ],
    }));
    expect(signals.find((s) => s.kind === "weight_change")!.title).toContain("Weight gain");
  });

  it("does not fire on a small fluctuation", () => {
    const signals = detectResidentChangeSignals(quiet({
      weightReadings: [
        { weight_lbs: 149, measured_at: daysAgo(1) },
        { weight_lbs: 150, measured_at: daysAgo(20) },
      ],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("weight_change");
    expect(WEIGHT_SHORT_PERCENT).toBe(5);
  });

  it("reports only one weight signal even when both windows qualify", () => {
    const signals = detectResidentChangeSignals(quiet({
      weightReadings: [
        { weight_lbs: 120, measured_at: daysAgo(1) },
        { weight_lbs: 140, measured_at: daysAgo(20) },
        { weight_lbs: 160, measured_at: daysAgo(150) },
      ],
    }));
    expect(signals.filter((s) => s.kind === "weight_change")).toHaveLength(1);
  });

  it("needs two readings", () => {
    const signals = detectResidentChangeSignals(quiet({
      weightReadings: [{ weight_lbs: 120, measured_at: daysAgo(1) }],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("weight_change");
  });
});

describe("condition-change categories and hospital visits", () => {
  it("lifts behaviour, continence, skin, and mobility signals from recorded events", () => {
    const signals = detectResidentChangeSignals(quiet({
      changeEvents: [
        { category: "behavioral_change", identified_at: daysAgo(2), status: "open" },
        { category: "continence_change", identified_at: daysAgo(3), status: "open" },
        { category: "skin_concern", identified_at: daysAgo(4), status: "open" },
        { category: "mobility_decline", identified_at: daysAgo(5), status: "open" },
      ],
    }));
    expect(signals.map((s) => s.kind).sort()).toEqual([
      "mobility_decline", "new_incontinence", "skin_concern", "behavior_change",
    ].sort());
  });

  it("fires on a hospital transfer", () => {
    const signals = detectResidentChangeSignals(quiet({
      hospitalEpisodes: [{ transfer_time: daysAgo(4), destination: "Mercy General", status: "returned" }],
    }));
    const signal = signals.find((s) => s.kind === "hospital_visit")!;
    expect(signal.evidence[0].label).toContain("Mercy General");
  });

  it("ignores a canceled transfer", () => {
    const signals = detectResidentChangeSignals(quiet({
      hospitalEpisodes: [{ transfer_time: daysAgo(4), destination: "Mercy General", status: "canceled" }],
    }));
    expect(signals.map((s) => s.kind)).not.toContain("hospital_visit");
  });
});

describe("ordering", () => {
  it("puts high severity first and is stable", () => {
    const input = quiet({
      incidents: [
        { incident_type: "fall", occurred_at: daysAgo(1) },
        { incident_type: "fall", occurred_at: daysAgo(2) },
      ],
      serviceExceptions: Array.from({ length: REFUSAL_COUNT_THRESHOLD }, (_, i) => ({
        completion_response: "resident_refused",
        documented_assistance_level: null,
        service_name: "Bathing",
        at: daysAgo(i + 1),
      })),
    });
    const signals = detectResidentChangeSignals(input);
    expect(signals[0].severity).toBe("high");
    expect(signals[signals.length - 1].severity).toBe("attention");
    expect(signals.map((s) => s.kind)).toEqual(detectResidentChangeSignals(input).map((s) => s.kind));
  });
});
