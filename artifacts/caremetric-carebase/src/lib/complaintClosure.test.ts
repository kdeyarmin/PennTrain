import { describe, expect, it } from "vitest";
import { complaintAppealComplete, complaintClosureReady } from "./complaintClosure";

const ready = {
  acknowledgementRecorded: true,
  investigatorAssigned: true,
  notesComplete: true,
  findingsComplete: true,
  writtenResponseRecorded: true,
  appealComplete: true,
  correctiveActionsComplete: true,
  monitoringComplete: true,
};

describe("complaintClosureReady", () => {
  it("is true only when every database-enforced item is known and satisfied", () => {
    expect(complaintClosureReady(ready)).toBe(true);
  });

  it("treats unloaded activity as not ready, not as zero open actions", () => {
    expect(complaintClosureReady({ ...ready, correctiveActionsComplete: null })).toBe(false);
    expect(complaintClosureReady({ ...ready, monitoringComplete: null })).toBe(false);
  });

  it("refuses a missing investigation artefact", () => {
    expect(complaintClosureReady({ ...ready, notesComplete: false })).toBe(false);
    expect(complaintClosureReady({ ...ready, investigatorAssigned: false })).toBe(false);
  });

  it("refuses close while an appeal is open without an outcome", () => {
    expect(complaintAppealComplete("", "upheld")).toBe(true);
    expect(complaintAppealComplete("2026-09-01T12:00", "no")).toBe(false);
    expect(complaintAppealComplete("2026-09-01T12:00", "upheld after review")).toBe(true);
    expect(complaintClosureReady({ ...ready, appealComplete: false })).toBe(false);
  });
});
