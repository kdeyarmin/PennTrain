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

  it("blocks the owning trainer on their own cross-facility class", () => {
    // The J30 defect: training_classes_select shows it to them, training_classes_write does not.
    expect(
      trainingClassWriteBlock(crossFacilityClass, {
        role: "trainer",
        profileId: trainerId,
        assignedFacilityIds: assigned,
      }),
    ).toBe("cross_facility");
  });

  it("blocks a facility manager on a cross-facility class for the same reason", () => {
    expect(
      trainingClassWriteBlock(crossFacilityClass, {
        role: "facility_manager",
        profileId: "profile-manager",
        assignedFacilityIds: assigned,
      }),
    ).toBe("cross_facility");
  });

  it("lets an org admin run a cross-facility class", () => {
    // The org_admin branch of the policy carries no facility test, which is why a cross-facility
    // class is runnable at all today.
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
    const blocks = ["cross_facility", "unassigned_facility", "not_owner", "role"] as const;
    const messages = blocks.map(describeTrainingClassWriteBlock);
    expect(new Set(messages).size).toBe(blocks.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(20);
  });
});
