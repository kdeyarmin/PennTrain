import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, create: vi.fn(), complete: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "assign", useEffect: () => {}, useMemo: (fn: () => unknown) => fn(),
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof value === "function" ? value() : value;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; },
}));
vi.mock("wouter", () => ({ useSearch: () => "", Link: "a" }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [{ facilityId: "all" }, vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", organizationId: "org", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useTrainingFacilityScope: () => ({ isReady: true, facilities: [{ id: "facility", name: "Home" }] }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Home" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: ["a", "b"].map(id => ({ id, first_name: id, last_name: "Learner", facility_id: "facility", status: "active" })) }) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [{ id: "course", title: "Course", current_version_id: "version", status: "published" }] }),
  useListCourseVersionsForCourses: () => ({ data: [{ id: "version", course_id: "course", status: "published", content_standard: "legacy" }] }), isCourseVersionLearnerReady: () => true }));
vi.mock("@/hooks/useQuizzes", () => ({ useListQuizzesForCourseVersion: () => ({ data: [] }) }));
vi.mock("@/hooks/useCertificates", () => ({ useListCertificates: () => ({ data: [] }), usePrepareCertificatePdf: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/useCourseAssignments", () => ({
  OPEN_ASSIGNMENT_STATUSES: ["assigned", "in_progress", "overdue", "paused"],
  useListCourseAssignmentsPaginated: () => ({ data: { count: 2, rows: ["a", "b"].map(id => ({ id: `assignment-${id}`, employee_id: id, course_id: "course", course_version_id: "version", facility_id: "facility", status: "assigned", due_date: "2026-12-31" })) } }),
  useCreateCourseAssignment: () => ({ mutateAsync: h.create }), useCompleteCourseAssignment: () => ({ mutateAsync: h.complete, mutate: vi.fn() }),
  useGetCourseProgress: () => ({}), useGrantAdditionalQuizAttempt: () => ({}), useCancelCourseAssignment: () => ({}),
}));
import CourseAssignments from "./CourseAssignments";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; return CourseAssignments(); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.props.onClick && text(n).trim() === label)!; }
function dialog(tree: ReactNode) { return nodes(tree).find(n => n.type === Dialog && text(n).startsWith("Assign Training"))!; }
function readyAssignment() {
  button(render(), "Assign Training").props.onClick();
  nodes(dialog(render())).find(n => n.props.onValueChange && n.props.value === "")!.props.onValueChange("course");
  nodes(render()).find(n => n.props.id === "assign-due-date")!.props.onChange({ target: { value: "2026-12-31" } });
  nodes(render()).find(n => n.props["aria-label"] === "Select all in facility")!.props.onCheckedChange();
}
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.create.mockResolvedValue({ alreadyAssigned: false }); h.complete.mockResolvedValue({}); });
describe("administrative training batch recovery", () => {
  it("retains only failed learners for retry after every assignment request settles", async () => {
    let finish!: () => void; h.create.mockRejectedValueOnce(new Error("Enrollment unavailable")).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ alreadyAssigned: false }); }));
    readyAssignment(); const pending = button(dialog(render()), "Assign to 2 Employees").props.onClick(); await Promise.resolve();
    expect(h.create.mock.calls, JSON.stringify(h.toast.mock.calls)).toHaveLength(2);
    const locked = dialog(render()); locked.props.onOpenChange(false); expect(dialog(render()).props.open).toBe(true);
    expect(button(locked, "Cancel").props.disabled).toBe(true);
    finish(); await pending;
    expect(dialog(render()).props.open).toBe(true); expect(text(dialog(render()))).toContain("Employees * (1 selected)");
    await button(dialog(render()), "Assign to 1 Employee").props.onClick();
    expect(h.create.mock.calls.map(([payload]) => payload.employee_id)).toEqual(["a", "b", "a"]);
    expect(dialog(render()).props.open).toBe(false);
  });
  it("retains failed completion selections and retries only those assignments", async () => {
    h.complete.mockRejectedValueOnce(new Error("Completion denied")).mockResolvedValueOnce({});
    nodes(render()).find(n => n.props["aria-label"] === "Select all eligible assignments on this page")!.props.onCheckedChange();
    await button(render(), "Mark Complete Selected").props.onClick();
    expect(text(render())).toContain("1 assignment selected");
    await button(render(), "Mark Complete Selected").props.onClick();
    expect(h.complete.mock.calls.map(([id]) => id)).toEqual(["assignment-a", "assignment-b", "assignment-a"]);
  });
});
