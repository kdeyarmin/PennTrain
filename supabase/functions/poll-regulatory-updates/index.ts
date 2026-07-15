import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const HEADERS = withCronCorsHeader({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });

function normalizeOfficialPage(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const authError = requireCronRequest(req, HEADERS);
  if (authError) return authError;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ error: "Supabase service credentials are missing" }), { status: 500, headers: HEADERS });
  const admin = createClient(url, key);
  const { data: sources, error } = await admin.from("regulatory_update_sources")
    .select("source_key,source_uri").eq("is_active", true).order("source_key");
  if (error) return new Response(JSON.stringify({ error: "Failed to load regulatory sources" }), { status: 500, headers: HEADERS });
  const results: Array<Record<string, unknown>> = [];
  for (const source of sources ?? []) {
    let status = 599;
    let normalized = "";
    let metadata: Record<string, unknown> = {};
    try {
      const response = await fetch(source.source_uri, {
        headers: { "User-Agent": "CareMetric-Regulatory-Monitor/1.0 (+https://cmcarebase.com)" },
        signal: AbortSignal.timeout(30_000), redirect: "follow",
      });
      status = response.status;
      const raw = await response.text();
      normalized = normalizeOfficialPage(raw).slice(0, 500_000);
      metadata = {
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        finalUrl: response.url,
        rawBytes: raw.length,
      };
    } catch (fetchError) {
      metadata = { error: fetchError instanceof Error ? fetchError.message.slice(0, 500) : "fetch_failed" };
    }
    const checksum = status >= 200 && status < 300 && normalized.length >= 40 ? await sha256(normalized) : null;
    const { data, error: recordError } = await admin.rpc("record_regulatory_source_snapshot", {
      p_source_key: source.source_key,
      p_http_status: status,
      p_source_checksum_sha256: checksum,
      p_normalized_content: normalized || null,
      p_response_metadata: metadata,
    });
    results.push({ sourceKey: source.source_key, httpStatus: status, ...(recordError ? { error: recordError.message } : { result: data }) });
  }
  const failed = results.filter((result) => "error" in result).length;
  return new Response(JSON.stringify({ checked: results.length, failed, results }), { status: failed === results.length && failed > 0 ? 502 : 200, headers: HEADERS });
});
