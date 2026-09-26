import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedTrainingFilters } from "@/lib/trainingAutomation";

type SavedReport = { id: string; name: string; organizationId: string; facilityId: string; filters: SavedTrainingFilters };
const h = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, effectIndex: 0, dependencies: [] as unknown[][],
  effects: [] as (() => void)[], changed: false, search: "", navigate: vi.fn(), report: vi.fn(), savedId: vi.fn(),
  saved: undefined as SavedReport | undefined,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "report-heading", useState: (initial: unknown) => {
  const index = h.stateIndex++;
  if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
  return [h.state[index], (next: unknown) => {
    const value = typeof next === "function" ? next(h.state[index]) : next;
    if (!Object.is(h.state[index], value)) { h.state[index] = value; h.changed = true; }
  }];
}, useEffect: (effect: () => void, dependencies: unknown[]) => {
  const index = h.effectIndex++;
  if (!h.dependencies[index] || dependencies.some((value, i) => !Object.is(value, h.dependencies[index][i]))) {
    h.dependencies[index] = dependencies; h.effects.push(effect);
  }
} }));
vi.mock("wouter", () => ({ Link: "a", useSearch: () => h.search, useLocation: () => ["/app/train", h.navigate] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "facility_manager" } }) }));
vi.mock("@/hooks/useTrainingAutomation", () => ({ useSavedTrainingReport: (id?: string) => {
  h.savedId(id); return { data: id ? h.saved : undefined, isLoading: !!id && !h.saved, isError: false };
} }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useTrainingPlans", () => ({ useListTrainingPlans: () => ({ data: [] }) }));
vi.mock("@/hooks/useTrainingProgress", () => ({ useSetAssignmentRequirement: () => ({}) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useCertificates", () => ({ usePrepareCertificatePdf: () => ({}) }));
vi.mock("@/hooks/useTrainingEnrollmentReport", () => ({ useTrainingEnrollmentReport: (...args: unknown[]) => { h.report(...args); return {}; } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./TrainingReminderReceipts", () => ({ TrainingReminderReceipts: () => null }));
vi.mock("./TrainingReportAutomation", () => ({ TrainingReportAutomation: () => null }));
vi.mock("./TrainingReportAnalytics", () => ({ TrainingReportAnalytics: () => null }));
import TrainingEnrollmentReport from "./TrainingEnrollmentReport";

type Node = ReactElement<Record<string, unknown>>;
const scope = { organizationId: "org-a", facilityId: "facility-a" };
type ReportScope = typeof scope & { employeeId?: string };
const savedDefaults: SavedTrainingFilters = { courseSearch: "", status: "all", dateBasis: "assigned", dateFrom: "", dateThrough: "" };
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
function field(tree: ReactNode, label: string) {
  const wrapper = nodes(tree).find(node => node.type === "label" && text(node).startsWith(label));
  if (!wrapper) throw new Error(`Missing field: ${label}`);
  return nodes(wrapper).find(node => node.props.onChange)!;
}
function change(tree: ReactNode, label: string, value: string) { (field(tree, label).props.onChange as (event: unknown) => void)({ target: { value } }); }
function render(props: ReportScope = scope) {
  let tree: ReactNode;
  for (let attempt = 0; attempt < 8; attempt++) {
    h.stateIndex = 0; h.effectIndex = 0; h.effects = []; h.changed = false;
    const inner = TrainingEnrollmentReport(props);
    tree = (inner.type as (props: ReportScope) => ReactNode)(inner.props);
    for (const effect of h.effects) effect();
    if (!h.changed) return tree;
  }
  throw new Error("Report did not settle after navigation effects");
}
function remount(props: ReportScope = scope) { h.state = []; h.dependencies = []; return render(props); }
beforeEach(() => {
  h.state = []; h.dependencies = []; h.stateIndex = 0; h.effectIndex = 0; h.effects = []; h.changed = false;
  h.search = "facilityId=facility-a&tab=enrollments"; h.saved = undefined;
  h.report.mockReset(); h.savedId.mockReset(); h.navigate.mockReset().mockImplementation((target: string) => {
    h.search = target.split("?")[1] || ""; h.changed = true;
  });
});

describe("Training report navigation intents", () => {
  it("applies an incoming overdue link to an already-mounted report and clears conflicting filters", () => {
    let tree = render();
    change(tree, "Enrollment status", "completed"); tree = render();
    change(tree, "On or after", "2026-09-01"); tree = render();
    change(tree, "Required or optional", "optional"); render();
    h.search = "facilityId=facility-a&tab=enrollments&deadline=overdue&source=notification";
    tree = render();
    expect(field(tree, "Enrollment status").props.value).toBe("all");
    expect(field(tree, "Deadlines").props.value).toBe("overdue");
    expect(field(tree, "Required or optional").props.value).toBe("required");
    expect(field(tree, "On or after").props.value).toBe("");
    expect(field(tree, "Filter dates by").props.value).toBe("due");
    expect(h.navigate).toHaveBeenLastCalledWith("/app/train?facilityId=facility-a&tab=enrollments&source=notification", { replace: true });
    expect(h.report).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, deadline: "overdue", purpose: "required", status: "all" }), 0, true);
  });

  it("consumes the initial overdue link so clearing it survives a tab remount", () => {
    h.search += "&deadline=overdue";
    let tree = render();
    expect(h.report.mock.calls[0][2]).toBe(false);
    expect(field(tree, "Deadlines").props.value).toBe("overdue");
    change(tree, "Deadlines", "all"); render();
    tree = remount();
    expect(field(tree, "Deadlines").props.value).toBe("all");
    expect(h.search).not.toContain("deadline=");
  });

  it("waits for authorized saved filters, gives them precedence, and does not restore them after manual changes", () => {
    h.search += "&savedTrainingReport=saved-a&deadline=overdue";
    render();
    expect(h.report).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    expect(h.navigate).not.toHaveBeenCalled();
    h.saved = { id: "saved-a", name: "Completion register", ...scope, filters: { ...savedDefaults, status: "completed", deadline: "all", dateBasis: "completed" } };
    let tree = render();
    expect(field(tree, "Enrollment status").props.value).toBe("completed");
    expect(field(tree, "Deadlines").props.value).toBe("all");
    expect(text(tree)).toContain("Opened saved report: Completion register");
    expect(h.search).toBe("facilityId=facility-a&tab=enrollments");
    change(tree, "Enrollment status", "in_progress"); render();
    tree = remount();
    expect(field(tree, "Enrollment status").props.value).toBe("all");
    expect(h.savedId).toHaveBeenLastCalledWith(undefined);
  });

  it("can reopen the same saved report later while the component remains mounted", () => {
    h.saved = { id: "saved-a", name: "Completion register", ...scope, filters: { ...savedDefaults, status: "completed" } };
    h.search += "&savedTrainingReport=saved-a";
    let tree = render();
    change(tree, "Enrollment status", "assigned"); tree = render();
    expect(field(tree, "Enrollment status").props.value).toBe("assigned");
    h.search += "&savedTrainingReport=saved-a";
    tree = render();
    expect(field(tree, "Enrollment status").props.value).toBe("completed");
    expect(h.navigate).toHaveBeenCalledTimes(2);
  });

  it("keeps a foreign-facility saved link blocked instead of consuming it or loading a wider report", () => {
    h.saved = { id: "saved-b", name: "Other facility", ...scope, facilityId: "facility-b", filters: { ...savedDefaults, status: "completed" } };
    h.search += "&savedTrainingReport=saved-b";
    const tree = render();
    expect(text(tree)).toContain("This saved report belongs to another facility");
    expect(h.report).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("applies an incoming overdue link immediately when the selected employee is unchanged", () => {
    const selected = { ...scope, employeeId: "employee-a" };
    h.search += "&employeeId=employee-a";
    render(selected);
    h.search += "&deadline=overdue";
    const tree = render(selected);
    expect(field(tree, "Deadlines").props.value).toBe("overdue");
    expect(h.report).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: "employee-a", deadline: "overdue" }), 0, true);
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("keeps a new employee's intent until the workspace remounts the matching report", () => {
    const previous = { ...scope, employeeId: "employee-a" };
    h.search += "&employeeId=employee-a";
    render(previous);
    h.search = "facilityId=facility-a&tab=enrollments&employeeId=employee-b&deadline=overdue";
    render(previous);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(expect.anything(), 0, false);
    const tree = remount({ ...scope, employeeId: "employee-b" });
    expect(field(tree, "Deadlines").props.value).toBe("overdue");
    expect(h.report).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: "employee-b", deadline: "overdue" }), 0, true);
    expect(h.search).toBe("facilityId=facility-a&tab=enrollments&employeeId=employee-b");
  });

  it("waits for a stale employee selection to clear before consuming a facility-wide reminder", () => {
    const previous = { ...scope, employeeId: "employee-a" };
    h.search += "&employeeId=employee-a";
    render(previous);
    h.search = "facilityId=facility-a&tab=enrollments&deadline=overdue";
    render(previous);
    expect(h.navigate).not.toHaveBeenCalled();
    const tree = remount();
    expect(field(tree, "Deadlines").props.value).toBe("overdue");
    expect(h.report).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: undefined, deadline: "overdue" }), 0, true);
    expect(h.search).toBe("facilityId=facility-a&tab=enrollments");
  });

  it("also retains a cached saved-report intent until the requested employee scope arrives", () => {
    const previous = { ...scope, employeeId: "employee-a" };
    h.search += "&employeeId=employee-a";
    render(previous);
    h.saved = { id: "saved-b", name: "Employee completion register", ...scope, filters: { ...savedDefaults, status: "completed", employeeId: "employee-b" } };
    h.search = "facilityId=facility-a&tab=enrollments&employeeId=employee-b&savedTrainingReport=saved-b";
    render(previous);
    expect(h.navigate).not.toHaveBeenCalled();
    const tree = remount({ ...scope, employeeId: "employee-b" });
    expect(field(tree, "Enrollment status").props.value).toBe("completed");
    expect(h.report).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: "employee-b", status: "completed" }), 0, true);
    expect(h.search).toBe("facilityId=facility-a&tab=enrollments&employeeId=employee-b");
  });
});
