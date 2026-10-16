import { describe, expect, it } from "vitest";
import {
  buildTrainingOwnerSteps,
  employeeIdsMatchingJobTitle,
  suggestedTrainingDueDate,
  trainingOwnerSetupFinished,
} from "./trainingOwnerSetup";

const links = {
  facilityHref: "/app/facilities",
  addStaffHref: "/app/employees?action=add",
  assignmentsHref: "/app/course-assignments",
};

describe("training owner setup", () => {
  it("starts a brand-new organization at the location, and holds the rest", () => {
    const steps = buildTrainingOwnerSteps(
      { facilities: 0, staff: 0, portalReady: 0, plans: 0, assigned: 0 },
      links,
    );
    expect(steps.map((step) => step.key)).toEqual(["facility", "staff", "invite", "assign", "progress"]);
    expect(steps[0]).toMatchObject({ done: false, blocked: false, href: "/app/facilities" });
    expect(steps.filter((step) => step.blocked).map((step) => step.key)).toEqual([
      "staff",
      "invite",
      "assign",
      "progress",
    ]);
    expect(trainingOwnerSetupFinished({ facilities: 0, staff: 0, portalReady: 0, plans: 0, assigned: 0 })).toBe(false);
  });

  it("treats one signed-in person as enough, and retires after the first assignment", () => {
    const counts = { facilities: 1, staff: 4, portalReady: 1, plans: 0, assigned: 2 };
    const steps = buildTrainingOwnerSteps(counts, links);
    expect(steps.find((step) => step.key === "invite")).toMatchObject({ done: true, blocked: false, tab: "students" });
    expect(steps.find((step) => step.key === "assign")).toMatchObject({
      done: true,
      href: "/app/course-assignments",
    });
    expect(steps.find((step) => step.key === "progress")?.done).toBe(false);
    expect(trainingOwnerSetupFinished(counts)).toBe(true);
  });

  it("does not mark invites done just because the roster exists", () => {
    const steps = buildTrainingOwnerSteps(
      { facilities: 1, staff: 3, portalReady: 0, plans: 1, assigned: 0 },
      links,
    );
    expect(steps.find((step) => step.key === "staff")?.done).toBe(true);
    expect(steps.find((step) => step.key === "invite")?.done).toBe(false);
    expect(trainingOwnerSetupFinished({ facilities: 1, staff: 3, portalReady: 0, plans: 1, assigned: 0 })).toBe(false);
  });

  it("suggests a deadline 30 facility days ahead, including a month boundary", () => {
    expect(suggestedTrainingDueDate("2026-01-15")).toBe("2026-02-14");
    expect(suggestedTrainingDueDate("2026-12-15")).toBe("2027-01-14");
  });

  it("selects a whole job title without matching a partial title", () => {
    const staff = [
      { id: "1", job_title: "Caregiver" },
      { id: "2", job_title: " caregiver " },
      { id: "3", job_title: "Lead Caregiver" },
      { id: "4", job_title: null },
    ];
    expect(employeeIdsMatchingJobTitle(staff, "Caregiver")).toEqual(["1", "2"]);
    expect(employeeIdsMatchingJobTitle(staff, "  ")).toEqual([]);
  });
});
