import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isExpired, isObservationExpired, isUnsyncedDraftOverdue, listServiceDraftEntries,
  purgeExpiredServiceDrafts, readAllServiceDrafts, readAllServiceDraftsWithFailures,
  readServiceDraft, saveServiceDraft, UNSYNCED_PURGE_AFTER_MS,
} from "./offlineServiceDraftCache";
import type { DraftListEntry, ObservationDraftListEntry } from "./offlineServiceDraftCache";
import type {
  OfflineChangeObservationDraft, OfflineServiceDraft, OfflineUnscheduledServiceDraft,
} from "./offlineServiceDraftSafety";

function unscheduledDraft(
  overrides: Partial<OfflineUnscheduledServiceDraft> = {},
): OfflineUnscheduledServiceDraft {
  return {
    kind: "unscheduled_service",
    draftId: "unsched-1",
    residentId: "resident-1",
    residentDisplayLabel: "Jamie Resident - Room 12",
    organizationId: "org-1",
    facilityId: "facility-1",
    profileId: "profile-1",
    serviceKind: "unscheduled_toileting",
    occurredAt: "2026-08-02T12:30:00.000Z",
    durationMinutes: 10,
    requiresTwoStaff: false,
    note: "Assisted after a fall risk moment.",
    idempotencyKey: "idem-unsched-1",
    createdAt: "2026-08-02T12:31:00.000Z",
    updatedAt: "2026-08-02T12:31:00.000Z",
    syncState: "draft",
    lastSyncOutcome: null,
    lastSyncError: null,
    ...overrides,
  };
}

function changeObservationDraft(
  overrides: Partial<OfflineChangeObservationDraft> = {},
): OfflineChangeObservationDraft {
  return {
    kind: "change_observation",
    draftId: "obs-1",
    eventId: "event-1",
    residentDisplayLabel: "Jamie Resident - Room 12",
    eventLabel: "Mobility Decline",
    organizationId: "org-1",
    facilityId: "facility-1",
    profileId: "profile-1",
    observedAt: "2026-08-03T03:00:00.000Z",
    observations: "Transferred with two-person assist, no buckling.",
    actionTaken: "Reminded to use the call bell.",
    supervisorNotified: true,
    idempotencyKey: "idem-obs-1",
    createdAt: "2026-08-03T03:01:00.000Z",
    updatedAt: "2026-08-03T03:01:00.000Z",
    syncState: "draft",
    lastSyncOutcome: null,
    lastSyncError: null,
    ...overrides,
  };
}

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
      // listServiceDraftEntries reads the whole store in one request; readAllServiceDrafts is
      // built on it, so the read-everything path needs this to be testable at all.
      getAll: () => fakeRequest(() => [...store.data.values()]),
      // purgeExpiredServiceDrafts deletes inside one readwrite transaction and waits on its
      // oncomplete, so the purge policy cannot be exercised end-to-end without this.
      delete: (key: unknown) => fakeRequest(() => { store.data.delete(key); }),
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
    readStoredRecord: (draftId: string) => stores.get("service-drafts")?.data.get(draftId) as Record<string, unknown> | undefined,
    writeStoredRecord: (draftId: string, record: Record<string, unknown>) => {
      stores.get("service-drafts")!.data.set(draftId, record);
    },
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

describe("draft kinds share one store (BACKLOG.md E5 Tiers 2-3)", () => {
  let fake: ReturnType<typeof fakeIndexedDB>;
  const identity = { organizationId: "org-1", profileId: "profile-1", role: "employee" };

  beforeEach(async () => {
    fake = fakeIndexedDB();
    vi.stubGlobal("indexedDB", fake.stub);
    await fake.seedDeviceKey();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("round-trips an unscheduled draft, which has no task at all", async () => {
    await saveServiceDraft(unscheduledDraft());
    await expect(readServiceDraft("unsched-1", identity)).resolves.toMatchObject({
      kind: "unscheduled_service",
      residentId: "resident-1",
      serviceKind: "unscheduled_toileting",
    });
  });

  it("binds an unscheduled draft's envelope to the resident, so another identity cannot open it", async () => {
    await saveServiceDraft(unscheduledDraft());
    await expect(
      readServiceDraft("unsched-1", { ...identity, profileId: "someone-else" }),
    ).rejects.toThrow();
  });

  // THE migration hazard. Records written before Tier 2 have neither `kind` nor `scopeId`, and
  // their envelope was sealed against a scope built from taskId. If a reader stopped falling back
  // to taskId, every not-yet-synced draft already on an aide's device would fail to decrypt -- on
  // the one device holding the only copy of that documentation, with no network to re-fetch it.
  it("still decrypts a pre-Tier-2 record that has neither kind nor scopeId", async () => {
    await saveServiceDraft(draft());
    const stored = fake.readStoredRecord("draft-1")!;
    expect(stored.scopeId).toBe("task-1");
    expect(stored.kind).toBe("service_task");

    const legacy = { ...stored };
    delete legacy.scopeId;
    delete legacy.kind;
    fake.writeStoredRecord("draft-1", legacy);

    await expect(readServiceDraft("draft-1", identity)).resolves.toMatchObject({
      draftId: "draft-1",
      taskId: "task-1",
      response: "completed_as_planned",
    });
  });

  // The other half of that guarantee: a service draft written NOW must produce the same scope
  // string Tier 1 produced, or old and new records would need two different read paths.
  it("writes a service draft's scopeId equal to its taskId, keeping the scope string unchanged", async () => {
    await saveServiceDraft(draft({ draftId: "draft-2", taskId: "task-2", idempotencyKey: "idem-2" }));
    const stored = fake.readStoredRecord("draft-2")!;
    expect(stored.scopeId).toBe(stored.taskId);
    expect(stored.envelope).toMatchObject({ additionalData: "org-1:profile-1:task-2:draft-2" });
  });

  it("round-trips a change observation, which has no task and no resident id", async () => {
    await saveServiceDraft(changeObservationDraft());
    await expect(readServiceDraft("obs-1", identity)).resolves.toMatchObject({
      kind: "change_observation",
      eventId: "event-1",
      observations: "Transferred with two-person assist, no buckling.",
      supervisorNotified: true,
    });
  });

  // Its subject is the EVENT -- which is why it is a third member of the union rather than a
  // variant of either existing kind. The plaintext taskId column stays empty for it, so the
  // panel's listing cannot mistake it for a task draft.
  it("binds a change observation's envelope to its event, and leaves taskId unwritten", async () => {
    await saveServiceDraft(changeObservationDraft());
    const stored = fake.readStoredRecord("obs-1")!;
    expect(stored.taskId).toBeUndefined();
    expect(stored.scopeId).toBe("event-1");
    expect(stored.kind).toBe("change_observation");
    expect(stored.envelope).toMatchObject({ additionalData: "org-1:profile-1:event-1:obs-1" });
  });

  it("refuses to open a change observation under a different identity", async () => {
    await saveServiceDraft(changeObservationDraft());
    await expect(
      readServiceDraft("obs-1", { ...identity, organizationId: "another-org" }),
    ).rejects.toThrow();
  });

  // Codex review finding (P1). The double-charting window this closes is invisible in a diff: it
  // depends on a NEW idempotency key being minted per capture, so that a retry of a write whose
  // response was lost carries the SAME key and collapses to a duplicate server-side rather than
  // appending a second monitoring entry.
  //
  // Two properties make that work, and both live here. First, saving a draft must preserve the key
  // it was given rather than regenerating one -- an update (the sync path rewrites syncState) must
  // not mint a fresh key, or every retry would look new to the server.
  it("preserves a change observation's idempotency key across a re-save", async () => {
    const original = changeObservationDraft();
    await saveServiceDraft(original);
    const readBack = await readServiceDraft("obs-1", identity);
    expect(readBack).toMatchObject({ idempotencyKey: "idem-obs-1" });

    await saveServiceDraft({ ...(readBack as OfflineChangeObservationDraft), syncState: "error" });
    await expect(readServiceDraft("obs-1", identity)).resolves.toMatchObject({
      idempotencyKey: "idem-obs-1",
      syncState: "error",
    });
  });

  // Second, two separate captures must NOT share a key -- otherwise the server would collapse two
  // genuinely different observations into one. The guarantee is per-draft, not global.
  it("keeps two separate captures on distinct keys", async () => {
    await saveServiceDraft(changeObservationDraft());
    await saveServiceDraft(changeObservationDraft({
      draftId: "obs-2", idempotencyKey: "idem-obs-2", observations: "Second round, still steady.",
    }));
    const first = await readServiceDraft("obs-1", identity);
    const second = await readServiceDraft("obs-2", identity);
    expect((first as OfflineChangeObservationDraft).idempotencyKey)
      .not.toBe((second as OfflineChangeObservationDraft).idempotencyKey);
  });

  // Three kinds now share one keyPath-"draftId" store with no secondary index, so nothing about
  // adding this one required an IndexedDB version bump -- but the three must genuinely coexist
  // rather than the last write clobbering the others.
  it("keeps all three kinds side by side in the same store", async () => {
    await saveServiceDraft(draft());
    await saveServiceDraft(unscheduledDraft());
    await saveServiceDraft(changeObservationDraft());
    expect(fake.draftStoreHas("draft-1")).toBe(true);
    expect(fake.draftStoreHas("unsched-1")).toBe(true);
    expect(fake.draftStoreHas("obs-1")).toBe(true);
  });

  // One record that will not decrypt used to reject the whole read (Promise.all), which took out
  // the review list AND both sync paths -- so healthy, unsynced care documentation became
  // unreachable and unsyncable while the plaintext purge clock kept counting down on it. The
  // realistic trigger is an ordinary app upgrade: a release that tightens assertFloorDraftAllowed
  // turns drafts already on the device into throwing records.
  it("still returns the readable drafts when one record cannot be decrypted", async () => {
    await saveServiceDraft(draft());
    await saveServiceDraft(unscheduledDraft());
    const poisoned = fake.readStoredRecord("unsched-1")!;
    fake.writeStoredRecord("unsched-1", {
      ...poisoned,
      envelope: { ...(poisoned.envelope as Record<string, unknown>), ciphertext: "bm90LWEtY2lwaGVydGV4dA==" },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drafts = await readAllServiceDrafts(identity);
    expect(drafts.map((entry) => entry.draftId)).toEqual(["draft-1"]);
    // Dropped, not concealed: the skip is logged against the specific draft id.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unsched-1"),
      expect.anything(),
    );
    warn.mockRestore();
  });

  // Reviewed on #458. Logging the id to the console is not surfacing it. The header's count comes
  // from the plaintext entry lane, which still lists an unreadable record, while the list renders
  // only decrypted drafts -- so omitting it produced "N pending" above a row that never appeared,
  // a "Sync now" that attempted nothing and reported success, and no way to clear it before the
  // purge deadline. The id has to come back with the drafts for the panel to show it at all.
  it("reports the id of a record it could not decrypt, alongside the ones it could", async () => {
    await saveServiceDraft(draft());
    await saveServiceDraft(unscheduledDraft());
    const poisoned = fake.readStoredRecord("unsched-1")!;
    fake.writeStoredRecord("unsched-1", {
      ...poisoned,
      envelope: { ...(poisoned.envelope as Record<string, unknown>), ciphertext: "bm90LWEtY2lwaGVydGV4dA==" },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { drafts, unreadableIds } = await readAllServiceDraftsWithFailures(identity);
    expect(drafts.map((entry) => entry.draftId)).toEqual(["draft-1"]);
    expect(unreadableIds).toEqual(["unsched-1"]);
    warn.mockRestore();
  });
});

/**
 * BACKLOG.md I6. The purge deleted care documentation that had never been offered to the server.
 *
 * Both lanes used to call their purge from inside the query that lists drafts -- and the sync
 * manager waits on that query before it will start a run. So on a device that had been offline
 * since the note was written, the first thing the app did on open was age the note out, and the
 * first sync attempt happened after. An aide documenting a refusal on Friday evening, off shift
 * until Tuesday, lost the only copy of it without one attempt ever being made.
 *
 * The rule these tests pin is `draft` means no attempt has been made, so no clock is running --
 * enforced in the policy itself rather than by call ordering, because ordering is a convention the
 * next caller can break by accident.
 */
describe("expiry policy: a draft the server has never seen does not age out", () => {
  const NOW = Date.parse("2026-08-10T12:00:00.000Z");
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  function entry(overrides: Partial<DraftListEntry> = {}): DraftListEntry {
    return {
      draftId: "entry-1",
      taskId: "task-1",
      kind: "service_task",
      syncState: "draft",
      createdAt: ago(FIVE_DAYS_MS),
      updatedAt: ago(FIVE_DAYS_MS),
      ...overrides,
    };
  }

  function observationEntry(overrides: Partial<ObservationDraftListEntry> = {}): ObservationDraftListEntry {
    return {
      draftId: "obs-entry-1",
      residentId: "resident-1",
      syncState: "draft",
      createdAt: ago(FIVE_DAYS_MS),
      updatedAt: ago(FIVE_DAYS_MS),
      ...overrides,
    };
  }

  it("keeps a never-attempted service draft well past the 72-hour ceiling", () => {
    expect(FIVE_DAYS_MS).toBeGreaterThan(UNSYNCED_PURGE_AFTER_MS);
    expect(isExpired(entry(), NOW)).toBe(false);
  });

  // The clock is not removed, only started later: once a run has actually failed, the record has
  // been offered and refused, and 72 hours of that is the ceiling it always had.
  it("still expires a service draft whose sync attempt failed", () => {
    expect(isExpired(entry({ syncState: "error" }), NOW)).toBe(true);
  });

  it("still expires a service draft left mid-attempt", () => {
    expect(isExpired(entry({ syncState: "syncing" }), NOW)).toBe(true);
  });

  // The other half of I6: `error` is not only "the server said no". Both sync loops catch a thrown
  // fetch and store `error`, so one flaky moment used to convert a protected draft into an ageing
  // one and the same weekend-offline device lost it anyway.
  it("runs the 72 hours from the last attempt, not from when the note was written", () => {
    expect(isExpired(entry({
      syncState: "error", createdAt: ago(FIVE_DAYS_MS), updatedAt: ago(2 * 60 * 60 * 1000),
    }), NOW)).toBe(false);
    expect(isExpired(entry({
      syncState: "error", createdAt: ago(FIVE_DAYS_MS), updatedAt: ago(4 * 24 * 60 * 60 * 1000),
    }), NOW)).toBe(true);
  });

  it("leaves the needs-review ceiling alone -- a rejected draft has its own 7 days", () => {
    expect(isExpired(entry({ syncState: "rejected" }), NOW)).toBe(false);
    expect(isExpired(entry({ syncState: "rejected", createdAt: ago(8 * 24 * 60 * 60 * 1000) }), NOW)).toBe(true);
  });

  it("applies both rules to observation drafts, which share the device and the policy", () => {
    expect(isObservationExpired(observationEntry(), NOW)).toBe(false);
    expect(isObservationExpired(observationEntry({ syncState: "error" }), NOW)).toBe(true);
    expect(isObservationExpired(observationEntry({
      syncState: "error", updatedAt: ago(2 * 60 * 60 * 1000),
    }), NOW)).toBe(false);
  });

  // The cost of keeping an unsynced note indefinitely is that the caregiver has to be told. The
  // 24-hour warning is what makes the trade acceptable, so it must not have moved with the ceiling.
  it("still warns at 24 hours on a draft that is no longer purged", () => {
    expect(isUnsyncedDraftOverdue(entry({ createdAt: ago(25 * 60 * 60 * 1000) }), NOW)).toBe(true);
    expect(isUnsyncedDraftOverdue(entry({ createdAt: ago(23 * 60 * 60 * 1000) }), NOW)).toBe(false);
  });

  describe("through the purge itself", () => {
    let fake: ReturnType<typeof fakeIndexedDB>;

    beforeEach(async () => {
      fake = fakeIndexedDB();
      vi.stubGlobal("indexedDB", fake.stub);
      await fake.seedDeviceKey();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("deletes the failed draft and keeps the never-attempted one, at the same age", async () => {
      await saveServiceDraft(draft({
        draftId: "never-attempted", idempotencyKey: "idem-never",
        createdAt: ago(FIVE_DAYS_MS), updatedAt: ago(FIVE_DAYS_MS), syncState: "draft",
      }));
      await saveServiceDraft(draft({
        draftId: "attempted-and-failed", idempotencyKey: "idem-failed",
        createdAt: ago(FIVE_DAYS_MS), updatedAt: ago(FIVE_DAYS_MS), syncState: "error",
        lastSyncError: "Network request failed",
      }));

      await expect(purgeExpiredServiceDrafts(NOW)).resolves.toEqual(["attempted-and-failed"]);
      expect(fake.draftStoreHas("never-attempted")).toBe(true);
      expect(fake.draftStoreHas("attempted-and-failed")).toBe(false);
    });

    // Records already on a caregiver's device were written without the plaintext last-attempt
    // column. They have to keep the clock they had rather than read as never-attempted (immortal)
    // or as attempted-at-the-epoch (purged on the next tick).
    it("falls back to createdAt on a record written before the last-attempt column existed", async () => {
      await saveServiceDraft(draft({
        draftId: "legacy-record", idempotencyKey: "idem-legacy",
        createdAt: ago(FIVE_DAYS_MS), updatedAt: ago(FIVE_DAYS_MS), syncState: "error",
      }));
      const stored = { ...fake.readStoredRecord("legacy-record")! };
      delete stored.updatedAt;
      fake.writeStoredRecord("legacy-record", stored);

      const [entry] = await listServiceDraftEntries();
      expect(entry.updatedAt).toBe(entry.createdAt);
      await expect(purgeExpiredServiceDrafts(NOW)).resolves.toEqual(["legacy-record"]);
    });
  });
});
