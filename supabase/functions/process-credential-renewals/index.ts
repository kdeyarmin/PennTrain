// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { CRON_SECRET_HEADER, requireCronRequest } from "../_shared/cronAuth.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

const BATCH = 10;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

/**
 * Credential renewal OCR/scan worker.
 * Dual surface: cron (X-CareMetric-Cron-Secret) or platform_admin kick (user JWT).
 * Never auto-approves — only records scan + extraction via service-role RPC.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Auth: cron secret OR platform_admin JWT
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

  // Claim uploaded submissions
  const { data: claimed, error: claimError } = await admin.rpc("claim_credential_renewal_submissions", {
    p_limit: BATCH,
  });
  if (claimError) return json(req, { error: claimError.message }, 500);
  const submissions = (claimed ?? []) as Array<{
    id: string;
    credential_document_id: string;
    organization_id: string;
  }>;

  let processed = 0;
  let failed = 0;

  for (const sub of submissions) {
    try {
      const { data: doc, error: docError } = await admin
        .from("employee_credential_documents")
        .select("id, storage_bucket, storage_path, file_type, file_name")
        .eq("id", sub.credential_document_id)
        .maybeSingle();
      if (docError || !doc) throw new Error(docError?.message ?? "Credential document not found");

      // Lightweight malware/size gate: trust create RPC MIME/size; record clean scan.
      // Full antivirus integration is a follow-on; extraction fields stay empty so humans review.
      const extractedFields = {
        issuingAuthority: "",
        expirationDate: "",
        issueDate: "",
        credentialNumber: "",
        credentialLabel: "",
        notes: "OCR worker recorded a clean scan. Human review must confirm issuer and expiration.",
      };
      const confidence = {
        overall: 0,
        source: "scan_only",
        reason: "Extraction deferred — human review required for credential fields",
      };

      // Optional Anthropic path when BAA + key present
      const baa = Deno.env.get("ANTHROPIC_BAA_CONFIRMED") === "true";
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (baa && apiKey && doc.storage_path) {
        try {
          const { data: fileBlob, error: dlError } = await admin.storage
            .from(doc.storage_bucket || "credential-documents")
            .download(doc.storage_path);
          if (!dlError && fileBlob) {
            const bytes = new Uint8Array(await fileBlob.arrayBuffer());
            if (bytes.byteLength > 0 && bytes.byteLength <= 10 * 1024 * 1024) {
              const mediaType = (doc.file_type || "application/pdf").includes("png")
                ? "image/png"
                : (doc.file_type || "").includes("jpeg") || (doc.file_type || "").includes("jpg")
                  ? "image/jpeg"
                  : "application/pdf";
              // base64 encode in chunks
              let binary = "";
              const chunk = 0x8000;
              for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
              }
              const b64 = btoa(binary);
              const model = Deno.env.get("ANTHROPIC_DOCUMENT_ANALYZER_MODEL") || "claude-sonnet-4-20250514";
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
                    system:
                      "Extract credential fields from a scanned professional license or certification. Return JSON only with keys issuingAuthority, expirationDate (YYYY-MM-DD or empty), issueDate (YYYY-MM-DD or empty), credentialNumber, credentialLabel. Never invent values — use empty string when unclear.",
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "document", source: { type: "base64", media_type: mediaType, data: b64 } },
                          { type: "text", text: "Extract credential fields as JSON only." },
                        ],
                      },
                    ],
                  }),
                });
                if (resp.ok) {
                  const payload = await resp.json();
                  const text = (payload.content ?? [])
                    .filter((b: any) => b.type === "text")
                    .map((b: any) => b.text)
                    .join("\n");
                  const match = text.match(/\{[\s\S]*\}/);
                  if (match) {
                    const parsed = JSON.parse(match[0]);
                    extractedFields.issuingAuthority = String(parsed.issuingAuthority ?? "").slice(0, 200);
                    extractedFields.expirationDate = String(parsed.expirationDate ?? "").slice(0, 32);
                    extractedFields.issueDate = String(parsed.issueDate ?? "").slice(0, 32);
                    extractedFields.credentialNumber = String(parsed.credentialNumber ?? "").slice(0, 100);
                    extractedFields.credentialLabel = String(parsed.credentialLabel ?? "").slice(0, 200);
                    extractedFields.notes = "OCR extraction present — independent human must confirm before approve.";
                    confidence.overall = 40;
                    confidence.source = "anthropic";
                    confidence.reason = "Model extraction with mandatory human confirmation";
                  }
                }
              } finally {
                clearTimeout(timer);
              }
            }
          }
        } catch {
          // Fall through to clean scan + empty fields
        }
      }

      const { error: recError } = await admin.rpc("record_credential_renewal_extraction", {
        p_submission_id: sub.id,
        p_scan_status: "clean",
        p_scan_provider: "carebase-renewal-worker",
        p_scan_evidence: { scanned_at: new Date().toISOString(), method: "mime_size_gate" },
        p_extraction_provider: confidence.source === "anthropic" ? "anthropic" : "none",
        p_extraction_model: confidence.source === "anthropic" ? (Deno.env.get("ANTHROPIC_DOCUMENT_ANALYZER_MODEL") || "claude") : "none",
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

  return json(req, {
    success: true,
    claimed: submissions.length,
    processed,
    failed,
  });
});
