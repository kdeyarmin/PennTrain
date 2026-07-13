import { describe, it, expect } from "vitest";
import { summarizeCourseFeedback, type CourseFeedback } from "./courseFeedback";

function feedback(rating: number): CourseFeedback {
  return {
    id: crypto.randomUUID(),
    organization_id: "org",
    course_id: "course",
    course_assignment_id: crypto.randomUUID(),
    employee_id: "employee",
    rating,
    comment: null,
    created_at: new Date().toISOString(),
  };
}

describe("summarizeCourseFeedback", () => {
  it("returns null average and zero count for no rows", () => {
    expect(summarizeCourseFeedback(undefined)).toEqual({ average: null, count: 0 });
    expect(summarizeCourseFeedback([])).toEqual({ average: null, count: 0 });
  });

  it("averages ratings and rounds to one decimal place", () => {
    expect(summarizeCourseFeedback([feedback(5), feedback(4), feedback(4)])).toEqual({ average: 4.3, count: 3 });
  });

  it("handles a single rating exactly", () => {
    expect(summarizeCourseFeedback([feedback(3)])).toEqual({ average: 3, count: 1 });
  });
});
