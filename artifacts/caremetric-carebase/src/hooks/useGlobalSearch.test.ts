import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, type QueryObserverOptions } from "@tanstack/react-query";
import { useGlobalSearch, type GlobalSearchResults } from "./useGlobalSearch";

const h = vi.hoisted(() => ({
  user: { id: "first", organizationId: "org" }, rpc: vi.fn(),
  options: undefined as QueryObserverOptions<GlobalSearchResults> | undefined,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: QueryObserverOptions<GlobalSearchResults>) => { h.options = options; return {}; },
}));
function options(query: string) { useGlobalSearch(query, "employee"); return h.options!; }
function result(title: string): GlobalSearchResults {
  return { items: [], organizations: [], employees: [], residents: [], profiles: [], courses: [{ assignmentId: title, title }] };
}
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "first", organizationId: "org" }; });

describe("record-search query isolation", () => {
  it("does not carry the previous query's records into a pending query", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.rpc.mockResolvedValueOnce({ data: result("first result"), error: null });
    const first = options("first");
    await client.fetchQuery(first);
    const observer = new QueryObserver(client, first);
    const unsubscribe = observer.subscribe(() => undefined);
    let finish!: (value: unknown) => void;
    h.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    observer.setOptions(options("second"));
    try {
      expect(observer.getCurrentResult().data?.courses).toEqual([]);
      expect(observer.getCurrentResult().fetchStatus).toBe("fetching");
      finish({ data: result("second result"), error: null });
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.courses[0]?.title).toBe("second result"));
    } finally { unsubscribe(); client.clear(); }
  });

  it("keeps a delayed former account response out of the replacement account cache", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let finish!: (value: unknown) => void;
    h.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = options("training"); const pending = client.fetchQuery(first);
    h.user = { id: "replacement", organizationId: "org" };
    const second = options("training");
    h.rpc.mockResolvedValueOnce({ data: result("replacement course"), error: null });
    await client.fetchQuery(second);
    finish({ data: result("former course"), error: null }); await pending;
    try { expect(client.getQueryData<GlobalSearchResults>(second.queryKey!)?.courses[0]?.title).toBe("replacement course"); }
    finally { client.clear(); }
  });
});
