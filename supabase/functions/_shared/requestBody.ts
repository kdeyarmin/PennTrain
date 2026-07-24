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

/** Read raw request text with Content-Length and actual-byte caps. */
export async function readTextBody(
  req: Request,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
): Promise<string> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  return rawBody;
}

/**
 * Read and parse a JSON request body with Content-Length and actual-byte caps,
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
