import { describe, expect, it } from "vitest";
import {
  canCancelEmergencyEvent,
  canCloseEmergencyEvent,
  canCreateEmergencyCorrectiveWork,
  canSaveEmergencyAfterAction,
  canStabilizeEmergencyEvent,
  emergencyTransitionReasonIsReady,
} from "./emergencyCommand";

describe("emergency command gates", () => {
  it("requires a five-character reason", () => {
    expect(emergencyTransitionReasonIsReady("ok")).toBe(false);
    expect(emergencyTransitionReasonIsReady("Ready")).toBe(true);
  });

  it("refuses stabilization while anyone is unaccounted", () => {
    expect(canStabilizeEmergencyEvent({
      reason: "All clear now",
      residentUnaccounted: 1,
      staffUnaccounted: 0,
    })).toBe(false);
    expect(canStabilizeEmergencyEvent({
      reason: "All clear now",
      residentUnaccounted: 0,
      staffUnaccounted: 0,
    })).toBe(true);
  });

  it("refuses closure without an approved after-action", () => {
    expect(canCloseEmergencyEvent({ reason: "Closing now", afterActionStatus: "submitted" })).toBe(false);
    expect(canCloseEmergencyEvent({ reason: "Closing now", afterActionStatus: "approved" })).toBe(true);
  });

  it("lets cancel proceed on a reason alone", () => {
    expect(canCancelEmergencyEvent("False alarm")).toBe(true);
  });

  it("mirrors the after-action length rules", () => {
    const draft = {
      status: "draft",
      responseSummary: "A full summary of the response so far.",
      strengths: "",
      gaps: "",
      correctivePlan: "",
    };
    expect(canSaveEmergencyAfterAction(draft)).toBe(true);
    expect(canSaveEmergencyAfterAction({ ...draft, responseSummary: "short" })).toBe(false);
    expect(canSaveEmergencyAfterAction({
      status: "approved",
      responseSummary: "A full summary of the response so far.",
      strengths: "ok",
      gaps: "gap here",
      correctivePlan: "plan",
    })).toBe(false);
    expect(canSaveEmergencyAfterAction({
      status: "approved",
      responseSummary: "A full summary of the response so far.",
      strengths: "Staff accounted quickly",
      gaps: "Radio coverage dropped",
      correctivePlan: "Replace radios",
    })).toBe(true);
  });

  it("refuses a corrective work item due now or in the past", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    expect(canCreateEmergencyCorrectiveWork({
      title: "Fix",
      ownerProfileId: "p1",
      dueAt: "2026-09-08T12:00:00.000Z",
      now,
    })).toBe(false);
    expect(canCreateEmergencyCorrectiveWork({
      title: "Replace radios",
      ownerProfileId: "p1",
      dueAt: "2026-09-09T12:00:00.000Z",
      now,
    })).toBe(true);
    expect(canCreateEmergencyCorrectiveWork({
      title: "ab",
      ownerProfileId: "p1",
      dueAt: "2026-09-09T12:00:00.000Z",
      now,
    })).toBe(false);
  });
});
