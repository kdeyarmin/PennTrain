import { decryptOfflinePayload, encryptOfflinePayload, generateOfflineDeviceKey, type EncryptedOfflinePayload } from "./offlineLearning";
import { createRunLatch } from "./runLatch";

const DATABASE_NAME = "carebase-offline-learning";
const DATABASE_VERSION = 2;
const KEY_STORE = "device-keys";
const BUNDLE_STORE = "course-bundles";
const META_STORE = "metadata";
const PROGRESS_STORE = "progress-checkpoints";

export interface OfflineIdentity { organizationId: string; profileId: string; role: string }
export interface OfflineDeviceMetadata extends OfflineIdentity { deviceId?: string; publicMarker: string; fingerprintSha256: string; createdAt: string }
export interface CachedCourseBundle {
  assignmentId: string;
  manifestId: string;
  versionId: string;
  title: string;
  expiresAt: string;
  downloadedAt: string;
  envelope: EncryptedOfflinePayload;
}
export interface OfflineProgressCheckpoint {
  assignmentId: string;
  percentComplete: number;
  syncedPercent: number;
  baseVersion: number;
  clientSequence: number;
  idempotencyKey: string;
  occurredAt: string;
  /**
   * When the learner started working this offline copy -- set on the FIRST checkpoint and carried
   * forward unchanged, never re-stamped (BACKLOG.md J74, Train).
   *
   * `sync_offline_learning_action` used to create `course_progress` with `started_at = now()`,
   * which is the moment of SYNC. Somebody who worked a course on the bus and reconnected at the
   * building had their seat clock started when they walked in the door -- and the comprehensive
   * gate (`require_comprehensive_self_completion`) then made them wait the course's whole designed
   * duration all over again. The server clamps this into [bundle download, now], so it can be
   * earlier than the sync but never earlier than the download that made the study possible.
   */
  startedAt?: string;
  /**
   * The furthest block the learner reached offline. Sent with the checkpoint so the offline work
   * carries the same two pieces of evidence the live player records for it -- percentage and
   * position. Without it, syncing 100% left `last_block_id` null, the live player resumed at lesson
   * one and immediately wrote the percentage back down, and for a comprehensive version the synced
   * progress could never be the last missing piece of the completion gate.
   */
  lastBlockId?: string;
  lastOutcome?: string;
  lastAttemptedAt?: string;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Offline storage request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const value = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    value.onupgradeneeded = () => {
      if (!value.result.objectStoreNames.contains(KEY_STORE)) value.result.createObjectStore(KEY_STORE);
      if (!value.result.objectStoreNames.contains(BUNDLE_STORE)) value.result.createObjectStore(BUNDLE_STORE, { keyPath: "assignmentId" });
      if (!value.result.objectStoreNames.contains(META_STORE)) value.result.createObjectStore(META_STORE);
      if (!value.result.objectStoreNames.contains(PROGRESS_STORE)) value.result.createObjectStore(PROGRESS_STORE, { keyPath: "assignmentId" });
    };
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Offline learning storage is unavailable"));
  });
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clearDatabase(db: IDBDatabase) {
  await Promise.all([KEY_STORE, BUNDLE_STORE, META_STORE, PROGRESS_STORE].map((store) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline wipe failed"));
  })));
}

const initializeDeviceLatch = createRunLatch<{ metadata: OfflineDeviceMetadata; isNew: boolean }>();

export async function initializeOfflineDevice(identity: OfflineIdentity): Promise<{ metadata: OfflineDeviceMetadata; isNew: boolean }> {
  if (identity.role !== "employee") throw new Error("Offline learning is available only to active employee accounts.");
  // Two overlapping first-downloads used to each mint an AES key and each write
  // metadata; last writer won and the first bundle became undecryptable. Same-realm
  // callers join this latch; the write transaction below re-reads so a second tab
  // that finished while we generated a key is adopted instead of overwritten.
  return initializeDeviceLatch(() => initializeOfflineDeviceUnlocked(identity));
}

async function initializeOfflineDeviceUnlocked(identity: OfflineIdentity): Promise<{ metadata: OfflineDeviceMetadata; isNew: boolean }> {
  const db = await openDatabase();
  const existing = await request(db.transaction(META_STORE).objectStore(META_STORE).get("device")) as OfflineDeviceMetadata | undefined;
  if (existing && (existing.profileId !== identity.profileId || existing.organizationId !== identity.organizationId || existing.role !== identity.role)) {
    await clearDatabase(db);
  } else if (existing) {
    return { metadata: existing, isNew: false };
  }
  const key = await generateOfflineDeviceKey();
  const marker = base64(crypto.getRandomValues(new Uint8Array(32)));
  const metadata: OfflineDeviceMetadata = { ...identity, publicMarker: marker, fingerprintSha256: await sha256(marker), createdAt: new Date().toISOString() };
  const transaction = db.transaction([KEY_STORE, META_STORE], "readwrite");
  const raced = await request(transaction.objectStore(META_STORE).get("device")) as OfflineDeviceMetadata | undefined;
  if (raced && raced.profileId === identity.profileId && raced.organizationId === identity.organizationId && raced.role === identity.role) {
    return { metadata: raced, isNew: false };
  }
  transaction.objectStore(KEY_STORE).put(key, "content");
  transaction.objectStore(META_STORE).put(metadata, "device");
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  return { metadata, isNew: true };
}

export async function saveOfflineDeviceId(deviceId: string) {
  const db = await openDatabase();
  const metadata = await request(db.transaction(META_STORE).objectStore(META_STORE).get("device")) as OfflineDeviceMetadata | undefined;
  if (!metadata) throw new Error("Offline device is not initialized");
  await request(db.transaction(META_STORE, "readwrite").objectStore(META_STORE).put({ ...metadata, deviceId }, "device"));
}

export async function cacheCourseBundle(input: {
  identity: OfflineIdentity; assignmentId: string; manifestId: string; versionId: string;
  title: string; expiresAt: string; bundle: unknown;
}) {
  const db = await openDatabase();
  const key = await request(db.transaction(KEY_STORE).objectStore(KEY_STORE).get("content")) as CryptoKey | undefined;
  if (!key) throw new Error("Offline encryption key is unavailable");
  const envelope = await encryptOfflinePayload(key, {
    domain: "course", organizationId: input.identity.organizationId, profileId: input.identity.profileId,
    versionId: input.versionId, data: input.bundle,
  });
  const record: CachedCourseBundle = {
    assignmentId: input.assignmentId, manifestId: input.manifestId, versionId: input.versionId,
    title: input.title, expiresAt: input.expiresAt, downloadedAt: new Date().toISOString(), envelope,
  };
  await request(db.transaction(BUNDLE_STORE, "readwrite").objectStore(BUNDLE_STORE).put(record));
  return record;
}

export async function listCachedCourseBundles(): Promise<CachedCourseBundle[]> {
  const db = await openDatabase();
  return request(db.transaction(BUNDLE_STORE).objectStore(BUNDLE_STORE).getAll());
}

export async function readCachedCourseBundle(record: CachedCourseBundle, identity: OfflineIdentity) {
  const db = await openDatabase();
  const key = await request(db.transaction(KEY_STORE).objectStore(KEY_STORE).get("content")) as CryptoKey | undefined;
  if (!key) throw new Error("Offline encryption key is unavailable");
  return decryptOfflinePayload(key, record.envelope, `${identity.organizationId}:${identity.profileId}:${record.versionId}`);
}

export async function removeCachedCourseBundle(assignmentId: string) {
  const db = await openDatabase();
  const transaction = db.transaction([BUNDLE_STORE, PROGRESS_STORE], "readwrite");
  transaction.objectStore(BUNDLE_STORE).delete(assignmentId);
  transaction.objectStore(PROGRESS_STORE).delete(assignmentId);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline course removal failed"));
  });
}

export async function getOfflineProgressCheckpoint(assignmentId: string): Promise<OfflineProgressCheckpoint | undefined> {
  const db = await openDatabase();
  return request(db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE).get(assignmentId));
}

export async function queueOfflineProgress(input: {
  assignmentId: string;
  percentComplete: number;
  baseVersion: number;
  lastBlockId?: string | null;
}) {
  const db = await openDatabase();
  const existing = await request(db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE).get(input.assignmentId)) as OfflineProgressCheckpoint | undefined;
  const percentComplete = Math.min(100, Math.max(0, Math.round(input.percentComplete)));
  if (existing && existing.percentComplete >= percentComplete) return existing;
  const checkpoint: OfflineProgressCheckpoint = {
    assignmentId: input.assignmentId,
    percentComplete,
    syncedPercent: existing?.syncedPercent ?? 0,
    baseVersion: existing?.baseVersion ?? input.baseVersion,
    clientSequence: (existing?.clientSequence ?? 0) + 1,
    idempotencyKey: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    // The first checkpoint is the start of study on this device; every later one keeps it.
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    lastBlockId: input.lastBlockId ?? existing?.lastBlockId,
  };
  await request(db.transaction(PROGRESS_STORE, "readwrite").objectStore(PROGRESS_STORE).put(checkpoint));
  return checkpoint;
}

export async function markOfflineProgressAttempt(
  assignmentId: string,
  outcome: string,
  serverVersion: number,
  sentPercent: number,
) {
  const db = await openDatabase();
  const existing = await request(db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE).get(assignmentId)) as OfflineProgressCheckpoint | undefined;
  if (!existing) throw new Error("Offline progress checkpoint is unavailable");
  const applied = outcome === "applied" || outcome === "duplicate";
  // Only the percent that was actually sent is synced; progress queued while the
  // request was in flight still needs its own sync. A conflict means the server
  // moved past our base version, so the pending percent must retry as a fresh
  // action against the server's version rather than replay the rejected receipt —
  // and the conflict receipt already consumed this (device, sequence) in the
  // append-only receipt ledger, so the retry needs a new sequence too.
  const conflicted = outcome === "conflict" && existing.percentComplete > existing.syncedPercent;
  const checkpoint: OfflineProgressCheckpoint = {
    ...existing,
    syncedPercent: applied ? Math.max(existing.syncedPercent, sentPercent) : existing.syncedPercent,
    baseVersion: applied || conflicted ? serverVersion : existing.baseVersion,
    clientSequence: conflicted ? existing.clientSequence + 1 : existing.clientSequence,
    idempotencyKey: conflicted ? crypto.randomUUID() : existing.idempotencyKey,
    lastOutcome: outcome,
    lastAttemptedAt: new Date().toISOString(),
  };
  await request(db.transaction(PROGRESS_STORE, "readwrite").objectStore(PROGRESS_STORE).put(checkpoint));
  return checkpoint;
}

export async function wipeOfflineLearning() {
  const db = await openDatabase();
  await clearDatabase(db);
}

export async function getOfflineDeviceMetadata(): Promise<OfflineDeviceMetadata | undefined> {
  const db = await openDatabase();
  return request(db.transaction(META_STORE).objectStore(META_STORE).get("device"));
}
