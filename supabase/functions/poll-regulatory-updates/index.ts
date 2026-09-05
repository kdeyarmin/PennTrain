import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import { summarizeRegulatorySourceChange } from "../_shared/regulatoryDiff.ts";

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

// The definition this worker reports against. Its execution_kind stayed `sql_cron` until
// 20260905250000 because relabelling it to `edge_cron` first requires this: the watchdog reads
// freshness for a non-sql_cron kind off `system_job_runs`, so a definition relabelled before its
// function claims a run is stale from the first tick and stays that way. See 20260904090000, which
// documented that trap while fixing two other jobs, and BACKLOG.md I17.
const JOB_KEY = "regulatory-update-polling";

Deno.serve(async (req: Request) => {
  const authError = requireCronRequest(req, HEADERS);
  if (authError) return authError;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ error: "Supabase service credentials are missing" }), { status: 500, headers: HEADERS });
  const admin = createClient(url, key);

  // Claimed BEFORE any work, so a run that dies mid-sweep leaves a claimed row for the reconciler
  // to close as `abandoned_run` rather than no trace that the invocation happened at all.
  const { data: claimRows, error: claimError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: JOB_KEY,
    p_correlation_id: req.headers.get("X-Correlation-Id") ?? crypto.randomUUID(),
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  });
  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: HEADERS });
  }
  const run = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!run?.should_execute) {
    return new Response(
      JSON.stringify({ skipped: true, status: run?.existing_status ?? "skipped" }),
      { status: 200, headers: HEADERS },
    );
  }
  const runId = run.run_id;

  const finish = async (
    status: string,
    attempted: number,
    succeeded: number,
    failed: number,
    errorCode: string | null,
    errorMessage: string | null,
  ) => {
    const { error: finishError } = await admin.rpc("finish_system_job", {
      p_run_id: runId,
      p_status: status,
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failed,
      p_result: {},
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
    // Logged rather than swallowed: a finalize that fails leaves the run claimed, and the only
    // thing worse than not knowing is not knowing why.
    if (finishError) console.error("finish_system_job failed", finishError.message);
  };

  const { data: sources, error } = await admin.from("regulatory_update_sources")
    .select("id,source_key,source_uri").eq("is_active", true).order("source_key");
  if (error) {
    await finish("failed", 0, 0, 1, "sources_unavailable", error.message.slice(0, 2000));
    return new Response(JSON.stringify({ error: "Failed to load regulatory sources" }), { status: 500, headers: HEADERS });
  }
  const results: Array<Record<string, unknown>> = [];
  for (const source of sources ?? []) {
    const { data: previousSnapshot } = await admin.from("regulatory_source_snapshots")
      .select("source_checksum_sha256,normalized_content")
      .eq("source_id", source.id).eq("fetch_succeeded", true)
      .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
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
    if (!recordError && data?.changed && data?.snapshotId && previousSnapshot?.normalized_content) {
      const changeSummary = {
        sourceKey: source.source_key,
        previousChecksum: previousSnapshot.source_checksum_sha256,
        newChecksum: checksum,
        detectedAt: new Date().toISOString(),
        ...summarizeRegulatorySourceChange(previousSnapshot.normalized_content, normalized),
      };
      const { error: summaryError } = await admin.from("regulatory_change_proposals")
        .update({ change_summary: changeSummary }).eq("source_snapshot_id", data.snapshotId);
      if (summaryError) {
        results.push({ sourceKey: source.source_key, httpStatus: status, error: "Source change was recorded, but its grounded diff summary could not be saved" });
        continue;
      }
    }
    results.push({ sourceKey: source.source_key, httpStatus: status, ...(recordError ? { error: recordError.message } : { result: data }) });
  }
  const failed = results.filter((result) => "error" in result).length;
  // An empty source list is a successful run with nothing attempted, which is what keeps the
  // freshness signal alive on a week with no sources configured -- staying silent when idle would
  // make a quiet week and a dead worker look identical.
  await finish(
    failed === 0 ? "succeeded" : failed === results.length ? "failed" : "partial",
    results.length,
    results.length - failed,
    failed,
    failed > 0 ? "source_fetch_failed" : null,
    failed > 0 ? `${failed} of ${results.length} regulatory sources failed` : null,
  );
  return new Response(JSON.stringify({ checked: results.length, failed, results }), { status: failed === results.length && failed > 0 ? 502 : 200, headers: HEADERS });
});
