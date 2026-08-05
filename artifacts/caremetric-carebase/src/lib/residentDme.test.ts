import { describe, expect, it } from "vitest";
import {
  DME_EVENT_SHAPES,
  dmeEquipmentLabel,
  dmeEventIssues,
  dmeInspectionState,
  type DmeEventForm,
  type DmeEventType,
} from "./residentDme";

// Verbatim from the resident_dme_history check constraint in 20260714100000.
const SERVER_EVENT_TYPES: DmeEventType[] = [
  "assigned", "inspected", "repair_requested", "repaired", "returned",
  "transferred", "disposed", "cleaned", "documented",
];
// Verbatim from the resident_dme_items status and condition check constraints.
const SERVER_STATUSES = ["ordered", "in_use", "needs_repair", "returned", "transferred", "disposed"];
const SERVER_CONDITIONS = ["new", "serviceable", "needs_cleaning", "needs_repair", "unsafe", "retired"];

const form = (overrides: Partial<DmeEventForm> = {}): DmeEventForm => ({
  eventType: "documented",
  note: "",
  newResidentId: "",
  newCondition: "",
  ...overrides,
});

describe("DME_EVENT_SHAPES", () => {
  it("covers every event type the server accepts and invents none", () => {
    expect(Object.keys(DME_EVENT_SHAPES).sort()).toEqual([...SERVER_EVENT_TYPES].sort());
  });

  it("only proposes statuses and conditions the check constraints allow", () => {
    for (const shape of Object.values(DME_EVENT_SHAPES)) {
      if (shape.status !== null) expect(SERVER_STATUSES).toContain(shape.status);
      if (shape.condition !== null) expect(SERVER_CONDITIONS).toContain(shape.condition);
    }
  });

  it("does not leave a repair request marked serviceable", () => {
    expect(DME_EVENT_SHAPES.repair_requested.status).toBe("needs_repair");
    expect(DME_EVENT_SHAPES.repair_requested.condition).toBe("needs_repair");
  });

  it("puts a repaired item back in service", () => {
    expect(DME_EVENT_SHAPES.repaired.status).toBe("in_use");
    expect(DME_EVENT_SHAPES.repaired.condition).toBe("serviceable");
  });

  it("leaves an inspection's condition to the inspector rather than assuming one", () => {
    expect(DME_EVENT_SHAPES.inspected.condition).toBeNull();
    expect(DME_EVENT_SHAPES.inspected.status).toBeNull();
  });
});

describe("dmeEventIssues", () => {
  it("requires a resident for the two events that move equipment", () => {
    expect(dmeEventIssues(form({ eventType: "assigned" }))).toContainEqual(expect.stringMatching(/resident/i));
    expect(dmeEventIssues(form({ eventType: "transferred" }))).toContainEqual(expect.stringMatching(/resident/i));
    expect(dmeEventIssues(form({ eventType: "assigned", newResidentId: "r1" }))).toEqual([]);
  });

  it("requires an inspection to say what it found", () => {
    expect(dmeEventIssues(form({ eventType: "inspected" }))).toContainEqual(expect.stringMatching(/condition/i));
    expect(dmeEventIssues(form({ eventType: "inspected", newCondition: "serviceable" }))).toEqual([]);
  });

  it("requires a real note where the note is the whole record", () => {
    expect(dmeEventIssues(form({ eventType: "disposed", note: "bin" }))).toHaveLength(1);
    expect(dmeEventIssues(form({ eventType: "disposed", note: "Frame cracked beyond repair" }))).toEqual([]);
  });

  it("does not demand a note for events that carry their own meaning", () => {
    expect(dmeEventIssues(form({ eventType: "returned" }))).toEqual([]);
    expect(dmeEventIssues(form({ eventType: "cleaned" }))).toEqual([]);
  });

  it("reports both problems at once for a transfer with no resident and no note", () => {
    expect(dmeEventIssues(form({ eventType: "repair_requested" }))).toHaveLength(1);
    expect(dmeEventIssues(form({ eventType: "assigned", newResidentId: "" }))).toHaveLength(1);
  });
});

describe("dmeInspectionState", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("says nothing about an item with no inspection frequency", () => {
    const state = dmeInspectionState({ status: "in_use", inspection_frequency_days: null }, null, now);
    expect(state.overdue).toBe(false);
    expect(state.label).toMatch(/not on an inspection schedule/i);
  });

  it("says nothing about an item no longer in service, matching the server's status filter", () => {
    const state = dmeInspectionState({ status: "disposed", inspection_frequency_days: 90 }, null, now);
    expect(state.overdue).toBe(false);
  });

  it("treats a never-inspected in-use item as overdue, not merely un-inspected", () => {
    const state = dmeInspectionState({ status: "in_use", inspection_frequency_days: 90 }, null, now);
    expect(state.overdue).toBe(true);
    expect(state.label).toMatch(/never inspected/i);
  });

  it("counts an item inside its window as due, not overdue", () => {
    const state = dmeInspectionState(
      { status: "in_use", inspection_frequency_days: 90 },
      "2026-07-05T12:00:00.000Z",
      now,
    );
    expect(state.overdue).toBe(false);
    expect(state.dueInDays).toBe(60);
  });

  it("names how far past due an item is", () => {
    const state = dmeInspectionState(
      { status: "in_use", inspection_frequency_days: 30 },
      "2026-06-04T12:00:00.000Z",
      now,
    );
    expect(state.overdue).toBe(true);
    expect(state.label).toBe("Inspection overdue by 31 days");
  });

  it("reads the exact boundary as due today rather than overdue", () => {
    const state = dmeInspectionState(
      { status: "in_use", inspection_frequency_days: 30 },
      "2026-07-05T12:00:00.000Z",
      now,
    );
    expect(state.overdue).toBe(false);
    expect(state.label).toBe("Inspection due today");
  });

  it("includes needs_repair items, which the server's count also includes", () => {
    const state = dmeInspectionState({ status: "needs_repair", inspection_frequency_days: 30 }, null, now);
    expect(state.overdue).toBe(true);
  });

  it("does not silently pass an unparseable inspection date off as current", () => {
    const state = dmeInspectionState({ status: "in_use", inspection_frequency_days: 30 }, "whenever", now);
    expect(state.overdue).toBe(true);
  });
});

describe("dmeEquipmentLabel", () => {
  it("reads the stored enum back as words", () => {
    expect(dmeEquipmentLabel("hospital_bed")).toBe("Hospital bed");
    expect(dmeEquipmentLabel("specialty_mattress")).toBe("Specialty mattress");
  });
});

describe("a transfer keeps the item on its inspection schedule", () => {
  // A transfer names a new resident, so the item is still in service in the same facility. Parking
  // it in a `transferred` status dropped it out of the in_use/needs_repair set that both
  // `dmeInspectionState` and `get_resident_care_delivery_analytics` count, which silently took a
  // walker or oxygen concentrator off the inspection schedule the moment it changed hands.
  it("moves the item to in_use, the same status an assignment produces", () => {
    expect(DME_EVENT_SHAPES.transferred.status).toBe("in_use");
    expect(DME_EVENT_SHAPES.transferred.status).toBe(DME_EVENT_SHAPES.assigned.status);
  });

  it("still requires the new resident, which is what makes it a transfer", () => {
    expect(DME_EVENT_SHAPES.transferred.requiresResident).toBe(true);
  });

  it("leaves a transferred item inspectable rather than untracked", () => {
    const state = dmeInspectionState(
      { status: DME_EVENT_SHAPES.transferred.status!, inspection_frequency_days: 30 },
      "2026-01-01T00:00:00Z",
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(state.label).not.toBe("Not on an inspection schedule");
    expect(state.overdue).toBe(true);
  });

  it("still leaves the events that genuinely end service off the schedule", () => {
    for (const shape of [DME_EVENT_SHAPES.returned, DME_EVENT_SHAPES.disposed]) {
      const state = dmeInspectionState(
        { status: shape.status!, inspection_frequency_days: 30 },
        "2026-01-01T00:00:00Z",
        new Date("2026-06-01T00:00:00Z"),
      );
      expect(state.label).toBe("Not on an inspection schedule");
    }
  });
});
