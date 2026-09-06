import { describe, expect, it } from "vitest";
import {
  bucketHoursInWindow,
  bucketStanding,
  ojtCapForBucket,
  trainingYearWindow,
  type CourseCreditHours,
  type TrainingRecordHours,
  type TrainingTypeBucket,
} from "./annualTrainingHours";

const trainingTypes: TrainingTypeBucket[] = [
  { id: "tt-general", hour_bucket: "general_annual" },
  { id: "tt-dementia", hour_bucket: "alr_dementia" },
  { id: "tt-unbucketed", hour_bucket: null },
];

function record(overrides: Partial<TrainingRecordHours> = {}): TrainingRecordHours {
  return {
    training_type_id: "tt-general",
    completion_date: "2026-05-01",
    hours: 4,
    completion_method: "in_person",
    status: "compliant",
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
    });
    expect(hours.get("alr_dementia")).toMatchObject({ completedHours: 0, ojtHours: 3 });
  });

  it("ignores pending_review and not_applicable records", () => {
    // Matching recalculate_compliance_core: an unconfirmed audience contributes no earned hours.
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
    });
    expect(hours.get("general_annual")?.completedHours).toBe(1.5);
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
