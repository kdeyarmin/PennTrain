import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, save: vi.fn(), toast: vi.fn(), eligibilityError: false, blocked: "" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "schedule", useEffect: () => {}, useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
}));
vi.mock("wouter", () => ({ useParams: () => ({ id: "schedule" }), useLocation: () => ["", vi.fn()] }));
vi.mock("@/components/staff/StaffCareCoverage", () => ({ StaffCareCoverage: "staff-care-coverage" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useSchedules", () => ({
  useGetSchedule: () => ({ data: { id: "schedule", organization_id: "org", facility_id: "facility", status: "draft", period_start: "2026-09-26", period_end: "2026-09-26" } }),
  useGenerateScheduleAssignments: () => ({}), useClearAutoFilledAssignments: () => ({}), usePublishSchedule: () => ({}), useUnpublishSchedule: () => ({}), useUpdateSchedule: () => ({}), useDeleteSchedule: () => ({}),
}));
vi.mock("@/hooks/useFacilities", () => ({ useGetFacility: () => ({ data: { name: "Facility" } }) }));
vi.mock("@/hooks/useFacilityUnits", () => ({ useListFacilityUnits: () => ({ data: [] }) }));
vi.mock("@/hooks/useShiftDefinitions", () => ({ useListShiftDefinitions: () => ({ data: [{ id: "day", name: "Day", is_active: true, start_time: "07:00", end_time: "15:00" }] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployeesByIds: () => ({ data: [] }) }));
vi.mock("@/hooks/useMedAdminAuthorization", () => ({ useMedAdminAuthorization: () => ({ byEmployeeId: new Map() }) }));
vi.mock("@/hooks/useShiftAssignments", () => ({ useListShiftAssignments: () => ({ data: [] }), useCreateShiftAssignment: () => ({ mutateAsync: h.save }), useUpdateShiftAssignment: () => ({}), useDeleteShiftAssignment: () => ({}) }));
vi.mock("@/hooks/useDailyOperations", () => ({ useRecordShiftCallOff: () => ({}) }));
vi.mock("@/hooks/useSchedulingEligibility", () => ({
  useCreateScheduleEligibilityOverride: () => ({}), useScheduleServiceWorkload: () => ({}),
  usePreviewShiftAssignmentCandidates: () => ({ isError: h.eligibilityError, error: new Error("Eligibility unavailable"), data: ["a", "b"].map(id => ({ employeeId: id, employeeName: `Employee ${id}`, outcome: h.blocked === id ? "blocked" : "eligible", hardBlocks: [], warnings: [], appliedOverrideIds: [] })) }),
}));
import ScheduleDetail from "./ScheduleDetail";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; return ScheduleDetail(); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => node.props.onClick && text(node) === label)!; }
function addDialog(tree: ReactNode) { return nodes(tree).find(node => node.type === Dialog && text(node).startsWith("Add Shift"))!; }
function openSelected() {
  button(render(), "Add").props.onClick();
  nodes(render()).find(node => node.props["aria-label"] === "Select all visible employees")!.props.onCheckedChange();
  return render();
}
beforeEach(() => { h.state = []; h.cursor = 0; h.eligibilityError = false; h.blocked = ""; vi.clearAllMocks(); h.save.mockResolvedValue({}); });
describe("schedule bulk assignment recovery", () => {
  it("waits for the whole batch, preserves failed employees, and retries only those failures", async () => {
    let finish!: () => void;
    h.save.mockRejectedValueOnce(new Error("Qualification changed")).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const operation = button(openSelected(), "Add Shift to 2 Employees").props.onClick();
    await Promise.resolve(); const pending = render();
    expect(button(pending, "Adding...").props.disabled).toBe(true);
    const dialog = addDialog(pending); dialog.props.onOpenChange(false);
    expect(addDialog(render()).props.open).toBe(true);
    expect(nodes(dialog).filter(node => node.props.onCheckedChange).every(node => node.props.disabled)).toBe(true);
    expect(nodes(dialog).find(node => node.props.value === "day" && node.props.onValueChange)?.props.disabled).toBe(true);
    expect(button(dialog, "Cancel").props.disabled).toBe(true);
    finish(); await operation;
    const retry = render(); expect(addDialog(retry).props.open).toBe(true);
    expect(text(addDialog(retry))).toContain("Employees * (1 selected)");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("Employee a: Qualification changed") }));
    await button(addDialog(retry), "Add Shift").props.onClick();
    expect(h.save.mock.calls.map(([payload]) => payload.employee_id)).toEqual(["a", "b", "a"]);
    expect(h.save.mock.calls.every(([payload]) => payload.shift_definition_id === "day" && payload.shift_date === "2026-09-26")).toBe(true);
    expect(addDialog(render()).props.open).toBe(false);
  });
  it("does not use cached eligibility after a failed refresh", async () => {
    openSelected(); h.eligibilityError = true;
    const action = button(render(), "Add Shift to 2 Employees"); expect(action.props.disabled).toBe(true);
    await action.props.onClick(); expect(h.save).not.toHaveBeenCalled();
  });
  it("rechecks selected employees against the current allowed candidates before writing", async () => {
    openSelected(); h.blocked = "b";
    await button(render(), "Add Shift to 2 Employees").props.onClick();
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.save.mock.calls[0][0].employee_id).toBe("a");
  });
});
