// enhancement/b1-b5-wire-20260801d
/** B1 edge — inject learning-runtime-bridge.js into package zip before accept. */
// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import JSZip from "npm:jszip@3.10.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

const BUNDLED_ADAPTER_PATH = "carebase/learning-runtime-bridge.js";
const ADAPTER_SCRIPT_TAG = `<script src="./${BUNDLED_ADAPTER_PATH}"></script>`;
const MAX_ZIP_BYTES = 104_857_600;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

function isInjectableHtml(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("<html") || lower.includes("<body") || lower.includes("<!doctype");
}

function injectAdapterScriptTag(html: string): string {
  if (html.includes(BUNDLED_ADAPTER_PATH)) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `  ${ADAPTER_SCRIPT_TAG}\n</body>`);
  return `${html}\n${ADAPTER_SCRIPT_TAG}\n`;
}

function hasHostilePath(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return n.startsWith("/") || n.includes("../") || n.includes("/..") || /^[a-zA-Z]:/.test(n);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadAdapterSource(): Promise<string> {
  try {
    return await Deno.readTextFile(new URL("./learning-runtime-bridge.js", import.meta.url));
  } catch {
    return "";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json(req, { error: "Invalid or expired session" }, 401);
  const { data: profile } = await caller.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile?.is_active || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(String(profile.role))) {
    return json(req, { error: "Not authorized to bundle learning packages" }, 403);
  }

  let body: { packageId?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }
  const packageId = body.packageId;
  if (!packageId) return json(req, { error: "packageId required" }, 400);

  try {
    const { data: pkg, error: pkgErr } = await caller
      .from("learning_packages")
      .select("id, storage_bucket, storage_path, entry_point, validation_status, content_sha256")
      .eq("id", packageId)
      .maybeSingle();
    if (pkgErr) throw pkgErr;
    if (!pkg) return json(req, { error: "Package not found" }, 404);
    if (pkg.validation_status === "accepted") return json(req, { success: true, skipped: true, reason: "already_accepted", packageId });
    if (pkg.validation_status === "quarantined") return json(req, { error: "Cannot bundle a quarantined package" }, 409);

    const bucket = String(pkg.storage_bucket || "learning-packages");
    const path = String(pkg.storage_path || "");
    if (!path) return json(req, { error: "Package has no storage_path" }, 400);

    const adapterSource = await loadAdapterSource();
    if (!adapterSource || adapterSource.length < 32) return json(req, { error: "Adapter source missing next to edge function" }, 500);

    const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Failed to download package zip");
    if (blob.size > MAX_ZIP_BYTES) return json(req, { error: "Package exceeds 100 MiB limit" }, 413);

    let zip: JSZip;
    try { zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer())); }
    catch { return json(req, { error: "Package is not a valid zip archive" }, 400); }

    for (const name of Object.keys(zip.files)) {
      if (hasHostilePath(name)) return json(req, { error: `Hostile path in zip: ${name}` }, 400);
    }

    const alreadyBundled = Boolean(zip.file(BUNDLED_ADAPTER_PATH));
    zip.file(BUNDLED_ADAPTER_PATH, adapterSource);

    const entryPoint = String(pkg.entry_point || "index.html");
    let injected = false;
    const entryFile = zip.file(entryPoint);
    if (entryFile && !entryFile.dir) {
      const html = await entryFile.async("string");
      if (isInjectableHtml(html)) { zip.file(entryPoint, injectAdapterScriptTag(html)); injected = true; }
    }
    if (!injected) {
      for (const [name, file] of Object.entries(zip.files)) {
        if (file.dir || !/\.html?$/i.test(name)) continue;
        const html = await file.async("string");
        if (!isInjectableHtml(html)) continue;
        zip.file(name, injectAdapterScriptTag(html));
        injected = true;
        break;
      }
    }

    const outBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const contentSha256 = await sha256Hex(outBytes);
    if (alreadyBundled && contentSha256 === pkg.content_sha256) {
      return json(req, { success: true, skipped: true, reason: "already_bundled", packageId, injected, contentSha256 });
    }

    const { error: upErr } = await admin.storage.from(bucket).upload(path, outBytes, { contentType: "application/zip", upsert: true });
    if (upErr) throw upErr;

    const { error: updErr } = await admin.from("learning_packages")
      .update({ content_sha256: contentSha256, compressed_bytes: outBytes.byteLength })
      .eq("id", packageId)
      .in("validation_status", ["pending", "validating", "rejected"]);
    if (updErr) throw updErr;

    return json(req, { success: true, packageId, injected, adapterPath: BUNDLED_ADAPTER_PATH, contentSha256, bytes: outBytes.byteLength });
  } catch (err) {
    return json(req, { success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
