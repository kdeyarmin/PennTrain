import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, effects: [] as Array<() => void>,
  total: 51, fetching: false, query: vi.fn(),
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
  useEffect: (effect: () => void) => { h.effects.push(effect); },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "reviewer" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployeesByIds: () => ({ data: [] }) }));
vi.mock("@/hooks/useCredentialRenewals", () => ({
  extractedFieldString: () => "",
  renewalSlaLabel: () => ({ label: "Waiting", level: "warn" }),
  useCredentialRenewalSubmissions: h.query,
  useCredentialRenewalQueueSummary: () => ({ data: null }),
  useReviewCredentialRenewal: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
  h.effects = [];
  return CredentialRenewalInbox({});
}
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find((node) => text(node.props.children as ReactNode) === label
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
