import { describe, expect, it } from "vitest";
import { RESIDENT_JOURNEY_STEPS, journeyCoverage, type JourneyStep } from "./residentJourney";

describe("resident lifecycle journey registry", () => {
  it("declares the twelve steps the program plan names, in order", () => {
    expect(RESIDENT_JOURNEY_STEPS).toHaveLength(12);
    expect(RESIDENT_JOURNEY_STEPS.map((step) => step.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("gives every step a stable unique id", () => {
    const ids = RESIDENT_JOURNEY_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  // A step marked pending with no reason is indistinguishable from one nobody has looked at. The
  // reason is what makes the coverage gap actionable rather than a number that sits there.
  it("requires a concrete blocker on every pending step", () => {
    for (const step of RESIDENT_JOURNEY_STEPS) {
      if (step.status !== "pending") continue;
      expect(step.blockedBy, `step ${step.id} is pending without a reason`).toBeTruthy();
      expect(step.blockedBy!.length).toBeGreaterThan(20);
      expect(step.blockedBy!.toLowerCase()).not.toBe("not built yet");
    }
  });

  it("does not leave a blocker on a step that is implemented", () => {
    for (const step of RESIDENT_JOURNEY_STEPS) {
      if (step.status !== "implemented") continue;
      expect(step.blockedBy, `step ${step.id} is implemented but still cites a blocker`).toBeUndefined();
    }
  });

  // "proves" is the guard against a step being marked implemented because a page rendered.
  it("states what each step proves, in terms of an outcome rather than a page", () => {
    for (const step of RESIDENT_JOURNEY_STEPS) {
      expect(step.proves.length).toBeGreaterThan(30);
    }
  });

  it("counts coverage without rounding in its own favour", () => {
    const steps: JourneyStep[] = [
      { id: "a", ordinal: 1, title: "A", proves: "x".repeat(31), status: "implemented" },
      { id: "b", ordinal: 2, title: "B", proves: "x".repeat(31), status: "pending", blockedBy: "y" },
      { id: "c", ordinal: 3, title: "C", proves: "x".repeat(31), status: "pending", blockedBy: "y" },
    ];
    const coverage = journeyCoverage(steps);
    expect(coverage).toMatchObject({ total: 3, implemented: 1, pending: 2, percent: 33 });
    expect(coverage.pendingIds).toEqual(["b", "c"]);
  });

  it("reports the real current coverage", () => {
    const coverage = journeyCoverage();
    expect(coverage.total).toBe(12);
    expect(coverage.implemented + coverage.pending).toBe(12);
  });
});
