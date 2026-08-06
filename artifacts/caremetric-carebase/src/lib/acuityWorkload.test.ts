import { describe, expect, it } from "vitest";
import {
  ADVISORY_NOTICE,
  buildAcuityWorkload,
  COGNITIVE_MINUTES,
  EVENT_MINUTES,
  LEVEL_OF_CARE_MINUTES,
  residentsRequiringTwoStaff,
  SETTLING_IN_DAYS,
  shiftsNeedingAttention,
  TRANSFER_MINUTES,
  type AcuityResidentLike,
  type AcuityShiftLike,
} from "./acuityWorkload";

// Noon Eastern so facilityToday(AS_OF) is stably 2026-07-25 (not near the midnight ET boundary).
const AS_OF = new Date("2026-07-25T16:00:00Z");

function resident(id: string, overrides: Partial<AcuityResidentLike> = {}): AcuityResidentLike {
  return {
    id,
    display_name: `Resident ${id}`,
    status: "active",
    level_of_care: "independent",
    transfer_assistance: "independent",
    ambulation_status: "independent",
    fall_risk: "low",
    elopement_risk: "none",
    cognitive_status: "no_impairment",
    admission_date: "2026-01-01",
    last_hospital_return_at: null,
    scheduled_service_tasks: 0,
    appointment_escorts: 0,
    ...overrides,
  };
}

function shift(overrides: Partial<AcuityShiftLike> = {}): AcuityShiftLike {
  return {
    key: "day",
    label: "Day",
    unit_name: null,
    staff: [{ employee_id: "e1", display_name: "Aide One", qualification_keys: [] }],
    required_qualification_keys: [],
    critical_services: [],
    ...overrides,
  };
}

function build(residents: AcuityResidentLike[], shifts: AcuityShiftLike[] = [shift()]) {
  return buildAcuityWorkload({ residents, shifts, asOf: AS_OF });
}

describe("it is advisory, and it is not a black box", () => {
  it("never emits a required or recommended staff count", () => {
    // The one output shape this module must not have. A "you need N staff" figure gets quoted back
    // to a facility in a survey, and it will be wrong.
    const [result] = build([resident("a", { level_of_care: "total_physical_assistance" })]);
    const keys = Object.keys(result);
    expect(keys).not.toContain("requiredStaff");
    expect(keys).not.toContain("recommendedStaff");
    expect(keys).not.toContain("staffingLevel");
    expect(keys).not.toContain("score");
  });

  it("carries a notice saying so, naming that no regulation prescribes the figures", () => {
    expect(ADVISORY_NOTICE).toContain("not a required");
    expect(ADVISORY_NOTICE).toContain("Pennsylvania");
  });

  it("itemizes every minute, so the total is the sum of its named parts and nothing else", () => {
    const [result] = build([
      resident("a", { level_of_care: "some_physical_assistance", transfer_assistance: "two_person" }),
      resident("b", { cognitive_status: "severe_impairment" }),
    ]);
    const summed = result.contributions.reduce((total, entry) => total + entry.minutes, 0);
    expect(result.totalMinutes).toBe(summed);
    expect(result.contributions.length).toBeGreaterThan(0);
  });

  it("computes each contribution from its exported constant", () => {
    // Anybody can check the arithmetic against the published numbers; that is the point.
    const [result] = build([resident("a", {
      level_of_care: "total_physical_assistance",
      transfer_assistance: "mechanical_lift",
    })]);
    const personal = result.contributions.find((entry) => entry.key === "level_of_care")!;
    const transfers = result.contributions.find((entry) => entry.key === "transfers")!;
    expect(personal.minutes).toBe(LEVEL_OF_CARE_MINUTES.total_physical_assistance);
    expect(transfers.minutes).toBe(TRANSFER_MINUTES.mechanical_lift);
  });

  it("drops a factor that contributes nothing rather than listing a zero", () => {
    const [result] = build([resident("a")]);
    expect(result.contributions.map((entry) => entry.key)).not.toContain("elopement");
  });
});

describe("reproducibility", () => {
  // The exit gate: reproducible from a fixture roster.
  const roster = [
    resident("a", { level_of_care: "some_physical_assistance", transfer_assistance: "two_person", fall_risk: "high" }),
    resident("b", { cognitive_status: "moderate_impairment", elopement_risk: "monitored" }),
    resident("c", { scheduled_service_tasks: 4, appointment_escorts: 1 }),
  ];

  it("gives the same answer every time for the same roster", () => {
    const first = build(roster);
    const second = build(roster);
    expect(second).toEqual(first);
  });

  it("gives a stated total for that fixture roster", () => {
    // Pinned deliberately: if a constant changes, this fails and somebody has to decide that was
    // intended rather than discovering it in a facility's numbers.
    const [result] = build(roster);
    const expected =
      LEVEL_OF_CARE_MINUTES.some_physical_assistance + LEVEL_OF_CARE_MINUTES.independent * 2
      + TRANSFER_MINUTES.two_person
      + 20 /* fall_risk high */
      + COGNITIVE_MINUTES.moderate_impairment
      + 10 /* elopement monitored */
      + 4 * EVENT_MINUTES.scheduledServiceTask
      + 1 * EVENT_MINUTES.appointmentEscort;
    expect(result.totalMinutes).toBe(expected);
  });

  it("counts only active residents", () => {
    const withDischarged = [...roster, resident("d", {
      status: "discharged", level_of_care: "total_physical_assistance",
    })];
    expect(build(withDischarged)[0].totalMinutes).toBe(build(roster)[0].totalMinutes);
  });

  it("falls back to the not-assessed figure for an unrecognized value rather than counting zero", () => {
    // A typo or a newly added enum value must not silently make a resident free to care for.
    const [result] = build([resident("a", { level_of_care: "something_new" })]);
    const personal = result.contributions.find((entry) => entry.key === "level_of_care")!;
    expect(personal.minutes).toBe(LEVEL_OF_CARE_MINUTES.not_assessed);
  });
});

describe("recent admissions and returns", () => {
  it("counts a resident admitted inside the settling window", () => {
    const [result] = build([resident("a", { admission_date: "2026-07-24" })]);
    expect(result.contributions.find((entry) => entry.key === "recent_admissions")?.minutes)
      .toBe(EVENT_MINUTES.recentAdmission);
  });

  it("stops counting one admitted longer ago than the window", () => {
    const [result] = build([resident("a", { admission_date: "2026-06-01" })]);
    expect(result.contributions.find((entry) => entry.key === "recent_admissions")).toBeUndefined();
  });

  it("counts a recent hospital return", () => {
    const [result] = build([resident("a", { last_hospital_return_at: "2026-07-24T08:00:00Z" })]);
    expect(result.contributions.find((entry) => entry.key === "hospital_returns")?.minutes)
      .toBe(EVENT_MINUTES.hospitalReturn);
  });

  it("ignores an unparseable date rather than counting it as today", () => {
    const [result] = build([resident("a", { admission_date: "not a date" })]);
    expect(result.contributions.find((entry) => entry.key === "recent_admissions")).toBeUndefined();
  });
});

describe("observations", () => {
  it("flags two-person transfers when fewer than two staff are scheduled", () => {
    const [result] = build([resident("a", { transfer_assistance: "two_person" })]);
    const flagged = result.observations.find((entry) => entry.key === "two_person_transfer_without_two_staff");
    expect(flagged?.severity).toBe("attention");
    expect(flagged?.subjectIds).toEqual(["a"]);
  });

  it("does not flag it when two staff are scheduled", () => {
    const [result] = build([resident("a", { transfer_assistance: "two_person" })], [shift({
      staff: [
        { employee_id: "e1", display_name: "One", qualification_keys: [] },
        { employee_id: "e2", display_name: "Two", qualification_keys: [] },
      ],
    })]);
    expect(result.observations.map((entry) => entry.key))
      .not.toContain("two_person_transfer_without_two_staff");
  });

  it("treats a mechanical lift as needing two staff too", () => {
    expect(residentsRequiringTwoStaff([
      resident("a", { transfer_assistance: "mechanical_lift" }),
      resident("b", { transfer_assistance: "one_person" }),
    ]).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("names the qualification nobody scheduled holds", () => {
    const [result] = build([resident("a")], [shift({
      required_qualification_keys: ["medication_administration"],
    })]);
    const gap = result.observations.find((entry) => entry.key === "qualification_gap");
    expect(gap?.message).toContain("medication_administration");
  });

  it("does not flag a qualification somebody scheduled does hold", () => {
    const [result] = build([resident("a")], [shift({
      required_qualification_keys: ["medication_administration"],
      staff: [{ employee_id: "e1", display_name: "One", qualification_keys: ["medication_administration"] }],
    })]);
    expect(result.observations.map((entry) => entry.key)).not.toContain("qualification_gap");
  });

  it("flags a critical service nobody scheduled can deliver", () => {
    const [result] = build([resident("a")], [shift({
      critical_services: [{ name: "Insulin administration", required_qualification_key: "insulin" }],
    })]);
    const uncovered = result.observations.find((entry) => entry.key === "uncovered_critical_service");
    expect(uncovered?.message).toContain("Insulin administration");
  });

  it("notes recent admissions and returns as context, not as a problem", () => {
    const [result] = build([resident("a", { admission_date: "2026-07-24" })]);
    const note = result.observations.find((entry) => entry.key === "recent_admissions_or_returns");
    expect(note?.severity).toBe("note");
    expect(note?.message).toContain(String(SETTLING_IN_DAYS));
  });

  it("says when the estimate is working from defaults", () => {
    // Otherwise a facility that has recorded nothing sees a confident number built on nothing.
    const [result] = build([resident("a", { level_of_care: "not_assessed" })]);
    const note = result.observations.find((entry) => entry.key === "acuity_not_assessed");
    expect(note?.subjectIds).toEqual(["a"]);
  });

  it("flags a shift with nobody on it", () => {
    const [result] = build([resident("a")], [shift({ staff: [] })]);
    expect(result.observations.map((entry) => entry.key)).toContain("no_staff_scheduled");
    expect(result.minutesPerStaff).toBeNull();
  });

  it("raises no staffing observation for a shift with no residents", () => {
    const [result] = build([], [shift({ staff: [] })]);
    expect(result.observations.map((entry) => entry.key)).not.toContain("no_staff_scheduled");
  });
});

describe("minutes per staff", () => {
  it("divides the same total rather than introducing a second number", () => {
    const [result] = build([resident("a", { level_of_care: "total_physical_assistance" })], [shift({
      staff: [
        { employee_id: "e1", display_name: "One", qualification_keys: [] },
        { employee_id: "e2", display_name: "Two", qualification_keys: [] },
      ],
    })]);
    expect(result.minutesPerStaff).toBe(Math.round(result.totalMinutes / 2));
  });
});

describe("what a scheduler should look at", () => {
  it("returns only shifts with something needing attention, busiest first", () => {
    const shifts = shiftsNeedingAttention(buildAcuityWorkload({
      residents: [resident("a", { transfer_assistance: "two_person" })],
      shifts: [
        shift({ key: "quiet", label: "Quiet", staff: [
          { employee_id: "e1", display_name: "One", qualification_keys: [] },
          { employee_id: "e2", display_name: "Two", qualification_keys: [] },
        ] }),
        shift({ key: "short", label: "Short-staffed" }),
      ],
      asOf: AS_OF,
    }));
    expect(shifts.map((entry) => entry.key)).toEqual(["short"]);
  });

  it("returns nothing when every shift is fine", () => {
    expect(shiftsNeedingAttention(build([resident("a")], [shift({
      staff: [
        { employee_id: "e1", display_name: "One", qualification_keys: [] },
        { employee_id: "e2", display_name: "Two", qualification_keys: [] },
      ],
    })]))).toEqual([]);
  });
});
