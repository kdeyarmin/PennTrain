import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient, type MutationObserverOptions, type QueryKey } from "@tanstack/react-query";
import { useListNotifications, useUnreadNotificationCount, useMarkNotificationRead, useMarkAllNotificationsRead, useListNotificationDeliveries } from "./useNotifications";

type Options = MutationObserverOptions<unknown, Error, unknown, unknown>;
type QueryOptions = { queryKey: QueryKey; enabled?: boolean; queryFn: (context: { signal: AbortSignal }) => Promise<unknown> };
const h = vi.hoisted(() => ({
  user: { id: "account-a", organizationId: "org-a", role: "employee" } as { id: string; organizationId: string; role: string } | null,
  client: undefined as QueryClient | undefined, mutations: [] as Options[], queries: [] as QueryOptions[], rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => h.client,
  useQuery: (options: QueryOptions) => { h.queries.push(options); return options; },
  useMutation: (options: Options) => { h.mutations.push(options); return options; },
}));
const notice = (id: string, profile = "account-a", read_at: string | null = null) => ({
  id, profile_id: profile, organization_id: "org-a", title: id, body: null, link: null,
  notification_type: "training_due_soon", read_at, created_at: "2026-09-27T05:00:00Z",
});
function queries() { h.queries = []; useListNotifications(); useUnreadNotificationCount(); useListNotificationDeliveries(); return h.queries; }
function options(all: boolean) { h.mutations = []; if (all) useMarkAllNotificationsRead(); else useMarkNotificationRead(); return h.mutations[0]; }
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "account-a", organizationId: "org-a", role: "employee" }; });

describe("notification account and receipt ownership", () => {
  it("isolates list, unread count and delivery history across account and permission changes", () => {
    const first = queries().map(query => query.queryKey);
    h.user = { id: "account-b", organizationId: "org-b", role: "employee" };
    const second = queries().map(query => query.queryKey);
    second.forEach((key, index) => expect(key).not.toEqual(first[index]));
    h.user = { ...h.user, role: "auditor" };
    queries().forEach((query, index) => expect(query.queryKey).not.toEqual(second[index]));
  });
  it("does not start signed-in inbox or delivery requests without an account", () => {
    h.user = null;
    queries().forEach(query => expect(query.enabled).toBe(false));
  });
  it.each([false, true])("does not restore account A after a late %s mark-read failure in account B", async all => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); h.client = client;
    const [listA, countA] = queries();
    client.setQueryData(listA.queryKey, [notice("private-a")]); client.setQueryData(countA.queryKey, 1);
    let finish!: (value: unknown) => void;
    h.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const observer = new MutationObserver(client, options(all));
    const save = observer.mutate(all ? undefined : "private-a").catch(error => error);
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    client.clear();
    h.user = { id: "account-b", organizationId: "org-b", role: "employee" };
    const [listB, countB] = queries(); const rowsB = [notice("private-b", "account-b")];
    client.setQueryData(listB.queryKey, rowsB); client.setQueryData(countB.queryKey, 1);
    observer.setOptions(options(all));
    finish({ error: new Error("Connection failed") }); await save;
    try {
      expect(client.getQueryData(listB.queryKey)).toEqual(rowsB);
      expect(client.getQueryData(countB.queryKey)).toBe(1);
      expect(client.getQueryCache().getAll().some(query => JSON.stringify(query.state.data).includes("private-a"))).toBe(false);
    } finally { client.clear(); }
  });
  it.each([false, true])("preserves newer server data when a pending %s mark-read request fails", async all => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); h.client = client;
    const [list, count] = queries(); client.setQueryData(list.queryKey, [notice("old")]); client.setQueryData(count.queryKey, 1);
    let finish!: (value: unknown) => void;
    h.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const observer = new MutationObserver(client, options(all));
    const save = observer.mutate(all ? undefined : "old").catch(error => error);
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    const latest = [notice("new-arrival"), notice("old", "account-a", "2026-09-27T05:02:00Z")];
    client.setQueryData(list.queryKey, latest); client.setQueryData(count.queryKey, 1);
    finish({ error: new Error("Response lost") }); await save;
    try { expect(client.getQueryData(list.queryKey)).toEqual(latest); expect(client.getQueryData(count.queryKey)).toBe(1); }
    finally { client.clear(); }
  });
});
