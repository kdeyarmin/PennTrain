import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOfflineProgressCheckpoint, markOfflineProgressAttempt, queueOfflineProgress,
} from "./offlineCourseCache";

/**
 * A minimal fake of just the IndexedDB surface the progress-checkpoint functions touch,
 * following the pattern established in offlineServiceDraftCache.test.ts (Node's vitest
 * environment has no `indexedDB` global and this repo carries no fake-indexeddb dependency).
 *
 * This exists to pin the sync-receipt race: progress queued while a sync request is in
 * flight must not be stamped as synced by that request's receipt, because the receipt only
 * proves the percent that was actually sent reached the server.
 */
function fakeIndexedDB() {
  interface Store { data: Map<unknown, unknown>; keyPath: string | null }
  const stores = new Map<string, Store>();

  function fakeRequest<T>(resolveWith: () => T) {
    const req: { result: T | undefined; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } =
      { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      req.result = resolveWith();
      req.onsuccess?.();
    });
    return req;
  }

  function objectStore(name: string) {
    const store = stores.get(name);
    if (!store) throw new Error(`Unknown object store "${name}"`);
    return {
      get: (key: unknown) => fakeRequest(() => store.data.get(key)),
      put: (value: unknown, explicitKey?: unknown) => fakeRequest(() => {
        const key = store.keyPath ? (value as Record<string, unknown>)[store.keyPath] : explicitKey;
        store.data.set(key, value);
        return key;
      }),
    };
  }

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options?: { keyPath?: string }) => {
      stores.set(name, { data: new Map(), keyPath: options?.keyPath ?? null });
    },
    transaction: (_storeNames: string | string[], _mode?: string) => ({
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null as unknown,
      objectStore,
    }),
  };

  const open = () => {
    const req = {
      result: db,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      error: null as unknown,
    };
    queueMicrotask(() => {
      req.onupgradeneeded?.();
      queueMicrotask(() => req.onsuccess?.());
    });
    return req;
  };

  return { stub: { open } };
}

describe("markOfflineProgressAttempt sync receipts", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", fakeIndexedDB().stub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks only the sent percent as synced when newer progress was queued mid-flight", async () => {
    const sent = await queueOfflineProgress({ assignmentId: "a-1", percentComplete: 40, baseVersion: 3 });
    // The sync request for 40% is in flight when the learner advances to 70%.
    await queueOfflineProgress({ assignmentId: "a-1", percentComplete: 70, baseVersion: 3 });

    const receipt = await markOfflineProgressAttempt("a-1", "applied", 4, sent.percentComplete);

    expect(receipt.syncedPercent).toBe(40);
    expect(receipt.percentComplete).toBe(70);
    expect(receipt.baseVersion).toBe(4);
    // The 70% checkpoint still qualifies for its own sync pass.
    const stored = await getOfflineProgressCheckpoint("a-1");
    expect(stored?.percentComplete).toBeGreaterThan(stored?.syncedPercent ?? 100);
  });

  it("never lowers syncedPercent on a stale receipt", async () => {
    await queueOfflineProgress({ assignmentId: "a-2", percentComplete: 80, baseVersion: 5 });
    await markOfflineProgressAttempt("a-2", "applied", 6, 80);

    const receipt = await markOfflineProgressAttempt("a-2", "duplicate", 6, 50);

    expect(receipt.syncedPercent).toBe(80);
  });

  it("rotates the idempotency key and adopts the server version on conflict with pending progress", async () => {
    const queued = await queueOfflineProgress({ assignmentId: "a-3", percentComplete: 55, baseVersion: 2 });

    const receipt = await markOfflineProgressAttempt("a-3", "conflict", 9, queued.percentComplete);

    expect(receipt.syncedPercent).toBe(0);
    expect(receipt.baseVersion).toBe(9);
    expect(receipt.idempotencyKey).not.toBe(queued.idempotencyKey);
    expect(receipt.lastOutcome).toBe("conflict");
  });

  it("keeps the idempotency key on conflict when nothing is pending", async () => {
    const queued = await queueOfflineProgress({ assignmentId: "a-4", percentComplete: 30, baseVersion: 1 });
    await markOfflineProgressAttempt("a-4", "applied", 2, 30);

    const receipt = await markOfflineProgressAttempt("a-4", "conflict", 3, 30);

    expect(receipt.idempotencyKey).toBe(queued.idempotencyKey);
    expect(receipt.baseVersion).toBe(2);
  });
});
