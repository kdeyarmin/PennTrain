#!/usr/bin/env node
// Production static file server for the CareMetric Train SPA, deployed to Railway.
//
// This app has no backend of its own -- the browser talks to Supabase directly
// via supabase-js. This server exists only to (a) serve the built Vite bundle
// with SPA fallback routing, and (b) expose GET /health for Railway's
// healthcheck, since `vite preview` cannot do either safely in production.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist", "public");
const DIST_DIR_WITH_SEP = DIST_DIR + sep;
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080;
const HOST = "0.0.0.0";

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

function isSupabaseConfigured() {
  return Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY);
}

// Best-effort reachability check against Supabase Auth's public health route.
// Never throws, never blocks the healthcheck response for long, and never
// touches the service-role key (this process should not have it at all) --
// only the anon key, the same key already shipped to every browser.
async function checkSupabaseReachable() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const response = await fetch(new URL("/auth/v1/health", url), {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function handleHealth(_req, res) {
  const supabaseReachable = await checkSupabaseReachable();
  const body = JSON.stringify({
    status: "ok",
    service: "caremetric-train",
    timestamp: new Date().toISOString(),
    supabase: isSupabaseConfigured() ? "configured" : "not_configured",
    supabaseReachable,
  });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
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

async function serveFile(filePath, res, { cacheable }) {
  const data = await readFile(filePath);
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    if (url.pathname === "/health") {
      await handleHealth(req, res);
      return;
    }

    const appPath = stripBasePath(url.pathname);
    if (appPath === null) {
      // Outside the configured BASE_PATH entirely -- not part of this app's routing space.
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const staticFile = await resolveStaticFile(appPath);
    if (staticFile) {
      await serveFile(staticFile, res, { cacheable: appPath.startsWith("/assets/") });
      return;
    }

    // A missing asset (hashed bundle chunk, image, font -- anything under /assets/ or with a
    // file extension) is a real 404, not an app route. Falling back to index.html for these
    // would return 200 text/html for a request that's actually broken -- e.g. a stale browser
    // tab requesting a pre-redeploy chunk filename -- defeating status-code-based existence
    // checks and polluting logs/monitoring with false 200s.
    if (appPath.startsWith("/assets/") || extname(appPath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    // SPA fallback: client-side routing (wouter) owns everything else.
    const indexPath = join(DIST_DIR, "index.html");
    await serveFile(indexPath, res, { cacheable: false });
  } catch (error) {
    console.error("Request handling error:", error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`caremetric-train server listening on http://${HOST}:${PORT}`);
  console.log(`Serving static files from ${DIST_DIR}`);
});
