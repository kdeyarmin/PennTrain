import { describe, expect, it } from "vitest";
import { canSelfEnrollInCourse, latestCourseAssignment } from "./courseAvailability";

const annualCourse = { id: "annual-course", recurrence_interval_days: 365 };

describe("canSelfEnrollInCourse", () => {
  it("offers a published course with no prior assignment", () => {
    expect(canSelfEnrollInCourse(annualCourse, [])).toBe(true);
  });

  it.each(["assigned", "in_progress", "overdue", "paused"])(
    "reuses %s work instead of offering a duplicate assignment",
    status => {
      expect(canSelfEnrollInCourse(annualCourse, [{
        course_id: annualCourse.id,
        status,
        assigned_at: "2026-01-01T12:00:00Z",
        completed_at: null,
      }])).toBe(false);
    },
  );

  it("does not offer a completed annual course before its 30-day renewal window", () => {
    expect(canSelfEnrollInCourse(annualCourse, [{
      course_id: annualCourse.id,
      status: "completed",
      assigned_at: "2026-01-01T12:00:00Z",
      completed_at: "2026-01-15T23:30:00Z",
    }], new Date("2026-12-16T04:59:59Z"))).toBe(false);
  });

  it("offers a fresh annual assignment when its Pennsylvania renewal window begins", () => {
    expect(canSelfEnrollInCourse(annualCourse, [{
      course_id: annualCourse.id,
      status: "completed",
      assigned_at: "2026-01-01T12:00:00Z",
      completed_at: "2026-01-15T23:30:00Z",
    }], new Date("2026-12-16T05:00:00Z"))).toBe(true);
  });

  it("uses protected completion documentation instead of a later mutable timestamp correction", () => {
    expect(canSelfEnrollInCourse(annualCourse, [{
      course_id: annualCourse.id,
      status: "completed",
      assigned_at: "2026-01-01T12:00:00Z",
      completed_at: "2026-12-31T12:00:00Z",
      completion_recorded_at: "2026-01-15T23:30:00Z",
    }], new Date("2027-01-15T05:00:00Z"))).toBe(true);
  });

  it("does not make a nonrecurring completed course enrollable again", () => {
    expect(canSelfEnrollInCourse(
      { id: "one-time", recurrence_interval_days: null },
      [{
        course_id: "one-time",
        status: "completed",
        assigned_at: "2020-01-01T00:00:00Z",
        completed_at: "2020-01-02T00:00:00Z",
      }],
      new Date("2030-01-01T00:00:00Z"),
    )).toBe(false);
  });

  it("allows replacement of a canceled assignment", () => {
    expect(canSelfEnrollInCourse(annualCourse, [{
      course_id: annualCourse.id,
      status: "canceled",
      assigned_at: "2026-01-01T12:00:00Z",
      completed_at: null,
    }])).toBe(true);
  });

  it("does not let a newer canceled row hide a prior completion that is not renewable", () => {
    expect(canSelfEnrollInCourse(annualCourse, [
      {
        course_id: annualCourse.id,
        status: "completed",
        assigned_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-06-01T00:00:00Z",
      },
      {
        course_id: annualCourse.id,
        status: "canceled",
        assigned_at: "2026-07-01T00:00:00Z",
        completed_at: null,
      },
    ], new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });

  it("reuses any open work even when another cycle was assigned more recently", () => {
    expect(canSelfEnrollInCourse(annualCourse, [
      {
        course_id: annualCourse.id,
        status: "in_progress",
        assigned_at: "2026-01-01T00:00:00Z",
        completed_at: null,
      },
      {
        course_id: annualCourse.id,
        status: "completed",
        assigned_at: "2026-02-01T00:00:00Z",
        completed_at: "2026-02-10T00:00:00Z",
      },
    ], new Date("2027-02-01T00:00:00Z"))).toBe(false);
  });

  it("uses the latest protected completion documentation across multiple cycles", () => {
    expect(canSelfEnrollInCourse(annualCourse, [
      {
        course_id: annualCourse.id,
        status: "completed",
        assigned_at: "2026-06-01T00:00:00Z",
        completed_at: "2026-06-02T00:00:00Z",
        completion_recorded_at: "2026-01-01T00:00:00Z",
      },
      {
        course_id: annualCourse.id,
        status: "completed",
        assigned_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-07-01T00:00:00Z",
        completion_recorded_at: "2026-07-01T00:00:00Z",
      },
    ], new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("latestCourseAssignment", () => {
  it("uses the newest cycle when a course has assignment history", () => {
    const latest = latestCourseAssignment(annualCourse.id, [
      {
        course_id: annualCourse.id,
        status: "completed",
        assigned_at: "2025-01-01T00:00:00Z",
        completed_at: "2025-01-02T00:00:00Z",
      },
      {
        course_id: annualCourse.id,
        status: "in_progress",
        assigned_at: "2026-01-01T00:00:00Z",
        completed_at: null,
      },
    ]);

    expect(latest?.status).toBe("in_progress");
  });
});
