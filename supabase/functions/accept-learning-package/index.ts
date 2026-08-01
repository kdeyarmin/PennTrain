// @ts-nocheck -- fflate npm module causes Deno type errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { strFromU8, strToU8, unzipSync, zipSync } from "npm:fflate@0.8.2";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { LEARNING_RUNTIME_BRIDGE_SOURCE } from "../_shared/learningPackageBridge.ts";

/** Relative path segment for the adapter inside the package zip (placed alongside the HTML). */
const BRIDGE_PATH = "carebase/learning-runtime-bridge.js";
/** Maximum accepted package size: 50 MB. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

function isInjectableHtml(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("<html") || lower.includes("<body") || lower.includes("<!doctype");
}

function injectBridgeScriptTag(html: string, scriptTag: string): string {
  if (html.includes(BRIDGE_PATH)) return html;
  const bodyClose = /<\/body>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `  ${scriptTag}\n</body>`);
  }
  return `${html}\n${scriptTag}\n`;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // caller: forwards the user JWT for RPC audit / role checks
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  // admin: service role for storage reads/writes and hash update
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json(req, { error: "Invalid or expired session" }, 401);

  let body: { package_id?: string; entry_point?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  if (!body.package_id) return json(req, { error: "package_id is required" }, 400);

  // 1. Load the package record
  const { data: pkg, error: pkgError } = await admin
    .from("learning_packages")
    .select("id, storage_bucket, storage_path, entry_point, validation_status")
    .eq("id", body.package_id)
    .single();
  if (pkgError || !pkg) return json(req, { error: "Package not found" }, 404);
  if (!["pending", "validating", "rejected"].includes(pkg.validation_status)) {
    return json(req, { error: "Package is not in an acceptable state" }, 409);
  }

  // 2. Download the zip from storage
  const bucket = pkg.storage_bucket ?? "learning-packages";
  const { data: zipBlob, error: dlError } = await admin.storage
    .from(bucket)
    .download(pkg.storage_path);
  if (dlError || !zipBlob) {
    return json(req, { error: `Storage download failed: ${dlError?.message ?? "no data"}` }, 502);
  }
  const zipBytesOriginal = new Uint8Array(await zipBlob.arrayBuffer());
  if (zipBytesOriginal.byteLength > MAX_ZIP_BYTES) {
    return json(req, { error: "Package exceeds 50 MB size limit" }, 413);
  }

  // 3. Unzip
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytesOriginal);
  } catch (e) {
    return json(req, { error: `Zip parse error: ${e instanceof Error ? e.message : String(e)}` }, 422);
  }

  // Reject hostile zip entries — normalize Windows separators first so that
  // ..\\ traversal and absolute Windows paths are caught alongside Unix-style ones.
  for (const name of Object.keys(files)) {
    const normalized = name.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (
      normalized.startsWith("/") ||
      /^[a-zA-Z]:/.test(normalized) ||
      segments.includes("..")
    ) {
      return json(req, { error: `Rejected hostile zip entry: ${name}` }, 422);
    }
  }

  // 4. Choose a single HTML to inject into; fail fast if none is injectable
  const candidateEntry = body.entry_point ?? pkg.entry_point ?? "index.html";
  let chosenEntryPath: string | null = null;

  if (files[candidateEntry]) {
    const html = strFromU8(files[candidateEntry]);
    if (isInjectableHtml(html)) chosenEntryPath = candidateEntry;
  }
  if (!chosenEntryPath) {
    for (const path of Object.keys(files)) {
      if (!/\.html?$/i.test(path)) continue;
      const html = strFromU8(files[path]);
      if (isInjectableHtml(html)) { chosenEntryPath = path; break; }
    }
  }
  if (!chosenEntryPath) {
    return json(req, { error: "No injectable HTML file found in package" }, 422);
  }

  // Place the bridge file alongside the chosen HTML so the relative <script src> resolves
  const htmlDir = chosenEntryPath.includes("/")
    ? chosenEntryPath.slice(0, chosenEntryPath.lastIndexOf("/") + 1)
    : "";
  const resolvedBridgePath = `${htmlDir}${BRIDGE_PATH}`;
  const bridgeScriptTag = `<script src="${BRIDGE_PATH}"></script>`;

  files[resolvedBridgePath] = strToU8(LEARNING_RUNTIME_BRIDGE_SOURCE);
  files[chosenEntryPath] = strToU8(
    injectBridgeScriptTag(strFromU8(files[chosenEntryPath]), bridgeScriptTag),
  );
  const entryPoint = chosenEntryPath;

  // 5. Rezip with default compression and enforce size cap on the new zip
  const zippable: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) {
    zippable[name] = data;
  }
  const newZipBytes = zipSync(zippable);
  if (newZipBytes.byteLength > MAX_ZIP_BYTES) {
    return json(req, { error: "Re-zipped package exceeds 50 MB size limit" }, 413);
  }

  // 6. Re-hash
  const newHash = await sha256Hex(newZipBytes);

  // 7. Re-upload to same storage path (overwrites original)
  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(pkg.storage_path, newZipBytes, { contentType: "application/zip", upsert: true });
  if (uploadError) {
    return json(req, { error: `Storage upload failed: ${uploadError.message}` }, 502);
  }

  // 8. Update content_sha256 to reflect the modified package
  const { error: hashUpdateError } = await admin
    .from("learning_packages")
    .update({ content_sha256: newHash })
    .eq("id", pkg.id);
  if (hashUpdateError) {
    return json(req, { error: `Failed to update content hash: ${hashUpdateError.message}` }, 502);
  }

  // 9. Mark accepted via RPC (uses the caller JWT so auth.uid() is correct in audit log)
  const reason = (body.reason ?? "").trim().length >= 8
    ? body.reason!.trim()
    : "Accepted after structural authoring review";
  const { error: rpcError } = await caller.rpc("accept_learning_package", {
    p_package_id: body.package_id,
    p_entry_point: entryPoint,
    p_reason: reason,
  });
  if (rpcError) return json(req, { error: rpcError.message }, 400);

  return json(req, { success: true, contentSha256: newHash, entryPoint });
});
