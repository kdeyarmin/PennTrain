// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

// Public evidence-room guest download. Guests have no Supabase session -- their whole
// identity is the grant token, so authorization happens in the database:
// authorize_evidence_guest_artifact re-checks every fail-closed condition (revocation,
// expiry, terms, scope, withdrawal, tenant status) and logs the download event before
// this function signs the stored object. The signed URL is short-lived; nothing here
// widens what the grant already allows.

const SIGNED_URL_TTL_SECONDS = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const requestIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Evidence guest download is missing required Supabase environment variables");
    return json({ error: "Service is not configured" }, 500);
  }

  let body: { token?: string; artifactId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.token !== "string" || body.token.length < 16 || typeof body.artifactId !== "string") {
    return json({ error: "token and artifactId are required" }, 400);
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const fingerprint = await sha256Hex(`${requestIp(req)}|${req.headers.get("user-agent") ?? ""}`);

  const { data: decision, error: authorizeError } = await adminClient.rpc("authorize_evidence_guest_artifact", {
    p_token: body.token,
    p_artifact_id: body.artifactId,
    p_event_type: "download",
    p_fingerprint: fingerprint,
  });
  if (authorizeError) {
    console.error("evidence guest authorization failed", authorizeError.message);
    return json({ error: "Authorization failed" }, 500);
  }
  if (!decision?.authorized) {
    return json({ authorized: false, reason: "access_denied" }, 403);
  }

  // The RPC only authorizes; the storage location comes from the immutable snapshot
  // artifact the collection entry points at.
  const { data: artifact, error: artifactError } = await adminClient
    .from("evidence_collection_artifacts")
    .select("id, display_name, snapshot_artifact_id")
    .eq("id", body.artifactId)
    .maybeSingle();
  if (artifactError || !artifact) return json({ error: "Artifact not found" }, 404);

  const { data: snapshotArtifact, error: snapshotError } = await adminClient
    .from("report_snapshot_artifacts")
    .select("storage_bucket, storage_path")
    .eq("id", artifact.snapshot_artifact_id)
    .maybeSingle();
  if (snapshotError || !snapshotArtifact) return json({ error: "Stored artifact not found" }, 404);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(snapshotArtifact.storage_bucket)
    .createSignedUrl(snapshotArtifact.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    console.error("evidence guest signing failed", signedUrlError?.message);
    return json({ error: "Failed to create download link" }, 500);
  }

  return json({
    authorized: true,
    url: signedUrlData.signedUrl,
    displayName: artifact.display_name,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
});
