import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>, refCursor: 0,
  total: 51, fetching: false, query: vi.fn(), review: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (next: unknown) => {
      h.state[index] = typeof next === "function" ? next(h.state[index]) : next;
    }];
  },
  useMemo: (value: () => unknown) => value(),
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); },
  useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "reviewer" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployeesByIds: () => ({ data: [] }) }));
vi.mock("@/hooks/useCredentialRenewals", () => ({
  extractedFieldString: () => "",
  renewalSlaLabel: () => ({ label: "Waiting", level: "warn" }),
  useCredentialRenewalSubmissions: h.query,
  useCredentialRenewalQueueSummary: () => ({ data: null }),
  useReviewCredentialRenewal: () => ({ isPending: false, mutateAsync: h.review }),
}));

import { CredentialRenewalInbox } from "./CredentialRenewalInbox";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const current = node as Node;
  return [current, ...nodes(current.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as Node).props.children as ReactNode) : "";
}
function render() {
  h.cursor = 0;
  h.refCursor = 0;
  h.effects = [];
  return CredentialRenewalInbox({});
}
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find((node) => text(node.props.children as ReactNode).trim() === label
    && typeof node.props.onClick === "function");
  expect(found, `${label} button`).toBeDefined();
  return found!;
}
function click(tree: ReactNode, label: string) {
  const target = button(tree, label);
  expect(target.props.disabled).toBe(false);
  (target.props.onClick as () => void)();
}

beforeEach(() => {
  vi.clearAllMocks(); h.refs = []; h.refCursor = 0;
  h.state = []; h.cursor = 0; h.effects = []; h.total = 51; h.fetching = false;
  h.query.mockReset();
  h.query.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) => ({
    data: {
      total: h.total,
      rows: Array.from({ length: Math.max(0, Math.min(pageSize, h.total - page * pageSize)) }, (_, index) => ({
        id: `renewal-${page * pageSize + index}`,
        employee_id: `staff${String(page * pageSize + index).padStart(3, "0")}`,
        status: "needs_review", scan_status: "clean", credential_type: "cpr",
        created_at: "2026-09-14T00:00:00Z", extracted_fields: null,
      })),
    },
    isLoading: false, isFetching: h.fetching, isError: false, refetch: vi.fn(),
  }));
});

function field(id: string) { return nodes(render()).find(n => n.props.id === id)!; }
function change(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function prepareReview() {
  click(render(), "Approve"); change("renewal-issuer", "State authority"); change("renewal-expiration", "2028-10-01");
  change("renewal-reason", "Verified against submitted evidence");
}
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

describe("credential decision recovery", () => {
  it("locks the approval draft and dialog until settlement and submits only one decision", async () => {
    const pending = deferred(); h.review.mockReturnValue(pending.promise); prepareReview();
    const submit = button(render(), "Approve renewal").props.onClick as () => void; submit(); submit();
    expect(h.review).toHaveBeenCalledTimes(1);
    let tree = render();
    expect(nodes(tree).some(n => n.type === "fieldset" && n.props.disabled && nodes(n).some(child => child.props.id === "renewal-reason"))).toBe(true);
    expect(button(tree, "Cancel").props.disabled).toBe(true);
    (nodes(tree).find(n => typeof n.props.onOpenChange === "function")!.props.onOpenChange as (value: boolean) => void)(false);
    expect(nodes(render()).find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(true);
    pending.resolve(); await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Renewal approved" })));
    tree = render(); expect(nodes(tree).find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(false);
  });
  it("retains all confirmed fields and the reason after a blocked review for retry", async () => {
    const pending = deferred(); h.review.mockReturnValue(pending.promise); prepareReview();
    (button(render(), "Approve renewal").props.onClick as () => void)(); pending.reject(new Error("Server review unavailable"));
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Review blocked" })));
    expect(field("renewal-issuer").props.value).toBe("State authority"); expect(field("renewal-expiration").props.value).toBe("2028-10-01");
    expect(field("renewal-reason").props.value).toBe("Verified against submitted evidence");
    expect(button(render(), "Approve renewal").props.disabled).toBe(false);
  });
  it.each(["success", "failure"])("does not publish late %s feedback after leaving the review", async outcome => {
    const pending = deferred(); h.review.mockReturnValue(pending.promise); prepareReview();
    const submit = button(render(), "Approve renewal").props.onClick as () => void;
    const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function");
    submit(); cleanups.forEach(cleanup => cleanup());
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("Old reviewer response"));
    await pending.promise.catch(() => undefined); await Promise.resolve(); await Promise.resolve();
    expect(h.toast).not.toHaveBeenCalled();
  });
});

describe("credential renewal inbox pagination", () => {
  it("makes the pending renewal after the first 50 reachable and preserves the queue filter", () => {
    let tree = render();
    expect(text(tree)).not.toContain("staff050");
    click(tree, "Next");
    tree = render();
    expect(h.query).toHaveBeenLastCalledWith({ status: "needs_review", page: 1, pageSize: 50 });
    expect(text(tree)).toContain("staff050");
    expect(text(tree)).toContain("Page 2 of 2");
    expect(button(tree, "Next").props.disabled).toBe(true);
    click(tree, "Previous");
    tree = render();
    expect(text(tree)).toContain("staff000");
    expect(button(tree, "Previous").props.disabled).toBe(true);
  });

  it("starts a newly selected status at page one", () => {
    click(render(), "Next");
    const filter = nodes(render()).find((node) => node.props.value === "needs_review"
      && typeof node.props.onValueChange === "function")!;
    (filter.props.onValueChange as (value: string) => void)("approved");
    render();
    expect(h.query).toHaveBeenLastCalledWith({ status: "approved", page: 0, pageSize: 50 });
  });

  it("returns to a populated page after the final pending item is reviewed", () => {
    click(render(), "Next");
    render();
    h.total = 50;
    render();
    h.effects.forEach((effect) => effect());
    const tree = render();
    expect(h.query).toHaveBeenLastCalledWith({ status: "needs_review", page: 0, pageSize: 50 });
    expect(text(tree)).toContain("staff000");
    expect(text(tree)).toContain("Page 1 of 1");
  });

  it("prevents repeated page changes while the requested page is loading", () => {
    h.fetching = true;
    const tree = render();
    expect(button(tree, "Next").props.disabled).toBe(true);
  });
});
