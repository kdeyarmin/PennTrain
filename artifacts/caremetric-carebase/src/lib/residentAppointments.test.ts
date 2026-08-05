import { describe, expect, it } from "vitest";
import {
  appointmentIsOpen, appointmentStage, appointmentStageLabel, buildPreparationState,
  followUpIsOverdue, followUpOutstanding, PREPARATION_LEAD_HOURS, preparationItemKindLabel,
  sortAppointments, transportSummary,
  type AppointmentLike, type AppointmentPreparationItemLike,
} from "./residentAppointments";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const hoursAgo = (hours: number) => hoursFromNow(-hours);

function appointment(overrides: Partial<AppointmentLike> = {}): AppointmentLike {
  return {
    id: "ap-1",
    resident_id: "res-1",
    appointment_type: "Cardiology",
    provider_name: "Dr. Ellis",
    location: "Mercy Cardiology",
    starts_at: hoursFromNow(48),
    expected_return_at: hoursFromNow(51),
    pickup_at: hoursFromNow(47),
    transportation_provider: "County Medical Transport",
    vehicle_identifier: "Van 3",
    driver_employee_id: null,
    escort_employee_id: null,
    status: "scheduled",
    outcome_summary: null,
    new_order_ack_status: "not_applicable",
    new_order_ack_at: null,
    new_order_ack_note: null,
    follow_up_due_at: null,
    follow_up_completed_at: null,
    follow_up_work_item_id: null,
    preparation_completed_at: null,
    cancellation_reason: null,
    rescheduled_to_appointment_id: null,
    ...overrides,
  };
}

function item(overrides: Partial<AppointmentPreparationItemLike> = {}): AppointmentPreparationItemLike {
  return {
    id: "item-1",
    item_kind: "document",
    label: "Current medication list",
    required: true,
    ready: false,
    ready_at: null,
    note: null,
    ...overrides,
  };
}

describe("stage", () => {
  it("separates a future appointment from one the resident has already left for", () => {
    // Neither is a stored status. Requiring a background job to move the row would mean the record
    // is wrong for however long the job is late.
    expect(appointmentStage(appointment({ starts_at: hoursFromNow(2) }), NOW)).toBe("upcoming");
    expect(appointmentStage(appointment({ starts_at: hoursAgo(2) }), NOW)).toBe("in_progress");
  });

  it("treats an outcome status with no summary as awaiting the outcome", () => {
    // The RPC lets a status be recorded with a null summary, so "attended" alone does not mean
    // anybody wrote down what happened.
    expect(appointmentStage(appointment({ status: "attended" }), NOW)).toBe("awaiting_outcome");
    expect(appointmentStage(appointment({ status: "attended", outcome_summary: "   " }), NOW))
      .toBe("awaiting_outcome");
  });

  it("moves to follow-up open once there is a summary, and to closed once it is signed off", () => {
    const attended = appointment({ status: "attended", outcome_summary: "Dose increased" });
    expect(appointmentStage(attended, NOW)).toBe("follow_up_open");
    expect(appointmentStage({ ...attended, follow_up_completed_at: hoursAgo(1) }, NOW)).toBe("closed");
  });

  it("reports cancelled and rescheduled from the stored status", () => {
    expect(appointmentStage(appointment({ status: "canceled" }), NOW)).toBe("canceled");
    expect(appointmentStage(
      appointment({ status: "rescheduled", rescheduled_to_appointment_id: "ap-2" }), NOW,
    )).toBe("rescheduled");
  });

  it("labels every stage it can return", () => {
    // A stage with no label reaches the screen as a blank badge.
    const stages = ["upcoming", "in_progress", "awaiting_outcome", "follow_up_open", "closed",
      "canceled", "rescheduled"] as const;
    for (const stage of stages) expect(appointmentStageLabel(stage)).toBeTruthy();
  });

  it("counts only the stages that still want something as open", () => {
    expect(appointmentIsOpen(appointment(), NOW)).toBe(true);
    expect(appointmentIsOpen(appointment({ status: "canceled" }), NOW)).toBe(false);
    expect(appointmentIsOpen(
      appointment({ status: "attended", outcome_summary: "Seen", follow_up_completed_at: hoursAgo(1) }),
      NOW,
    )).toBe(false);
  });
});

describe("preparation", () => {
  const prep = (
    appointmentOverrides: Partial<AppointmentLike> = {},
    items: AppointmentPreparationItemLike[] = [item()],
  ) => buildPreparationState({ appointment: appointment(appointmentOverrides), items, now: NOW });

  it("falls due one lead window before departure, not at departure", () => {
    // The last shift on which a missing document can still be found.
    expect(prep({ starts_at: hoursFromNow(PREPARATION_LEAD_HOURS + 1) }).due).toBe(false);
    expect(prep({ starts_at: hoursFromNow(PREPARATION_LEAD_HOURS - 1) }).due).toBe(true);
  });

  it("is overdue only once the resident has actually left with something missing", () => {
    expect(prep({ starts_at: hoursFromNow(1) }).overdue).toBe(false);
    expect(prep({ starts_at: hoursAgo(1) }).overdue).toBe(true);
  });

  it("is not overdue once every required item is ready, however late it was done", () => {
    const ready = [item({ ready: true, ready_at: hoursAgo(1) })];
    expect(prep({ starts_at: hoursAgo(5) }, ready).overdue).toBe(false);
    expect(prep({ starts_at: hoursAgo(5) }, ready).ready).toBe(true);
  });

  it("ignores optional items when deciding readiness", () => {
    const items = [item({ ready: true, ready_at: hoursAgo(2) }), item({ id: "item-2", required: false })];
    expect(prep({}, items).ready).toBe(true);
    expect(prep({}, items).outstanding).toHaveLength(0);
  });

  it("does not apply to an appointment that has already happened or was cancelled", () => {
    // Otherwise every past appointment with an unticked box sits in the panel forever, unactionable.
    for (const status of ["attended", "canceled", "no_show", "closed"]) {
      const state = prep({ status });
      expect(state.applicable).toBe(false);
      expect(state.outstanding).toHaveLength(0);
      expect(state.overdue).toBe(false);
    }
  });

  it("does not apply to a superseded appointment, whose replacement carries its own list", () => {
    // The regression this guards: a rescheduled row keeps its original start date, so leaving it
    // applicable left `overdue` permanently true against items nobody would ever tick -- an urgent
    // card on the panel that no action could clear.
    const state = prep({
      status: "rescheduled", rescheduled_to_appointment_id: "ap-2", starts_at: hoursAgo(200),
    });
    expect(state.applicable).toBe(false);
    expect(state.overdue).toBe(false);
    expect(state.outstanding).toHaveLength(0);
  });

  it("keeps 'every item ready' distinct from 'somebody signed it off'", () => {
    const ready = [item({ ready: true, ready_at: hoursAgo(1) })];
    expect(prep({}, ready).ready).toBe(true);
    expect(prep({}, ready).signedOff).toBe(false);
    expect(prep({ preparation_completed_at: hoursAgo(1) }, ready).signedOff).toBe(true);
  });

  it("labels every item kind the table permits", () => {
    for (const kind of ["document", "equipment", "task"]) {
      expect(preparationItemKindLabel(kind)).not.toBe(kind);
    }
  });
});

describe("follow-up", () => {
  it("names both gates the server enforces, and only while a follow-up is live", () => {
    const outstanding = followUpOutstanding(
      appointment({ status: "attended", new_order_ack_status: "pending_review" }), NOW,
    );
    expect(outstanding.map((step) => step.key))
      .toEqual(["outcome_summary", "new_order_acknowledgement"]);
    // Every step has to justify itself: an unexplained blocker gets worked around.
    for (const step of outstanding) expect(step.why.length).toBeGreaterThan(20);
  });

  it("asks for nothing while the appointment has not happened", () => {
    expect(followUpOutstanding(appointment(), NOW)).toHaveLength(0);
  });

  it("clears once the summary is written and the orders are acknowledged", () => {
    expect(followUpOutstanding(appointment({
      status: "attended", outcome_summary: "Dose increased", new_order_ack_status: "acknowledged",
      new_order_ack_at: hoursAgo(1),
    }), NOW)).toHaveLength(0);
  });

  it("is overdue only when the deadline passed AND something is genuinely outstanding", () => {
    const base = { status: "attended", follow_up_due_at: hoursAgo(2) } as Partial<AppointmentLike>;
    expect(followUpIsOverdue(appointment(base), NOW)).toBe(true);
    // Nothing outstanding: the row is stale bookkeeping, not an overdue obligation.
    expect(followUpIsOverdue(appointment({
      ...base, outcome_summary: "Seen", new_order_ack_status: "not_applicable",
    }), NOW)).toBe(false);
  });

  it("is never overdue once it has been closed", () => {
    expect(followUpIsOverdue(appointment({
      status: "attended", follow_up_due_at: hoursAgo(48), follow_up_completed_at: hoursAgo(1),
    }), NOW)).toBe(false);
  });

  it("is not overdue when no deadline was ever set", () => {
    expect(followUpIsOverdue(appointment({ status: "attended", follow_up_due_at: null }), NOW)).toBe(false);
  });
});

describe("presentation", () => {
  it("summarizes the transport arrangements, and says nothing when there are none", () => {
    expect(transportSummary(appointment())).toContain("County Medical Transport");
    expect(transportSummary(appointment())).toContain("Van 3");
    expect(transportSummary(appointment({
      transportation_provider: null, vehicle_identifier: null, pickup_at: null,
    }))).toBeNull();
  });

  it("notes an assigned driver and escort, because a missing escort is a departure blocker", () => {
    const summary = transportSummary(appointment({
      driver_employee_id: "emp-1", escort_employee_id: "emp-2",
    }));
    expect(summary).toContain("driver assigned");
    expect(summary).toContain("escort assigned");
  });

  it("sorts anything still open above anything closed, whatever the dates say", () => {
    const stale = appointment({ id: "stale", status: "attended", starts_at: hoursAgo(500) });
    const closed = appointment({
      id: "closed", status: "attended", starts_at: hoursAgo(1),
      outcome_summary: "Seen", follow_up_completed_at: hoursAgo(1),
    });
    // A three-week-old open follow-up is the thing worth seeing, and a date sort buries it.
    expect(sortAppointments([closed, stale], NOW).map((row) => row.id)).toEqual(["stale", "closed"]);
  });

  it("breaks a date tie deterministically so the list does not reshuffle between renders", () => {
    const a = appointment({ id: "aaa" });
    const b = appointment({ id: "bbb" });
    expect(sortAppointments([b, a], NOW).map((row) => row.id)).toEqual(["aaa", "bbb"]);
  });
});
