/**
 * Offline service documentation draft storage (BACKLOG.md E5, Tier 1).
 *
 * Raw IndexedDB, mirroring offlineCourseCache.ts's style -- this repo hand-rolls its own offline
 * stores rather than taking an `idb`/`dexie` dependency. This is a genuinely separate database from
 * the course-content store: its own name, its own non-extractable AES-GCM device key generated and
 * held in its own key object store, and its own encrypt/decrypt/scope logic written independently
 * here rather than imported from offlineLearning.ts. That file's envelope functions are wired to its
 * own payload assertion (an allowlist of four learning-content domains); reusing them for a resident
 * service-documentation draft would either reject every draft outright or -- worse -- require
 * loosening that assertion for a use case it was never meant to cover. The AES-GCM mechanics
 * (12-byte random IV per record, AAD-bound scope, non-extractable key) are mirrored; the store is not
 * extended.
 *
 * Only four fields sit in plaintext on disk -- draftId, taskId, syncState, createdAt -- because that
 * is everything the panel's listing and the purge/expiry clock need without decrypting anything.
 * Everything else (resident label, service name, the documentation response, exception-detail notes)
 * lives only inside the per-record ciphertext, which the full draft is serialized into
 * whole -- so the plaintext columns are a fast index into the store, not a second source of truth;
 * decrypting a record always returns the complete, authoritative draft.
 */
import {
  assertFloorDraftAllowed, draftKindOf, isChangeObservationDraft, isUnscheduledServiceDraft,
  NEEDS_REVIEW_DRAFT_STATES, UNRESOLVED_DRAFT_STATES,
  type OfflineDraftKind, type OfflineDraftSyncOutcome, type OfflineDraftSyncState,
  type OfflineFloorDraft,
} from "./offlineServiceDraftSafety";

const DATABASE_NAME = "carebase-offline-floor";
const DATABASE_VERSION = 1;
const KEY_STORE = "device-key";
const META_STORE = "metadata";
const DRAFT_STORE = "service-drafts";

export interface OfflineFloorIdentity { organizationId: string; profileId: string; role: string }
export interface OfflineFloorDeviceMetadata extends OfflineFloorIdentity {
  deviceId?: string;
  publicMarker: string;
  fingerprintSha256: string;
  createdAt: string;
}

interface StoredDraftEnvelope { version: 1; iv: string; ciphertext: string; additionalData: string }
interface StoredDraftRecord {
  draftId: string;
  /**
   * Present on service-task records, absent on the other two kinds. Kept rather than folded into
   * scopeId because records written before Tier 2 have only this field, and it is what their
   * envelope was sealed against.
   */
  taskId?: string;
  /**
   * What the envelope's AAD binds to: the task for a service draft, the resident for an
   * unscheduled one, the event for a change observation. Absent on pre-Tier-2 records, which fall
   * back to taskId -- see scopeSubjectOf.
   */
  scopeId?: string;
  /** Absent on pre-Tier-2 records, which are all service_task by definition. */
  kind?: OfflineDraftKind;
  syncState: OfflineDraftSyncState;
  createdAt: string;
  envelope: StoredDraftEnvelope;
}

export interface DraftListEntry {
  draftId: string;
  /** Undefined for the unscheduled and change-observation kinds, neither of which has a task. */
  taskId?: string;
  kind: OfflineDraftKind;
  syncState: OfflineDraftSyncState;
  createdAt: string;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Offline service draft storage request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const value = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    value.onupgradeneeded = () => {
      if (!value.result.objectStoreNames.contains(KEY_STORE)) value.result.createObjectStore(KEY_STORE);
      if (!value.result.objectStoreNames.contains(META_STORE)) value.result.createObjectStore(META_STORE);
      if (!value.result.objectStoreNames.contains(DRAFT_STORE)) value.result.createObjectStore(DRAFT_STORE, { keyPath: "draftId" });
    };
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Offline service draft storage is unavailable"));
  });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clearDatabase(db: IDBDatabase): Promise<void> {
  await Promise.all([KEY_STORE, META_STORE, DRAFT_STORE].map((store) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline service draft wipe failed"));
  })));
}

async function generateDraftDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * org:profile:subject:draftId -- decrypting under a different identity, subject, or draft id fails.
 *
 * The subject is the task for a service draft, the resident for an unscheduled one, and the event
 * for a change-of-condition observation. The FORMAT is deliberately unchanged from Tier 1: this
 * string is the AES-GCM additional-authenticated-data
 * an existing envelope was sealed against, so altering how a service draft's scope is composed
 * would make every not-yet-synced draft already on a device fail to decrypt -- on the one device
 * holding the only copy of that documentation.
 */
function draftScope(organizationId: string, profileId: string, subjectId: string, draftId: string): string {
  return `${organizationId}:${profileId}:${subjectId}:${draftId}`;
}

/** What a draft's envelope is bound to. */
function draftSubjectOf(draft: OfflineFloorDraft): string {
  if (isUnscheduledServiceDraft(draft)) return draft.residentId;
  if (isChangeObservationDraft(draft)) return draft.eventId;
  return draft.taskId;
}

/**
 * The same, recovered from a stored record. Pre-Tier-2 records have no scopeId, and taskId is what
 * their envelope was sealed with -- so the fallback is not a convenience, it is the compatibility.
 */
function scopeSubjectOf(record: StoredDraftRecord): string {
  const subject = record.scopeId ?? record.taskId;
  if (!subject) throw new Error(`Offline draft ${record.draftId} has no scope subject`);
  return subject;
}

async function encryptDraft(key: CryptoKey, draft: OfflineFloorDraft): Promise<StoredDraftEnvelope> {
  assertFloorDraftAllowed(draft);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = draftScope(
    draft.organizationId, draft.profileId, draftSubjectOf(draft), draft.draftId,
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(additionalData) },
    key,
    new TextEncoder().encode(JSON.stringify(draft)),
  );
  return { version: 1, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), additionalData };
}

async function decryptDraft(key: CryptoKey, envelope: StoredDraftEnvelope, expectedScope: string): Promise<OfflineFloorDraft> {
  if (envelope.version !== 1 || envelope.additionalData !== expectedScope) {
    throw new Error("Offline service draft scope changed; wipe required");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: new TextEncoder().encode(envelope.additionalData) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  const draft = JSON.parse(new TextDecoder().decode(plaintext)) as OfflineFloorDraft;
  assertFloorDraftAllowed(draft);
  return draft;
}

async function getDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const key = await request(db.transaction(KEY_STORE).objectStore(KEY_STORE).get("content")) as CryptoKey | undefined;
  if (!key) throw new Error("Offline service draft encryption key is unavailable");
  return key;
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

export async function initializeOfflineFloorDevice(identity: OfflineFloorIdentity): Promise<{ metadata: OfflineFloorDeviceMetadata; isNew: boolean }> {
  if (identity.role !== "employee") throw new Error("Offline service documentation is available only to active employee accounts.");
  const db = await openDatabase();
  const existing = await request(db.transaction(META_STORE).objectStore(META_STORE).get("device")) as OfflineFloorDeviceMetadata | undefined;
  if (existing && (existing.profileId !== identity.profileId || existing.organizationId !== identity.organizationId || existing.role !== identity.role)) {
    await clearDatabase(db);
  } else if (existing) {
    return { metadata: existing, isNew: false };
  }
  const key = await generateDraftDeviceKey();
  const marker = base64(crypto.getRandomValues(new Uint8Array(32)));
  const metadata: OfflineFloorDeviceMetadata = { ...identity, publicMarker: marker, fingerprintSha256: await sha256(marker), createdAt: new Date().toISOString() };
  const transaction = db.transaction([KEY_STORE, META_STORE], "readwrite");
  transaction.objectStore(KEY_STORE).put(key, "content");
  transaction.objectStore(META_STORE).put(metadata, "device");
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  return { metadata, isNew: true };
}

export async function saveOfflineFloorDeviceId(deviceId: string): Promise<void> {
  const db = await openDatabase();
  const metadata = await request(db.transaction(META_STORE).objectStore(META_STORE).get("device")) as OfflineFloorDeviceMetadata | undefined;
  if (!metadata) throw new Error("Offline service draft device is not initialized");
  await request(db.transaction(META_STORE, "readwrite").objectStore(META_STORE).put({ ...metadata, deviceId }, "device"));
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

// Codex review finding: awaiting only the `put` request's onsuccess (via the `request()` helper
// above) resolves as soon as IndexedDB has queued the write against the transaction's in-memory
// view -- it does NOT mean the transaction went on to commit. A transaction can still abort after
// every request in it has already reported success (e.g. a QuotaExceededError surfacing only at
// flush time), in which case the request never fires a second, later error -- only the
// transaction's own onabort does. This is the sole persistence path for an offline care note, so
// resolve only once the transaction itself completes, exactly like the other multi-store writes in
// this module (initializeOfflineFloorDevice, clearDatabase, purgeExpiredServiceDrafts) already key
// off transaction.oncomplete rather than the individual request.
export async function saveServiceDraft<T extends OfflineFloorDraft>(draft: T): Promise<T> {
  assertFloorDraftAllowed(draft);
  const db = await openDatabase();
  const key = await getDeviceKey(db);
  const envelope = await encryptDraft(key, draft);
  // scopeId is written for EVERY kind, and for a service draft it equals taskId -- so the scope
  // string a new service record produces is byte-identical to what Tier 1 produced, and old and
  // new records decrypt through the same path.
  const record: StoredDraftRecord = {
    draftId: draft.draftId,
    taskId: isUnscheduledServiceDraft(draft) || isChangeObservationDraft(draft) ? undefined : draft.taskId,
    scopeId: draftSubjectOf(draft),
    kind: draftKindOf(draft),
    syncState: draft.syncState, createdAt: draft.createdAt, envelope,
  };
  const transaction = db.transaction(DRAFT_STORE, "readwrite");
  transaction.objectStore(DRAFT_STORE).put(record);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline service draft save failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline service draft save was aborted"));
  });
  return draft;
}

/** Plaintext-only listing -- what the panel's counts and purge clock need without decrypting anything. */
export async function listServiceDraftEntries(): Promise<DraftListEntry[]> {
  const db = await openDatabase();
  const records = await request(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).getAll()) as StoredDraftRecord[];
  return records.map(({ draftId, taskId, kind, syncState, createdAt }) => ({
    draftId, taskId, kind: kind ?? "service_task", syncState, createdAt,
  }));
}

export async function readServiceDraft(draftId: string, identity: OfflineFloorIdentity): Promise<OfflineFloorDraft | undefined> {
  const db = await openDatabase();
  const record = await request(db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(draftId)) as StoredDraftRecord | undefined;
  if (!record) return undefined;
  const key = await getDeviceKey(db);
  const expectedScope = draftScope(
    identity.organizationId, identity.profileId, scopeSubjectOf(record), record.draftId,
  );
  return decryptDraft(key, record.envelope, expectedScope);
}

/** Full, decrypted drafts for the review list -- used only where the content itself must be shown. */
export async function readAllServiceDrafts(identity: OfflineFloorIdentity): Promise<OfflineFloorDraft[]> {
  const entries = await listServiceDraftEntries();
  const drafts = await Promise.all(entries.map((entry) => readServiceDraft(entry.draftId, identity)));
  return drafts.filter((draft): draft is OfflineFloorDraft => draft !== undefined);
}

export async function updateServiceDraft(
  draftId: string,
  patch: Partial<Pick<OfflineFloorDraft, "syncState" | "lastSyncOutcome" | "lastSyncError">>,
  identity: OfflineFloorIdentity,
): Promise<OfflineFloorDraft | undefined> {
  const draft = await readServiceDraft(draftId, identity);
  if (!draft) return undefined;
  const updated = { ...draft, ...patch, updatedAt: new Date().toISOString() } as OfflineFloorDraft;
  return saveServiceDraft(updated);
}

export async function removeServiceDraft(draftId: string): Promise<void> {
  const db = await openDatabase();
  await request(db.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).delete(draftId));
}

export async function wipeOfflineServiceDrafts(): Promise<void> {
  const db = await openDatabase();
  await clearDatabase(db);
}

// ---------------------------------------------------------------------------
// Purge / expiry policy
// ---------------------------------------------------------------------------

export const UNSYNCED_WARN_AFTER_MS = 24 * 60 * 60 * 1000;
export const UNSYNCED_PURGE_AFTER_MS = 72 * 60 * 60 * 1000;
export const NEEDS_REVIEW_PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Unresolved (draft/syncing/error) and unsynced for 24h+ -- the panel shows a "copy note" warning. */
export function isUnsyncedDraftOverdue(entry: DraftListEntry, now: number = Date.now()): boolean {
  return (UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)
    && now - new Date(entry.createdAt).getTime() >= UNSYNCED_WARN_AFTER_MS;
}

function isExpired(entry: DraftListEntry, now: number): boolean {
  const ageMs = now - new Date(entry.createdAt).getTime();
  if ((UNRESOLVED_DRAFT_STATES as string[]).includes(entry.syncState)) return ageMs >= UNSYNCED_PURGE_AFTER_MS;
  if ((NEEDS_REVIEW_DRAFT_STATES as string[]).includes(entry.syncState)) return ageMs >= NEEDS_REVIEW_PURGE_AFTER_MS;
  // applied/duplicate are removed immediately by the caller that observes that outcome, not by age.
  return false;
}

/** Hard-purges anything past its ceiling. Safe to call often (e.g. whenever the panel loads). */
export async function purgeExpiredServiceDrafts(now: number = Date.now()): Promise<string[]> {
  const entries = await listServiceDraftEntries();
  const expired = entries.filter((entry) => isExpired(entry, now));
  if (expired.length === 0) return [];
  const db = await openDatabase();
  const transaction = db.transaction(DRAFT_STORE, "readwrite");
  for (const entry of expired) transaction.objectStore(DRAFT_STORE).delete(entry.draftId);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline service draft purge failed"));
  });
  return expired.map((entry) => entry.draftId);
}

export type { OfflineDraftSyncOutcome, OfflineDraftSyncState };
