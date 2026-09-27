import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, versionsError: false, blocksError: false, coursesError: false, pending: false, retry: vi.fn(), create: vi.fn(), register: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: () => {}, useMemo: (fn: () => unknown) => fn(),
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof value === "function" ? value() : value;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "author" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useCourses", () => ({
  useListCourses: () => ({ data: [{ id: "course", title: "Course", organization_id: "org" }], isError: h.coursesError, error: new Error("Catalog unavailable"), refetch: h.retry }),
  useListCourseVersions: () => ({ data: [{ id: "version", title: "Draft", version_number: 1, status: "draft" }], isError: h.versionsError, error: new Error("Versions unavailable"), refetch: h.retry }),
  useListCourseBlocks: () => ({ data: [], isError: h.blocksError, error: new Error("Blocks unavailable"), refetch: h.retry }),
}));
vi.mock("@/hooks/useGovernedContentRevisions", () => ({
  useGovernedContentAssets: () => ({ data: ["a", "b"].map(id => ({ id, source_id: `course-${id}`, title: id })) }), useGovernedContentRevisions: () => ({ data: [] }),
  useCreateGovernedRevision: () => ({ mutateAsync: h.create, isPending: h.pending }), useRegisterGovernedAsset: () => ({ mutateAsync: h.register }),
  useSubmitGovernedRevision: () => ({}), useReviewGovernedRevision: () => ({}), usePublishGovernedRevision: () => ({}),
}));
import { GovernedContentRevisionsPanel } from "./GovernedContentRevisionsPanel";
import { QueryError } from "@/components/QueryState";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; return GovernedContentRevisionsPanel(); }
function authorNode(asset = "a") { nodes(render()).find(n => n.props.onValueChange)!.props.onValueChange(asset); return nodes(render()).find(n => n.props.assetId === asset)!; }
function mount(node: Node) { h.state = []; return () => { h.cursor = 0; return (node.type as (props: any) => ReactNode)(node.props); }; }
function action(tree: ReactNode, label: string) { return nodes(tree).find(n => n.props.onClick && text(n).trim() === label)!; }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.versionsError = false; h.blocksError = false; h.coursesError = false; h.pending = false; });
describe("governed revision authoring recovery", () => {
  it("offers a retry for failed source-version reads", () => {
    h.versionsError = true; const tree = mount(authorNode())(); const failure = nodes(tree).find(n => n.type === QueryError)!;
    expect(failure).toBeDefined(); failure.props.onRetry(); expect(h.retry).toHaveBeenCalled();
  });
  it("offers a retry for failed source-block reads and blocks stale snapshot creation", () => {
    const card = mount(authorNode()); nodes(card()).find(n => n.props.onValueChange && n.props.value === "")!.props.onValueChange("version");
    h.blocksError = true; const tree = card(); const failure = nodes(tree).find(n => n.type === QueryError)!;
    expect(failure).toBeDefined(); failure.props.onRetry(); expect(h.retry).toHaveBeenCalled(); expect(action(tree, "Author revision").props.disabled).toBe(true);
  });
  it("blocks a cached registration selection when its catalog refresh fails and exposes retry", () => {
    const node = nodes(render()).find(n => n.props.governedSourceIds)!; const card = mount(node);
    nodes(card()).find(n => n.props.onValueChange)!.props.onValueChange("course"); h.coursesError = true;
    const tree = card(); expect(action(tree, "Register").props.disabled).toBe(true);
    const failure = nodes(tree).find(n => n.type === QueryError)!; failure.props.onRetry(); expect(h.retry).toHaveBeenCalled();
  });
  it("isolates the authoring draft when the selected governed asset changes", () => {
    const first = authorNode("a"); const second = authorNode("b"); expect(first.key).not.toBeNull(); expect(first.key).not.toBe(second.key);
  });
  it("locks snapshot inputs while a revision is being authored", () => {
    h.pending = true; const tree = mount(authorNode())();
    expect(nodes(tree).find(n => n.props.id === "gc-summary")?.props.disabled).toBe(true);
    expect(nodes(tree).find(n => n.props.onValueChange && n.props.value === "")?.props.disabled).toBe(true);
    expect(nodes(tree).find(n => n.props.id === "gc-material")?.props.disabled).toBe(true);
  });
});
