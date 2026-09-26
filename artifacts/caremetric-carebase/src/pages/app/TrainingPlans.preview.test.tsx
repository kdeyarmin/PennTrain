import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingPlan } from "@/hooks/useTrainingPlans";

const h = vi.hoisted(() => ({ state: [] as unknown[], index: 0, apply: vi.fn(), lookup: vi.fn(), lookupError: false, retryNames: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "preview-test", useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
  return [h.state[index], (next: unknown) => { h.state[index] = typeof next === "function" ? next(h.state[index]) : next; }];
} }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin" } }) }));
vi.mock("@/hooks/useTrainingPlans", () => ({
  useListTrainingPlanItems: () => ({ data: [{ id: "item", course_id: "course" }], isLoading: false, isError: false }),
  useApplyTrainingPlanToEmployee: () => ({ mutateAsync: h.apply }),
}));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", is_active: true }] }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useTrainingFacilityScope: () => ({
  facilities: [{ id: "facility", is_active: true }], isReady: true, isLoading: false, isError: false,
}) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [{
  id: "employee", facility_id: "facility", first_name: "Casey", last_name: "Learner",
}], isLoading: false, isError: false }), useListEmployeesByIds: (ids: string[]) => {
  h.lookup(ids); return { data: h.lookupError ? undefined : [{ id: "former", first_name: "Former", last_name: "Learner", status: "terminated" }], isError: h.lookupError, error: new Error("Names unavailable"), refetch: h.retryNames };
} }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [{ id: "course", title: "Orientation" }] }) }));
vi.mock("@/hooks/useCourseAssignments", () => ({ useListCourseAssignments: () => ({ data: [{ id: "assignment", employee_id: "former", course_id: "course", status: "completed" }] }) }));
import { ApplyPlanDialog, PlanProgressSection } from "./TrainingPlans";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : "";
}
const plan = { id: "legacy-plan", organization_id: "organization", name: "Legacy orientation", facility_id: null } as TrainingPlan;
function render() { h.index = 0; return ApplyPlanDialog({ plan, open: true, onClose: vi.fn() }); }
function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => typeof node.props.onClick === "function" && text(node.props.children as ReactNode) === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  expect(button.props.disabled).not.toBe(true);
  (button.props.onClick as () => void)();
}
function deadline(tree: ReactNode, value: string) {
  const field = nodes(tree).find(node => node.props.type === "date")!;
  (field.props.onChange as (event: unknown) => void)({ target: { value } });
}
beforeEach(() => {
  h.state = []; h.index = 0;
  h.lookupError = false; h.lookup.mockClear(); h.retryNames.mockClear();
  h.apply.mockReset().mockResolvedValue({ assigned: 1, failed: [], requirementsEnsured: 0, alreadyAssigned: 0 });
});

describe("historical plan participants", () => {
  it("retains an inactive learner's name and completed progress through targeted lookup", () => {
    const tree = PlanProgressSection({ plan });
    expect(h.lookup).toHaveBeenCalledWith(["former"]);
    expect(text(tree)).toContain("Former Learner");
    expect(text(tree)).toContain("1 / 1 complete");
  });
  it("preserves the completed progress and offers retry when participant names fail", () => {
    h.lookupError = true; const tree = PlanProgressSection({ plan });
    expect(text(tree)).toContain("Employee #former"); expect(text(tree)).toContain("1 / 1 complete");
    const error = nodes(tree).find(node => node.props.what === "plan participant names")!;
    (error.props.onRetry as () => void)(); expect(h.retryNames).toHaveBeenCalledOnce();
  });
});

describe("legacy plan deadline review", () => {
  it("requires a new preview after editing a previously reviewed completion deadline", async () => {
    let tree = render();
    const employee = nodes(tree).find(node => node.props["aria-label"] === "Casey Learner")!;
    (employee.props.onCheckedChange as (value: boolean) => void)(true);
    deadline(tree, "2031-01-15");
    click(render(), "Preview 1 Employee");
    tree = render();
    expect(text(tree)).toContain("Review assignment changes");
    expect(text(tree)).toContain("Confirm apply to 1 Employee");

    deadline(tree, "2031-02-20");
    tree = render();
    expect(text(tree)).not.toContain("Review assignment changes");
    expect(text(tree)).not.toContain("Confirm apply to 1 Employee");
    expect(h.apply).not.toHaveBeenCalled();
    click(tree, "Preview 1 Employee");
    tree = render();
    expect(text(tree)).toContain("Casey Learner");
    expect(text(tree)).toContain("2/20/2031");
    click(tree, "Confirm apply to 1 Employee");
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledExactlyOnceWith({
      planId: "legacy-plan", employeeId: "employee", facilityId: "facility", organizationId: "organization", assignedBy: "manager", dueDate: "2031-02-20",
    }));
  });
});
