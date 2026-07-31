import { describe, expect, it } from "vitest";
import { isPilotFeatureKey, isReleaseActiveForOrg, PILOT_FEATURE_KEYS } from "./pilotCohort";

describe("pilotCohort", () => {
  it("knows the four pilot feature keys", () => {
    expect(PILOT_FEATURE_KEYS).toHaveLength(4);
    expect(isPilotFeatureKey("learning.video_watch_gate")).toBe(true);
    expect(isPilotFeatureKey("nope")).toBe(false);
  });

  it("evaluates effective release for cohort vs global", () => {
    expect(isReleaseActiveForOrg({
      isEnabled: true, rolloutMode: "cohort", expiresAt: null, orgEnrolled: true, killDisabled: false,
    })).toBe(true);
    expect(isReleaseActiveForOrg({
      isEnabled: true, rolloutMode: "cohort", expiresAt: null, orgEnrolled: false, killDisabled: false,
    })).toBe(false);
    expect(isReleaseActiveForOrg({
      isEnabled: true, rolloutMode: "global", expiresAt: null, orgEnrolled: false, killDisabled: false,
    })).toBe(true);
    expect(isReleaseActiveForOrg({
      isEnabled: true, rolloutMode: "global", expiresAt: null, orgEnrolled: true, killDisabled: true,
    })).toBe(false);
  });
});
