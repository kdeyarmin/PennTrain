import { QueryClient, QueryObserver, onlineManager, type QueryObserverOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(), useMutation: vi.fn(), client: null as QueryClient | null,
  records: [] as Array<{ assignmentId: string; expiresAt: string }>,
  bundle: { data: { course: { title: "Downloaded training" } } },
  checkpoint: { assignmentId: "assignment-1", percentComplete: 40 } as { assignmentId: string; percentComplete: number } | undefined,
}));
vi.mock("@tanstack/react-query", async original => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: harness.useQuery,
  useMutation: harness.useMutation,
  useQueryClient: () => harness.client,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "employee-1", organizationId: "org-1", role: "employee" } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/offlineCourseCache", () => ({
  listCachedCourseBundles: async () => harness.records,
  readCachedCourseBundle: async () => harness.bundle,
  getOfflineProgressCheckpoint: async () => harness.checkpoint,
  getOfflineDeviceMetadata: async () => undefined,
  removeCachedCourseBundle: async (assignmentId: string) => {
    harness.records = harness.records.filter(record => record.assignmentId !== assignmentId);
  },
  wipeOfflineLearning: async () => { harness.records = []; },
  cacheCourseBundle: vi.fn(), initializeOfflineDevice: vi.fn(), markOfflineProgressAttempt: vi.fn(),
  queueOfflineProgress: vi.fn(), saveOfflineDeviceId: vi.fn(),
}));

import { useOfflineCourseBundle, useOfflineCourseLibrary, useOfflineProgress, useRemoveOfflineCourse, useWipeOfflineCourses } from "./useOfflineLearning";

let client: QueryClient;
let unsubscribers: Array<() => void>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { networkMode: "always" } } });
  harness.client = client;
  harness.records = [{ assignmentId: "assignment-1", expiresAt: "2099-01-01T00:00:00Z" }];
  harness.checkpoint = { assignmentId: "assignment-1", percentComplete: 40 };
  harness.useQuery.mockReset();
  harness.useMutation.mockReset();
  unsubscribers = [];
  vi.stubGlobal("indexedDB", {});
  onlineManager.setOnline(false);
});

afterEach(() => {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  client.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

function observeLastQuery() {
  const options = harness.useQuery.mock.calls.at(-1)![0] as QueryObserverOptions;
  const observer = new QueryObserver(client, options);
  unsubscribers.push(observer.subscribe(() => {}));
  return observer;
}

describe("downloaded learning while disconnected", () => {
  it.each([
    { name: "library", hook: () => useOfflineCourseLibrary(), expected: () => harness.records },
    { name: "bundle", hook: () => useOfflineCourseBundle("assignment-1"), expected: () => ({ record: harness.records[0], bundle: harness.bundle }) },
    { name: "progress", hook: () => useOfflineProgress("assignment-1"), expected: () => harness.checkpoint },
  ])("reads the local $name without waiting for reconnection", async ({ hook, expected }) => {
    hook();
    const observer = observeLastQuery();
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
    expect(onlineManager.isOnline()).toBe(false);
    expect(observer.getCurrentResult().data).toEqual(expected());
  });

  it("treats a fresh download without a checkpoint as a successful empty read", async () => {
    harness.checkpoint = undefined;
    useOfflineProgress("assignment-1");
    const observer = observeLastQuery();
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
    expect(observer.getCurrentResult().data).toBeNull();
  });

  it("removes a revoked course from an open reader and its checkpoint cache", async () => {
    useOfflineCourseBundle("assignment-1");
    const observer = observeLastQuery();
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
    client.setQueryData(["offline-course-progress", "assignment-1"], harness.checkpoint);
    client.setQueryData(["offline-course-bundle", "employee-1", "assignment-2"], { unrelated: true });
    useRemoveOfflineCourse();
    const mutation = harness.useMutation.mock.calls.at(-1)![0];
    await mutation.mutationFn("assignment-1");
    await mutation.onSuccess(undefined, "assignment-1");
    expect(observer.getCurrentResult().status).toBe("error");
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(client.getQueryData(["offline-course-progress", "assignment-1"])).toBeUndefined();
    expect(client.getQueryData(["offline-course-bundle", "employee-1", "assignment-2"])).toEqual({ unrelated: true });
  });

  it("clears decrypted bundles and checkpoint caches after a device wipe", async () => {
    const bundleKey = ["offline-course-bundle", "employee-1", "assignment-1"];
    const checkpointKey = ["offline-course-progress", "assignment-1"];
    client.setQueryData(bundleKey, harness.bundle);
    client.setQueryData(checkpointKey, harness.checkpoint);
    useWipeOfflineCourses();
    const mutation = harness.useMutation.mock.calls.at(-1)![0];
    await mutation.mutationFn();
    await mutation.onSuccess();
    expect(client.getQueryData(bundleKey)).toBeUndefined();
    expect(client.getQueryData(checkpointKey)).toBeUndefined();
  });
});
