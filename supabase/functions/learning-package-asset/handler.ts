import { equalPackageDigest, isSafePackagePath, MAX_PACKAGE_ZIP_BYTES, packageSha256, readPackageArchive } from "../_shared/learningPackageArchive.ts";

export interface PackageAssetContext {
  session: { id: string; package_id: string; assignment_id: string; employee_id: string; organization_id: string; launch_nonce_sha256: string; expires_at: string; state: string };
  pkg: { id: string; organization_id: string | null; course_version_id: string; validation_status: string; storage_bucket: string; storage_path: string; content_sha256: string };
  assignment: { id: string; employee_id: string; organization_id: string; course_version_id: string; status: string };
  employee: { id: string; organization_id: string; profile_id: string | null; status: string };
  organization: { id: string; subscription_status: string };
  profile: { id: string; organization_id: string | null; is_active: boolean; role: string };
}
async function verifyPackageAssetNonce(nonce: string, launchNonceSha256: string) {
  return equalPackageDigest(await packageSha256(nonce), launchNonceSha256);
}

export interface PackageAssetDependencies {
  loadContext: (sessionId: string) => Promise<PackageAssetContext | null>;
  downloadArchive: (bucket: string, path: string) => Promise<Blob | null>;
  now?: () => number;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", xml: "application/xml", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", vtt: "text/vtt",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", wasm: "application/wasm", pdf: "application/pdf",
};
const HEADERS = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range",
};

function denied(status = 404, message = "Package content is unavailable. Relaunch the course or contact your trainer.") {
  return new Response(message, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/** A live launch nonce is a narrow capability: one session's package, until expiry/relaunch. */
export function contextAllowsPackageAssets(context: PackageAssetContext, now: number): boolean {
  const { session: s, pkg: p, assignment: a, employee: e, profile, organization } = context;
  return organization.id === s.organization_id && !["suspended", "canceled"].includes(organization.subscription_status)
    && ["active", "completed"].includes(s.state) && Date.parse(s.expires_at) > now
    && p.id === s.package_id && p.validation_status === "accepted"
    && (p.organization_id === null || p.organization_id === s.organization_id)
    && a.id === s.assignment_id && a.status !== "canceled" && a.organization_id === s.organization_id
    && a.course_version_id === p.course_version_id && a.employee_id === s.employee_id
    && e.id === s.employee_id && e.organization_id === s.organization_id && ["active", "on_leave"].includes(e.status)
    && profile.id === e.profile_id && profile.is_active
    && (profile.organization_id === s.organization_id || (profile.organization_id === null && profile.role === "platform_admin"))
    && p.storage_bucket === "learning-packages" && /^[0-9a-f]{64}$/.test(p.content_sha256);
}

/** Cache only compressed source bytes. Authorization is rechecked for EVERY asset, even a hit. */
export function createPackageAssetHandler(deps: PackageAssetDependencies) {
  let cached: { key: string; bytes: Uint8Array; until: number } | null = null;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    if (!["GET", "HEAD"].includes(req.method)) return denied(405, "Method not allowed");
    try {
      const url = new URL(req.url);
      const match = /\/learning-package-asset\/([0-9a-f-]{36})\/([0-9a-f]{64})\/(.+)$/.exec(url.pathname);
      if (!match) return denied();
      const [, sessionId, nonce, encodedPath] = match;
      const parts = encodedPath.split("/").map((part) => decodeURIComponent(part));
      if (parts.some((part) => part.includes("/"))) return denied();
      const path = parts.join("/");
      if (!isSafePackagePath(path)) return denied();
      const context = await deps.loadContext(sessionId);
      const now = (deps.now ?? Date.now)();
      if (!context || !contextAllowsPackageAssets(context, now)) return denied();
      // The hash is minted by start_learning_runtime_session; possession of a guessed session ID
      // or a session from another learner never grants content access.
      if (!await verifyPackageAssetNonce(nonce, context.session.launch_nonce_sha256)) return denied();
      const p = context.pkg;
      const key = `${p.id}:${p.content_sha256}:${p.storage_path}`;
      let bytes: Uint8Array;
      if (cached?.key === key && cached.until > now) {
        bytes = cached.bytes;
      } else {
        cached = null;
        const blob = await deps.downloadArchive(p.storage_bucket, p.storage_path);
        if (!blob) return denied(502);
        if (blob.size > MAX_PACKAGE_ZIP_BYTES) return denied(413, "Package exceeds size limit");
        bytes = new Uint8Array(await blob.arrayBuffer());
        if (!equalPackageDigest(await packageSha256(bytes), p.content_sha256)) return denied(409, "Package changed. Contact your trainer to validate it again.");
        cached = { key, bytes, until: now + 60_000 };
      }
      // Inflate only the requested member; reject traversal and declared zip bombs even in
      // archives accepted by older releases. This also launches existing accepted ZIPs as-is.
      const files = readPackageArchive(bytes, path);
      const content = Object.hasOwn(files, path) ? files[path] : undefined;
      if (!content) return denied();
      const type = MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
      const headers: Record<string, string> = { ...HEADERS, "X-Learning-Content-Type": type, "Accept-Ranges": "bytes" };
      let start = 0;
      let end = content.byteLength - 1;
      let status = 200;
      const range = req.headers.get("Range");
      const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
        start = rangeMatch[1] ? Number(rangeMatch[1]) : Math.max(0, content.byteLength - Number(rangeMatch[2]));
        end = rangeMatch[1] && rangeMatch[2] ? Math.min(Number(rangeMatch[2]), end) : end;
        if (start > end || start >= content.byteLength) return new Response(null, { status: 416, headers: { ...HEADERS, "Content-Range": `bytes */${content.byteLength}` } });
        headers["Content-Range"] = `bytes ${start}-${end}/${content.byteLength}`;
        status = 206;
      }
      headers["Content-Length"] = String(Math.max(0, end - start + 1));
      // Supabase's default domain rewrites text/html. Only the application delivery proxy
      // restores the allowlisted MIME type, AND enforces a response-level sandbox for all HTML.
      return new Response(req.method === "HEAD" ? null : content.subarray(start, end + 1) as BodyInit, { status, headers });
    } catch {
      return denied(422, "The learning package could not be read. Contact your trainer.");
    }
  };
}
