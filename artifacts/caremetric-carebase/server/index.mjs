#!/usr/bin/env node
// Production static file server for the CareMetric CareBase SPA, deployed to Railway.
//
// This app has no backend of its own -- the browser talks to Supabase directly
// via supabase-js. This server exists only to (a) serve the built Vite bundle
// with SPA fallback routing, and (b) expose GET /health for Railway's
// healthcheck, since `vite preview` cannot do either safely in production.
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist", "public");
const DIST_DIR_WITH_SEP = DIST_DIR + sep;
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080;
const ASSET_ARCHIVE_DIR = process.env.ASSET_ARCHIVE_DIR
  ? resolve(process.env.ASSET_ARCHIVE_DIR)
  : null;
const ASSET_ARCHIVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// "::" binds dual-stack (IPv6 + IPv4-mapped) -- Railway's docs recommend it so the
// service works on both current (IPv4+IPv6) and legacy (IPv6-only) private networks.
const HOST = process.env.HOST || "::";

// Must mirror vite.config.ts's `basePath = process.env.BASE_PATH ?? "/"` exactly -- that's what
// Vite prefixes every emitted asset URL with at build time, so this server has to strip the same
// prefix back off before looking for the underlying file, which is never nested under that prefix
// on disk (`base` only changes referenced URLs, not the build output layout).
const RAW_BASE_PATH = process.env.BASE_PATH ?? "/";
const BASE_PATH = RAW_BASE_PATH === "/" ? "/" : `/${RAW_BASE_PATH.replace(/^\/+|\/+$/g, "")}/`;

// Returns the pathname with BASE_PATH removed, or null if the request falls outside the
// configured base entirely (not part of this app's routing space). GET /health is handled
// separately, before this ever runs -- Railway's healthcheckPath is a fixed literal "/health",
// unaffected by BASE_PATH.
function stripBasePath(pathname) {
  if (BASE_PATH === "/") return pathname;
  const baseNoTrailingSlash = BASE_PATH.slice(0, -1);
  if (pathname === baseNoTrailingSlash) return "/";
  if (pathname.startsWith(BASE_PATH)) return pathname.slice(BASE_PATH.length - 1);
  return null;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

// Extensions worth compressing; server/precompress.mjs emits .br/.gz siblings for these at
// build time (only where compression actually shrinks the file), and serveFile negotiates
// them via Accept-Encoding. Already-compressed formats (images, woff2) are excluded.
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".map",
  ".webmanifest",
  ".txt",
]);

// Head-prerendered copies of index.html for statically-known public routes, written by
// server/prerender-heads.mjs at build time (route-specific title/meta/canonical/JSON-LD in
// the raw HTML, for crawlers and scrapers that don't run JS). The map is built ONCE at
// startup from the files actually present, so any route without a prerendered copy simply
// falls through to plain index.html -- the SPA fallback can never 404 because of this.
const PRERENDER_DIR = join(DIST_DIR, "__prerendered");
const PRERENDERED_ROUTES = new Map();
try {
  for (const entry of await readdir(PRERENDER_DIR, { withFileTypes: true })) {
    // Exactly ".html" -- skips the ".html.br"/".html.gz" siblings precompress emits.
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const slug = entry.name.slice(0, -".html".length);
    PRERENDERED_ROUTES.set(slug === "root" ? "/" : `/${slug}`, join(PRERENDER_DIR, entry.name));
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  // No prerendered output in this build -- every app route serves index.html.
}
if (PRERENDERED_ROUTES.size > 0) {
  console.log(`Serving ${PRERENDERED_ROUTES.size} head-prerendered routes from ${PRERENDER_DIR}`);
}

// Sent on every response. Railway terminates TLS, so HSTS is set with a moderate max-age and
// without includeSubDomains/preload (safe default if a custom apex domain is ever attached).
// The CSP deliberately contains only directives that cannot break resource loading
// (clickjacking/base/object hardening); a full resource CSP needs testing with the Google
// Fonts + Supabase origins first.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=15552000",
  "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};

function sendText(res, status, body) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Error responses must never outlive a deploy at the browser or CDN. A cached 404 for a
    // content-hashed chunk can keep a repaired release broken for hours.
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// This server never talks to Supabase itself -- the browser does, using whatever
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY were baked into the currently-served bundle at
// build time. This process's own env vars at request time can silently diverge from that
// (no rebuild on a runtime variable change, dummy build-time values, etc.), so /health
// intentionally does not report Supabase configuration or reachability -- doing so would
// describe this process's environment, not the bundle actually being served, which is
// exactly the kind of false assurance a healthcheck must not give.
async function handleHealth(_req, res) {
  const body = JSON.stringify({
    status: "ok",
    service: "caremetric-carebase",
    timestamp: new Date().toISOString(),
  });
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function resolveStaticFile(pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(DIST_DIR, safePath);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR_WITH_SEP)) return null;
  try {
    const info = await stat(filePath);
    if (info.isFile()) return filePath;
  } catch {
    // fall through to null
  }
  return null;
}

async function resolveArchivedAsset(pathname) {
  if (!ASSET_ARCHIVE_DIR || !pathname.startsWith("assets/")) return null;
  const relativeAssetPath = pathname.slice("assets/".length);
  const archivePrefix = ASSET_ARCHIVE_DIR + sep;
  const archivePath = resolve(ASSET_ARCHIVE_DIR, normalize(relativeAssetPath));
  if (archivePath !== ASSET_ARCHIVE_DIR && !archivePath.startsWith(archivePrefix)) return null;
  try {
    const info = await stat(archivePath);
    return info.isFile() ? archivePath : null;
  } catch {
    return null;
  }
}

async function prepareAssetArchive() {
  if (!ASSET_ARCHIVE_DIR) return;
  try {
    await mkdir(ASSET_ARCHIVE_DIR, { recursive: true });
    await cp(join(DIST_DIR, "assets"), ASSET_ARCHIVE_DIR, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });

    const cutoff = Date.now() - ASSET_ARCHIVE_MAX_AGE_MS;
    const entries = await readdir(ASSET_ARCHIVE_DIR, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const filePath = join(ASSET_ARCHIVE_DIR, entry.name);
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) await rm(filePath, { force: true });
    }));
    console.log(`Preserving release assets in ${ASSET_ARCHIVE_DIR}`);
  } catch (error) {
    console.warn(`Asset archive disabled (failed to prepare ${ASSET_ARCHIVE_DIR})`, error);
  }
}

// Picks the best precompressed encoding the client accepts: br over gzip, honoring q=0
// opt-outs. Returns null when only the identity response is acceptable.
function pickEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  const accepted = new Map();
  for (const part of acceptEncoding.split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      if (key === "q") q = Number(value);
    }
    accepted.set(name.trim().toLowerCase(), Number.isNaN(q) ? 0 : q);
  }
  const q = (name) => accepted.get(name) ?? accepted.get("*") ?? 0;
  const qBr = q("br");
  const qGzip = q("gzip");
  if (qBr <= 0 && qGzip <= 0) return null;
  if (qBr >= qGzip) return { encoding: "br", suffix: ".br" };
  return { encoding: "gzip", suffix: ".gz" };
}

async function serveFile(filePath, req, res, { cacheable }) {
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheable ? "public, max-age=31536000, immutable" : "no-cache",
  };

  let data = null;
  if (COMPRESSIBLE_EXTENSIONS.has(ext)) {
    // Cache correctness even when we answer with the identity body: the response
    // still varies on Accept-Encoding.
    headers["Vary"] = "Accept-Encoding";
    const picked = pickEncoding(req.headers["accept-encoding"]);
    if (picked) {
      try {
        data = await readFile(filePath + picked.suffix);
        headers["Content-Encoding"] = picked.encoding;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        // No precompressed sibling -- fall back to identity.
      }
    }
  }
  if (data === null) data = await readFile(filePath);

  headers["Content-Length"] = data.byteLength;
  res.writeHead(200, headers);
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    if (url.pathname === "/health") {
      await handleHealth(req, res);
      return;
    }

    const strippedPath = stripBasePath(url.pathname);
    if (strippedPath === null) {
      // Outside the configured BASE_PATH entirely -- not part of this app's routing space.
      sendText(res, 404, "Not Found");
      return;
    }

    // URL pathnames arrive percent-encoded; decode so files like "my file.txt" resolve.
    // Decoding happens BEFORE the containment check in resolveStaticFile, which is what
    // actually prevents traversal (normalize + join + startsWith(DIST_DIR + sep)) -- a
    // decoded "../" still cannot escape. Reject malformed encodings and NUL bytes outright.
    let appPath;
    try {
      appPath = decodeURIComponent(strippedPath);
    } catch {
      sendText(res, 400, "Bad Request");
      return;
    }
    if (appPath.includes("\0")) {
      sendText(res, 400, "Bad Request");
      return;
    }

    const requestedPath = appPath.replace(/^\/+/, "");
    const staticFile =
      await resolveStaticFile(requestedPath) ??
      await resolveArchivedAsset(requestedPath);
    if (staticFile) {
      await serveFile(staticFile, req, res, { cacheable: appPath.startsWith("/assets/") });
      return;
    }

    // A missing asset (hashed bundle chunk, image, font -- anything under /assets/ or with a
    // file extension) is a real 404, not an app route. Falling back to index.html for these
    // would return 200 text/html for a request that's actually broken -- e.g. a stale browser
    // tab requesting a pre-redeploy chunk filename -- defeating status-code-based existence
    // checks and polluting logs/monitoring with false 200s.
    if (appPath.startsWith("/assets/") || extname(appPath)) {
      sendText(res, 404, "Not Found");
      return;
    }

    // SPA fallback: client-side routing (wouter) owns everything else. Statically-known
    // public routes get their head-prerendered copy of index.html (same body, route-specific
    // <head>); anything else -- including routes with no prerendered file -- serves
    // index.html itself. Both go through serveFile with the same no-cache +
    // Accept-Encoding-negotiation behavior.
    const routePath = appPath.length > 1 ? appPath.replace(/\/+$/, "") || "/" : "/";
    const indexPath = PRERENDERED_ROUTES.get(routePath) ?? join(DIST_DIR, "index.html");
    await serveFile(indexPath, req, res, { cacheable: false });
  } catch (error) {
    console.error("Request handling error:", error);
    if (!res.headersSent) {
      sendText(res, 500, "Internal Server Error");
    } else {
      res.destroy();
    }
  }
});

// Railway's edge proxy reuses idle upstream connections longer than Node's 5s default
// keep-alive; if the origin closes first, reused connections surface as intermittent 502s.
// Outlive the proxy's idle window (headersTimeout must stay > keepAliveTimeout).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Bind dual-stack by default, but fall back to IPv4-only where the environment has no IPv6
// at all (some containers/sandboxes) -- an explicit HOST is honored without fallback.
function startListening(host, allowFallback) {
  const onError = (error) => {
    server.removeListener("listening", onListening);
    if (allowFallback && (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL")) {
      console.warn(`IPv6 not available in this environment (${error.code} on "${host}"); falling back to 0.0.0.0`);
      startListening("0.0.0.0", false);
      return;
    }
    throw error;
  };
  const onListening = () => {
    server.removeListener("error", onError);
    const { address, port } = server.address();
    console.log(`caremetric-carebase server listening on http://${address.includes(":") ? `[${address}]` : address}:${port}`);
    console.log(`Serving static files from ${DIST_DIR}`);
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(PORT, host);
}
await prepareAssetArchive();
startListening(HOST, !process.env.HOST);

// Railway sends SIGTERM on redeploy/scale-down: stop accepting connections, let in-flight
// requests finish, then exit -- with a forced-exit fallback so shutdown can never hang past
// the platform's grace period.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
