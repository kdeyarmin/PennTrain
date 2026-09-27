import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[], queue: vi.fn(), record: vi.fn(), followUp: vi.fn(), updateRequirement: vi.fn(), requirementPending: false, toast: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "service", useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const state = h.state; const index = h.cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
  useEffect: (fn: () => () => void) => { const index = h.cursor++; if (!(index in h.state)) { h.state[index] = true; h.cleanups.push(fn()); } },
  useRef: (initial: unknown) => { const index = h.cursor++; return h.state[index] ?? (h.state[index] = { current: initial }); },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Facility" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/components/residents/LogChangeOfConditionDialog", () => ({ LogChangeOfConditionDialog: "section" }));
vi.mock("@/components/residents/ServiceExceptionFollowUpDialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/residents/ServiceExceptionFollowUpDialog")>();
  return { ...actual, ServiceExceptionFollowUpDialog: "follow-up-dialog" };
});
vi.mock("@/hooks/useResidentServiceTasks", () => ({
  useResidentServiceTaskQueue: h.queue,
  useListResidentServiceRequirements: () => ({ data: [] }), useListServiceTaskAlerts: () => ({ data: [] }),
  useListServiceExceptionRules: () => ({ data: [] }), useServiceTaskAvailableStaff: () => ({ data: [] }),
  useRecordResidentServiceTask: () => ({ mutate: h.record }),
  useAssignResidentServiceTask: () => ({ mutate: vi.fn() }), useResolveServiceTaskAlert: () => ({ mutate: vi.fn() }),
  useRecordServiceExceptionFollowUp: () => ({ mutateAsync: h.followUp }),
  useUpdateResidentServiceRequirement: () => ({ mutate: h.updateRequirement, isPending: h.requirementPending }), useUpsertServiceExceptionRule: () => ({ mutate: vi.fn() }),
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
  vi.clearAllMocks(); h.state = []; h.cursor = 0; h.cleanups = []; h.requirementPending = false;
  h.queue.mockReturnValue({ data: ["a", "b"].map(id => ({ id, resident_name: `Resident ${id}`, service_name: `Service ${id}`, status: "scheduled", facility_id: "facility", facility_name: "Facility", scheduled_start: "2026-09-26T13:00:00Z", scheduled_end: "2026-09-26T14:00:00Z" })) });
});
afterEach(() => h.cleanups.splice(0).forEach(fn => fn()));
function directTexts(node: Node | undefined): string[] {
  const children = node?.props?.children;
  const list = Array.isArray(children) ? children : children == null ? [] : [children];
  return list.map((child) => content(child as ReactNode).trim());
}

function cardValue(label: string) {
  const card = nodes(render()).find((node) => {
    const texts = directTexts(node);
    return texts.includes(label) && texts.some((text) => /^\d+$/.test(text));
  });
  return directTexts(card).find((text) => /^\d+$/.test(text));
}

describe("service day totals", () => {
  it("counts a late delivery as an exception and as completed care", () => {
    h.queue.mockReturnValue({ data: [{ id: "late", resident_name: "Ada", service_name: "Bath", status: "completed_late", facility_id: "facility", facility_name: "Facility", scheduled_start: "2026-09-26T13:00:00Z", scheduled_end: "2026-09-26T14:00:00Z" }] });
    expect(cardValue("Exceptions")).toBe("1");
    expect(cardValue("Completed")).toBe("1");
    expect(cardValue("Scheduled")).toBe("0");
  });
});

describe("service task editing", () => {
  it("locks a submitted requirement and retains its draft for one retry after failure", () => {
    const dialog = nodes(render()).find(node => typeof node.type === "function" && node.type.name === "RequirementDialog")!;
    const onClose = vi.fn();
    const props = { ...dialog.props, onClose, requirement: { id: "requirement-a", service_name: "Daily support", source_plan_version: 1, effective_from: "2026-09-01", special_instructions: "Original instructions", time_window_start: "09:00", time_window_end: "11:00" } };
    h.state = [];
    const renderDialog = () => { h.cursor = 0; return (dialog.type as (value: typeof props) => ReactNode)(props); };
    const save = () => nodes(renderDialog()).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === "Save and regenerate future tasks")!;
    const first = save(); (first.props.onClick as () => void)(); (first.props.onClick as () => void)();
    expect(h.updateRequirement).toHaveBeenCalledTimes(1);
    const submitted = h.updateRequirement.mock.calls[0];
    expect(submitted[0]).toMatchObject({ requirementId: "requirement-a", specialInstructions: "Original instructions" });
    h.requirementPending = true;
    const pending = renderDialog();
    expect(nodes(pending).find(node => node.type === "fieldset")!.props.disabled).toBe(true);
    (nodes(pending)[0].props.onOpenChange as (open: boolean) => void)(false);
    expect(onClose).not.toHaveBeenCalled();
    submitted[1].onError(new Error("Please retry")); submitted[1].onSettled(); h.requirementPending = false;
    const instructions = nodes(renderDialog()).find(node => node.props.id === "service-special-instructions")!;
    expect(instructions.props.value).toBe("Original instructions");
    (instructions.props.onChange as (event: unknown) => void)({ target: { value: "Corrected instructions" } });
    (save().props.onClick as () => void)();
    expect(h.updateRequirement.mock.calls[1][0]).toMatchObject({ requirementId: "requirement-a", specialInstructions: "Corrected instructions" });
    h.updateRequirement.mock.calls[1][1].onSuccess(); expect(onClose).toHaveBeenCalledTimes(1);
  });
  function openFollowUp(index: number) {
    const actions = nodes(render()).filter(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === "Supervisor follow-up");
    (actions[index].props.onClick as () => void)();
    return nodes(render()).find(node => node.type === "follow-up-dialog")!;
  }
  function refusedTasks() { h.queue.mockReturnValue({ data: ["a", "b"].map(id => ({ id, resident_name: `Resident ${id}`, service_name: `Service ${id}`, status: "resident_refused", facility_id: "facility", facility_name: "Facility", scheduled_start: "2026-09-26T13:00:00Z", scheduled_end: "2026-09-26T14:00:00Z" })) }); }
  it("tells the follow-up dialog to preserve its reason after a server refusal", async () => {
    refusedTasks(); h.followUp.mockRejectedValueOnce(new Error("Temporary failure")); const dialog = openFollowUp(0);
    expect(await (dialog.props.onConfirm as (reason: string) => Promise<boolean>)("Repeated refusal")).toBe(false);
    expect(nodes(render()).find(node => node.type === "follow-up-dialog")!.props.open).toBe(true);
    expect(h.followUp).toHaveBeenCalledWith({ taskId: "a", reason: "Repeated refusal" });
  });
  it("does not close a replacement follow-up after an older request completes", async () => {
    refusedTasks(); let finish!: () => void; h.followUp.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const first = openFollowUp(0), pending = (first.props.onConfirm as (reason: string) => Promise<boolean>)("Original reason");
    (first.props.onOpenChange as (open: boolean) => void)(false); const replacement = openFollowUp(1);
    expect(replacement.key).not.toBe(first.key); finish(); expect(await pending).toBe(false);
    expect(nodes(render()).find(node => node.type === "follow-up-dialog")!.props.taskName).toBe("Service b"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("suppresses a follow-up completion after the page unmounts", async () => {
    refusedTasks(); let finish!: () => void; h.followUp.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const first = openFollowUp(0), pending = (first.props.onConfirm as (reason: string) => Promise<boolean>)("Original reason");
    h.cleanups.splice(0).forEach(fn => fn()); finish(); expect(await pending).toBe(false); expect(h.toast).not.toHaveBeenCalled();
  });
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
