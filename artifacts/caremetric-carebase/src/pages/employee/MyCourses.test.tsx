import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = value; }]; },
  useMemo: (compute: () => unknown) => compute(),
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/me/courses", vi.fn()], useSearch: () => "" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === "required" ? new Set(["required"]) : [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile", organizationId: "org", role: "employee" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => ({ data: { id: "employee", organization_id: "org" } }) }));
vi.mock("@/hooks/useCourseAssignments", () => ({ useSelfEnrollCourse: () => ({}), useListCourseAssignments: () => ({ data: [
  { id: "required", course_id: "required-course", status: "completed", is_required: true },
  { id: "optional", course_id: "optional-course", status: "in_progress", is_required: false, assignment_origin: "self_enrolled" },
] }) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [
  { id: "required-course", title: "Completed required course" }, { id: "optional-course", title: "Optional learning course" },
] }), useListCourseVersionsByIds: () => ({ data: [] }), canEnrollInCourse: () => false, isCourseVersionLearnerReady: () => false }));
vi.mock("@/hooks/useOfflineLearning", () => ({ useOfflineCourseLibrary: () => ({ data: [] }), useDownloadCourseForOffline: () => ({}), useRemoveOfflineCourse: () => ({}), useWipeOfflineCourses: () => ({}) }));
vi.mock("@/hooks/useTrainingDiscovery", () => ({ librarySchema: {}, useTrainingDiscovery: () => ({}), useSaveTrainingDiscovery: () => ({}) }));
vi.mock("@/components/training/TrainingWelcome", () => ({ TrainingWelcome: "welcome" }));
vi.mock("@/components/training-discovery/ElectiveDiscovery", () => ({ ElectiveDiscovery: "discovery", SavedCoursesFilter: "saved-filter" }));
vi.mock("@/components/training-discovery/OptionalRefreshers", () => ({ OptionalRefreshers: "refreshers" }));
import MyCourses from "./MyCourses";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return MyCourses(); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => node.props.onClick && text(node.props.children as ReactNode) === label)!; }
beforeEach(() => { h.state = []; h.cursor = 0; });

describe("My Learning list selection", () => {
  it("keeps selection, heading and content aligned when required learning is complete", () => {
    let tree = render();
    expect(button(tree, "Required").props["aria-pressed"]).toBe(true);
    expect(text(tree)).toContain("Required by your facility (0)");
    expect(text(tree)).not.toContain("Optional learning course");
    (button(tree, "Optional").props.onClick as () => void)(); tree = render();
    expect(button(tree, "Optional").props).toMatchObject({ "aria-pressed": true, variant: "default" });
    expect(button(tree, "Required").props).toMatchObject({ "aria-pressed": false, variant: "outline" });
    expect(text(tree)).toContain("Your optional learning (1)");
    expect(text(tree)).toContain("Optional learning course");
    (button(tree, "Completed / history").props.onClick as () => void)(); tree = render();
    expect(button(tree, "Completed / history").props["aria-pressed"]).toBe(true);
    expect(button(tree, "Optional").props["aria-pressed"]).toBe(false);
    expect(text(tree)).toContain("Completed learning and history (1)");
    expect(text(tree)).toContain("Completed required course");
    expect(text(tree)).not.toContain("Optional learning course");
  });
  it("clears the previous status filter when changing learning lists", () => {
    let tree = render();
    const filter = nodes(tree).find(node => node.props.value === "all" && node.props.onValueChange)!;
    (filter.props.onValueChange as (value: string) => void)("overdue");
    tree = render(); expect(text(tree)).toContain("No training matches this status filter");
    (button(tree, "Optional").props.onClick as () => void)(); tree = render();
    expect(text(tree)).toContain("Your optional learning (1)");
    expect(text(tree)).toContain("Optional learning course");
  });
});
