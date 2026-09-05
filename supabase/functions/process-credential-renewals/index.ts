// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { CRON_SECRET_HEADER, requireCronRequest } from "../_shared/cronAuth.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

const BATCH = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

function emptyExtraction(notes: string) {
  return {
    fields: {
      issuingAuthority: "",
      expirationDate: "",
      issueDate: "",
      credentialNumber: "",
      credentialLabel: "",
      notes,
    },
    confidence: {
      overall: 0,
      source: "scan_only",
      reason: "Extraction deferred — human review required for credential fields",
    },
  };
}

function sanitizeDate(value: unknown): string {
  const s = typeof value === "string" ? value.trim().slice(0, 32) : "";
  if (!s) return "";
  if (DATE_PATTERN.test(s)) return s;
  // Accept common MM/DD/YYYY → YYYY-MM-DD when unambiguous
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return "";
}

function sanitizeField(value: unknown, max: number): string {
  if (typeof value !== "string") return value == null ? "" : String(value).slice(0, max);
  return value.trim().slice(0, max);
}

/**
 * Credential renewal OCR/scan worker.
 * Dual surface: cron (X-CareMetric-Cron-Secret) or platform_admin kick (user JWT).
 * Never auto-approves — only records scan + extraction via service-role RPC.
 */
// The definition this worker reports against.
const JOB_KEY = "process-credential-renewals";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let authorized = false;
  if (req.headers.has(CRON_SECRET_HEADER)) {
    const denied = requireCronRequest(req, corsHeadersForRequest(req));
    if (denied) return denied;
    authorized = true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await caller.auth.getUser();
    if (error || !user) return json(req, { error: "Invalid or expired session" }, 401);
    const { data: profile } = await caller.from("profiles").select("role, is_active").eq("id", user.id).single();
    if (!profile?.is_active || profile.role !== "platform_admin") {
      return json(req, { error: "Only platform administrators may kick the renewal OCR worker" }, 403);
    }
    authorized = true;
  }
  if (!authorized) return json(req, { error: "Unauthorized" }, 401);

  // Report against the definition BEFORE any work, so a run that dies mid-batch leaves a claimed
  // row for the reconciler to close as `abandoned_run` rather than no trace that the invocation
  // happened. Its execution_kind stayed `sql_cron` until 20260905250000 because relabelling it to
  // `edge_cron` first requires exactly this: the watchdog reads freshness for a non-sql_cron kind
  // off system_job_runs, so a definition relabelled before its function claims a run is stale from
  // the first tick and stays that way (20260904090000 documented that trap). BACKLOG.md I17.
  const { data: claimRows, error: runClaimError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: JOB_KEY,
    p_correlation_id: req.headers.get("X-Correlation-Id") ?? crypto.randomUUID(),
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  });
  if (runClaimError) return json(req, { error: runClaimError.message }, 500);
  const run = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!run?.should_execute) {
    return json(req, { success: true, skipped: true, status: run?.existing_status ?? "skipped" });
  }
  const runId = run.run_id;
  const finishRun = async (
    status: string,
    attempted: number,
    succeeded: number,
    failedCount: number,
    errorCode: string | null,
    errorMessage: string | null,
  ) => {
    const { error: finishError } = await admin.rpc("finish_system_job", {
      p_run_id: runId,
      p_status: status,
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failedCount,
      p_result: {},
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
    if (finishError) console.error("finish_system_job failed", finishError.message);
  };

  const { data: claimed, error: claimError } = await admin.rpc("claim_credential_renewal_submissions", {
    p_limit: BATCH,
  });
  if (claimError) {
    await finishRun("failed", 0, 0, 1, "queue_unavailable", claimError.message.slice(0, 2000));
    return json(req, { error: claimError.message }, 500);
  }
  const submissions = (claimed ?? []) as Array<{
    id: string;
    credential_document_id: string;
    organization_id: string;
  }>;

  let processed = 0;
  let failed = 0;
  let extracted = 0;
  const extractionErrors: string[] = [];

  for (const sub of submissions) {
    try {
      const { data: doc, error: docError } = await admin
        .from("employee_credential_documents")
        .select("id, storage_bucket, storage_path, file_type, file_name")
        .eq("id", sub.credential_document_id)
        .maybeSingle();
      if (docError || !doc) throw new Error(docError?.message ?? "Credential document not found");

      let { fields: extractedFields, confidence } = emptyExtraction(
        "No malware scan was performed. Human review must confirm issuer and expiration.",
      );
      let extractionProvider = "none";
      let extractionModel = "none";
      let extractionAttemptError: string | null = null;

      // BACKLOG.md I23. This worker used to record `scan_status: "clean"` unconditionally, with
      // evidence naming a `mime_size_gate` that did not exist outside the extraction branch -- so a
      // deployment with no extraction provider recorded every submitted file as malware-clean
      // having opened none of them, and the review UI gated on exactly that label. There is no
      // malware scanner here and this does not pretend to be one. What it can honestly do is refuse
      // a file that is empty, oversized, or not one of the three types this product accepts, and
      // then say plainly that nothing scanned the rest.
      const ACCEPTED_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
      const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
      const declaredType = (doc.file_type || "application/pdf").toLowerCase();
      const mediaType: (typeof ACCEPTED_MEDIA_TYPES)[number] = declaredType.includes("png")
        ? "image/png"
        : declaredType.includes("jpeg") || declaredType.includes("jpg")
          ? "image/jpeg"
          : "application/pdf";

      if (!doc.storage_path) throw new Error("Credential document has no stored file");
      const { data: fileBlob, error: dlError } = await admin.storage
        .from(doc.storage_bucket || "credential-documents")
        .download(doc.storage_path);
      if (dlError || !fileBlob) throw new Error(dlError?.message ?? "Document download failed");
      const bytes = new Uint8Array(await fileBlob.arrayBuffer());
      const gateFailure = bytes.byteLength === 0
        ? "The uploaded file is empty."
        : bytes.byteLength > MAX_DOCUMENT_BYTES
          ? `The uploaded file is ${Math.round(bytes.byteLength / 1024 / 1024)}MB; the limit is 10MB.`
          : !ACCEPTED_MEDIA_TYPES.some((accepted) => declaredType.includes(accepted.split("/")[1]))
            ? `The uploaded file is declared as ${declaredType}; only PDF, PNG and JPEG are accepted.`
            : null;
      const scanEvidence = {
        scanned_at: new Date().toISOString(),
        method: "mime_size_gate",
        malware_scanner: "none configured",
        byte_length: bytes.byteLength,
        declared_type: declaredType,
        gate_failure: gateFailure,
      };
      if (gateFailure) {
        // A file this gate refuses is not a scanning failure, it is a bad upload, and the employee
        // needs to hear which. `failed` is the terminal state the reviewer sees.
        const { error: gateError } = await admin.rpc("record_credential_renewal_extraction", {
          p_submission_id: sub.id,
          p_scan_status: "failed",
          p_scan_provider: "carebase-renewal-worker",
          p_scan_evidence: scanEvidence,
          p_extraction_provider: "none",
          p_extraction_model: "none",
          p_extracted_fields: { notes: gateFailure },
          p_confidence: { overall: 0, source: "gate", reason: gateFailure },
        });
        if (gateError) throw new Error(gateError.message);
        failed += 1;
        continue;
      }

      const baa = Deno.env.get("ANTHROPIC_BAA_CONFIRMED") === "true";
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (baa && apiKey) {
        try {
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const b64 = btoa(binary);
          const model = Deno.env.get("ANTHROPIC_DOCUMENT_ANALYZER_MODEL")
            || Deno.env.get("ANTHROPIC_CREDENTIAL_RENEWAL_MODEL")
            || "claude-sonnet-4-20250514";
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                max_tokens: 1024,
                tools: [
                  {
                    name: "emit_credential_fields",
                    description: "Emit extracted credential fields from a license or certification scan. Use empty strings when unclear — never invent values.",
                    input_schema: {
                      type: "object",
                      properties: {
                        issuingAuthority: { type: "string" },
                        expirationDate: { type: "string", description: "YYYY-MM-DD or empty" },
                        issueDate: { type: "string", description: "YYYY-MM-DD or empty" },
                        credentialNumber: { type: "string" },
                        credentialLabel: { type: "string" },
                        confidence: { type: "integer", description: "0-100 overall confidence" },
                      },
                      required: [
                        "issuingAuthority",
                        "expirationDate",
                        "issueDate",
                        "credentialNumber",
                        "credentialLabel",
                        "confidence",
                      ],
                    },
                  },
                ],
                tool_choice: { type: "tool", name: "emit_credential_fields" },
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "document", source: { type: "base64", media_type: mediaType, data: b64 } },
                      {
                        type: "text",
                        text: "Extract professional credential fields. Call emit_credential_fields. Never invent values.",
                      },
                    ],
                  },
                ],
              }),
            });
            if (!resp.ok) {
              const errText = await resp.text().catch(() => "");
              throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 200)}`);
            }
            const payload = await resp.json();
            const toolBlock = (payload.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "emit_credential_fields");
            let parsed: Record<string, unknown> | null = toolBlock?.input ?? null;
            if (!parsed) {
              const text = (payload.content ?? [])
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("\n");
              const match = text.match(/\{[\s\S]*\}/);
              if (match) parsed = JSON.parse(match[0]);
            }
            if (!parsed) throw new Error("Model returned no structured credential fields");

            const overall = Math.max(0, Math.min(100, Number(parsed.confidence ?? 40) || 40));
            extractedFields = {
              issuingAuthority: sanitizeField(parsed.issuingAuthority, 200),
              expirationDate: sanitizeDate(parsed.expirationDate),
              issueDate: sanitizeDate(parsed.issueDate),
              credentialNumber: sanitizeField(parsed.credentialNumber, 100),
              credentialLabel: sanitizeField(parsed.credentialLabel, 200),
              notes: "Structured OCR extraction present — independent human must confirm before approve.",
            };
            confidence = {
              overall,
              source: "anthropic",
              reason: "Structured tool extraction with mandatory human confirmation",
              fieldPresence: {
                issuingAuthority: Boolean(extractedFields.issuingAuthority),
                expirationDate: Boolean(extractedFields.expirationDate),
                issueDate: Boolean(extractedFields.issueDate),
                credentialNumber: Boolean(extractedFields.credentialNumber),
              },
            };
            extractionProvider = "anthropic";
            extractionModel = model;
            extracted += 1;
          } finally {
            clearTimeout(timer);
          }
        } catch (e) {
          extractionAttemptError = String((e as Error)?.message ?? e).slice(0, 400);
          extractionErrors.push(`${sub.id.slice(0, 8)}: ${extractionAttemptError}`);
          // Fall through to clean scan + empty fields; surface error in notes for the reviewer
          extractedFields.notes =
            `OCR extraction failed (${extractionAttemptError}). Human review must enter fields manually.`;
          confidence = {
            overall: 0,
            source: "scan_only",
            reason: "Extraction failed; the file passed the type and size gate and was not scanned",
            extractionError: extractionAttemptError,
          };
        }
      } else if (!baa || !apiKey) {
        extractedFields.notes =
          "Scan-only mode (ANTHROPIC_BAA_CONFIRMED + ANTHROPIC_API_KEY not both set). Human review required.";
        confidence.reason = "No BAA-confirmed extraction provider configured";
      }

      const { error: recError } = await admin.rpc("record_credential_renewal_extraction", {
        p_submission_id: sub.id,
        // `not_scanned`, not `clean`: nothing here inspects the file for malware, and saying
        // otherwise put a claim in the record that the product cannot stand behind.
        p_scan_status: "not_scanned",
        p_scan_provider: "carebase-renewal-worker",
        p_scan_evidence: { ...scanEvidence, extraction_error: extractionAttemptError },
        p_extraction_provider: extractionProvider,
        p_extraction_model: extractionModel,
        p_extracted_fields: extractedFields,
        p_confidence: confidence,
      });
      if (recError) throw new Error(recError.message);
      processed += 1;
    } catch (e) {
      failed += 1;
      await admin.rpc("record_credential_renewal_extraction", {
        p_submission_id: sub.id,
        p_scan_status: "failed",
        p_scan_provider: "carebase-renewal-worker",
        p_scan_evidence: { error: String((e as Error)?.message ?? e).slice(0, 500) },
        p_extraction_provider: "none",
        p_extraction_model: "none",
        p_extracted_fields: {},
        p_confidence: {},
      }).catch(() => null);
    }
  }

  // An empty queue is a successful run with nothing attempted. Staying silent when idle would
  // make a quiet ten minutes and a dead worker look identical, which is the whole class of bug
  // this instrumentation exists for.
  await finishRun(
    failed === 0 ? "succeeded" : processed === 0 ? "failed" : "partial",
    submissions.length,
    processed,
    failed,
    failed > 0 ? "renewal_extraction_failed" : null,
    failed > 0 ? extractionErrors.slice(0, 3).join(" | ").slice(0, 2000) : null,
  );

  return json(req, {
    success: true,
    claimed: submissions.length,
    processed,
    failed,
    extracted,
    extractionErrors: extractionErrors.slice(0, 10),
  });
});
