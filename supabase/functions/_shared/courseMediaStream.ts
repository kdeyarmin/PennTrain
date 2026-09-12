import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { MediaError, type MediaMime } from "./courseMediaProtocol.ts";

export function mediaSignatureMatches(prefix: Uint8Array, mime: MediaMime): boolean {
  const ascii = new TextDecoder("latin1").decode(prefix);
  if (mime === "application/pdf") return /^%PDF-[12]\.\d/.test(ascii);
  if (mime === "video/mp4") return prefix.byteLength >= 16 && ascii.slice(4, 8) === "ftyp"
    && new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(0) >= 16;
  return prefix.length >= 16 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3
    && ascii.includes("webm");
}

/** A bounded, private temporary file keeps 100 MiB video uploads out of the heap.
 * No file or provider path comes from a request. Only these two generated paths
 * are removed; no recursive deletion and no cleanup of another invocation.
 */
export async function spoolMedia(body: ReadableStream<Uint8Array> | null, expected: { sourceBytes: number; sourceSha256: string; mimeType: MediaMime }, signal: AbortSignal) {
  if (!body) throw new MediaError(400, "Media bytes are required.");
  const directory = await mkdtemp(join(tmpdir(), "carebase-media-"));
  const path = join(directory, "original");
  const cleanup = async () => { await unlink(path).catch(() => {}); await rmdir(directory).catch(() => {}); };
  const file = await open(path, "wx", 0o600).catch(async error => { await cleanup(); throw error; });
  const reader = body.getReader(); const hash = createHash("sha256"); let count = 0; const prefix = new Uint8Array(4096); let prefixLength = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new MediaError(400, "Invalid media bytes.");
      count += part.value.byteLength;
      if (count > expected.sourceBytes) throw new MediaError(413, "Media exceeds its declared size.");
      const take = Math.min(4096 - prefixLength, part.value.byteLength); prefix.set(part.value.subarray(0, take), prefixLength); prefixLength += take;
      hash.update(part.value);
      let offset = 0;
      while (offset < part.value.byteLength) { const result = await file.write(part.value, offset); if (!result.bytesWritten) throw new Error("Media staging failed"); offset += result.bytesWritten; }
    }
    signal.throwIfAborted();
    if (count !== expected.sourceBytes || hash.digest("hex") !== expected.sourceSha256) throw new MediaError(400, "Media bytes do not match the reviewed upload.");
    if (!mediaSignatureMatches(prefix.subarray(0, prefixLength), expected.mimeType)) throw new MediaError(415, "The media format does not match its declared type.");
    await file.close();
    return { stream: () => Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, cleanup };
  } catch (error) {
    await reader.cancel().catch(() => {}); await file.close().catch(() => {}); await cleanup(); throw error;
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

export async function verifyMediaStream(body: ReadableStream<Uint8Array> | null, expected: { sourceBytes: number; sourceSha256: string; mimeType: MediaMime }, signal: AbortSignal) {
  const original = await spoolMedia(body, expected, signal); await original.cleanup();
}
