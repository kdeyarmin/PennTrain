/** Shared request-body size guard for public (verify_jwt=false) edge functions. */

export const DEFAULT_MAX_REQUEST_BYTES = 16_384;

export class RequestBodyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

/**
 * Read raw request text with Content-Length and streaming byte caps so chunked
 * or length-spoofed bodies cannot force unbounded buffering.
 */
export async function readTextBody(
  req: Request,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<string> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }

  if (!req.body) return "";

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
  return new TextDecoder().decode(merged);
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
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new RequestBodyError("Invalid JSON body", 400);
  }
}
