import { describe, expect, it } from "vitest";
import {
  canWriteTrainingClass,
  describeTrainingClassWriteBlock,
  trainingClassWriteBlock,
} from "./trainingClassPermissions";

const trainerId = "profile-trainer";
const assigned = new Set(["fac-assigned"]);

const facilityClass = { facility_id: "fac-assigned", trainer_profile_id: trainerId };
const otherFacilityClass = { facility_id: "fac-other", trainer_profile_id: trainerId };
const crossFacilityClass = { facility_id: null, trainer_profile_id: trainerId };

describe("trainingClassWriteBlock", () => {
  it("lets the owning trainer write a class at a facility they are assigned to", () => {
    expect(
      trainingClassWriteBlock(facilityClass, {
        role: "trainer",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBeNull();
  });

  // RETARGETED: these two used to assert the J30 defect -- that the owning trainer and a facility
  // manager were both refused their own cross-facility class. `20260906220000` changed the policy
  // this module mirrors to `(facility_id is null or is_assigned_to_facility(facility_id))`, so
  // asserting the old rule now makes the page refuse what the database accepts, and hides every
  // control on the session including Cancel class.
  it("lets the owning trainer write their own cross-facility class", () => {
    expect(
      trainingClassWriteBlock(crossFacilityClass, {
        role: "trainer",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBeNull();
  });

  it("lets a facility manager write a cross-facility class, which is scoped by organization alone", () => {
    expect(
      trainingClassWriteBlock(crossFacilityClass, {
        role: "facility_manager",
        profileId: "profile-manager",
        assignedFacilityIds: assigned,
      }),
    ).toBeNull();
  });

  it("still blocks a trainer who does not own the cross-facility class", () => {
    expect(
      trainingClassWriteBlock(crossFacilityClass, {
        role: "trainer",
        profileId: "someone-else",
        assignedFacilityIds: assigned,
      }),
    ).toBe("not_owner");
  });

  it("lets an org admin run a cross-facility class", () => {
    // The org_admin branch of the policy carries no facility test at all.
    expect(
      canWriteTrainingClass(crossFacilityClass, {
        role: "org_admin",
        profileId: "profile-admin",
        assignedFacilityIds: new Set(),
      }),
    ).toBe(true);
    expect(
      canWriteTrainingClass(crossFacilityClass, {
        role: "platform_admin",
        profileId: "profile-platform",
        assignedFacilityIds: new Set(),
      }),
    ).toBe(true);
  });

  it("blocks a facility outside the caller's assignments", () => {
    expect(
      trainingClassWriteBlock(otherFacilityClass, {
        role: "trainer",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBe("unassigned_facility");
  });

  it("blocks a trainer who does not own the class", () => {
    expect(
      trainingClassWriteBlock(facilityClass, {
        role: "trainer",
        profileId: "someone-else",
        assignedFacilityIds: assigned,
      }),
    ).toBe("not_owner");
  });

  it("blocks roles with no write branch, including a missing role", () => {
    expect(
      trainingClassWriteBlock(facilityClass, {
        role: "employee",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBe("role");
    expect(
      trainingClassWriteBlock(facilityClass, {
        role: "auditor",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBe("role");
    expect(
      trainingClassWriteBlock(facilityClass, {
        role: null,
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBe("role");
  });
});

describe("describeTrainingClassWriteBlock", () => {
  it("gives every block a distinct next step", () => {
    const blocks = ["unassigned_facility", "not_owner", "role"] as const;
    const messages = blocks.map(describeTrainingClassWriteBlock);
    expect(new Set(messages).size).toBe(blocks.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(20);
  });
});
