import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refs: [] as Array<{ current: any }>, cursor: 0, effects: [] as boolean[], effectCursor: 0, cleanup: [] as Array<() => void>,
  user: { id: "actor-a", organizationId: "org-a", role: "org_admin", facilityId: "facility-a" },
  props: {} as { kind?: "training" | "credential"; facilityId?: string }, loading: false, error: false, rows: [] as any[], pending: false,
  query: vi.fn(), retryRead: vi.fn(), retry: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => h.refs[h.cursor++] ??= { current: initial },
  useEffect: (effect: () => (() => void) | void) => { const index = h.effectCursor++; if (!h.effects[index]) { h.effects[index] = true; const cleanup = effect(); if (cleanup) h.cleanup.push(cleanup); } },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useDocumentDeletions", () => ({
  usePendingDocumentDeletions: (...args: unknown[]) => { h.query(...args); return { data: h.rows, isLoading: h.loading, isError: h.error, error: new Error("Queue unavailable"), refetch: h.retryRead }; },
  useRetryDocumentDeletion: () => ({ isPending: h.pending, mutateAsync: h.retry }),
}));
import { DocumentDeletionQueue } from "./DocumentDeletionQueue";
import { QueryError, QueryLoading } from "@/components/QueryState";

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
const render = () => { h.cursor = h.effectCursor = 0; return DocumentDeletionQueue(h.props); };
const button = () => nodes(render()).find(n => n.props["aria-label"] === "Retry deletion of roster.pdf")!;
const receipt = { document_kind: "training", document_id: "doc", facility_id: "facility-a", storage_bucket: "signin-sheets", storage_path: "server-path", file_name: "roster.pdf", requested_at: "2026-09-27T00:00:00Z" };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.resetAllMocks(); h.refs = []; h.effects = []; h.cleanup = []; h.cursor = h.effectCursor = 0;
  h.user = { id: "actor-a", organizationId: "org-a", role: "org_admin", facilityId: "facility-a" }; h.props = { kind: "training", facilityId: "facility-a" };
  h.loading = h.error = h.pending = false; h.rows = [receipt]; h.retry.mockResolvedValue(undefined);
});
afterEach(() => h.cleanup.forEach(cleanup => cleanup()));

describe("pending document deletion controls", () => {
  it("shows recoverable read failure instead of offering stale receipt actions", () => {
    h.error = true; const tree = render(); expect(nodes(tree).some(n => n.props.onClick)).toBe(false);
    const failure = nodes(tree).find(n => n.type === QueryError)!; expect(failure.props.what).toBe("pending file deletions"); failure.props.onRetry(); expect(h.retryRead).toHaveBeenCalledOnce();
  });
  it("shows loading before rows and hides an empty successful queue", () => {
    h.loading = true; expect(nodes(render()).some(n => n.type === QueryLoading)).toBe(true);
    h.loading = false; h.rows = []; expect(render()).toBeNull();
  });
  it("passes the explicit facility/kind scope and retries only the chosen server receipt", async () => {
    button().props.onClick(); await flush();
    expect(h.query).toHaveBeenCalledWith("training", "facility-a"); expect(h.retry).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(h.toast).toHaveBeenCalledExactlyOnceWith({ title: "File deletion completed", description: "roster.pdf" });
  });
  it("locks retry buttons and the handler while another cleanup is pending", () => {
    h.pending = true; expect(button().props.disabled).toBe(true); button().props.onClick(); expect(h.retry).not.toHaveBeenCalled();
  });
  it("retains the receipt with an actionable failure and permits a later retry", async () => {
    h.retry.mockRejectedValueOnce(new Error("The file is still referenced")); button().props.onClick(); await flush();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "File deletion is still pending", description: "The file is still referenced", variant: "destructive" }));
    expect(button().props.disabled).toBe(false); button().props.onClick(); await flush(); expect(h.retry).toHaveBeenCalledTimes(2);
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "File deletion completed" }));
  });
  it.each([false, true])("suppresses late feedback after teardown (failure=%s)", async failed => {
    let finish!: () => void; h.retry.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = () => failed ? reject(new Error("Late error")) : resolve(); }));
    button().props.onClick(); h.cleanup.forEach(cleanup => cleanup()); finish(); await flush(); expect(h.toast).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not revive feedback after a scope A→B→A sequence (failure=%s)", async failed => {
    let finish!: () => void; h.retry.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = () => failed ? reject(new Error("Late error")) : resolve(); }));
    button().props.onClick(); h.props = { ...h.props, facilityId: "facility-b" }; render(); h.props = { ...h.props, facilityId: "facility-a" }; render();
    finish(); await flush(); expect(h.toast).not.toHaveBeenCalled();
    button().props.onClick(); await flush(); expect(h.toast).toHaveBeenCalledOnce();
  });
  it.each(["id", "organizationId", "role", "facilityId"] as const)("expires old callbacks when the actor's %s changes", async key => {
    let finish!: () => void; h.retry.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    button().props.onClick(); h.user = { ...h.user, [key]: `${key}-b` }; render(); finish(); await flush(); expect(h.toast).not.toHaveBeenCalled();
  });
});
