import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentLike } from "@/lib/residentAppointments";

const harness = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, effectAppointment: undefined as unknown,
  record: vi.fn(), toast: vi.fn(), close: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = initial;
    return [harness.state[index], (next: unknown) => { harness.state[index] = next; }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    if (harness.effectAppointment !== deps[0]) {
      harness.effectAppointment = deps[0];
      effect();
    }
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/hooks/useResidentAppointmentMutations", () => ({
  useRecordAppointmentOutcome: () => ({ mutateAsync: harness.record, isPending: false }),
  useAcknowledgeAppointmentNewOrder: vi.fn(), useCompleteAppointmentFollowUp: vi.fn(),
  useRescheduleAppointment: vi.fn(), useScheduleAppointmentForResident: vi.fn(),
}));

import { RecordAppointmentOutcomeDialog } from "./AppointmentDialogs";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
let appointment: AppointmentLike;
function render() {
  harness.cursor = 0;
  return nodes(RecordAppointmentOutcomeDialog({ appointment, residentId: "resident-a", onOpenChange: harness.close }));
}
function input(id: string) { return render().find((node) => node.props.id === id)!; }
function enter(id: string, value: string) {
  (input(id).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
function chooseStatus(value: string) {
  const select = render().find((node) => typeof node.props.onValueChange === "function")!;
  (select.props.onValueChange as (value: string) => void)(value);
}
function submit() {
  return render().find((node) => typeof node.props.onClick === "function" && text(node.props.children as ReactNode) === "Record outcome")!;
}

beforeEach(() => {
  harness.state = []; harness.cursor = 0; harness.effectAppointment = undefined;
  harness.record.mockReset().mockResolvedValue(null); harness.toast.mockReset(); harness.close.mockReset();
  appointment = {
    id: "appointment-a", resident_id: "resident-a", appointment_type: "Clinic", location: "Clinic",
    status: "attended", outcome_summary: null, new_order_ack_status: "not_applicable",
    follow_up_due_at: "2026-09-17T16:00:00Z",
  } as AppointmentLike;
  render();
});

describe("appointment outcome follow-up consistency", () => {
  it("retains the existing deadline when completing an earlier incomplete outcome", () => {
    expect(input("outcome-follow-up").props.value).toBe("2026-09-17T12:00");
  });

  it("omits an unchanged deadline so the minute input cannot truncate the saved clock", async () => {
    appointment = { ...appointment, follow_up_due_at: "2026-09-17T16:00:37.456Z" };
    render();
    enter("outcome-summary", "More information recorded.");
    (submit().props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({
      outcomeSummary: "More information recorded.", followUpDueAt: undefined,
    })));
  });

  it("does not send a deadline with a closed outcome and retains it if the user switches back", async () => {
    enter("outcome-summary", "Visit complete; nothing remains.");
    enter("outcome-follow-up", "2026-09-18T12:00");
    chooseStatus("closed");
    expect(input("outcome-follow-up").props.disabled).toBe(true);
    expect(input("outcome-follow-up").props.value).toBe("");
    chooseStatus("attended");
    expect(input("outcome-follow-up").props.value).toBe("2026-09-18T12:00");
    chooseStatus("closed");
    (submit().props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({
      status: "closed", outcomeSummary: "Visit complete; nothing remains.", followUpDueAt: undefined,
      newOrderAckStatus: "not_applicable",
    })));
  });

  it("requires an outcome summary before closing, while permitting incomplete outcomes to be saved", () => {
    chooseStatus("closed");
    expect(submit().props.disabled).toBe(true);
    enter("outcome-summary", "No changes required.");
    expect(submit().props.disabled).toBe(false);
    enter("outcome-summary", "");
    chooseStatus("attended");
    expect(submit().props.disabled).toBe(false);
  });

  it("requires already-pending orders to be acknowledged before the appointment can be closed", () => {
    appointment = { ...appointment, new_order_ack_status: "pending_review" };
    render();
    enter("outcome-summary", "The physician changed an order.");
    chooseStatus("closed");
    expect(submit().props.disabled).toBe(true);
    expect(render().some((node) => text(node.props.children as ReactNode).includes("Acknowledge the existing orders before closing"))).toBe(true);
  });

  it("keeps saved pending orders checked and requires the separate acknowledgement action", async () => {
    appointment = { ...appointment, new_order_ack_status: "pending_review" };
    render();
    const checkbox = render().find((node) => node.props.type === "checkbox")!;
    expect(checkbox.props.checked).toBe(true);
    expect(checkbox.props.disabled).toBe(true);
    expect(render().some((node) => text(node.props.children as ReactNode).includes("Use Acknowledge orders on the appointment"))).toBe(true);
    enter("outcome-summary", "More outcome information.");
    (submit().props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({ newOrderAckStatus: "pending_review" })));
  });

  it("keeps the order checkbox optional for an appointment that has no saved pending orders", () => {
    const checkbox = render().find((node) => node.props.type === "checkbox")!;
    expect(checkbox.props.checked).toBe(false);
    expect(checkbox.props.disabled).toBe(false);
  });
});
