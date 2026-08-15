/** Shared request-body size guard for public (verify_jwt=false) edge functions. */

export const DEFAULT_MAX_REQUEST_BYTES = 16_384;

// Cap for the bulk-import functions: the whole CSV travels in every chunk call (the file
// checksum has to match the job receipt), so this covers the largest legitimate file, not a
// single chunk. 8MB is far beyond a 1000-row roster; without a cap, req.json() buffered
// whatever an authenticated org member posted.
export const MAX_IMPORT_BODY_BYTES = 8 * 1024 * 1024;

export class RequestBodyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

/**
 * Read raw request bytes with Content-Length and streaming byte caps so chunked
 * or length-spoofed bodies cannot force unbounded buffering.
 */
export async function readBytesBody(
  req: Request,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<Uint8Array> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }

  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancel failures; we've already rejected the payload
      }
      throw new RequestBodyError("Request body is too large", 413);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Read raw request text with Content-Length and streaming byte caps so chunked
 * or length-spoofed bodies cannot force unbounded buffering.
 */
export async function readTextBody(
  req: Request,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<string> {
  return new TextDecoder().decode(await readBytesBody(req, maxBytes));
}

/**
 * Read and parse a JSON request body with Content-Length and streaming byte caps,
 * matching the resident-portal-download / Stripe webhook pattern.
 */
export async function readJsonBody<T = Record<string, unknown>>(
  req: Request,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<T> {
  const rawBody = await readTextBody(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new RequestBodyError("Invalid JSON body", 400);
  }
  // `JSON.parse("null")` (and bare scalars) parse fine but are not the object every caller
  // property-accesses immediately -- a literal `null` body turned into an uncaught TypeError
  // 500 on public endpoints instead of this contract's clean 400.
  if (parsed === null || typeof parsed !== "object") {
    throw new RequestBodyError("Invalid JSON body", 400);
  }
  return parsed as T;
}
