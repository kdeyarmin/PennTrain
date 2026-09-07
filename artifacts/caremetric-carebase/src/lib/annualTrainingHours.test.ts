import { describe, expect, it } from "vitest";
import {
  audienceStatusByTypeId,
  bucketHoursInWindow,
  bucketStanding,
  ojtCapForBucket,
  trainingTypeCreditsFacility,
  trainingYearWindow,
  type CourseCreditHours,
  type TrainingRecordHours,
  type TrainingTypeBucket,
} from "./annualTrainingHours";

function trainingType(overrides: Partial<TrainingTypeBucket> & { id: string }): TrainingTypeBucket {
  return {
    hour_bucket: "general_annual",
    is_active: true,
    state: "PA",
    applies_to_facility_type: "BOTH",
    audience_verification_required: true,
    ...overrides,
  };
}

const trainingTypes: TrainingTypeBucket[] = [
  trainingType({ id: "tt-general", hour_bucket: "general_annual" }),
  trainingType({ id: "tt-dementia", hour_bucket: "alr_dementia" }),
  trainingType({ id: "tt-unbucketed", hour_bucket: null }),
];

let nextRecordId = 0;
function record(overrides: Partial<TrainingRecordHours> = {}): TrainingRecordHours {
  nextRecordId += 1;
  return {
    id: `rec-${String(nextRecordId).padStart(3, "0")}`,
    training_type_id: "tt-general",
    completion_date: "2026-05-01",
    hours: 4,
    completion_method: "in_person",
    status: "compliant",
    audience_decision_at: null,
    created_at: `2026-05-01T00:00:${String(nextRecordId % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

describe("trainingYearWindow", () => {
  it("runs from the most recent hire anniversary to the next one", () => {
    expect(trainingYearWindow("2021-03-15", "2026-09-06")).toEqual({
      start: "2026-03-15",
      end: "2027-03-15",
    });
  });

  it("uses last year's anniversary when this year's has not arrived", () => {
    // The January case the finding is about: the calendar bucket has reset, the training year
    // has not.
    expect(trainingYearWindow("2021-11-20", "2026-01-08")).toEqual({
      start: "2025-11-20",
      end: "2026-11-20",
    });
  });

  it("includes the anniversary day itself in the new year", () => {
    expect(trainingYearWindow("2021-03-15", "2026-03-15")?.start).toBe("2026-03-15");
  });

  it("clamps a leap-day hire instead of drifting to 1 March", () => {
    expect(trainingYearWindow("2020-02-29", "2026-06-01")).toEqual({
      start: "2026-02-28",
      end: "2027-02-28",
    });
  });

  // Deriving `end` from the already-clamped `start` lost a day for a leap-day hire, and the
  // contract is [start, end) -- so the day fell in no window at all and its hours counted toward
  // nothing. Each boundary is measured from the hire date with its own offset now.
  it("leaves no gap between a leap-day hire's windows", () => {
    // 2028 is a leap year, so this year's anniversary is 29 February and has not arrived yet.
    // The window that covers 28 February must therefore END on the 29th, not on the 28th.
    expect(trainingYearWindow("2020-02-29", "2028-02-28")).toEqual({
      start: "2027-02-28",
      end: "2028-02-29",
    });
    // And the next one picks up exactly where it left off.
    expect(trainingYearWindow("2020-02-29", "2028-02-29")).toEqual({
      start: "2028-02-29",
      end: "2029-02-28",
    });
  });

  // The property, rather than the two dates: consecutive windows touch, so every day belongs to
  // exactly one of them.
  it("keeps consecutive windows contiguous across a leap boundary", () => {
    for (const [earlier, later] of [["2028-02-28", "2028-02-29"], ["2029-02-27", "2029-02-28"]]) {
      const before = trainingYearWindow("2020-02-29", earlier)!;
      const after = trainingYearWindow("2020-02-29", later)!;
      if (before.start !== after.start) expect(before.end).toBe(after.start);
      expect(earlier >= before.start && earlier < before.end).toBe(true);
      expect(later >= after.start && later < after.end).toBe(true);
    }
  });

  it("returns null without a hire date, or when the hire date is still ahead", () => {
    expect(trainingYearWindow(null, "2026-09-06")).toBeNull();
    expect(trainingYearWindow(undefined, "2026-09-06")).toBeNull();
    expect(trainingYearWindow("2026-12-01", "2026-09-06")).toBeNull();
  });
});

describe("bucketHoursInWindow", () => {
  const window = { start: "2026-03-15", end: "2027-03-15" };

  it("counts only completions inside the training year", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ completion_date: "2026-03-15", hours: 2 }),
        record({ completion_date: "2026-12-31", hours: 3 }),
        // Before this training year opened, and on the far side of the next anniversary.
        record({ completion_date: "2026-03-14", hours: 5 }),
        record({ completion_date: "2027-03-15", hours: 5 }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(5);
  });

  it("spans the new year, which is exactly what the calendar bucket cannot do", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ completion_date: "2026-11-02", hours: 6 }),
        record({ completion_date: "2027-01-04", hours: 6 }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(12);
  });

  it("caps PCH on-the-job hours at six and reports the raw figure alongside", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ hours: 4, completion_method: "in_person" }),
        record({ hours: 9, completion_method: "on_the_job" }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")).toMatchObject({ completedHours: 10, ojtHours: 9 });
  });

  it("admits no on-the-job hours outside the PCH general bucket", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ training_type_id: "tt-dementia", hours: 3, completion_method: "on_the_job" }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "ALR",
      facilityState: "PA",
    });
    expect(hours.get("alr_dementia")).toMatchObject({ completedHours: 0, ojtHours: 3 });
  });

  it("ignores pending_review and not_applicable records", () => {
    // Matching recalculate_compliance_core: an unconfirmed audience contributes no earned hours.
    // The confirmed record is the newest of the three, so the TYPE's current decision is
    // `compliant` and only the per-record exclusion is doing the work here -- the type-level one
    // has its own cases below.
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ hours: 5, status: "pending_review" }),
        record({ hours: 5, status: "not_applicable" }),
        record({ hours: 1, status: "compliant" }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(1);
  });

  it("ignores a training type with no hour bucket", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [record({ training_type_id: "tt-unbucketed", hours: 8 })],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.size).toBe(0);
  });

  it("adds individual course completion credit dated inside the window", () => {
    const credits: CourseCreditHours[] = [
      { training_type_id: "tt-general", credit_hours: 1.5, credited_at: "2026-04-02T14:30:00.000Z" },
      { training_type_id: "tt-general", credit_hours: 1.5, credited_at: "2026-01-02T14:30:00.000Z" },
    ];
    const hours = bucketHoursInWindow({
      window,
      records: [],
      courseCredits: credits,
      trainingTypes,
      facilityType: "ALR",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(1.5);
  });

  it("dates a course credit by the Pennsylvania day, not the UTC day", () => {
    // The window is a pair of facility calendar dates, and `credited_at` is a timestamptz that
    // PostgREST serialises in UTC. 2026-03-15T02:00:00Z is 2026-03-14 at 22:00 in Pennsylvania --
    // the evening BEFORE this window opens -- so the credit belongs to the previous training year.
    // Slicing the leading ten characters read "2026-03-15" and counted it here, which is how an
    // employee's hours moved between years depending on what time of day they finished a course.
    const hours = bucketHoursInWindow({
      window,
      records: [],
      courseCredits: [
        { training_type_id: "tt-general", credit_hours: 2, credited_at: "2026-03-15T02:00:00.000Z" },
      ],
      trainingTypes,
      facilityType: "ALR",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")).toBeUndefined();
  });

  it("counts a credit earned on the Pennsylvania evening the window closes", () => {
    // The mirror image, and the reason a clamp is not enough: 2027-03-15T02:00:00Z is still
    // 2027-03-14 in Pennsylvania, the last day this window covers.
    const hours = bucketHoursInWindow({
      window,
      records: [],
      courseCredits: [
        { training_type_id: "tt-general", credit_hours: 2, credited_at: "2027-03-15T02:00:00.000Z" },
      ],
      trainingTypes,
      facilityType: "ALR",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(2);
  });

  it("ignores hours against a type the server would never credit for this facility", () => {
    // What the card used to add up. Only the first record is creditable for a PCH employee; the
    // other three are a different facility type's catalog, a different state's, and a deactivated
    // type, and the course credit is against the first of those -- each excluded by
    // `creditable_types`, so the server's bucket counts 4 where the card counted all 20.
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ training_type_id: "tt-pch", hours: 4 }),
        record({ training_type_id: "tt-hha", hours: 4 }),
        record({ training_type_id: "tt-ohio", hours: 4 }),
        record({ training_type_id: "tt-retired", hours: 4 }),
      ],
      courseCredits: [
        { training_type_id: "tt-hha", credit_hours: 4, credited_at: "2026-06-01T12:00:00.000Z" },
      ],
      trainingTypes: [
        trainingType({ id: "tt-pch", applies_to_facility_type: "PCH" }),
        trainingType({ id: "tt-hha", applies_to_facility_type: "HHA" }),
        trainingType({ id: "tt-ohio", state: "OH" }),
        trainingType({ id: "tt-retired", is_active: false }),
      ],
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(4);
  });

  it("drops every hour on a type the employer has since marked not applicable", () => {
    // The employer confirmed the audience, hours were logged, then the decision was reversed.
    // `current_training_audience_status` reads the reversal, so `creditable_types` drops the type
    // outright -- the earlier record's six hours included. Skipping only the reversing record (all
    // this module used to do) left those six on the card.
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ id: "r1", hours: 6, status: "compliant", created_at: "2026-05-01T00:00:00.000Z" }),
        record({
          id: "r2",
          hours: null,
          status: "not_applicable",
          created_at: "2026-06-01T00:00:00.000Z",
          audience_decision_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
      courseCredits: [
        { training_type_id: "tt-general", credit_hours: 3, credited_at: "2026-05-20T12:00:00.000Z" },
      ],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")).toBeUndefined();
  });

  it("still credits a type that never asks for an audience decision", () => {
    // `not tt.audience_verification_required or ...` -- the server's guard short-circuits, so a
    // type with verification off is creditable whatever its records say. Applying the type-level
    // exclusion to it would be a new divergence introduced by the fix for the old one.
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({ id: "r1", training_type_id: "tt-open", hours: 5, status: "compliant" }),
        record({ id: "r2", training_type_id: "tt-open", hours: null, status: "not_applicable",
          created_at: "2026-07-01T00:00:00.000Z", audience_decision_at: "2026-07-01T00:00:00.000Z" }),
      ],
      courseCredits: [],
      trainingTypes: [trainingType({ id: "tt-open", audience_verification_required: false })],
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(5);
  });

  it("keeps the hours when the latest decision confirms the audience again", () => {
    const hours = bucketHoursInWindow({
      window,
      records: [
        record({
          id: "r1",
          hours: null,
          status: "not_applicable",
          created_at: "2026-04-01T00:00:00.000Z",
          audience_decision_at: "2026-04-01T00:00:00.000Z",
        }),
        record({
          id: "r2",
          hours: 6,
          status: "compliant",
          created_at: "2026-05-01T00:00:00.000Z",
          audience_decision_at: "2026-05-01T00:00:00.000Z",
        }),
      ],
      courseCredits: [],
      trainingTypes,
      facilityType: "PCH",
      facilityState: "PA",
    });
    expect(hours.get("general_annual")?.completedHours).toBe(6);
  });
});

describe("audienceStatusByTypeId", () => {
  it("reads the decided record ahead of an undecided one, however they were created", () => {
    const status = audienceStatusByTypeId([
      record({ id: "r2", status: "compliant", created_at: "2026-06-01T00:00:00.000Z", audience_decision_at: null }),
      record({ id: "r1", status: "not_applicable", created_at: "2026-01-01T00:00:00.000Z", audience_decision_at: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(status.get("tt-general")).toBe("not_applicable");
  });

  it("takes the latest decision when both records carry one", () => {
    const status = audienceStatusByTypeId([
      record({ id: "r1", status: "not_applicable", audience_decision_at: "2026-01-02T00:00:00.000Z" }),
      record({ id: "r2", status: "compliant", audience_decision_at: "2026-04-09T00:00:00.000Z" }),
    ]);
    expect(status.get("tt-general")).toBe("compliant");
  });

  it("falls back to created_at, then id, when no decision was ever recorded", () => {
    expect(audienceStatusByTypeId([
      record({ id: "r1", status: "compliant", created_at: "2026-01-01T00:00:00.000Z" }),
      record({ id: "r2", status: "pending_review", created_at: "2026-02-01T00:00:00.000Z" }),
    ]).get("tt-general")).toBe("pending_review");
    expect(audienceStatusByTypeId([
      record({ id: "r1", status: "compliant", created_at: "2026-01-01T00:00:00.000Z" }),
      record({ id: "r2", status: "pending_review", created_at: "2026-01-01T00:00:00.000Z" }),
    ]).get("tt-general")).toBe("pending_review");
  });
});

describe("trainingTypeCreditsFacility", () => {
  const pch = { facilityType: "PCH", facilityState: "PA" };

  it("accepts a type scoped to this facility type or to BOTH", () => {
    expect(trainingTypeCreditsFacility(trainingType({ id: "a", applies_to_facility_type: "PCH" }), pch)).toBe(true);
    expect(trainingTypeCreditsFacility(trainingType({ id: "b", applies_to_facility_type: "BOTH" }), pch)).toBe(true);
  });

  it("rejects another facility type's catalog, which the server never credits", () => {
    for (const other of ["ALR", "NH", "HHA", "HOS", "GH"]) {
      expect(trainingTypeCreditsFacility(trainingType({ id: other, applies_to_facility_type: other }), pch)).toBe(false);
    }
  });

  it("rejects a deactivated type and another state's type", () => {
    expect(trainingTypeCreditsFacility(trainingType({ id: "c", is_active: false }), pch)).toBe(false);
    expect(trainingTypeCreditsFacility(trainingType({ id: "d", state: "OH" }), pch)).toBe(false);
  });

  it("reads a missing facility state as PA, the way coalesce(f.state,'PA') does in SQL", () => {
    const scope = { facilityType: "PCH", facilityState: null };
    expect(trainingTypeCreditsFacility(trainingType({ id: "e", state: "PA" }), scope)).toBe(true);
    expect(trainingTypeCreditsFacility(trainingType({ id: "f", state: "OH" }), scope)).toBe(false);
  });
});

describe("ojtCapForBucket", () => {
  it("is six only for a PCH general annual bucket", () => {
    expect(ojtCapForBucket("general_annual", "PCH")).toBe(6);
    expect(ojtCapForBucket("general_annual", "ALR")).toBe(0);
    expect(ojtCapForBucket("alr_dementia", "PCH")).toBe(0);
  });
});

describe("bucketStanding", () => {
  const window = { start: "2026-03-15", end: "2027-03-15" };

  it("is compliant once the required hours are earned", () => {
    expect(bucketStanding(12, 12, window, "2026-04-01")).toBe("compliant");
  });

  it("warns inside the last 90 days of the training year, not from 2 October", () => {
    expect(bucketStanding(4, 12, window, "2026-10-02")).toBe("incomplete");
    expect(bucketStanding(4, 12, window, "2026-12-16")).toBe("due_soon");
  });

  it("stays incomplete rather than compliant when nothing is required yet", () => {
    expect(bucketStanding(0, 0, window, "2026-04-01")).toBe("incomplete");
  });
});
