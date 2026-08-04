import { describe, expect, it } from "vitest";
import {
  actionReasonLabel,
  actionTypeLabel,
  simulationStateNote,
  simulationSummary,
  type SimulatedAction,
  type SimulationLike,
} from "./automationSimulation";

const action = (overrides: Partial<SimulatedAction> = {}): SimulatedAction => ({
  type: "create_work_item",
  wouldAttempt: true,
  wouldCreateWork: true,
  wouldNotify: false,
  reason: "eligible",
  payload: {},
  ...overrides,
});

const simulation = (overrides: Partial<SimulationLike> = {}): SimulationLike => ({
  ruleName: "Critical compliance follow-up",
  ruleState: "active",
  conditionsMatch: true,
  actions: [action()],
  writesPerformed: false,
  ...overrides,
});

describe("actionReasonLabel", () => {
  it("translates every reason code the server can emit", () => {
    expect(actionReasonLabel("eligible")).toBe("would run");
    expect(actionReasonLabel("conditions_not_matched")).toMatch(/conditions do not match/i);
    expect(actionReasonLabel("facility_required")).toMatch(/needs a facility/i);
  });

  it("distinguishes the two ways a rule does nothing", () => {
    expect(actionReasonLabel("conditions_not_matched")).not.toBe(actionReasonLabel("facility_required"));
  });

  it("passes an unrecognised reason through rather than hiding it", () => {
    expect(actionReasonLabel("some_new_reason")).toBe("some_new_reason");
  });
});

describe("actionTypeLabel", () => {
  it("names the two action types the schema allows", () => {
    expect(actionTypeLabel("create_work_item")).toBe("Create a work item");
    expect(actionTypeLabel("notify_roles")).toBe("Notify roles");
  });

  it("passes an unknown type through", () => {
    expect(actionTypeLabel("future_action")).toBe("future_action");
  });
});

describe("simulationSummary", () => {
  it("counts a single work item", () => {
    expect(simulationSummary(simulation())).toBe("Running this rule now would create 1 work item.");
  });

  it("pluralises and joins both effects", () => {
    expect(simulationSummary(simulation({
      actions: [
        action(),
        action(),
        action({ type: "notify_roles", wouldCreateWork: false, wouldNotify: true }),
      ],
    }))).toBe("Running this rule now would create 2 work items and send 1 notification.");
  });

  it("says nothing happens when conditions do not match, and says why", () => {
    const summary = simulationSummary(simulation({
      conditionsMatch: false,
      actions: [action({ wouldAttempt: false, wouldCreateWork: false, reason: "conditions_not_matched" })],
    }));
    expect(summary).toMatch(/conditions do not match/i);
    expect(summary).toMatch(/no effect/i);
  });

  it("says nothing happens without blaming the conditions when they did match", () => {
    const summary = simulationSummary(simulation({
      conditionsMatch: true,
      actions: [action({ wouldCreateWork: false, reason: "facility_required" })],
    }));
    expect(summary).toBe("Running this rule now would have no effect.");
    expect(summary).not.toMatch(/conditions/i);
  });

  it("counts effects rather than actions, so skipped actions do not inflate the number", () => {
    expect(simulationSummary(simulation({
      actions: [action(), action({ wouldCreateWork: false, reason: "facility_required" })],
    }))).toBe("Running this rule now would create 1 work item.");
  });

  it("handles a rule with no actions at all", () => {
    expect(simulationSummary(simulation({ actions: [] }))).toMatch(/no effect/i);
  });
});

describe("simulationStateNote", () => {
  it("stays quiet for an active rule", () => {
    expect(simulationStateNote("active")).toBeNull();
  });

  it("warns that a draft or paused rule will not fire on its own", () => {
    expect(simulationStateNote("draft")).toMatch(/will not fire on its own/i);
    expect(simulationStateNote("paused")).toMatch(/will not fire on its own/i);
  });

  it("is blunt about a retired rule", () => {
    expect(simulationStateNote("retired")).toMatch(/never fire again/i);
  });
});
