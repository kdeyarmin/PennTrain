import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const LEARNING_PACKAGE_ROUTE = "/_learning-packages/";
const CONTENT_TYPES = new Set([
  "text/html; charset=utf-8", "text/javascript; charset=utf-8", "text/css; charset=utf-8", "application/json", "application/xml", "text/plain; charset=utf-8",
  "image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "text/vtt",
  "font/woff", "font/woff2", "font/ttf", "font/otf", "application/wasm", "application/pdf", "application/octet-stream",
]);
export const PACKAGE_SECURITY_HEADERS = {
  // Uploaded scripts are untrusted EVEN if the user directly opens the asset URL. A frame-only
  // sandbox would turn that direct open into stored XSS on the application origin.
  "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups; object-src 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  // The sandboxed package has an opaque origin. It may fetch its own JSON, modules and fonts
  // using its narrow path capability; cookies and Authorization are never forwarded.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range",
};

/** Shared by Railway, Vite development and Vite preview; never accepts an upstream URL from a caller. */
export async function proxyLearningPackage(req, res, path, { supabaseUrl, fetchImpl = fetch } = {}) {
  if (!path.startsWith(LEARNING_PACKAGE_ROUTE)) return false;
  const reject = (status, message) => {
    res.writeHead(status, { ...PACKAGE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : message);
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, PACKAGE_SECURITY_HEADERS);
    res.end();
    return true;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    reject(405, "Method not allowed");
    return true;
  }
  try {
    const suffix = path.slice(LEARNING_PACKAGE_ROUTE.length).split("?")[0];
    if (!/^[0-9a-f-]{36}\/[0-9a-f]{64}\/.+/.test(suffix)) {
      reject(404, "Package content unavailable");
      return true;
    }
    const segments = suffix.split("/").map(decodeURIComponent);
    if (segments.some((part) => !part || part === "." || part === ".." || /[/\\\x00-\x1f\x7f]/.test(part))) {
      reject(404, "Package content unavailable");
      return true;
    }
    if (!supabaseUrl) {
      reject(503, "Package delivery is not configured. Contact your administrator.");
      return true;
    }
    const upstream = new URL(supabaseUrl);
    if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error("Invalid package backend");
    upstream.pathname = `/functions/v1/learning-package-asset/${segments.map(encodeURIComponent).join("/")}`;
    upstream.search = "";
    upstream.hash = "";
    const headers = {};
    if (typeof req.headers.range === "string") headers.Range = req.headers.range;
    const response = await fetchImpl(upstream, { method: req.method, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (![200, 206, 416].includes(response.status)) {
      await response.body?.cancel();
      reject(response.status >= 500 ? 502 : response.status, "Package content is unavailable. Relaunch the course or contact your trainer.");
      return true;
    }
    const type = response.headers.get("X-Learning-Content-Type");
    if (response.status !== 416 && (!type || !CONTENT_TYPES.has(type))) {
      await response.body?.cancel();
      reject(502, "Package delivery returned an invalid response");
      return true;
    }
    const outgoing = { ...PACKAGE_SECURITY_HEADERS, "Content-Type": type ?? "text/plain; charset=utf-8" };
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = response.headers.get(name);
      if (value) outgoing[name] = value;
    }
    res.writeHead(response.status, outgoing);
    if (req.method === "HEAD" || !response.body) res.end();
    else await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    // The URL contains a scoped launch credential. Do not log requests or upstream error URLs.
    if (!res.headersSent) reject(502, "Package content is unavailable. Relaunch the course or contact your trainer.");
    else res.destroy();
  }
  return true;
}
