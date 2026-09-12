import { MediaError, mediaMime, parseMediaOperation, type MediaOperation } from "./courseMediaProtocol.ts";
async function mediaMetadataBody(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new MediaError(400, "Media metadata is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3000)]);
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 8192) throw new MediaError(413, "Media metadata is too large.");
      chunks.push(part.value);
    }
    signal.throwIfAborted(); const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
  } catch (error) { await reader.cancel().catch(() => {}); if (signal.aborted) throw new MediaError(408, "Media metadata timed out."); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

export function encodeMediaRequest(value: MediaOperation): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function parseMediaHttpRequest(request: Request): Promise<MediaOperation> {
  if (request.method !== "POST") throw new MediaError(405, "Method not allowed.");
  if (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity") throw new MediaError(415, "Encoded media requests are unsupported.");
  const mime = request.headers.get("content-type"); const encoded = request.headers.get("x-caremetric-media-request");
  if (mediaMime(mime)) {
    if (!encoded || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new MediaError(400, "Media metadata is required.");
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), value => value.charCodeAt(0));
    const operation = parseMediaOperation(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (encodeMediaRequest(operation) !== encoded || operation.operation !== "media.upload" || operation.mimeType !== mime) throw new MediaError(400, "Invalid media upload metadata.");
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== operation.sourceBytes)) throw new MediaError(400, "Media length differs from the reviewed upload.");
    return operation;
  }
  if (mime?.split(";", 1)[0] !== "application/json" || encoded !== null) throw new MediaError(415, "Unsupported course media content type.");
  const operation = parseMediaOperation(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await mediaMetadataBody(request))));
  if (operation.operation === "media.upload") throw new MediaError(415, "Send media as its original binary bytes.");
  return operation;
}

export async function mediaStorageRequest(config: { supabaseUrl: string; serviceKey: string }, signal: AbortSignal,
  path: string, input: { body?: ReadableStream<Uint8Array>; mime: string; size: number }, fetcher: typeof fetch = fetch) {
  if (!/^(?:global|[0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(path)) throw new MediaError(502, "Invalid media storage reference.");
  return await fetcher(`${config.supabaseUrl}/storage/v1/object/${input.body ? "" : "authenticated/"}course-media/${path}`, {
    method: input.body ? "POST" : "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
      ...(input.body ? { "content-type": input.mime, "content-length": String(input.size), "x-upsert": "false" } : {}) },
    ...(input.body ? { body: input.body, duplex: "half" } : {}),
  } as RequestInit);
}
