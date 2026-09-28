import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "org_admin", train: false, state: [] as unknown[], cursor: 0,
  filters: { search: "", status: "all", category: "all", scope: "system", section: "catalog" },
  list: vi.fn(), create: vi.fn(), options: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "course",
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/app/courses", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role, organizationId: "organization" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/productRoutes", () => ({ pathAvailableInBuild: () => !h.train }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [h.filters, (changes: unknown) => Object.assign(h.filters, changes)] }));
vi.mock("@/components/training/CourseRecommendations", () => ({ CourseRecommendations: "recommendations" }));
vi.mock("@/hooks/useCourses", () => ({
  useListCourses: (filters: unknown) => { h.list(filters); return { data: [], isLoading: false }; },
  useCreateCourse: () => ({ mutate: h.create, isPending: false }),
  useLearningCreationOptions: (enabled: boolean) => { h.options(enabled); return {}; },
}));
import Courses from "./Courses";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return Courses(); }
beforeEach(() => {
  h.role = "org_admin"; h.train = false; h.state = [];
  h.filters = { search: "", status: "all", category: "all", scope: "system", section: "catalog" };
  h.list.mockReset(); h.create.mockReset(); h.options.mockReset();
});

describe("course catalog authority and recommendation navigation", () => {
  it.each(["org_admin", "facility_manager"])("only offers published catalog, enrollment and recommendations to %s", role => {
    h.role = role; h.filters.status = "draft";
    const tree = render();
    expect(h.list).toHaveBeenCalledWith({ status: "published", systemOnly: false });
    expect(h.options).toHaveBeenCalledWith(false);
    expect(nodes(tree).some(node => node.props.href === "/admin/courses/new-ai")).toBe(false);
    expect(nodes(tree).some(node => node.props["aria-label"] === "Filter by status")).toBe(false);
    expect(nodes(tree).some(node => node.props.href === "/app/course-assignments")).toBe(true);
    expect(nodes(tree).some(node => node.props.onClick && text(node.props.children as ReactNode) === "Recommend a course")).toBe(true);
    expect(text(tree)).toContain("No published courses available yet");
    expect(text(tree)).not.toContain("No training content matches your filters");
  });

  it("restricts AI authoring and draft controls to the super admin", () => {
    h.role = "platform_admin";
    const tree = render();
    expect(h.options).toHaveBeenCalledWith(true);
    expect(nodes(tree).some(node => node.props.href === "/admin/courses/new-ai")).toBe(true);
    expect(nodes(tree).some(node => node.props["aria-label"] === "Filter by status")).toBe(true);
    expect(nodes(tree).some(node => node.props.href === "/app/course-assignments")).toBe(false);
    expect(text(tree)).toContain("Course recommendations");
  });

  it.each(["trainer", "employee", "auditor"])("does not offer authoring or recommendations to %s", role => {
    h.role = role;
    const tree = render();
    expect(nodes(tree).some(node => node.props.href === "/admin/courses/new-ai" || node.type === "recommendations")).toBe(false);
  });

  it("opens recommendations without clearing the catalog filters", () => {
    h.filters.search = "dementia"; h.filters.category = "Care";
    let tree = render();
    const recommend = nodes(tree).find(node => node.props.onClick && text(node.props.children as ReactNode) === "Recommend a course")!;
    (recommend.props.onClick as () => void)(); tree = render();
    expect(h.filters).toMatchObject({ section: "recommendations", search: "dementia", category: "Care" });
    const panel = nodes(tree).find(node => node.props.value === "recommendations" && node.props.forceMount)!;
    expect(panel.props.hidden).toBe(false);
    const tabs = nodes(tree).find(node => node.props.value === "recommendations" && node.props.onValueChange)!;
    (tabs.props.onValueChange as (section: string) => void)("catalog"); tree = render();
    const hiddenPanel = nodes(tree).find(node => node.props.value === "recommendations" && node.props.forceMount)!;
    expect(hiddenPanel.props.hidden).toBe(true);
    expect(nodes(hiddenPanel).some(node => node.type === "recommendations")).toBe(true);
    expect(h.filters).toMatchObject({ section: "catalog", search: "dementia", category: "Care" });
  });

  it("honors a recommendation return link and safely falls back from unknown sections", () => {
    h.filters.section = "recommendations";
    expect(nodes(render()).some(node => node.props.value === "recommendations" && node.props.onValueChange)).toBe(true);
    h.filters.section = "unknown";
    expect(nodes(render()).some(node => node.props.value === "catalog" && node.props.onValueChange)).toBe(true);
  });

  it("does not expose missing authoring routes in the Train build", () => {
    h.role = "platform_admin"; h.train = true;
    const tree = render();
    expect(h.options).toHaveBeenCalledWith(false);
    expect(nodes(tree).some(node => node.props.href === "/admin/courses/new-ai")).toBe(false);
    expect(nodes(tree).some(node => node.props.href === "https://cmcarebase.com/admin/courses")).toBe(true);
  });
});
