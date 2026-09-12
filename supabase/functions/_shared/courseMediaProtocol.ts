export const MEDIA_PDF_LIMIT = 26_214_400;
export const MEDIA_VIDEO_LIMIT = 104_857_600;
export const MEDIA_METADATA_LIMIT = 262_144;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
export const mediaUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const mediaSha = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
export const mediaExact = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export type MediaMime = "application/pdf" | "video/mp4" | "video/webm";
export const mediaMime = (value: unknown): value is MediaMime => ["application/pdf", "video/mp4", "video/webm"].includes(value as string);
export const mediaFileName = (value: unknown): value is string => typeof value === "string" && value === value.trim()
  && value === value.normalize("NFC") && [...value].length >= 1 && [...value].length <= 160 && !/[\u0000-\u001f\u007f-\u009f/\\:]/.test(value);
const size = (value: unknown, mime: unknown): value is number => Number.isInteger(value) && (value as number) > 0
  && (value as number) <= (mime === "application/pdf" ? MEDIA_PDF_LIMIT : MEDIA_VIDEO_LIMIT);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
export class MediaError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type MediaUpload = { operation: "media.upload"; requestId: string; versionId: string; blockId: string; sourceRevision: string;
  reason: string; fileName: string; mimeType: MediaMime; sourceSha256: string; sourceBytes: number };
export type MediaOperation = MediaUpload | { operation: "media.context"; versionId: string; blockId: string }
  | { operation: "media.status"; operationId: string } | { operation: "media.finish"; operationId: string }
  | { operation: "media.read"; versionId: string; blockId: string; assetId: string; range: null | { start: number; end: number | null } };
export type MediaAsset = { id: string; contentSha256: string; mimeType: MediaMime; byteSize: number; fileName: string };
export type MediaReceipt = { operationId: string; assetId: string; versionId: string; blockId: string; sourceRevision: string;
  contentSha256: string; mimeType: MediaMime; byteSize: number; fileName: string; attachedAt: string };
export type MediaIntent = { requestId: string; operationId: string; versionId: string; blockId: string; assetId: string;
  sourceRevision: string; contentSha256: string; mimeType: MediaMime; byteSize: number; fileName: string; reason: string;
  createdAt: string; expiresAt: string; state: "prepared" | "staged" | "expired" | "committed"; canFinishThisSession: boolean; result: MediaReceipt | null };
export type MediaContext = { courseId: string; versionId: string; sourceRevision: string;
  block: { id: string; type: "pdf" | "video"; title: string | null; mediaAsset: MediaAsset | null; legacyDocumentId: string | null;
    legacyVideoSha256: string | null; generationState: "none" | "pending" | "settled" }; intents: { items: MediaIntent[]; hasMore: boolean } };
function invalid(): never { throw new MediaError(400, "Invalid course media request."); }
function upstream(): never { throw new MediaError(502, "Invalid course media response."); }
export function parseMediaOperation(value: unknown): MediaOperation {
  if (mediaExact(value, ["operation", "versionId", "blockId"]) && value.operation === "media.context" && mediaUuid(value.versionId) && mediaUuid(value.blockId)) return value as MediaOperation;
  if (mediaExact(value, ["operation", "operationId"]) && ["media.status", "media.finish"].includes(value.operation as string) && mediaUuid(value.operationId)) return value as MediaOperation;
  if (mediaExact(value, ["operation", "versionId", "blockId", "assetId", "range"]) && value.operation === "media.read"
    && mediaUuid(value.versionId) && mediaUuid(value.blockId) && mediaUuid(value.assetId)) {
    if (value.range !== null && (!mediaExact(value.range, ["start", "end"]) || !Number.isInteger(value.range.start)
      || (value.range.start as number) < 0 || (value.range.start as number) >= MEDIA_VIDEO_LIMIT
      || value.range.end !== null && (!Number.isInteger(value.range.end) || (value.range.end as number) < (value.range.start as number) || (value.range.end as number) >= MEDIA_VIDEO_LIMIT))) invalid();
    return value as MediaOperation;
  }
  if (!mediaExact(value, ["operation", "requestId", "versionId", "blockId", "sourceRevision", "reason", "fileName", "mimeType", "sourceSha256", "sourceBytes"])
    || value.operation !== "media.upload" || !mediaUuid(value.requestId) || !mediaUuid(value.versionId) || !mediaUuid(value.blockId)
    || !mediaSha(value.sourceRevision) || !mediaSha(value.sourceSha256) || !mediaMime(value.mimeType) || !size(value.sourceBytes, value.mimeType)
    || !mediaFileName(value.fileName) || typeof value.reason !== "string" || value.reason !== value.reason.trim() || [...value.reason].length < 8 || [...value.reason].length > 500) invalid();
  return value as MediaUpload;
}
export function projectMediaAsset(value: unknown): MediaAsset {
  if (!mediaExact(value, ["id", "contentSha256", "mimeType", "byteSize", "fileName"]) || !mediaUuid(value.id) || !mediaSha(value.contentSha256)
    || !mediaMime(value.mimeType) || !size(value.byteSize, value.mimeType) || !mediaFileName(value.fileName)) upstream();
  return value as MediaAsset;
}
export function projectMediaReceipt(value: unknown): MediaReceipt {
  if (!mediaExact(value, ["operationId", "assetId", "versionId", "blockId", "sourceRevision", "contentSha256", "mimeType", "byteSize", "fileName", "attachedAt"])
    || !mediaUuid(value.operationId) || !mediaUuid(value.assetId) || !mediaUuid(value.versionId) || !mediaUuid(value.blockId) || !mediaSha(value.sourceRevision) || !date(value.attachedAt)) upstream();
  projectMediaAsset({ id: value.assetId, contentSha256: value.contentSha256, mimeType: value.mimeType, byteSize: value.byteSize, fileName: value.fileName });
  return value as MediaReceipt;
}
export function verifyMediaReceipt(value: MediaReceipt, expected: Pick<MediaReceipt, "assetId" | "versionId" | "blockId" | "contentSha256" | "mimeType" | "byteSize" | "fileName">) {
  for (const key of ["assetId", "versionId", "blockId", "contentSha256", "mimeType", "byteSize", "fileName"] as const) if (value[key] !== expected[key]) upstream();
  return value;
}
export function projectMediaStage(value: unknown, request: MediaUpload) {
  if (mediaExact(value, ["state", "result"]) && value.state === "committed") {
    const result = projectMediaReceipt(value.result);
    verifyMediaReceipt(result, { ...request, assetId: result.assetId, contentSha256: request.sourceSha256, byteSize: request.sourceBytes });
    return { state: "committed" as const, result };
  }
  if (!mediaExact(value, ["state", "operationId", "assetId", "versionId", "blockId", "contentSha256", "mimeType", "byteSize", "fileName"])
    || value.state !== "staged" || !mediaUuid(value.operationId) || !mediaUuid(value.assetId)
    || value.versionId !== request.versionId || value.blockId !== request.blockId || value.contentSha256 !== request.sourceSha256
    || value.mimeType !== request.mimeType || value.byteSize !== request.sourceBytes || value.fileName !== request.fileName) upstream();
  return value as { state: "staged"; operationId: string; assetId: string; versionId: string; blockId: string; contentSha256: string; mimeType: MediaMime; byteSize: number; fileName: string };
}
export function projectMediaIntent(value: unknown): MediaIntent {
  if (!mediaExact(value, ["requestId", "operationId", "versionId", "blockId", "assetId", "sourceRevision", "contentSha256", "mimeType", "byteSize", "fileName", "reason", "createdAt", "expiresAt", "state", "canFinishThisSession", "result"])
    || !mediaUuid(value.requestId) || !mediaUuid(value.operationId) || !mediaUuid(value.versionId) || !mediaUuid(value.blockId) || !mediaSha(value.sourceRevision)
    || !date(value.createdAt) || !date(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || Date.parse(value.expiresAt) > Date.parse(value.createdAt) + 900_001 || typeof value.reason !== "string" || [...value.reason].length < 8 || [...value.reason].length > 500
    || !["prepared", "staged", "expired", "committed"].includes(value.state as string) || typeof value.canFinishThisSession !== "boolean"
    || value.canFinishThisSession && value.state !== "staged" || (value.state === "committed") !== (value.result !== null)) upstream();
  projectMediaAsset({ id: value.assetId, contentSha256: value.contentSha256, mimeType: value.mimeType, byteSize: value.byteSize, fileName: value.fileName });
  if (value.result !== null) {
    const result = projectMediaReceipt(value.result); verifyMediaReceipt(result, value as unknown as MediaIntent);
    if (result.operationId !== value.operationId) upstream();
  }
  return value as MediaIntent;
}
export function projectMediaContext(value: unknown, operation: { versionId: string; blockId: string }): MediaContext {
  if (!mediaExact(value, ["courseId", "versionId", "sourceRevision", "block", "intents"]) || !mediaUuid(value.courseId) || value.versionId !== operation.versionId || !mediaSha(value.sourceRevision)
    || !mediaExact(value.block, ["id", "type", "title", "mediaAsset", "legacyDocumentId", "legacyVideoSha256", "generationState"]) || value.block.id !== operation.blockId
    || !["pdf", "video"].includes(value.block.type as string) || !(value.block.title === null || typeof value.block.title === "string")
    || !(value.block.legacyDocumentId === null || mediaUuid(value.block.legacyDocumentId)) || !(value.block.legacyVideoSha256 === null || mediaSha(value.block.legacyVideoSha256))
    || !["none", "pending", "settled"].includes(value.block.generationState as string) || !mediaExact(value.intents, ["items", "hasMore"])
    || !Array.isArray(value.intents.items) || value.intents.items.length > 20 || typeof value.intents.hasMore !== "boolean") upstream();
  if (value.block.mediaAsset !== null) {
    const asset = projectMediaAsset(value.block.mediaAsset);
    if ((value.block.type === "pdf") !== (asset.mimeType === "application/pdf") || value.block.legacyDocumentId !== null || value.block.legacyVideoSha256 !== null) upstream();
  }
  const ids = new Set();
  for (const item of value.intents.items) {
    const intent = projectMediaIntent(item);
    if (ids.has(intent.operationId) || intent.versionId !== value.versionId || intent.blockId !== value.block.id
      || intent.canFinishThisSession && (intent.sourceRevision !== value.sourceRevision || value.block.generationState === "pending")) upstream();
    ids.add(intent.operationId);
  }
  return value as MediaContext;
}
