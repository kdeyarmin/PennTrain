import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, deps: [] as Array<unknown[] | undefined>, effectCursor: 0, effects: [] as Array<() => unknown>, dirty: false,
  page: { rows: [] as any[], count: 0 }, loading: false, failed: false, fetching: false, placeholder: false, remove: vi.fn(), toast: vi.fn(), refetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (fn: () => unknown) => fn(), useRef: () => ({ current: null }),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial; return [h.state[i], (next: unknown) => { const value = typeof next === "function" ? next(h.state[i]) : next; if (!Object.is(value, h.state[i])) h.dirty = true; h.state[i] = value; }]; },
  useEffect: (effect: () => unknown, deps?: unknown[]) => { const i = h.effectCursor++; if (!deps || !h.deps[i] || deps.some((d, j) => !Object.is(d, h.deps[i]?.[j]))) { h.effects.push(effect); h.deps[i] = deps; } },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", organizationId: "org", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useDocuments", () => ({
  usePaginatedDocuments: () => ({ data: h.page, isLoading: h.loading, isError: h.failed, isSuccess: !h.loading && !h.failed, isFetching: h.fetching, isPlaceholderData: h.placeholder, error: new Error("Read failed"), refetch: h.refetch }),
  useUploadDocument: () => ({}), useDocumentSignedUrl: () => ({}), useDeleteDocument: () => ({ mutateAsync: h.remove }),
}));
vi.mock("@/components/documents/DocumentDeletionQueue", () => ({ DocumentDeletionQueue: "deletion-queue" }));
vi.mock("@/components/residents/ResidentDocumentDeletionQueue", () => ({ ResidentDocumentDeletionQueue: "resident-deletion-queue" }));
vi.mock("@/components/residents/ResidentRecordDestructionLog", () => ({ ResidentRecordDestructionLog: "destruction-log" }));
import Documents from "./Documents";

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render(effects = true) { for (let i = 0; i < 12; i++) { h.cursor = h.effectCursor = 0; h.effects = []; h.dirty = false; const tree = Documents(); if (!effects) return tree; h.effects.forEach(effect => effect()); if (!h.dirty) return tree; } throw new Error("Render did not settle"); }
function bulk(tree = render()) { return nodes(tree).filter(n => n.props.onClick && text(n).trim() === "Delete Selected").at(-1)!; }
function selectAll() { nodes(render()).find(n => n.props["aria-label"] === "Select all documents on this page")!.props.onCheckedChange(); }
const pendingMessage = "The document record was removed, but file deletion is still pending. Use Pending file deletions in Documents to retry.";
beforeEach(() => {
  vi.resetAllMocks(); h.state = []; h.deps = []; h.effects = []; h.cursor = h.effectCursor = 0; h.loading = h.failed = h.fetching = h.placeholder = false;
  h.page = { count: 2, rows: ["pending", "denied"].map(id => ({ id, file_name: `${id}.pdf`, storage_bucket: "external-uploads", storage_path: id, document_type: "other", created_at: "2026-09-27T00:00:00Z" })) };
  h.remove.mockResolvedValue(undefined);
});

describe("document selection after durable deletion", () => {
  it("moves metadata-removed failures to the cleanup queue and retries only still-present denied records", async () => {
    h.remove.mockImplementation(async doc => {
      if (doc.id === "pending") { h.page = { count: 1, rows: h.page.rows.filter(row => row.id !== "pending") }; throw new Error(pendingMessage); }
      throw new Error("Referenced document cannot be deleted");
    });
    selectAll(); await bulk().props.onClick();
    expect(text(render())).toContain("1 document selected");
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: expect.stringContaining("Pending file deletions") }));
    h.remove.mockResolvedValue(undefined); await bulk().props.onClick();
    expect(h.remove.mock.calls.map(([doc]) => doc.id)).toEqual(["pending", "denied", "denied"]);
    expect(text(render())).not.toContain("document selected");
  });
  it.each(["failed", "loading", "fetching", "placeholder"] as const)("preserves selected retries while the list is %s", async status => {
    selectAll(); render(); h[status] = true; h.page = { rows: [], count: 0 };
    const tree = render(); expect(text(tree)).toContain("2 documents selected");
    await bulk(tree).props.onClick(); expect(h.remove).not.toHaveBeenCalled();
    expect(h.toast.mock.calls.some(([notice]) => notice.title === "0 documents deleted")).toBe(false);
    h[status] = false; h.page = { rows: [{ id: "denied", file_name: "denied.pdf", created_at: "2026-09-27T00:00:00Z" }], count: 1 };
    expect(text(render())).toContain("1 document selected");
  });
  it("does not report zero deletions when an authoritative empty refresh wins before the selection effect", async () => {
    selectAll(); render(); h.page = { rows: [], count: 0 };
    const tree = render(false); await bulk(tree).props.onClick();
    expect(h.remove).not.toHaveBeenCalled(); expect(h.toast.mock.calls.some(([notice]) => notice.title === "0 documents deleted")).toBe(false);
  });
  it("shows the durable cleanup guidance for a single deletion failure", async () => {
    h.remove.mockRejectedValue(new Error(pendingMessage));
    nodes(render()).find(n => n.props["aria-label"] === "Delete document")!.props.onClick();
    await nodes(render()).find(n => n.props.onClick && text(n).trim() === "Delete")!.props.onClick();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: pendingMessage, variant: "destructive" }));
  });
});
