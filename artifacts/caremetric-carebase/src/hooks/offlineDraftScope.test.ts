import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import type { OfflineFloorFacilityScope } from "@/lib/offlineServiceDraftCache";
import {
  useSyncAllOfflineServiceDrafts, useSyncOfflineServiceDraft, useUnsyncedServiceDrafts, useUnsyncedServiceDraftEntries,
} from "./useOfflineServiceDrafts";
import {
  useSyncAllOfflineObservationDrafts, useSyncOfflineObservationDraft, useUnsyncedObservationDrafts, useUnsyncedObservationDraftEntries,
} from "./useOfflineObservationDrafts";

interface QueryOptions { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; networkMode?: "online" | "always" | "offlineFirst" }
const h = vi.hoisted(() => ({
  user: { id: "employee-1", organizationId: "org-1", role: "employee" },
  scope: undefined as OfflineFloorFacilityScope | undefined,
  query: undefined as QueryOptions | undefined,
  mutation: undefined as { mutationFn: (input?: string) => Promise<unknown> } | undefined,
  invalidate: vi.fn(),
  serviceRead: vi.fn(),
  serviceSyncRead: vi.fn(),
  observationRead: vi.fn(),
  serviceEntries: vi.fn(), observationEntries: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user, offlineFacilityScope: h.scope }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: QueryOptions) => { h.query = options; return {}; },
  useMutation: (options: typeof h.mutation) => { h.mutation = options; return {}; },
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock("@/lib/offlineServiceDraftCache", async (original) => ({
  ...await original<typeof import("@/lib/offlineServiceDraftCache")>(),
  readAllServiceDraftsWithFailures: h.serviceRead,
  readAllServiceDrafts: h.serviceSyncRead,
  readAllObservationDrafts: h.observationRead,
  listServiceDraftEntries: h.serviceEntries,
  listObservationDraftEntries: h.observationEntries,
}));

function queryFor(hook: () => unknown): QueryOptions {
  hook();
  return h.query!;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "employee-1", organizationId: "org-1", role: "employee" };
  h.scope = { facilityIds: ["home"], isCurrent: () => true };
  h.serviceRead.mockResolvedValue({ drafts: [], unreadableIds: [] });
  h.serviceSyncRead.mockResolvedValue([]);
  h.observationRead.mockResolvedValue([]);
  h.serviceEntries.mockResolvedValue([]); h.observationEntries.mockResolvedValue([]);
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => { onlineManager.setOnline(true); vi.unstubAllGlobals(); });

describe("offline draft scope wiring", () => {
  it.each([
    ["service entries", useUnsyncedServiceDraftEntries, h.serviceEntries],
    ["service full records", useUnsyncedServiceDrafts, h.serviceRead],
    ["observation entries", useUnsyncedObservationDraftEntries, h.observationEntries],
    ["observation full records", useUnsyncedObservationDrafts, h.observationRead],
  ] as const)("reads local %s even while React Query is offline", async (_kind, hook, read) => {
    onlineManager.setOnline(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = queryFor(hook);
    const request = client.fetchQuery(query);
    void request.catch(() => undefined);
    try {
      expect(client.getQueryState(query.queryKey)?.fetchStatus).not.toBe("paused");
      await request;
      expect(read).toHaveBeenCalledOnce();
    } finally {
      client.clear();
    }
  });

  it.each([
    ["service", useUnsyncedServiceDrafts, h.serviceRead, "offline-service-drafts"],
    ["observation", useUnsyncedObservationDrafts, h.observationRead, "offline-observation-drafts"],
  ] as const)("reconciles %s panel reads and refreshes the remaining entry count", async (_kind, hook, read, key) => {
    const query = queryFor(hook);
    await query.queryFn();
    expect(read).toHaveBeenCalledWith({ profileId: "employee-1", organizationId: "org-1", role: "employee" }, h.scope);
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: [key, "entries"] });
    const scopedKey = query.queryKey;
    h.scope = undefined;
    expect(queryFor(hook).queryKey).not.toEqual(scopedKey);
    h.scope = { facilityIds: ["home"], isCurrent: () => true };
    h.user = { ...h.user, organizationId: "replacement-org" };
    expect(queryFor(hook).queryKey).not.toEqual(scopedKey);
  });

  it.each([
    ["service", useUnsyncedServiceDrafts, h.serviceRead],
    ["observation", useUnsyncedObservationDrafts, h.observationRead],
  ] as const)("cannot publish an earlier unknown-scope %s result into the resolved-scope query", async (_kind, hook, read) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let finishOld!: (value: unknown) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    h.scope = undefined;
    const oldQuery = queryFor(hook);
    const oldRequest = client.fetchQuery(oldQuery);
    h.scope = { facilityIds: ["home"], isCurrent: () => true };
    read.mockResolvedValueOnce(["allowed-only"]);
    const currentQuery = queryFor(hook);
    await expect(client.fetchQuery(currentQuery)).resolves.toEqual(["allowed-only"]);
    finishOld(["revoked-note-from-earlier-read"]);
    await oldRequest;
    expect(client.getQueryData(currentQuery.queryKey)).toEqual(["allowed-only"]);
    client.clear();
  });

  it.each([
    ["single service", useSyncOfflineServiceDraft, h.serviceSyncRead],
    ["all services", useSyncAllOfflineServiceDrafts, h.serviceSyncRead],
    ["single observation", useSyncOfflineObservationDraft, h.observationRead],
    ["all observations", useSyncAllOfflineObservationDrafts, h.observationRead],
  ] as const)("reconciles the %s sync read before sending a retained draft", async (_kind, hook, read) => {
    read.mockRejectedValueOnce(new DOMException("Scope was replaced", "AbortError"));
    hook();
    await expect(h.mutation!.mutationFn("draft-1")).rejects.toThrow("Scope was replaced");
    expect(read).toHaveBeenCalledWith({ profileId: "employee-1", organizationId: "org-1", role: "employee" }, h.scope);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
