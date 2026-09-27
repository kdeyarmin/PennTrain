import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOfflineProgressCheckpoint, initializeOfflineDevice, markOfflineProgressAttempt, queueOfflineProgress,
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
  let writeTail = Promise.resolve();

  function fakeRequest<T>(resolveWith: () => T, ready = Promise.resolve()) {
    const req: { result: T | undefined; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } =
      { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(async () => {
      await ready;
      req.result = resolveWith();
      req.onsuccess?.();
    });
    return req;
  }

  function objectStore(name: string, ready: Promise<void>) {
    const store = stores.get(name);
    if (!store) throw new Error(`Unknown object store "${name}"`);
    return {
      get: (key: unknown) => fakeRequest(() => store.data.get(key), ready),
      put: (value: unknown, explicitKey?: unknown) => fakeRequest(() => {
        const key = store.keyPath ? (value as Record<string, unknown>)[store.keyPath] : explicitKey;
        store.data.set(key, value);
        return key;
      }, ready),
    };
  }

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options?: { keyPath?: string }) => {
      stores.set(name, { data: new Map(), keyPath: options?.keyPath ?? null });
    },
    transaction: (_storeNames: string | string[], _mode?: string) => {
      // IndexedDB serializes overlapping readwrite transactions. Model that lock so a
      // single-transaction read/modify/write is distinguishable from two unsafe transactions.
      const ready = _mode === "readwrite" ? writeTail : Promise.resolve();
      let release: (() => void) | undefined;
      let aborted = false;
      if (_mode === "readwrite") writeTail = new Promise<void>(resolve => { release = resolve; });
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null as unknown,
        objectStore: (name: string) => objectStore(name, ready),
        abort: () => { aborted = true; tx.onabort?.(); release?.(); },
      };
      // initializeOfflineDevice waits on oncomplete for the write txn.
      setTimeout(async () => { await ready; if (!aborted) tx.oncomplete?.(); release?.(); }, 0);
      return tx;
    },
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

  it("allocates distinct checkpoint sequences for overlapping lesson saves", async () => {
    const saved = await Promise.all([
      queueOfflineProgress({ assignmentId: "parallel", percentComplete: 40, baseVersion: 3 }),
      queueOfflineProgress({ assignmentId: "parallel", percentComplete: 70, baseVersion: 3 }),
    ]);
    expect(saved.map(checkpoint => checkpoint.clientSequence)).toEqual([1, 2]);
    expect((await getOfflineProgressCheckpoint("parallel"))?.percentComplete).toBe(70);
  });

  it("never overwrites a further checkpoint when an earlier lesson save arrives later", async () => {
    const [further, earlier] = await Promise.all([
      queueOfflineProgress({ assignmentId: "reverse", percentComplete: 70, baseVersion: 3 }),
      queueOfflineProgress({ assignmentId: "reverse", percentComplete: 40, baseVersion: 3 }),
    ]);
    expect(earlier).toEqual(further);
    expect((await getOfflineProgressCheckpoint("reverse"))?.percentComplete).toBe(70);
  });

  it("merges a sync receipt and a concurrent lesson save without losing either", async () => {
    await queueOfflineProgress({ assignmentId: "receipt-race", percentComplete: 40, baseVersion: 3 });
    await Promise.all([
      markOfflineProgressAttempt("receipt-race", "applied", 4, 40),
      queueOfflineProgress({ assignmentId: "receipt-race", percentComplete: 70, baseVersion: 3 }),
    ]);
    expect(await getOfflineProgressCheckpoint("receipt-race")).toMatchObject({ percentComplete: 70, syncedPercent: 40, baseVersion: 4, clientSequence: 2 });
  });

  it("keeps the newer server version when an older receipt settles last", async () => {
    await queueOfflineProgress({ assignmentId: "version-race", percentComplete: 80, baseVersion: 5 });
    await markOfflineProgressAttempt("version-race", "applied", 8, 80);
    expect(await markOfflineProgressAttempt("version-race", "duplicate", 6, 40)).toMatchObject({ baseVersion: 8, syncedPercent: 80 });
  });

  it.each([2, 3])("keeps the successful returned outcome when a conflict replay settles after sync version %i", async appliedVersion => {
    await queueOfflineProgress({ assignmentId: "late-conflict", percentComplete: 40, baseVersion: 1 });
    await markOfflineProgressAttempt("late-conflict", "conflict", 2, 40);
    await queueOfflineProgress({ assignmentId: "late-conflict", percentComplete: 70, baseVersion: 2 });
    const synced = await markOfflineProgressAttempt("late-conflict", "applied", appliedVersion, 70);
    // Another tab's replay of the old conflict arrives after the retry has succeeded.
    const late = await markOfflineProgressAttempt("late-conflict", "conflict", 2, 40);
    expect(late).toEqual(synced);
    expect(late.lastOutcome).toBe("applied"); // OfflineCourse uses this returned value for its toast.
  });

  it("does not rotate a newer pending checkpoint for an already resolved conflict", async () => {
    await queueOfflineProgress({ assignmentId: "pending-after-sync", percentComplete: 70, baseVersion: 2 });
    await markOfflineProgressAttempt("pending-after-sync", "applied", 3, 70);
    const pending = await queueOfflineProgress({ assignmentId: "pending-after-sync", percentComplete: 80, baseVersion: 3 });
    expect(await markOfflineProgressAttempt("pending-after-sync", "conflict", 2, 40)).toEqual(pending);
  });

  it.each(["rejected", "wipe_required"])("preserves terminal %s receipts even when progress was already synchronized", async outcome => {
    await queueOfflineProgress({ assignmentId: "closed-after-sync", percentComplete: 70, baseVersion: 2 });
    await markOfflineProgressAttempt("closed-after-sync", "applied", 3, 70);
    expect(await markOfflineProgressAttempt("closed-after-sync", outcome, 3, 70)).toMatchObject({ lastOutcome: outcome, syncedPercent: 70, baseVersion: 3 });
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

  it("rotates the idempotency key, sequence, and base version on conflict with pending progress", async () => {
    const queued = await queueOfflineProgress({ assignmentId: "a-3", percentComplete: 55, baseVersion: 2 });

    const receipt = await markOfflineProgressAttempt("a-3", "conflict", 9, queued.percentComplete);

    expect(receipt.syncedPercent).toBe(0);
    expect(receipt.baseVersion).toBe(9);
    expect(receipt.idempotencyKey).not.toBe(queued.idempotencyKey);
    // The conflict receipt consumed (device, clientSequence) in the unique receipt
    // ledger; a retry on the same sequence would violate that constraint server-side.
    expect(receipt.clientSequence).toBe(queued.clientSequence + 1);
    expect(receipt.lastOutcome).toBe("conflict");
  });

  it("keeps the idempotency key on conflict when nothing is pending", async () => {
    const queued = await queueOfflineProgress({ assignmentId: "a-4", percentComplete: 30, baseVersion: 1 });
    await markOfflineProgressAttempt("a-4", "applied", 2, 30);

    const receipt = await markOfflineProgressAttempt("a-4", "conflict", 3, 30);

    expect(receipt.idempotencyKey).toBe(queued.idempotencyKey);
    expect(receipt.clientSequence).toBe(queued.clientSequence);
    expect(receipt.baseVersion).toBe(2);
    expect(receipt.lastOutcome).toBe("conflict");
  });
});

describe("initializeOfflineDevice first-write race", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", fakeIndexedDB().stub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("concurrent first inits share one device key and marker", async () => {
    const identity = { organizationId: "org-1", profileId: "user-1", role: "employee" as const };
    const [first, second] = await Promise.all([
      initializeOfflineDevice(identity),
      initializeOfflineDevice(identity),
    ]);
    expect(first.metadata.publicMarker).toBe(second.metadata.publicMarker);
    expect(first.metadata.fingerprintSha256).toBe(second.metadata.fingerprintSha256);
  });
});
