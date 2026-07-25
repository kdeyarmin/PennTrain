import { describe, expect, it } from "vitest";
import {
  canRequestOverride,
  dutyEligibilitySummary,
  dutyReason,
  dutyReasons,
  isDutyBlocked,
  type DutyEligibilityResult,
} from "./dutyEligibility";

function result(overrides: Partial<DutyEligibilityResult> = {}): DutyEligibilityResult {
  return { outcome: "eligible", blocks: [], warnings: [], overrideId: null, ...overrides };
}

describe("reasons", () => {
  it("explains what is wrong and what would fix it", () => {
    const reason = dutyReason("qualification_missing");
    expect(reason.summary).toContain("qualification");
    expect(reason.resolution.length).toBeGreaterThan(20);
  });

  it("reads as something for a code this build does not know", () => {
    // A blank line in a dialog is worse than an imperfect label.
    const reason = dutyReason("some_new_block_code");
    expect(reason.summary).toBe("Some new block code");
    expect(reason.resolution.length).toBeGreaterThan(0);
  });

  it("separates what an override can solve from what it cannot", () => {
    // An override cannot make a deactivated account into an active one.
    expect(dutyReason("profile_inactive").overridable).toBe(false);
    expect(dutyReason("profile_not_found").overridable).toBe(false);
    // A missing qualification is exactly the case a time-limited override exists for.
    expect(dutyReason("qualification_missing").overridable).toBe(true);
  });

  it("returns blocks and warnings together, blocks first", () => {
    const reasons = dutyReasons(result({
      outcome: "blocked", blocks: ["qualification_missing"], warnings: ["override_applied"],
    }));
    expect(reasons.map((reason) => reason.code)).toEqual(["qualification_missing", "override_applied"]);
  });
});

describe("blocked state", () => {
  it("is blocked only on a blocked outcome", () => {
    expect(isDutyBlocked(result({ outcome: "blocked", blocks: ["role_not_accepted"] }))).toBe(true);
    expect(isDutyBlocked(result({ outcome: "warning", warnings: ["override_applied"] }))).toBe(false);
    expect(isDutyBlocked(result())).toBe(false);
  });

  it("treats an absent result as not blocked, so a failed lookup never silently locks the UI", () => {
    // The server enforces regardless; a UI that hard-locks on a network blip helps nobody.
    expect(isDutyBlocked(undefined)).toBe(false);
  });
});

describe("override affordance", () => {
  it("offers an override for a block an override can actually clear", () => {
    expect(canRequestOverride(result({ outcome: "blocked", blocks: ["qualification_missing"] }))).toBe(true);
  });

  it("does not offer one for a deactivated account", () => {
    expect(canRequestOverride(result({ outcome: "blocked", blocks: ["profile_inactive"] }))).toBe(false);
  });

  it("offers one when any block is overridable, even alongside one that is not", () => {
    expect(canRequestOverride(result({
      outcome: "blocked", blocks: ["profile_inactive", "qualification_missing"],
    }))).toBe(true);
  });

  it("offers nothing when nothing is blocked", () => {
    expect(canRequestOverride(result())).toBe(false);
    expect(canRequestOverride(undefined)).toBe(false);
  });
});

describe("summary line", () => {
  it("says nothing when the person is eligible", () => {
    expect(dutyEligibilitySummary(result())).toBeNull();
    expect(dutyEligibilitySummary(undefined)).toBeNull();
  });

  it("names the reason rather than only refusing", () => {
    const summary = dutyEligibilitySummary(result({
      outcome: "blocked", blocks: ["qualification_missing"],
    }));
    expect(summary).toContain("Cannot sign");
    expect(summary).toContain("qualification");
  });

  it("surfaces a warning without claiming the action is blocked", () => {
    const summary = dutyEligibilitySummary(result({
      outcome: "warning", warnings: ["override_applied"],
    }));
    expect(summary).toContain("Note:");
    expect(summary).not.toContain("Cannot sign");
  });

  it("combines several reasons into one line", () => {
    const summary = dutyEligibilitySummary(result({
      outcome: "blocked", blocks: ["role_not_accepted", "qualification_missing"],
    }));
    expect(summary).toContain("role");
    expect(summary).toContain("qualification");
  });
});
