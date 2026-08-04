/**
 * Resident appointments (program plan item 1 -- the Appointments tab).
 *
 * `resident_appointments` was modelled in full in 20260714100000 and then never read or written by
 * the application. `resident-tabs/tabs.ts` carried it in `PLANNED_TABS` with the reason: an empty
 * tab reads as "no appointments" rather than "not built". Migration 20260804010000 supplies the
 * three write paths the schema was missing; this module owns the reading of a row -- what stage it
 * is at, what is outstanding before the resident leaves, and what is outstanding before the
 * follow-up can be closed.
 *
 * Pure, with an injectable clock, for the same reason `hospitalReconciliation.ts` is: the same
 * definition drives the tab, the Needs Attention panel, and the tests, and the server enforces the
 * same gates independently. If the two ever disagree, the server wins and the user sees an error
 * rather than a wrong screen -- but they are written from one list here so they do not drift
 * silently.
 */

export type AppointmentStage =
  | "upcoming"
  | "in_progress"
  | "awaiting_outcome"
  | "follow_up_open"
  | "closed"
  | "canceled"
  | "rescheduled";

export type PreparationItemKind = "document" | "equipment" | "task";

export interface AppointmentPreparationItemLike {
  id: string;
  item_kind: string;
  label: string;
  required: boolean;
  ready: boolean;
  ready_at: string | null;
  note: string | null;
}

export interface AppointmentLike {
  id: string;
  resident_id: string;
  appointment_type: string;
  provider_name: string | null;
  location: string;
  starts_at: string;
  expected_return_at: string | null;
  pickup_at: string | null;
  transportation_provider: string | null;
  vehicle_identifier: string | null;
  driver_employee_id: string | null;
  escort_employee_id: string | null;
  status: string;
  outcome_summary: string | null;
  new_order_ack_status: string;
  new_order_ack_at: string | null;
  new_order_ack_note: string | null;
  follow_up_due_at: string | null;
  follow_up_completed_at: string | null;
  follow_up_work_item_id: string | null;
  preparation_completed_at: string | null;
  cancellation_reason: string | null;
  rescheduled_to_appointment_id: string | null;
}

/**
 * How long before departure the preparation is treated as due. Chosen as one day because that is
 * the last shift on which someone can still find a missing document -- a window measured in hours
 * would mean the panel first raises it when nothing can be done about it.
 */
export const PREPARATION_LEAD_HOURS = 24;

export interface AppointmentOutstandingStep {
  key: string;
  label: string;
  /** Why this step exists, in the words someone would use defending having skipped it. */
  why: string;
}

export interface AppointmentPreparationState {
  /** False once the appointment has happened -- there is nothing left to prepare. */
  applicable: boolean;
  items: AppointmentPreparationItemLike[];
  outstanding: AppointmentPreparationItemLike[];
  /** Every required item ready. Distinct from `signedOff`: nobody has said so yet. */
  ready: boolean;
  signedOff: boolean;
  /** Null when the appointment has no start we can read. */
  dueAt: string | null;
  due: boolean;
  overdue: boolean;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function appointmentStage(appointment: AppointmentLike, now: Date = new Date()): AppointmentStage {
  if (appointment.status === "canceled") return "canceled";
  if (appointment.status === "rescheduled") return "rescheduled";
  if (appointment.status === "scheduled") {
    const startsAt = parseInstant(appointment.starts_at);
    // "In progress" is not a stored status; it is the window between departure and the expected
    // return, and staff need it distinguished from "upcoming" while the resident is out of the
    // building. Deriving it means no background job has to move a row to keep the record honest.
    if (startsAt && startsAt.getTime() <= now.getTime()) return "in_progress";
    return "upcoming";
  }
  if (appointment.follow_up_completed_at) return "closed";
  if (appointment.status === "closed") return "closed";
  if (!appointment.outcome_summary?.trim()) return "awaiting_outcome";
  return "follow_up_open";
}

export function appointmentStageLabel(stage: AppointmentStage): string {
  switch (stage) {
    case "upcoming": return "Upcoming";
    case "in_progress": return "Out at appointment";
    case "awaiting_outcome": return "Awaiting outcome";
    case "follow_up_open": return "Follow-up open";
    case "closed": return "Closed";
    case "canceled": return "Cancelled";
    case "rescheduled": return "Rescheduled";
  }
}

/** Stages where the appointment still wants something from somebody. */
export function appointmentIsOpen(appointment: AppointmentLike, now: Date = new Date()): boolean {
  const stage = appointmentStage(appointment, now);
  return stage === "upcoming" || stage === "in_progress"
    || stage === "awaiting_outcome" || stage === "follow_up_open";
}

export function buildPreparationState({
  appointment,
  items,
  now = new Date(),
}: {
  appointment: AppointmentLike;
  items: AppointmentPreparationItemLike[];
  now?: Date;
}): AppointmentPreparationState {
  const stage = appointmentStage(appointment, now);
  const startsAt = parseInstant(appointment.starts_at);
  // Preparation for a cancelled, already-attended, or superseded appointment is not "complete", it
  // is moot. Reporting it as outstanding would put permanent, unactionable rows in the panel.
  //
  // `rescheduled` belongs in that list and was briefly on the other side of it, on the reasoning
  // that the replacement inherits the preparation list. It does -- but as its OWN rows, on its own
  // appointment. Leaving the superseded row applicable meant its start date sat permanently in the
  // past with items nobody would ever tick, so `overdue` went true and an urgent card appeared that
  // no action could clear. That is exactly the failure this filter exists to prevent.
  const applicable = stage === "upcoming" || stage === "in_progress";
  const outstanding = items.filter((item) => item.required && !item.ready);
  const dueAt = startsAt
    ? new Date(startsAt.getTime() - PREPARATION_LEAD_HOURS * 3_600_000)
    : null;

  return {
    applicable,
    items,
    outstanding: applicable ? outstanding : [],
    ready: outstanding.length === 0,
    signedOff: Boolean(appointment.preparation_completed_at),
    dueAt: dueAt?.toISOString() ?? null,
    due: applicable && Boolean(dueAt) && now.getTime() >= dueAt!.getTime(),
    // Departure has passed with required items still unready. This is the state worth interrupting
    // someone over, and it is the reason the panel ranks it above the merely-due version.
    overdue: applicable && outstanding.length > 0
      && Boolean(startsAt) && now.getTime() >= startsAt!.getTime(),
  };
}

/**
 * What stands between this appointment and a closed follow-up. Mirrors
 * `complete_appointment_follow_up`'s gate exactly; the server raises with the same two reasons.
 */
export function followUpOutstanding(
  appointment: AppointmentLike,
  now: Date = new Date(),
): AppointmentOutstandingStep[] {
  const stage = appointmentStage(appointment, now);
  if (stage !== "awaiting_outcome" && stage !== "follow_up_open") return [];

  const steps: AppointmentOutstandingStep[] = [];
  if (!appointment.outcome_summary?.trim()) {
    steps.push({
      key: "outcome_summary",
      label: "Record what happened at the appointment",
      why: "The follow-up work item's description was built from this. Closing without it leaves a queue entry that says nothing and a record that proves nothing.",
    });
  }
  if (appointment.new_order_ack_status === "pending_review") {
    steps.push({
      key: "new_order_acknowledgement",
      label: "Acknowledge the new orders",
      why: "An order nobody acknowledged is an order nobody is carrying out.",
    });
  }
  return steps;
}

export function followUpIsOverdue(appointment: AppointmentLike, now: Date = new Date()): boolean {
  if (appointment.follow_up_completed_at) return false;
  const due = parseInstant(appointment.follow_up_due_at);
  if (!due) return false;
  return now.getTime() > due.getTime() && followUpOutstanding(appointment, now).length > 0;
}

/**
 * The transport arrangements as one readable line. Assembled here rather than in the tab so the
 * same summary can go in a Needs Attention card without the two drifting apart.
 */
export function transportSummary(appointment: AppointmentLike): string | null {
  const parts: string[] = [];
  if (appointment.transportation_provider?.trim()) parts.push(appointment.transportation_provider.trim());
  if (appointment.vehicle_identifier?.trim()) parts.push(appointment.vehicle_identifier.trim());
  if (appointment.driver_employee_id) parts.push("driver assigned");
  if (appointment.escort_employee_id) parts.push("escort assigned");
  if (appointment.pickup_at) {
    const pickup = parseInstant(appointment.pickup_at);
    if (pickup) parts.push(`pickup ${pickup.toLocaleString()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function preparationItemKindLabel(kind: string): string {
  switch (kind) {
    case "document": return "Document";
    case "equipment": return "Equipment";
    case "task": return "Task";
    default: return kind;
  }
}

/**
 * Newest first for history, but anything still open sorts above anything closed regardless of date.
 * A follow-up left open three weeks ago is more urgent than yesterday's attended-and-closed visit,
 * and a plain date sort buries it.
 */
export function sortAppointments(
  appointments: AppointmentLike[],
  now: Date = new Date(),
): AppointmentLike[] {
  return [...appointments].sort((a, b) => {
    const openDiff = Number(appointmentIsOpen(b, now)) - Number(appointmentIsOpen(a, now));
    if (openDiff !== 0) return openDiff;
    const dateDiff = new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.id.localeCompare(b.id);
  });
}
