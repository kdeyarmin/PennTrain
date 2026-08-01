import { describe, expect, it } from "vitest";
import { summarizeSetupProgress } from "./enterpriseOperations";
import { buildOrganizationSetupSteps, organizationNeedsSetup } from "./organizationSetup";

const EMPTY_ORG = { facilities: 0, employees: 0, residents: 0, teamMembers: 1 };

describe("organizationNeedsSetup", () => {
  it("shows the guide to an organization straight out of signup", () => {
    // Signup creates an organizations row and one org_admin profile -- nothing else.
    expect(organizationNeedsSetup(EMPTY_ORG)).toBe(true);
  });

  it("keeps showing it while there is a facility but no roster", () => {
    expect(organizationNeedsSetup({ ...EMPTY_ORG, facilities: 1 })).toBe(true);
  });

  it("retires itself once the organization is operating", () => {
    // Deliberately not gated on every step: an org with no residents (a training-only
    // customer) should not be nagged forever.
    expect(organizationNeedsSetup({ facilities: 1, employees: 4, residents: 0, teamMembers: 1 })).toBe(false);
  });
});

describe("buildOrganizationSetupSteps", () => {
  it("leads with the facility, since everything else hangs off one", () => {
    const [first] = buildOrganizationSetupSteps(EMPTY_ORG);
    expect(first.key).toBe("facility");
    expect(first.blocked).toBe(false);
  });

  it("blocks staff and residents until a facility exists, and says why", () => {
    const steps = buildOrganizationSetupSteps(EMPTY_ORG);
    const blocked = steps.filter((step) => step.blocked).map((step) => step.key);
    expect(blocked).toEqual(["employees", "residents"]);
    for (const step of steps.filter((s) => s.blocked)) {
      expect(step.blockedReason).toMatch(/facility/i);
      // A blocked step must not send the user to a page that cannot accept the record yet.
      expect(step.href).toBe("/app/facilities");
    }
  });

  it("unblocks the rest as soon as a facility exists", () => {
    const steps = buildOrganizationSetupSteps({ ...EMPTY_ORG, facilities: 1 });
    expect(steps.some((step) => step.blocked)).toBe(false);
    expect(steps.find((step) => step.key === "employees")?.href).toBe("/app/employees");
  });

  it("counts the founding admin as not-yet-a-team", () => {
    // Signup leaves exactly one profile; that is not "invited your team".
    expect(buildOrganizationSetupSteps(EMPTY_ORG).find((s) => s.key === "team")?.complete).toBe(false);
    expect(
      buildOrganizationSetupSteps({ ...EMPTY_ORG, teamMembers: 2 }).find((s) => s.key === "team")?.complete,
    ).toBe(true);
  });

  it("reports progress against the shared guided-setup summary", () => {
    const fresh = summarizeSetupProgress(buildOrganizationSetupSteps(EMPTY_ORG));
    expect(fresh).toMatchObject({ complete: 0, percent: 0 });

    const done = summarizeSetupProgress(
      buildOrganizationSetupSteps({ facilities: 2, employees: 10, residents: 5, teamMembers: 3 }),
    );
    expect(done).toMatchObject({ complete: 4, remaining: 0, percent: 100 });
  });
});
