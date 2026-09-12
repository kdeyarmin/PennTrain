import { MediaError, mediaExact, mediaUuid, projectMediaReceipt, verifyMediaReceipt, type MediaUpload } from "./courseMediaProtocol.ts";
import { spoolMedia, verifyMediaStream } from "./courseMediaStream.ts";
import { boundedPackageBody } from "./learningPackageHttp.ts";

export interface MediaPorts {
  prepare: (request: MediaUpload) => Promise<unknown>;
  record: (proof: { p_operation_id: string; p_content_sha256: string; p_byte_size: number; p_mime_type: string }) => Promise<void>;
  storage: (path: string, input: { body?: ReadableStream<Uint8Array>; mime: string; size: number }) => Promise<Response>;
}
export async function isMediaDuplicate(response: Response): Promise<boolean> {
  if (response.status === 409) { await response.body?.cancel(); return true; }
  if (response.status !== 400) { await response.body?.cancel(); return false; }
  try {
    const error = JSON.parse(new TextDecoder().decode(await boundedPackageBody(response, 4096)));
    return error !== null && typeof error === "object" && !Array.isArray(error) && String(error.statusCode) === "409"
      && ["Duplicate", "ResourceAlreadyExists", "KeyAlreadyExists"].includes(error.code ?? error.error);
  } catch { return false; }
}
export async function stageCourseMedia(request: MediaUpload, body: ReadableStream<Uint8Array> | null, ports: MediaPorts, signal: AbortSignal) {
  const prepared = await ports.prepare(request);
  if (mediaExact(prepared, ["result"])) {
    const receipt = projectMediaReceipt(prepared.result);
    verifyMediaReceipt(receipt, { ...request, assetId: receipt.assetId, contentSha256: request.sourceSha256, byteSize: request.sourceBytes });
    await body?.cancel(); return { state: "committed" as const, result: receipt };
  }
  if (!mediaExact(prepared, ["operationId", "assetId", "versionId", "blockId", "contentSha256", "mimeType", "byteSize", "fileName", "storagePath", "result"])
    || !mediaUuid(prepared.operationId) || !mediaUuid(prepared.assetId) || prepared.result !== null || prepared.versionId !== request.versionId || prepared.blockId !== request.blockId
    || prepared.contentSha256 !== request.sourceSha256 || prepared.mimeType !== request.mimeType || prepared.byteSize !== request.sourceBytes || prepared.fileName !== request.fileName
    || typeof prepared.storagePath !== "string" || !/^(?:global|[0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(prepared.storagePath)
    || prepared.storagePath.split("/")[2] !== prepared.assetId || !prepared.storagePath.endsWith("/" + request.sourceSha256)) throw new MediaError(502, "Invalid media reservation.");
  const original = await spoolMedia(body, request, signal);
  try {
    const response = await ports.storage(prepared.storagePath, { body: original.stream(), mime: request.mimeType, size: request.sourceBytes });
    if (!response.ok && !(await isMediaDuplicate(response))) throw new MediaError(502, "Immutable media could not be stored.");
    if (response.ok) await response.body?.cancel();
    // Both success and duplicate observations verify the exact stored bytes.
    const stored = await ports.storage(prepared.storagePath, { mime: request.mimeType, size: request.sourceBytes });
    if (!stored.ok || stored.headers.get("content-type")?.split(";", 1)[0] !== request.mimeType) { await stored.body?.cancel(); throw new MediaError(502, "Stored media is unavailable."); }
    await verifyMediaStream(stored.body, request, signal);
    await ports.record({ p_operation_id: prepared.operationId, p_content_sha256: request.sourceSha256, p_byte_size: request.sourceBytes, p_mime_type: request.mimeType });
    return { state: "staged" as const, operationId: prepared.operationId, assetId: prepared.assetId, versionId: request.versionId, blockId: request.blockId,
      contentSha256: request.sourceSha256, mimeType: request.mimeType, byteSize: request.sourceBytes, fileName: request.fileName };
  } finally { await original.cleanup(); }
}

export function mediaRpcError(error: { code?: string } | null | undefined) {
  if (!error) return;
  throw new MediaError(error.code === "42501" ? 403 : error.code === "28000" ? 401 : error.code === "P0002" ? 404
    : ["40001", "23514", "55000"].includes(error.code ?? "") ? 409 : ["22023", "22P02"].includes(error.code ?? "") ? 400 : 502,
  "The course media request could not be completed. Refresh the course and try again.");
}
