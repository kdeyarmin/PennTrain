import { describe, expect, it } from "vitest";
import { evacuationSeconds, fireDrillRecordErrors, type FireDrillRecordDraft } from "./fireDrillRecord";

const complete: FireDrillRecordDraft = {
  drillTime: "02:15",
  durationMinutes: "3",
  durationSeconds: "5",
  exitRouteUsed: "East stairwell to rear parking lot",
  residentsPresent: "24",
  residentsEvacuated: "24",
  staffParticipating: "4",
  problemsEncountered: "None",
};

describe("fireDrillRecordErrors", () => {
  it("accepts a record carrying every 2600.132(c) / 2800.132(c) element", () => {
    expect(fireDrillRecordErrors(complete)).toEqual({});
  });

  it("requires the evacuation time, which the regulation lists in the written record", () => {
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "", durationSeconds: "" }))
      .toEqual({ evacuationDuration: "Required" });
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: " ", durationSeconds: "" }))
      .toEqual({ evacuationDuration: "Required" });
  });

  it("accepts either part of the evacuation time on its own", () => {
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "4", durationSeconds: "" })).toEqual({});
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "", durationSeconds: "45" })).toEqual({});
  });

  it("rejects an evacuation time that cannot be real", () => {
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "0", durationSeconds: "0" }).evacuationDuration)
      .toBe("Enter how long the evacuation took");
    expect(fireDrillRecordErrors({ ...complete, durationSeconds: "75" }).evacuationDuration)
      .toBe("Enter whole minutes and seconds (0–59)");
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "-2" }).evacuationDuration)
      .toBe("Enter whole minutes and seconds (0–59)");
    expect(fireDrillRecordErrors({ ...complete, durationMinutes: "1.5" }).evacuationDuration)
      .toBe("Enter whole minutes and seconds (0–59)");
  });

  it("names every other missing element", () => {
    const empty: FireDrillRecordDraft = {
      drillTime: "", durationMinutes: "", durationSeconds: "", exitRouteUsed: "", residentsPresent: "",
      residentsEvacuated: "", staffParticipating: "", problemsEncountered: "",
    };
    expect(Object.keys(fireDrillRecordErrors(empty)).sort()).toEqual([
      "drillTime", "evacuationDuration", "exitRouteUsed", "problemsEncountered",
      "residentsEvacuated", "residentsPresent", "staffParticipating",
    ]);
  });
});

describe("evacuationSeconds", () => {
  it("combines minutes and seconds", () => {
    expect(evacuationSeconds("3", "5")).toBe(185);
    expect(evacuationSeconds("2", "")).toBe(120);
    expect(evacuationSeconds("", "40")).toBe(40);
  });

  it("returns null when nothing usable was entered", () => {
    expect(evacuationSeconds("", "")).toBeNull();
    expect(evacuationSeconds("1", "60")).toBeNull();
    expect(evacuationSeconds("abc", "")).toBeNull();
  });
});
