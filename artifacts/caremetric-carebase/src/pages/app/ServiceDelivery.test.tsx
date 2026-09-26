import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, queue: vi.fn(), record: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "service", useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const state = h.state; const index = h.cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = h.cursor++; return h.state[index] ?? (h.state[index] = { current: initial }); },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Facility" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/components/residents/LogChangeOfConditionDialog", () => ({ LogChangeOfConditionDialog: "section" }));
vi.mock("@/components/residents/ServiceExceptionFollowUpDialog", () => ({ ServiceExceptionFollowUpDialog: "section", isServiceException: () => false }));
vi.mock("@/hooks/useResidentServiceTasks", () => ({
  useResidentServiceTaskQueue: h.queue,
  useListResidentServiceRequirements: () => ({ data: [] }), useListServiceTaskAlerts: () => ({ data: [] }),
  useListServiceExceptionRules: () => ({ data: [] }), useServiceTaskAvailableStaff: () => ({ data: [] }),
  useRecordResidentServiceTask: () => ({ mutate: h.record }),
  useAssignResidentServiceTask: () => ({ mutate: vi.fn() }), useResolveServiceTaskAlert: () => ({ mutate: vi.fn() }),
  useRecordServiceExceptionFollowUp: () => ({ mutateAsync: vi.fn() }),
  useUpdateResidentServiceRequirement: () => ({ mutate: vi.fn() }), useUpsertServiceExceptionRule: () => ({ mutate: vi.fn() }),
}));
import ServiceDelivery from "./ServiceDelivery";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function content(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  return value && typeof value === "object" && "props" in value ? content((value as Node).props.children as ReactNode) : "";
}
function render() { h.cursor = 0; return ServiceDelivery(); }
function button(label: string) { return nodes(render()).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === label)!; }
function click(label: string) { const node = button(label); expect(node.props.disabled).toBeFalsy(); (node.props.onClick as () => void)(); }
function record(index: number) {
  const buttons = nodes(render()).filter(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === "Record");
  (buttons[index].props.onClick as () => void)();
}
function note(value: string) {
  const node = nodes(render()).find(node => node.props.id === "service-additional-note")!;
  (node.props.onChange as (event: unknown) => void)({ target: { value } });
}
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0;
  h.queue.mockReturnValue({ data: ["a", "b"].map(id => ({ id, resident_name: `Resident ${id}`, service_name: `Service ${id}`, status: "scheduled", facility_id: "facility", facility_name: "Facility", scheduled_start: "2026-09-26T13:00:00Z", scheduled_end: "2026-09-26T14:00:00Z" })) });
});
describe("service task editing", () => {
  it.each(["", "2026-02-30", "invalid"])("keeps the screen usable and disables queue reads for date %j", value => {
    const field = nodes(render()).find(node => node.props["aria-label"] === "Service date")!;
    (field.props.onChange as (event: unknown) => void)({ target: { value } });
    expect(() => render()).not.toThrow();
    expect(h.queue.mock.calls.at(-1)![1]).toEqual({ enabled: false });
    expect(content(render())).toContain("Choose a valid service date");
    expect(button("Record")).toBeUndefined();
  });
  it("loads the correct Pennsylvania day after a blank date is repaired", () => {
    const setDate = (value: string) => (nodes(render()).find(node => node.props["aria-label"] === "Service date")!.props.onChange as (event: unknown) => void)({ target: { value } });
    setDate(""); render(); setDate("2026-09-27"); render();
    expect(h.queue.mock.calls.at(-1)).toEqual([expect.objectContaining({ from: "2026-09-27T04:00:00.000Z", through: "2026-09-28T04:00:00.000Z" }), { enabled: true }]);
  });
  it("keeps a newer task draft open when an earlier save finishes", () => {
    record(0); note("Original note"); click("Record outcome");
    expect(h.record.mock.calls[0][0]).toMatchObject({ taskId: "a", note: "Original note" });
    const finish = h.record.mock.calls[0][1].onSuccess;
    click("Cancel"); record(1); note("New task note");
    finish();
    expect(content(render())).toContain("Record Service b");
    expect(nodes(render()).find(node => node.props.id === "service-additional-note")!.props.value).toBe("New task note");
    click("Record outcome");
    expect(h.record.mock.calls[1][0]).toMatchObject({ taskId: "b", note: "New task note" });
  });
});
