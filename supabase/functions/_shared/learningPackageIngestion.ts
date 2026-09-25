import { isSafePackagePath, MAX_PACKAGE_ZIP_BYTES, packageSha256 } from "./learningPackageArchiveCore.ts";
import { LEARNING_RUNTIME_BRIDGE_SOURCE } from "./learningPackageBridge.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
export const PACKAGE_BRIDGE_PATH = "carebase/learning-runtime-bridge.js";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
export class PackageIngestionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type PackageUpload = { operation: "upload"; requestId: string; versionId: string; sourceRevision: string;
  reason: string; standard: "scorm_1_2" | "scorm_2004_4th" | "xapi"; sourceSha256: string; sourceBytes: number };
export type PackageAccept = { operation: "accept"; requestId: string; packageId: string; sourceRevision: string; reason: string; entryPoint: string | null };
export type PackageOperation = PackageUpload | PackageAccept;
export type PackageResult = { operationId: string; packageId: string; versionId: string; sourceRevision: string;
  status: "pending" | "accepted"; sourceSha256: string; runtimeSha256: string | null; entryPoint: string | null };
export interface PackageCodec {
  readArchive: (bytes: Uint8Array) => Record<string, Uint8Array>;
  zipFiles: (files: Record<string, Uint8Array>) => Uint8Array;
}
export interface PackageIngestionPorts {
  codec: PackageCodec;
  prepare: (request: PackageOperation & { bridgeSha256?: string }) => Promise<unknown>;
  finish: (operationId: string) => Promise<unknown>;
  record: (proof: { p_operation_id: string; p_source_sha256: string; p_source_bytes: number;
    p_runtime_sha256: string | null; p_runtime_bytes: number | null; p_entry_point: string | null; p_bridge_sha256: string | null }) => Promise<void>;
  download: (bucket: string, path: string) => Promise<Blob | null>;
  /** Must use upsert:false. An existing object is verified byte-for-byte below. */
  upload: (bucket: string, path: string, bytes: Uint8Array) => Promise<"created" | "exists">;
}

export function parsePackageOperation(value: unknown): PackageOperation {
  const invalid = () => { throw new PackageIngestionError(400, "Invalid package request."); };
  if (!object(value) || !uuid(value.requestId) || !sha(value.sourceRevision) || typeof value.reason !== "string"
    || value.reason !== value.reason.trim() || value.reason.length < 8 || value.reason.length > 500 || /[\x00-\x1f\x7f]/.test(value.reason)) return invalid();
  if (value.operation === "upload" && exact(value, ["operation", "requestId", "versionId", "sourceRevision", "reason", "standard", "sourceSha256", "sourceBytes"])
    && uuid(value.versionId) && sha(value.sourceSha256) && typeof value.standard === "string" && ["scorm_1_2", "scorm_2004_4th", "xapi"].includes(value.standard)
    && Number.isInteger(value.sourceBytes) && Number(value.sourceBytes) > 0 && Number(value.sourceBytes) <= MAX_PACKAGE_ZIP_BYTES) return value as PackageUpload;
  if (value.operation === "accept" && exact(value, ["operation", "requestId", "packageId", "sourceRevision", "reason", "entryPoint"])
    && uuid(value.packageId) && (value.entryPoint === null || typeof value.entryPoint === "string" && isSafePackagePath(value.entryPoint))) return value as PackageAccept;
  return invalid();
}

export function projectPackageResult(value: unknown): PackageResult {
  if (!object(value) || !exact(value, ["operationId", "packageId", "versionId", "sourceRevision", "status", "sourceSha256", "runtimeSha256", "entryPoint"])
    || !uuid(value.operationId) || !uuid(value.packageId) || !uuid(value.versionId) || !sha(value.sourceRevision) || !sha(value.sourceSha256)
    || !(value.status === "pending" && value.runtimeSha256 === null && value.entryPoint === null
      || value.status === "accepted" && sha(value.runtimeSha256) && typeof value.entryPoint === "string" && isSafePackagePath(value.entryPoint))) {
    throw new PackageIngestionError(502, "Package result could not be verified.");
  }
  return value as PackageResult;
}

/** Deterministic derivation keeps retry hashes stable. Authored bytes are retained separately. */
export function derivePackageRuntime(original: Uint8Array, requestedEntry: string | null, codec: PackageCodec) {
  const files = codec.readArchive(original);
  const injectable = (path: string) => /\.html?$/i.test(path) && /<(html|body)\b|<!doctype\b/i.test(new TextDecoder().decode(files[path]));
  const entry = requestedEntry === null
    ? Object.hasOwn(files, "index.html") && injectable("index.html") ? "index.html" : Object.keys(files).sort().find(path => injectable(path))
    : Object.hasOwn(files, requestedEntry) && injectable(requestedEntry) ? requestedEntry : undefined;
  if (!entry) throw new PackageIngestionError(422, "Choose an existing HTML entry point in this package.");
  const directory = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : "";
  const resolvedBridge = `${directory}${PACKAGE_BRIDGE_PATH}`;
  // A source package cannot supply the application's trusted adapter namespace.
  if (Object.keys(files).some(path => path === resolvedBridge || path.startsWith(`${directory}carebase/`))) {
    throw new PackageIngestionError(422, "The package contains the reserved CareBase runtime directory.");
  }
  const html = new TextDecoder().decode(files[entry]);
  if (/<base\b/i.test(html)) throw new PackageIngestionError(422, "Package entry points must not override the document base URL.");
  const tag = `<script src="${PACKAGE_BRIDGE_PATH}"></script>`;
  files[resolvedBridge] = new TextEncoder().encode(LEARNING_RUNTIME_BRIDGE_SOURCE);
  files[entry] = new TextEncoder().encode(/<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => `${tag}\n</body>`) : `${html}\n${tag}\n`);
  const runtime = codec.zipFiles(files);
  if (runtime.byteLength > MAX_PACKAGE_ZIP_BYTES) throw new PackageIngestionError(413, "Derived package exceeds the 50 MB limit.");
  return { runtime, entryPoint: entry };
}

async function immutableUpload(ports: PackageIngestionPorts, bucket: string, path: string, bytes: Uint8Array, digest: string) {
  if (await ports.upload(bucket, path, bytes) === "created") return;
  const existing = await ports.download(bucket, path);
  if (!existing || existing.size !== bytes.byteLength || await packageSha256(new Uint8Array(await existing.arrayBuffer())) !== digest) {
    throw new PackageIngestionError(409, "An immutable package object differs. It was not overwritten.");
  }
}

/** The final authenticated RPC rechecks current access and draft CAS after all I/O. */
export type PackageStageResult = { state: "committed"; result: PackageResult } | { state: "staged"; operationId: string; packageId: string; versionId: string; sourceSha256: string; runtimeSha256: string | null; entryPoint: string | null };
export async function stagePackageOperation(request: PackageOperation, file: Blob | null, ports: PackageIngestionPorts): Promise<PackageStageResult> {
  const bridgeSha256 = request.operation === "accept" ? await packageSha256(LEARNING_RUNTIME_BRIDGE_SOURCE) : undefined;
  const prepared = await ports.prepare({ ...request, ...(bridgeSha256 ? { bridgeSha256 } : {}) });
  if (!object(prepared)) throw new PackageIngestionError(502, "Package operation could not be prepared.");
  if (prepared.result !== null) {
    const result = projectPackageResult(prepared.result);
    if (request.operation === "upload" && (result.versionId !== request.versionId || result.sourceSha256 !== request.sourceSha256)
      || request.operation === "accept" && result.packageId !== request.packageId) throw new PackageIngestionError(502, "Package receipt identity differs from the request.");
    return { state: "committed", result };
  }
  if (!uuid(prepared.operationId) || !uuid(prepared.packageId) || !uuid(prepared.versionId) || !object(prepared.source)
    || prepared.operation !== request.operation || !sha(prepared.source.sha256) || !Number.isInteger(prepared.source.bytes)
    || Number(prepared.source.bytes) < 1 || Number(prepared.source.bytes) > MAX_PACKAGE_ZIP_BYTES
    || typeof prepared.originalPath !== "string" || !isSafePackagePath(prepared.originalPath)
    || prepared.runtimePrefix !== `managed/${prepared.operationId}/`
    || request.operation === "upload" && (prepared.versionId !== request.versionId || prepared.source.sha256 !== request.sourceSha256 || prepared.source.bytes !== request.sourceBytes)
    || request.operation === "accept" && (prepared.packageId !== request.packageId || prepared.bridgeSha256 !== bridgeSha256)) {
    throw new PackageIngestionError(502, "Package operation could not be verified.");
  }
  if (!["learning-packages", "learning-package-originals"].includes(String(prepared.source.bucket))
    || typeof prepared.source.path !== "string" || !isSafePackagePath(prepared.source.path)) throw new PackageIngestionError(502, "Package source is unavailable.");
  const originalBlob = request.operation === "upload" ? file : await ports.download(String(prepared.source.bucket), prepared.source.path);
  if (!originalBlob || originalBlob.size !== prepared.source.bytes || originalBlob.size > MAX_PACKAGE_ZIP_BYTES) {
    throw new PackageIngestionError(422, "Original package length differs from its registration.");
  }
  const original = new Uint8Array(await originalBlob.arrayBuffer());
  const sourceSha256 = await packageSha256(original);
  if (sourceSha256 !== prepared.source.sha256) throw new PackageIngestionError(409, "Original package hash differs from its registration.");
  // Validate hostile archive paths and decompression budgets before retaining any new object.
  ports.codec.readArchive(original);
  await immutableUpload(ports, "learning-package-originals", prepared.originalPath, original, sourceSha256);
  let runtimeSha256: string | null = null;
  let runtimeBytes: number | null = null;
  let entryPoint: string | null = null;
  if (request.operation === "accept") {
    const derived = derivePackageRuntime(original, request.entryPoint, ports.codec);
    runtimeSha256 = await packageSha256(derived.runtime); runtimeBytes = derived.runtime.byteLength; entryPoint = derived.entryPoint;
    await immutableUpload(ports, "learning-packages", `${prepared.runtimePrefix}${runtimeSha256}.zip`, derived.runtime, runtimeSha256);
  }
  await ports.record({ p_operation_id: prepared.operationId, p_source_sha256: sourceSha256, p_source_bytes: original.byteLength,
    p_runtime_sha256: runtimeSha256, p_runtime_bytes: runtimeBytes, p_entry_point: entryPoint, p_bridge_sha256: bridgeSha256 ?? null });
  return { state: "staged", operationId: prepared.operationId, packageId: prepared.packageId, versionId: prepared.versionId,
    sourceSha256, runtimeSha256, entryPoint };
}

export async function executePackageOperation(request: PackageOperation, file: Blob | null, ports: PackageIngestionPorts): Promise<PackageResult> {
  const staged = await stagePackageOperation(request, file, ports);
  if (staged.state === "committed") return staged.result;
  const result = projectPackageResult(await ports.finish(staged.operationId));
  if (result.operationId !== staged.operationId || result.packageId !== staged.packageId || result.versionId !== staged.versionId
    || result.sourceSha256 !== staged.sourceSha256 || result.runtimeSha256 !== staged.runtimeSha256 || result.entryPoint !== staged.entryPoint) {
    throw new PackageIngestionError(502, "Committed package result differs from the verified artifact.");
  }
  return result;
}

export function packageRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const status = error.code === "42501" ? 403 : error.code === "28000" ? 401 : error.code === "P0002" ? 404
    : ["40001", "23505", "55000"].includes(error.code ?? "") ? 409 : error.code === "22023" ? 400 : 502;
  throw new PackageIngestionError(status, status === 502 ? "The package operation could not be completed." :
    status === 409 ? "The draft or package changed. Refresh and retry the operation." : status === 403 ? "Current package administrator access is required."
      : status === 401 ? "Sign in again before changing this package." : status === 404 ? "Package not found." : "Invalid package request.");
}
