// @ts-nocheck
// State form document analyzer worker. Dual-mode like generate-compliance-binder:
//  - Cron path (X-CareMetric-Cron-Secret): claims queued document_analyzer_jobs, sends
//    each stored PDF to Anthropic for grounded extraction, and records results through
//    the leased finish RPC -- so uploads keep processing after the admin closes the tab.
//  - User path (Authorization header, platform_admin only): kicks one specific job
//    immediately after upload instead of waiting for the next cron sweep.
// Extraction never touches resident charts and never approves anything: results land on
// the job row as a draft for mandatory super-admin review.
//
// Unlike the course/wellness Anthropic callers there is no separate *_ai_generations
// audit table: the durable job row already records requested_by, the serving model,
// attempt counts, timestamps, and the failure reason for every extraction call.
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { CRON_SECRET_HEADER, requireCronRequest } from "../_shared/cronAuth.ts";
import { getAnthropicModelCandidates } from "../_shared/anthropicModels.ts";
import { ORG_AI_DISABLED_MESSAGE, orgAiAllowed, orgAiDisabledBody } from "../_shared/orgAiGate.ts";
import {
  CURRENT_STATE_FORM_TEMPLATES,
  decideExtractionStatus,
  EXTRACTION_TOOL_NAME,
  EXTRACTION_TOOL_SCHEMA,
  validateExtractionInput,
} from "../_shared/documentAnalyzerExtraction.ts";

const ANALYZER_JOB_KEY = "document-analyzer-extraction";
const ANALYZER_SETTING_KEY = "ai_document_analyzer_enabled";
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const PRIMARY_MODEL_ENV = "ANTHROPIC_DOCUMENT_ANALYZER_MODEL";
const FALLBACK_MODELS_ENV = "ANTHROPIC_DOCUMENT_ANALYZER_FALLBACK_MODELS";
const MAX_TOKENS = 8192;
const ANTHROPIC_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `You transcribe scanned historical Pennsylvania personal-care and assisted-living state forms so staff can convert them to current templates.

Non-negotiable grounding rules:
1. Extract ONLY what is visibly written or printed on the document. Never infer, guess, or fill gaps from context, medical knowledge, regulations, or typical values.
2. If a value is missing, illegible, or ambiguous, return an empty string for that field and add an issue explaining what a reviewer must verify. Mark illegible passages inside the notes transcription as [illegible].
3. Transcribe handwriting faithfully -- do not summarize, correct, or normalize it beyond obvious spacing.
4. Dates: report review_due_date exactly as written. Report admission_date in YYYY-MM-DD only when the written date is complete and unambiguous; otherwise return an empty string and raise an issue.
5. Map the document to one of these current templates, or the unknown option if unsure: ${CURRENT_STATE_FORM_TEMPLATES.join("; ")}.
6. Raise an issue for every field a human should double-check: smudged text, conflicting values, missing required information, or dates older than 12 months.
7. Set confidence honestly (0-100) from scan quality and handwriting legibility. A pristine typed form can be high; degraded handwriting must be low.

Call the ${EXTRACTION_TOOL_NAME} tool exactly once, and answer every grounding_checklist item truthfully. If you cannot satisfy a checklist item, still return your best strictly-grounded transcription, flag the shortfall with issues, and mark that item false.`;

const USER_INSTRUCTIONS =
  "Extract this scanned historical state form for super-admin review. Follow the grounding rules exactly.";

interface AnthropicCallResult {
  ok: boolean;
  model: string;
  status: number;
  body: Record<string, unknown> | null;
}

async function callAnthropicWithFallback(
  apiKey: string,
  pdfBase64: string,
  signal: AbortSignal,
  candidates: string[],
): Promise<AnthropicCallResult> {
  let last: AnthropicCallResult | null = null;

  for (const model of candidates) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: USER_INSTRUCTIONS },
          ],
        }],
        tools: [{
          name: EXTRACTION_TOOL_NAME,
          description: "Emit the grounded state form extraction.",
          input_schema: EXTRACTION_TOOL_SCHEMA,
        }],
        tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
      }),
      signal,
    });
    const bodyJson = await res.json().catch(() => null);
    if (res.ok) return { ok: true, model, status: res.status, body: bodyJson };

    const errorMessage = typeof bodyJson?.error?.message === "string" ? bodyJson.error.message : "";
    const canFallback = res.status === 404 || res.status === 429 || res.status >= 500 || (res.status === 400 && /model/i.test(errorMessage));
    last = { ok: false, model, status: res.status, body: bodyJson };
    if (!canFallback) return last;
  }

  return last!;
}

function anthropicErrorMessage(result: AnthropicCallResult) {
  return (result.body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API returned ${result.status}`;
}

function extractToolInput(anthropicBody: Record<string, unknown> | null): unknown {
  const content = (anthropicBody as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => {
    const candidate = b as { type?: string; name?: string };
    return candidate.type === "tool_use" && candidate.name === EXTRACTION_TOOL_NAME;
  });
  return (block as { input?: Record<string, unknown> } | undefined)?.input ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function isAnalyzerEnabled(client: any): Promise<boolean | null> {
  const { data, error } = await client
    .from("platform_settings")
    .select("value")
    .eq("key", ANALYZER_SETTING_KEY)
    .maybeSingle();
  if (error) return null;
  return data?.value === true;
}

// PT-019: document_analyzer_jobs has no organization column, so the job's org context
// is the requesting profile's organization_id. Uploaders are platform admins; vendor
// staff without an organization (organization_id null) are platform-internal and are
// gated only by the platform switch, while an org-bound requester is gated by their
// organization's BAA state. Fails closed on a lookup error.
async function analyzerJobOrgGate(adminClient: any, requestedBy: string | null | undefined): Promise<boolean> {
  if (!requestedBy) return false;
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("organization_id")
    .eq("id", requestedBy)
    .maybeSingle();
  if (error || !profile) return false;
  return await orgAiAllowed(adminClient, profile.organization_id);
}

// Processes one claimed job end to end. Throws to record a retryable failure through the
// finish RPC in the caller; returns the routed status on success.
async function processClaimedJob(
  adminClient: any,
  claim: { job_id: string; run_id: string; source_bucket: string; source_path: string; requested_by: string },
  apiKey: string,
  modelCandidates: string[],
): Promise<string> {
  // Per-organization BAA gate before any provider work, enforced on both the cron and
  // user paths since every extraction flows through this function.
  if (!(await analyzerJobOrgGate(adminClient, claim.requested_by))) {
    throw new AnalyzerJobError("org_ai_disabled", ORG_AI_DISABLED_MESSAGE);
  }
  const { data: blob, error: downloadError } = await adminClient.storage
    .from(claim.source_bucket)
    .download(claim.source_path);
  if (downloadError || !blob) {
    throw new AnalyzerJobError("download_failed", downloadError?.message ?? "Stored PDF could not be downloaded");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new AnalyzerJobError("download_failed", "Stored PDF is empty");
  }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new AnalyzerJobError("download_failed", "Stored PDF exceeds the 20MB analyzer limit");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  let result: AnthropicCallResult;
  try {
    result = await callAnthropicWithFallback(apiKey, bytesToBase64(bytes), controller.signal, modelCandidates);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new AnalyzerJobError("timeout", `Anthropic API request timed out after ${ANTHROPIC_TIMEOUT_MS / 1000}s`);
    }
    throw new AnalyzerJobError("anthropic_error", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timeoutId);
  }

  if (!result.ok) {
    throw new AnalyzerJobError("anthropic_error", anthropicErrorMessage(result));
  }

  // A truncated response returns HTTP 200 with an incomplete (or missing) tool block, which
  // would otherwise surface as a misleading "invalid extraction" and burn every retry.
  const stopReason = (result.body as { stop_reason?: string } | null)?.stop_reason;
  if (stopReason === "max_tokens") {
    throw new AnalyzerJobError(
      "extraction_truncated",
      `The extraction hit the ${MAX_TOKENS}-token output limit before completing -- the document's handwritten content may be too long for a single pass`,
    );
  }

  const extraction = validateExtractionInput(extractToolInput(result.body));
  if (!extraction) {
    throw new AnalyzerJobError("extraction_invalid", "AI response did not include a valid state form extraction");
  }

  const status = decideExtractionStatus(extraction);
  const { data: finished, error: finishError } = await adminClient.rpc("finish_document_analyzer_job", {
    p_job_id: claim.job_id,
    p_run_id: claim.run_id,
    p_status: status,
    p_model: result.model,
    p_page_count: extraction.page_count,
    p_confidence: extraction.confidence,
    p_resident_name: extraction.resident_name,
    p_facility_name: extraction.facility_name,
    p_state_form_template: extraction.state_form_template,
    p_review_due_date: extraction.review_due_date,
    p_admission_date: extraction.admission_date,
    p_notes: extraction.notes,
    p_issues: extraction.issues,
    p_error_code: null,
    p_error_message: null,
  });
  if (finishError) throw new AnalyzerJobError("finish_failed", finishError.message);
  if (!finished) throw new AnalyzerJobError("lease_expired", "Extraction finished after the job lease expired");
  return status;
}

class AnalyzerJobError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AnalyzerJobError";
  }
}

async function recordJobFailure(adminClient: any, claim: { job_id: string; run_id: string }, error: unknown) {
  const code = error instanceof AnalyzerJobError ? error.code : "extraction_failed";
  const message = String((error as Error)?.message ?? "State form extraction failed").slice(0, 2000);
  await adminClient.rpc("finish_document_analyzer_job", {
    p_job_id: claim.job_id,
    p_run_id: claim.run_id,
    p_status: null,
    p_error_code: code,
    p_error_message: message,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Document analyzer worker is missing required Supabase environment variables");
    return json({ error: "Service is not configured" }, 500);
  }
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  // Cron worker path: sweep queued/stale jobs so processing survives closed tabs and
  // failed user-path kicks.
  if (req.headers.has(CRON_SECRET_HEADER)) {
    const denied = requireCronRequest(req, CORS_HEADERS);
    if (denied) return denied;
    return await runWorkerBatch(req, adminClient);
  }

  // User path (platform_admin only): kick one job immediately after upload.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (callerProfile.role !== "platform_admin") {
    return json({ error: "not authorized to run the document analyzer" }, 403);
  }

  const enabled = await isAnalyzerEnabled(callerClient);
  if (enabled === null) return json({ error: "Failed to read platform AI settings" }, 500);
  if (!enabled) {
    return json({
      error: "State form extraction is currently disabled by the platform administrator. Enable it in Platform Settings once the PHI/BAA review is complete.",
    }, 403);
  }

  // Checked only after auth/role/setting so secret configuration does not leak ahead of
  // authorization.
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: { job_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.job_id) return json({ error: "job_id is required" }, 400);

  // The caller-scoped read proves visibility (platform_admin RLS) before any
  // service-role work happens on the row.
  const { data: job, error: jobError } = await callerClient
    .from("document_analyzer_jobs")
    .select("id, status, requested_by")
    .eq("id", body.job_id)
    .maybeSingle();
  if (jobError) return json({ error: jobError.message }, 500);
  if (!job) return json({ error: "document analyzer job not found" }, 404);

  // PT-019: surface a coded 403 before claiming so a denied kick does not burn one of
  // the job's limited extraction attempts. processClaimedJob re-checks the same gate.
  if (!(await analyzerJobOrgGate(adminClient, job.requested_by))) {
    return json(orgAiDisabledBody(), 403);
  }

  const workerId = crypto.randomUUID();
  const { data: claims, error: claimError } = await adminClient.rpc("claim_document_analyzer_jobs", {
    p_worker_id: workerId,
    p_job_id: body.job_id,
    p_limit: 1,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  const claim = claims?.[0];
  if (!claim) {
    // Already processing under a fresh lease, already extracted, or attempts exhausted --
    // report the row's current state and let the page's polling take over.
    return json({ success: true, status: job.status, claimed: false }, 202);
  }

  const modelCandidates = getAnthropicModelCandidates(PRIMARY_MODEL_ENV, FALLBACK_MODELS_ENV);
  try {
    const status = await processClaimedJob(adminClient, claim, anthropicApiKey, modelCandidates);
    return json({ success: true, status, claimed: true });
  } catch (jobError) {
    await recordJobFailure(adminClient, claim, jobError);
    // The queue owns retries/backoff; surface a sanitized outcome, not a hard error, so
    // the page keeps polling the row like every other job.
    return json({ success: true, status: "queued_or_failed", claimed: true }, 200);
  }
});

async function runWorkerBatch(req: Request, adminClient: any): Promise<Response> {
  const enabled = await isAnalyzerEnabled(adminClient);
  if (!enabled) {
    // Disabled (or unreadable) kill switch: leave queued jobs untouched -- they resume on
    // the first sweep after a platform admin re-enables extraction.
    return json({ success: true, skipped: true, reason: "analyzer_disabled" });
  }
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let batchSize = 2;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.batchSize)) {
      batchSize = Math.min(3, Math.max(1, Math.floor(body.batchSize)));
    }
  } catch {
    // default batch size
  }

  const { data: claimRows, error: claimError } = await adminClient.rpc("claim_system_job_execution", {
    p_job_key: ANALYZER_JOB_KEY,
    p_correlation_id: crypto.randomUUID(),
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  const run = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!run?.should_execute) {
    return json({ success: true, skipped: true, status: run?.existing_status ?? "skipped" });
  }

  const runId = run.run_id;
  const workerId = crypto.randomUUID();
  const modelCandidates = getAnthropicModelCandidates(PRIMARY_MODEL_ENV, FALLBACK_MODELS_ENV);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let batchError: string | null = null;

  try {
    for (let i = 0; i < batchSize; i++) {
      const { data: cancelled } = await adminClient.rpc("is_system_job_cancellation_requested", {
        p_run_id: runId,
      });
      if (cancelled === true) break;

      const { data: jobs, error: jobsError } = await adminClient.rpc("claim_document_analyzer_jobs", {
        p_worker_id: workerId,
        p_limit: 1,
      });
      if (jobsError) {
        batchError = jobsError.message;
        break;
      }
      const claim = jobs?.[0];
      if (!claim) break;

      attempted += 1;
      try {
        await processClaimedJob(adminClient, claim, anthropicApiKey, modelCandidates);
        succeeded += 1;
      } catch (jobError) {
        failed += 1;
        await recordJobFailure(adminClient, claim, jobError);
      }

      await adminClient.rpc("heartbeat_system_job", {
        p_run_id: runId,
        p_attempted_count: attempted,
        p_succeeded_count: succeeded,
        p_failed_count: failed,
        p_cursor: {},
      });
    }
  } finally {
    await adminClient.rpc("finish_system_job", {
      p_run_id: runId,
      p_status: batchError ? "failed" : failed > 0 ? "partial" : "succeeded",
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failed,
      p_result: {},
      p_error_code: batchError ? "batch_error" : null,
      p_error_message: batchError,
    });
  }

  return json({ success: !batchError, attempted, succeeded, failed });
}
