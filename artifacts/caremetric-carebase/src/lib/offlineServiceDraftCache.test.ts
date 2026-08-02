import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveServiceDraft } from "./offlineServiceDraftCache";
import type { OfflineServiceDraft } from "./offlineServiceDraftSafety";

/**
 * A minimal, purpose-built fake of just the IndexedDB surface offlineServiceDraftCache.ts touches.
 * Node's vitest environment has no `indexedDB` global at all, and this repo carries no
 * fake-indexeddb dependency -- offlineCourseCache.ts, the sibling store this module's header comment
 * says it mirrors, is equally untested for the same reason.
 *
 * This exists specifically to reproduce the Codex review finding on saveServiceDraft: a `put`
 * request can fire its own onsuccess and then have the transaction it belongs to abort instead of
 * firing oncomplete (e.g. a QuotaExceededError surfacing only when IndexedDB actually flushes to
 * disk, well after every request already reported success) -- with no further event on that
 * already-succeeded request. `forceNextWriteAbort` models exactly that: the write still lands in the
 * fake store (mirroring how a request "succeeds" against the transaction's in-memory view before a
 * commit failure), but the owning transaction reports onabort, never oncomplete.
 */
function fakeIndexedDB() {
  interface Store { data: Map<unknown, unknown>; keyPath: string | null }
  const stores = new Map<string, Store>();
  let forceNextWriteAbort = false;

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
    transaction: (_storeNames: string | string[], mode?: string) => {
      const shouldAbort = mode === "readwrite" && forceNextWriteAbort;
      if (mode === "readwrite") forceNextWriteAbort = false;
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null as unknown,
        objectStore,
      };
      // Settles two microtask turns after creation -- comfortably after the single put() request
      // saveServiceDraft issues (synchronously, in the same tick this transaction is created) has
      // already fired its own onsuccess, exactly reproducing "the request succeeded, the transaction
      // didn't."
      queueMicrotask(() => queueMicrotask(() => {
        if (shouldAbort) {
          tx.error = new Error("Simulated QuotaExceededError at commit");
          tx.onabort?.();
        } else {
          tx.oncomplete?.();
        }
      }));
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

  return {
    stub: { open },
    forceNextWriteAbort: (value: boolean) => { forceNextWriteAbort = value; },
    seedDeviceKey: async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      // Pre-create the stores directly (bypassing a transaction) so the key is readable the moment
      // saveServiceDraft's own openDatabase() call resolves. openDatabase's onupgradeneeded handler
      // guards every createObjectStore call behind objectStoreNames.contains(), so finding these
      // already present when it fires is a harmless no-op, not a duplicate-store error.
      db.createObjectStore("device-key");
      db.createObjectStore("metadata");
      db.createObjectStore("service-drafts", { keyPath: "draftId" });
      stores.get("device-key")!.data.set("content", key);
    },
    draftStoreHas: (draftId: string) => stores.get("service-drafts")?.data.has(draftId) ?? false,
  };
}

function draft(overrides: Partial<OfflineServiceDraft> = {}): OfflineServiceDraft {
  return {
    draftId: "draft-1",
    taskId: "task-1",
    residentId: "resident-1",
    residentDisplayLabel: "Jamie Resident · Room 12",
    organizationId: "org-1",
    facilityId: "facility-1",
    profileId: "profile-1",
    serviceName: "Bathing assistance",
    scheduledStart: "2026-08-02T13:00:00.000Z",
    scheduledEnd: "2026-08-02T14:00:00.000Z",
    taskKind: "scheduled_care",
    acceptableResponses: ["completed_as_planned"],
    refusalHandling: null,
    response: "completed_as_planned",
    exceptionDetails: {},
    idempotencyKey: "idem-1",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    syncState: "draft",
    lastSyncOutcome: null,
    lastSyncError: null,
    ...overrides,
  };
}

describe("saveServiceDraft transaction safety", () => {
  let fake: ReturnType<typeof fakeIndexedDB>;

  beforeEach(async () => {
    fake = fakeIndexedDB();
    vi.stubGlobal("indexedDB", fake.stub);
    await fake.seedDeviceKey();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves once the write transaction actually completes", async () => {
    await expect(saveServiceDraft(draft())).resolves.toMatchObject({ draftId: "draft-1" });
    expect(fake.draftStoreHas("draft-1")).toBe(true);
  });

  it("rejects, rather than silently resolving, when the put succeeds but its transaction later aborts", async () => {
    fake.forceNextWriteAbort(true);
    await expect(saveServiceDraft(draft())).rejects.toThrow();
  });
});
