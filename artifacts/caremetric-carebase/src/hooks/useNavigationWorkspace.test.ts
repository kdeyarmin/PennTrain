import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient, type MutationObserverOptions } from "@tanstack/react-query";
import { useNavigationWorkspace, type NavigationPreference } from "./useProductExperience";

type Options = MutationObserverOptions<NavigationPreference, Error, unknown>;
const h = vi.hoisted(() => ({
  user: { id: "account-a", organizationId: "org", role: "employee" },
  client: undefined as QueryClient | undefined,
  mutations: [] as Options[], from: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => h.client,
  useQuery: () => ({ data: null }),
  useMutation: (options: Options) => { h.mutations.push(options); return {}; },
}));
function options() { h.mutations = []; useNavigationWorkspace(); return h.mutations; }
const row = (id: string): NavigationPreference => ({ profile_id: id, organization_id: "org",
  favorite_paths: ["/app/training"], recent_paths: [], created_at: "2026-09-26", updated_at: "2026-09-26" });
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "account-a", organizationId: "org", role: "employee" }; });

describe("navigation preference save ownership", () => {
  it.each([[0, ["/app/training"]], [1, { path: "/app/training", label: "Training" }]])(
    "keeps a delayed mutation %i receipt in its original account cache after options change", async (index, variables) => {
      const client = new QueryClient(); h.client = client;
      let finish!: (value: unknown) => void;
      const pending = new Promise(resolve => { finish = resolve; });
      const single = vi.fn(() => pending);
      h.from.mockReturnValue({ upsert: () => ({ select: () => ({ single }) }) });
      h.rpc.mockReturnValue(pending);
      client.setQueryData(["navigation_preferences", "account-b"], row("account-b"));
      const observer = new MutationObserver(client, options()[index as number]);
      const save = observer.mutate(variables);
      await vi.waitFor(() => expect(index === 0 ? single : h.rpc).toHaveBeenCalledOnce());
      h.user = { ...h.user, id: "account-b" };
      observer.setOptions(options()[index as number]);
      finish({ data: row("account-a"), error: null }); await save;
      try {
        expect(client.getQueryData(["navigation_preferences", "account-a"])).toEqual(row("account-a"));
        expect(client.getQueryData(["navigation_preferences", "account-b"])).toEqual(row("account-b"));
      } finally { client.clear(); }
    },
  );
});
