/**
 * Durable medical equipment events (BACKLOG.md G10).
 *
 * `register_resident_dme_item` had a caller. `record_resident_dme_event` -- the only writer of
 * `resident_dme_history` anywhere in the system -- had none. Two consequences, both visible on the
 * same screen:
 *
 *   1. The "Register DME" card promised it "preserves assignment history and repair/inspection
 *      documentation". Nothing could add a history row after registration, so it did not.
 *   2. The "DME inspections due" metric counts in-use items with no `inspected` history row inside
 *      their configured frequency window. With no writer of that table the count could only ever
 *      rise: every item with an inspection frequency was permanently overdue from the day it was
 *      registered, and no action on the screen could clear one.
 *
 * This module owns what each event means for the item it is recorded against. The server takes
 * whatever status and condition it is handed; these are the defaults that make the pairing coherent,
 * so a repair request does not leave equipment marked serviceable.
 */

export type DmeEventType =
  | "assigned"
  | "inspected"
  | "repair_requested"
  | "repaired"
  | "returned"
  | "transferred"
  | "disposed"
  | "cleaned"
  | "documented";

export type DmeStatus = "ordered" | "in_use" | "needs_repair" | "returned" | "transferred" | "disposed";
export type DmeCondition = "new" | "serviceable" | "needs_cleaning" | "needs_repair" | "unsafe" | "retired";

export interface DmeEventShape {
  label: string;
  /** What this event says about where the item now is in its life. */
  status: DmeStatus | null;
  /** What it says about the item's physical state, or null when the recorder must choose. */
  condition: DmeCondition | null;
  /** True when the event is meaningless without naming the resident it moved to. */
  requiresResident: boolean;
  /** True when the event carries no other field, so the note is the whole record. */
  requiresNote: boolean;
  description: string;
}

export const DME_EVENT_SHAPES: Record<DmeEventType, DmeEventShape> = {
  assigned: {
    label: "Assigned to a resident",
    status: "in_use", condition: null, requiresResident: true, requiresNote: false,
    description: "The item is now in use by the named resident.",
  },
  inspected: {
    label: "Inspected",
    // The one event where the condition is the point: an inspection that did not say what it found
    // clears the overdue count without recording anything.
    status: null, condition: null, requiresResident: false, requiresNote: false,
    description: "Records the inspection that the overdue count is measured against. Say what you found.",
  },
  repair_requested: {
    label: "Repair requested",
    status: "needs_repair", condition: "needs_repair", requiresResident: false, requiresNote: true,
    description: "Marks the item as needing repair and records what is wrong with it.",
  },
  repaired: {
    label: "Repaired",
    status: "in_use", condition: "serviceable", requiresResident: false, requiresNote: true,
    description: "Returns the item to service and records what was done.",
  },
  cleaned: {
    label: "Cleaned",
    status: null, condition: "serviceable", requiresResident: false, requiresNote: false,
    description: "Clears a needs-cleaning condition.",
  },
  transferred: {
    label: "Transferred to another resident",
    // `in_use`, not `transferred`: a transfer names a new resident, so the walker or concentrator
    // is still in service in the same facility and still needs inspecting on schedule. Only
    // `in_use`/`needs_repair` items are counted by `dmeInspectionState` and by
    // `get_resident_care_delivery_analytics`, so parking it in a `transferred` status silently
    // took it off the inspection schedule. The transfer stays visible as an event in the history,
    // which is where "what happened" belongs; status records where the item is now.
    status: "in_use", condition: null, requiresResident: true, requiresNote: false,
    description: "Moves the item to a different resident in the same facility. It stays in service.",
  },
  returned: {
    label: "Returned to vendor or owner",
    status: "returned", condition: null, requiresResident: false, requiresNote: false,
    description: "The item has left the building and is no longer in service here.",
  },
  disposed: {
    label: "Disposed",
    status: "disposed", condition: "retired", requiresResident: false, requiresNote: true,
    description: "The item is gone for good. Record why it could not be repaired or returned.",
  },
  documented: {
    label: "Note only",
    status: null, condition: null, requiresResident: false, requiresNote: true,
    description: "Adds to the record without changing the item.",
  },
};

export const DME_CONDITIONS: DmeCondition[] = [
  "new", "serviceable", "needs_cleaning", "needs_repair", "unsafe", "retired",
];

export interface DmeEventForm {
  eventType: DmeEventType;
  note: string;
  newResidentId: string;
  newCondition: string;
}

/** What is wrong with an event form, or an empty list when it is ready to record. */
export function dmeEventIssues(form: DmeEventForm): string[] {
  const shape = DME_EVENT_SHAPES[form.eventType];
  const issues: string[] = [];
  if (shape.requiresResident && !form.newResidentId) {
    issues.push("Name the resident this equipment moved to.");
  }
  if (shape.requiresNote && form.note.trim().length < 5) {
    issues.push("This event is only the note — say what happened, in at least five characters.");
  }
  if (form.eventType === "inspected" && !form.newCondition) {
    issues.push("An inspection has to record what condition the equipment was found in.");
  }
  return issues;
}

export interface DmeItemLike {
  status: string;
  inspection_frequency_days: number | null;
}

export interface DmeInspectionState {
  /** Null when this item is not on an inspection schedule at all. */
  dueInDays: number | null;
  overdue: boolean;
  label: string;
}

/**
 * When this item's next inspection is due, mirroring the server's overdue definition exactly.
 *
 * The analytics metric counts items whose status is `in_use` or `needs_repair`, that carry an
 * inspection frequency, and that have no `inspected` history row inside that many days. An item
 * matching all three with no inspection ever recorded is overdue, not merely un-inspected -- which
 * is what the whole estate looked like while nothing could write the history.
 */
export function dmeInspectionState(
  item: DmeItemLike,
  lastInspectedAt: string | null,
  now: Date,
): DmeInspectionState {
  const frequency = item.inspection_frequency_days;
  if (frequency === null || !["in_use", "needs_repair"].includes(item.status)) {
    return { dueInDays: null, overdue: false, label: "Not on an inspection schedule" };
  }
  if (!lastInspectedAt) {
    return { dueInDays: null, overdue: true, label: `Never inspected (every ${frequency} days)` };
  }
  const last = Date.parse(lastInspectedAt);
  if (Number.isNaN(last)) {
    return { dueInDays: null, overdue: true, label: `Never inspected (every ${frequency} days)` };
  }
  const elapsedDays = Math.floor((now.getTime() - last) / 86_400_000);
  const dueInDays = frequency - elapsedDays;
  if (dueInDays < 0) {
    return { dueInDays, overdue: true, label: `Inspection overdue by ${Math.abs(dueInDays)} days` };
  }
  if (dueInDays === 0) return { dueInDays, overdue: false, label: "Inspection due today" };
  return { dueInDays, overdue: false, label: `Inspection due in ${dueInDays} days` };
}

export function dmeEquipmentLabel(equipmentType: string): string {
  return equipmentType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
