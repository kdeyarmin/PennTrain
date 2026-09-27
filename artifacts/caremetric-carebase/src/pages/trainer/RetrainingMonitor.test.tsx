import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilityRetrainingStatus } from "@/lib/facilityRetrainingStatus";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, pending: false, classesError: false, assignmentsError: false,
  classes: [{ id: "class", class_name: "Retraining", class_date: "2026-09-26", duration_hours: 1, capacity: 20, status: "scheduled" }],
  enroll: vi.fn(), toast: vi.fn(), retry: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "test", useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => { const values = h.state, index = h.cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "trainer", role: "trainer" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/usePracticums", () => ({ useListPracticums: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: () => ({ data: [], isError: h.assignmentsError, error: new Error("Scope unavailable"), refetch: h.retry }) }));
vi.mock("@/hooks/useTrainingClasses", () => ({ useListTrainingClasses: () => ({ data: h.classes, isError: h.classesError }),
  useEnrollRetrainingCohort: () => ({ mutateAsync: h.enroll, isPending: h.pending }) }));
import RetrainingMonitor, { EnrollCohortDialog } from "./RetrainingMonitor";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
const facility = { facilityId: "facility-a", facilityName: "Cedar", candidates: ["a", "b"].map(id => ({ employeeId: id, firstName: "Learner", lastName: id, reason: "missing" })) } as FacilityRetrainingStatus;
const close = vi.fn();
function render() { h.cursor = 0; return EnrollCohortDialog({ open: true, facility, onOpenChange: close }); }
function selectClass(value = "class") { const field = nodes(render()).find(node => node.props.value === "" && node.props.onValueChange)!; (field.props.onValueChange as (value: string) => void)(value); }
function button(label: string, tree = render()) { const button = nodes(tree).find(node => node.props.onClick && text(node).trim() === label); if (!button) throw new Error(`Missing ${label}`); return button; }
beforeEach(() => { vi.resetAllMocks(); h.state = []; h.cursor = 0; h.pending = false; h.classesError = false; h.assignmentsError = false; h.classes = [{ id: "class", class_name: "Retraining", class_date: "2026-09-26", duration_hours: 1, capacity: 20, status: "scheduled" }]; });
describe("retraining enrollment recovery", () => {
  it("keeps only failed learners selected for retry after partial enrollment", async () => {
    selectClass(); h.enroll.mockResolvedValue([{ employeeId: "a", success: true, status: "registered" }, { employeeId: "b", success: false, error: "Offline" }]);
    await (button("Enroll 2 staff").props.onClick as () => Promise<void>)();
    // The click intentionally discards the promise for the UI; let its continuation settle.
    await Promise.resolve();
    expect(button("Enroll 1 staff").props.disabled).toBeFalsy();
    h.enroll.mockResolvedValue([{ employeeId: "b", success: true, status: "waitlisted" }]);
    (button("Enroll 1 staff").props.onClick as () => void)(); await Promise.resolve();
    expect(h.enroll).toHaveBeenLastCalledWith({ classId: "class", employeeIds: ["b"] });
  });
  it("locks class, attendee choices, and close while the batch is pending", () => {
    selectClass(); h.pending = true; const tree = render();
    expect(button("Close", tree).props.disabled).toBe(true);
    expect(button("Select all", tree).props.disabled).toBe(true);
    expect(nodes(tree).find(node => node.props.onValueChange)?.props.disabled).toBe(true);
    expect(nodes(tree).filter(node => node.props.onCheckedChange).every(node => node.props.disabled)).toBe(true);
    (nodes(tree)[0].props.onOpenChange as (value: boolean) => void)(false);
    expect(close).not.toHaveBeenCalled();
  });
  it("blocks unavailable or failed class data before enrollment", () => {
    selectClass(); h.classesError = true;
    expect(button("Enroll 2 staff").props.disabled).toBe(true);
    (button("Enroll 2 staff").props.onClick as () => void)(); expect(h.enroll).not.toHaveBeenCalled();
    h.classesError = false; h.classes = [];
    (button("Enroll 2 staff").props.onClick as () => void)(); expect(h.enroll).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Choose an available class" }));
  });
  it("shows a recoverable scope failure instead of no facilities and keys dialog sessions", () => {
    h.assignmentsError = true; const tree = RetrainingMonitor();
    const error = nodes(tree).find(node => node.props.what === "retraining compliance")!;
    expect(error).toBeDefined(); expect(text(tree)).not.toContain("No facilities found");
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
    expect(nodes(tree).find(node => node.type === EnrollCohortDialog)?.key).toBe("closed");
  });
});
