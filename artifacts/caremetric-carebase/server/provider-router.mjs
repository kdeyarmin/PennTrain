/** Bounded Node HTTP adapter for the existing Fetch API provider handlers. */
const ROUTES = new Map([
  ["sms-mfa", { bytes: 2048, browser: true }],
  ["create-billing-session", { bytes: 32 * 1024, browser: true }],
  ["stripe-billing-webhook", { bytes: 1024 * 1024, browser: false }],
  ["sync-billing-quantities", { bytes: 32 * 1024, browser: false }],
]);
const PREFIX = "/api/providers/";
const RESPONSE_LIMIT = 1024 * 1024;
const RESPONSE_HEADERS = new Set([
  "content-type", "access-control-allow-origin", "access-control-allow-headers",
  "access-control-allow-methods", "access-control-max-age", "vary", "retry-after",
  "x-request-id", "x-correlation-id",
]);

class InputError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function fail(req, res, status, code) {
  if (res.destroyed || res.writableEnded) return;
  // Do not drain an unbounded rejected request. Close after flushing the error response.
  res.writeHead(status, {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", Connection: "close",
  });
  res.once("finish", () => req.destroy());
  res.end(JSON.stringify({ error: { code } }));
}

function readBody(req, limit, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      req.removeListener("data", onData); req.removeListener("end", onEnd);
      req.removeListener("error", onError); req.removeListener("aborted", onAbort);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error) => { cleanup(); error ? reject(error) : resolve(Buffer.concat(chunks, bytes)); };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) { req.pause(); finish(new InputError(413, "payload_too_large")); }
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = () => finish(new InputError(400, "invalid_request"));
    const onAbort = () => { req.pause(); finish(new InputError(408, "request_timeout")); };
    if (signal.aborted) { onAbort(); return; }
    req.on("data", onData); req.once("end", onEnd); req.once("error", onError);
    req.once("aborted", onAbort); signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function responseBody(response, signal) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error("Provider response exceeds limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

/** pathname is the server's already base-stripped pathname; handlers never see a Host-derived URL. */
export function createProviderRouter({
  handlers, enabled = false, publicOrigin = "https://cmcarebase.com",
  bodyTimeoutMs = 10_000, handlerTimeoutMs = 150_000, maxConcurrent = 16,
}) {
  const origin = new URL(publicOrigin).origin;
  let active = 0;
  return async (req, res, pathname) => {
    if (!pathname?.startsWith(PREFIX)) return false;
    const name = pathname.slice(PREFIX.length);
    const route = ROUTES.get(name);
    if (!route) { fail(req, res, 404, "provider_route_not_found"); return true; }
    if (!enabled) { fail(req, res, 503, "provider_runtime_unavailable"); return true; }
    if (req.method !== "POST" && !(route.browser && req.method === "OPTIONS")) {
      fail(req, res, 405, "method_not_allowed"); return true;
    }
    if (active >= maxConcurrent) { fail(req, res, 503, "provider_runtime_busy"); return true; }
    const length = req.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > route.bytes)) {
      fail(req, res, 413, "payload_too_large"); return true;
    }
    if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
      fail(req, res, 415, "unsupported_content_encoding"); return true;
    }
    const handler = handlers.get(name);
    if (!handler) { fail(req, res, 503, "provider_runtime_unavailable"); return true; }
    active += 1;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    req.once("aborted", disconnect); res.once("close", disconnect);
    let timer = setTimeout(() => controller.abort(), bodyTimeoutMs);
    timer.unref?.();
    try {
      const body = await readBody(req, route.bytes, controller.signal);
      clearTimeout(timer);
      controller.signal.throwIfAborted();
      const headers = new Headers();
      // Only headers consumed by these handlers cross the adapter. No cookies, proxy headers,
      // service credentials from arbitrary input, or hop-by-hop headers are forwarded.
      for (const key of ["authorization", "origin", "content-type", "stripe-signature",
        "x-caremetric-cron-secret", "x-correlation-id", "x-request-id", "idempotency-key"]) {
        const value = req.headers[key];
        if (typeof value === "string") headers.set(key, value);
      }
      const request = new Request(`${origin}${PREFIX}${name}`, {
        method: req.method, headers, signal: controller.signal,
        ...(body.length ? { body } : {}),
      });
      const work = async () => {
        const response = await handler(request);
        if (!(response instanceof Response)) throw new Error("Invalid provider response");
        return { response, bytes: await responseBody(response, controller.signal) };
      };
      let abortListener;
      const interrupted = new Promise((_, reject) => {
        abortListener = () => reject(new InputError(504, "provider_request_timeout"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
      });
      timer = setTimeout(() => controller.abort(), handlerTimeoutMs);
      timer.unref?.();
      let result;
      try { result = await Promise.race([work(), interrupted]); }
      finally { controller.signal.removeEventListener("abort", abortListener); }
      if (controller.signal.aborted || res.destroyed) return true;
      const responseHeaders = {
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Length": result.bytes.length,
      };
      for (const [key, value] of result.response.headers) {
        if (RESPONSE_HEADERS.has(key)) responseHeaders[key] = value;
      }
      res.writeHead(result.response.status, responseHeaders);
      res.end(result.bytes);
    } catch (error) {
      controller.abort();
      fail(req, res, error instanceof InputError ? error.status : 502,
        error instanceof InputError ? error.code : "provider_request_failed");
    } finally {
      clearTimeout(timer); active -= 1;
      req.removeListener("aborted", disconnect); res.removeListener("close", disconnect);
    }
    return true;
  };
}
