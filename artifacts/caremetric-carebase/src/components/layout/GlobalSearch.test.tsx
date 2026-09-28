import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, id: 0,
  result: {} as Record<string, unknown>, navigate: vi.fn(), refetch: vi.fn(),
  role: "employee", favorites: [] as string[], recent: [] as { path: string; label: string }[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = value; }]; },
  useRef: (initial: unknown) => { const index = h.refCursor++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
  useId: () => `search-${++h.id}`,
  useEffect: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/me", h.navigate] }));
vi.mock("@/hooks/useGlobalSearch", () => ({ useGlobalSearch: () => h.result }));
vi.mock("@/hooks/useProductExperience", () => ({ useNavigationWorkspace: () => ({ favoritePaths: h.favorites, recentPaths: h.recent }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "employee", role: h.role } }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({
  enabledModules: new Set(["core", "train", "carebase"]), canAccessPath: () => true, canAccessModule: () => true,
}) }));
import { GlobalSearch } from "./GlobalSearch";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function render() { h.cursor = 0; h.refCursor = 0; return GlobalSearch(); }
function empty() { return { items: [], organizations: [], profiles: [], employees: [], residents: [], courses: [] }; }
beforeEach(() => {
  vi.clearAllMocks(); h.refs = []; h.id = 0;
  vi.unstubAllEnvs(); h.role = "employee"; h.favorites = []; h.recent = [];
  h.state = ["certificates", "certificates", true, undefined];
  h.result = { data: empty(), isFetching: false, isError: false, refetch: h.refetch };
});

describe("global search recovery and result ownership", () => {
  it("hides stale shortcuts that the current role cannot open", () => {
    h.state = ["", "", true, undefined];
    h.favorites = ["/admin/organizations", "/me/certificates"];
    h.recent = [{ path: "/admin/users", label: "Old administrator page" }];
    const html = renderToStaticMarkup(render());
    expect(html).toContain("My certificates");
    expect(html).not.toContain("/admin/organizations");
    expect(html).not.toContain("Old administrator page");
  });

  it("does not offer directory records from pages absent in Train", () => {
    vi.stubEnv("VITE_APP_PRODUCT", "train");
    h.role = "platform_admin";
    h.state = ["sample", "sample", true, undefined];
    h.result = { ...h.result, data: { ...empty(),
      organizations: [{ id: "org", name: "Unavailable organization result" }],
      profiles: [{ id: "profile", first_name: "Unavailable profile result", last_name: "", email: "sample@example.test" }],
      employees: [{ id: "person", first_name: "Unavailable employee result", last_name: "" }],
    } };
    const html = renderToStaticMarkup(render());
    expect(html).not.toContain("Unavailable organization result");
    expect(html).not.toContain("Unavailable profile result");
    expect(html).not.toContain("Unavailable employee result");
  });

  it("keeps platform resident results whose detail route has no index page", () => {
    h.role = "platform_admin";
    h.state = ["resident", "resident", true, undefined];
    h.result = { ...h.result, data: { ...empty(), residents: [{ id: "resident-id", first_name: "Visible resident", last_name: "Record" }] } };
    const tree = render();
    expect(renderToStaticMarkup(tree)).toContain("Visible resident");
    const result = nodes(tree).find(node => node.type === "button" && String(node.props.id).includes("resident-resident-id"))!;
    (result.props.onClick as () => void)();
    expect(h.navigate).toHaveBeenCalledWith("/admin/residents/resident-id");
  });

  it("uses trainer directory destinations for shared workspace results", () => {
    h.role = "trainer";
    h.state = ["sample", "sample", true, undefined];
    h.result = { ...h.result, data: { ...empty(), items: [{ id: "staff-id", kind: "employees", label: "Sample employee", route: "/app/employees/staff-id" }] } };
    const tree = render();
    expect(renderToStaticMarkup(tree)).toContain("Sample employee");
    const result = nodes(tree).find(node => node.type === "button" && String(node.props.id).includes("staff-id"))!;
    (result.props.onClick as () => void)();
    expect(h.navigate).toHaveBeenCalledWith("/trainer/employees/staff-id");
  });

  it("keeps known page navigation usable when record search fails", () => {
    h.result = { ...h.result, data: undefined, isError: true, error: new Error("Connection unavailable") };
    const tree = render();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("My certificates");
    expect(html).toContain("Connection unavailable");
    const page = nodes(tree).find(node => node.type === "button" && String(node.props.id).includes("page-"))!;
    (page.props.onClick as () => void)();
    expect(h.navigate).toHaveBeenCalledWith("/me/certificates");
    const retry = nodes(tree).find(node => node.type === "button" && node.props.children === "Retry search")!;
    (retry.props.onClick as () => void)();
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it("never offers a previous search's record while the new text is debouncing", () => {
    h.state = ["certificates", "alice", true, undefined];
    h.result = { ...h.result, data: { ...empty(), employees: [{ id: "alice", first_name: "Alice", last_name: "Previous result" }] } };
    const html = renderToStaticMarkup(render());
    expect(html).toContain("My certificates");
    expect(html).not.toContain("Previous result");
    expect(html).toContain("Searching");
  });

  it("does not keep failed record results actionable alongside current page shortcuts", () => {
    h.result = { ...h.result, isError: true, error: new Error("Retry needed"), data: {
      ...empty(), courses: [{ assignmentId: "old", title: "Unconfirmed record" }],
    } };
    const html = renderToStaticMarkup(render());
    expect(html).toContain("My certificates");
    expect(html).not.toContain("Unconfirmed record");
  });

  it("connects each mounted search to its own uniquely identified list", () => {
    const first = nodes(render()); const second = nodes(render());
    const input = (tree: Node[]) => tree.find(node => node.props.role === "combobox")!;
    const list = (tree: Node[]) => tree.find(node => node.props.role === "listbox")!;
    expect(input(first).props["aria-controls"]).toBe(list(first).props.id);
    expect(input(second).props["aria-controls"]).toBe(list(second).props.id);
    expect(list(first).props.id).not.toBe(list(second).props.id);
  });
});
