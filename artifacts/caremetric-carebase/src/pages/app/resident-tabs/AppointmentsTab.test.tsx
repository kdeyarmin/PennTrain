import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResidentTabProps } from "./types";

const harness = vi.hoisted(() => ({
  preparation: { data: undefined as unknown[] | undefined, isError: false, error: null as Error | null, refetch: vi.fn() },
  complete: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useResidentAppointments", () => ({
  useResidentAppointments: () => ({ data: [{
    id: "appointment-a", resident_id: "resident-a", appointment_type: "Clinic", location: "Clinic",
    status: "scheduled", starts_at: "2026-09-16T12:00:00Z", pickup_at: null,
    new_order_ack_status: "not_applicable", preparation_completed_at: null,
  }], isError: false, isLoading: false }),
  useResidentAppointmentPreparation: () => harness.preparation,
}));
vi.mock("@/hooks/useResidentAppointmentMutations", () => ({
  useAddAppointmentPreparationItem: vi.fn(),
  useCompleteAppointmentPreparation: () => ({ mutateAsync: harness.complete, isPending: false }),
  useSetAppointmentPreparationItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/residents/AppointmentDialogs", () => ({
  AcknowledgeNewOrdersDialog: () => null, CloseAppointmentFollowUpDialog: () => null,
  RecordAppointmentOutcomeDialog: () => null, RescheduleAppointmentDialog: () => null,
  ScheduleAppointmentDialog: () => null,
}));

import AppointmentsTab from "./AppointmentsTab";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  // Render the pure preparation list, without executing Radix infrastructure or unrelated dialogs.
  if (typeof element.type === "function" && element.type.name === "PreparationList") {
    return nodes((element.type as (props: Record<string, unknown>) => ReactNode)(element.props));
  }
  return [element, ...nodes(element.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
function render() {
  return nodes(AppointmentsTab({ resident: { id: "resident-a" }, canManage: true } as ResidentTabProps));
}
function signOff() {
  return render().find((node) => typeof node.props.onClick === "function" && text(node.props.children as ReactNode) === "Sign off preparation")!;
}

beforeEach(() => {
  harness.preparation.data = undefined;
  harness.preparation.isError = false;
  harness.preparation.error = null;
});

describe("preparation readiness depends on a complete read", () => {
  it("does not offer sign-off or an empty-list claim before preparation loads", () => {
    expect(signOff().props.disabled).toBe(true);
    expect(render().some((node) => text(node.props.children as ReactNode).includes("Loading preparation items"))).toBe(true);
    expect(render().some((node) => text(node.props.children as ReactNode).includes("Nothing was listed"))).toBe(false);
  });

  it("does not treat a failed initial read or a failed refresh of empty cached data as ready", () => {
    harness.preparation.isError = true;
    harness.preparation.error = new Error("Offline");
    for (const data of [undefined, []]) {
      harness.preparation.data = data;
      expect(signOff().props.disabled).toBe(true);
      expect(render().some((node) => text(node.props.children as ReactNode).includes("Preparation could not be verified"))).toBe(true);
      expect(render().some((node) => text(node.props.children as ReactNode).includes("Nothing was listed"))).toBe(false);
    }
  });

  it("permits sign-off after a successful read confirms no preparation items", () => {
    harness.preparation.data = [];
    expect(signOff().props.disabled).toBe(false);
    expect(render().some((node) => text(node.props.children as ReactNode).includes("Nothing was listed"))).toBe(true);
  });
});
