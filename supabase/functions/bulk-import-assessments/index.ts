// @ts-nocheck -- retained: jsr:@std/csv typed output causes inference errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv/parse";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { acquireImportJobLease } from "../_shared/importJobLease.ts";
import { MAX_IMPORT_BODY_BYTES, readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_COLUMNS = ["resident_external_id", "assessment_type"];
const DOMAIN = "assessments";
const TARGET = "resident_assessment_forms";
const REASONS = new Set(["initial", "annual", "significant_change", "department_request"]);

interface ImportRowResult {
  row: number;
  success: boolean;
  error?: string;
  record_id?: string;
  action?: "create" | "update" | "skip";
  preview?: boolean;
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) =>
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

function normalizeFormType(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  if (t === "RASP" || t === "ASP") return t;
  if (t.includes("ASP") && !t.includes("RASP")) return "ASP";
  if (t.includes("RASP") || t.includes("RESIDENT")) return "RASP";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: profile } = await callerClient
    .from("profiles").select("role, organization_id, is_active").eq("id", user.id).single();
  if (!profile?.is_active) return json(req, { error: "Caller profile not found or inactive" }, 403);
  if (!["platform_admin", "org_admin", "facility_manager"].includes(profile.role as string)) {
    return json(req, { error: "not authorized to import assessments" }, 403);
  }

  let body: any;
  try { body = await readJsonBody(req, MAX_IMPORT_BODY_BYTES); } catch (error) {
    if (error instanceof RequestBodyError) return json(req, { error: error.message }, error.status);
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const csv = body.csv;
  if (!csv || typeof csv !== "string") return json(req, { error: "csv (string) is required" }, 400);
  const offset = Number.isFinite(body.offset) ? Math.max(0, Math.floor(body.offset)) : 0;
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(200, Math.floor(body.limit))) : null;
  const mode = body.mode === "validate" ? "validate" : "apply";
  const duplicateStrategy = ["create", "skip", "update"].includes(body.duplicate_strategy ?? "")
    ? body.duplicate_strategy
    : "create";
  if (body.job_id && !UUID_PATTERN.test(body.job_id)) return json(req, { error: "job_id must be a UUID" }, 400);

  const effectiveOrgId = profile.role === "platform_admin" ? body.organization_id : profile.organization_id;
  if (!effectiveOrgId) return json(req, { error: "organization_id is required" }, 400);

  let rows: Record<string, string | undefined>[];
  try { rows = (await parse(csv, { skipFirstRow: true, strip: true })) as any; }
  catch (e) { return json(req, { error: `Failed to parse CSV: ${(e as Error).message}` }, 400); }
  if (rows.length === 0) return json(req, { error: "CSV contains no data rows" }, 400);
  if (rows.length > 1000) return json(req, { error: "CSV exceeds the 1000-row import limit" }, 400);
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) return json(req, { error: `CSV is missing required columns: ${missing.join(", ")}` }, 400);

  const fileSha256 = await sha256Hex(csv);
  let jobId = body.job_id ?? null;
  if (!jobId) {
    const { data, error } = await callerClient.rpc("start_data_import_job", {
      p_domain: DOMAIN,
      p_file_name: (body.file_name ?? "assessments.csv").slice(0, 255),
      p_file_sha256: fileSha256,
      p_total_rows: rows.length,
      p_duplicate_strategy: duplicateStrategy,
      p_facility_id: null,
      p_organization_id: profile.role === "platform_admin" ? effectiveOrgId : null,
    });
    if (error) return json(req, { error: `Unable to start import job: ${error.message}` }, 400);
    jobId = data as string;
  } else {
    const { data: existingJob, error: jobError } = await callerClient.from("data_import_jobs")
      .select("domain,status,original_file_sha256,duplicate_strategy").eq("id", jobId).single();
    if (jobError || !existingJob) return json(req, { error: "Import job was not found in your scope" }, 404);
    if (existingJob.domain !== DOMAIN) return json(req, { error: "Import job domain does not match this processor" }, 409);
    if (existingJob.original_file_sha256 !== fileSha256) return json(req, { error: "CSV checksum does not match" }, 409);
    if (existingJob.duplicate_strategy !== duplicateStrategy) return json(req, { error: "Duplicate strategy cannot change" }, 409);
    const allowed = mode === "validate" ? ["uploaded", "mapping", "validated", "ready", "failed"] : ["ready", "applying", "failed"];
    if (!allowed.includes(existingJob.status)) {
      return json(req, { error: `Import job in ${existingJob.status} cannot continue` }, 409);
    }
  }

  // Nothing reaches a customer's tables until this job's claim is ours. The durable worker
  // (process-data-import-jobs) cannot tell an in-progress browser apply from a stranded one, so
  // without a claim it applies the same ledger rows this run is walking -- see G34.
  const leaseError = await acquireImportJobLease(callerClient, jobId);
  if (leaseError) return json(req, { error: leaseError, job_id: jobId }, 409);

  // An omitted limit is capped to the ledger RPC's 200-row chunk contract rather than the whole
  // file -- see bulk-import-employees for the failure this prevents. Callers page via nextOffset.
  const endIndex = Math.min(offset + (limit ?? 200), rows.length);
  if (offset >= rows.length) {
    return json(req, {
      success: true, mode, job_id: jobId, total: 0, succeeded: 0, failed: 0, results: [],
      totalRows: rows.length, offset, nextOffset: null,
    });
  }

  const results: ImportRowResult[] = [];
  const ledgerRows: any[] = [];
  const { data: existingLedgers } = await callerClient.from("data_import_rows")
    .select("row_number, status, target_id, proposed_action").eq("job_id", jobId)
    .gte("row_number", offset + 2).lte("row_number", endIndex + 1);
  const ledgerMap = new Map((existingLedgers ?? []).map((r: any) => [r.row_number, r]));

  for (let index = offset; index < endIndex; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const existingLedger = ledgerMap.get(rowNumber);
    if (existingLedger && ["applied", "skipped", "reverted"].includes(existingLedger.status)) {
      results.push({
        row: rowNumber,
        success: existingLedger.status !== "reverted",
        record_id: existingLedger.target_id ?? undefined,
        action: existingLedger.proposed_action,
        preview: mode === "validate",
      });
      continue;
    }

    const externalId = row.resident_external_id?.trim();
    const formType = normalizeFormType(row.assessment_type);
    const assessmentDate = row.assessment_date?.trim() || null;
    const requestedStatus = (row.status?.trim() || "draft").toLowerCase();
    const reasonRaw = (row.reason?.trim() || "initial").toLowerCase();
    const sourceRef = row.source_reference?.trim() || null;
    const rowErrors: string[] = [];
    const warnings: string[] = [];

    if (!externalId) rowErrors.push("resident_external_id is required");
    if (!formType) rowErrors.push("assessment_type must be RASP or ASP");
    if (assessmentDate && !DATE_PATTERN.test(assessmentDate)) rowErrors.push("assessment_date must be YYYY-MM-DD");
    if (!REASONS.has(reasonRaw)) {
      rowErrors.push("reason must be one of: initial, annual, significant_change, department_request");
    }
    if (requestedStatus === "finalized") {
      warnings.push("Imports always create draft forms; finalize in the resident assessment workflow.");
    } else if (requestedStatus !== "draft" && requestedStatus !== "") {
      rowErrors.push("status must be draft or finalized");
    }

    let resident: { id: string; facility_id: string; organization_id: string } | null = null;
    if (!rowErrors.length) {
      // BACKLOG J39. `residents.external_id` (20260906130000) is the source system's identifier.
      // `preferred_name` is checked only as a documented fallback, for residents imported before
      // that column existed, when the identifier was stashed there as `import:{id}` -- a field
      // printed on the face sheet and freely editable, which is why it stopped being the carrier.
      const { data } = await callerClient.from("residents").select("id, facility_id, organization_id")
        .eq("organization_id", effectiveOrgId)
        .eq("external_id", externalId)
        .limit(1).maybeSingle();
      let match = data;
      if (!match) {
        const legacy = await callerClient.from("residents").select("id, facility_id, organization_id")
          .eq("organization_id", effectiveOrgId)
          .eq("preferred_name", `import:${externalId}`)
          .limit(1).maybeSingle();
        match = legacy.data;
      }
      if (!match) rowErrors.push(`Unknown resident_external_id: ${externalId} (import residents first with a matching external_id)`);
      else resident = match;
    }

    let existing: any = null;
    if (!rowErrors.length && resident && formType) {
      // Match by source_reference only when the CSV carries one: the stored marker holds
      // `source_reference: null` for rows imported without it, and matching on "" never found
      // those -- a re-uploaded two-column CSV then previewed every row as a clean create and
      // apply silently duplicated the drafts.
      let bySourceRef: any = null;
      if (sourceRef) {
        const { data } = await callerClient.from("resident_assessment_forms").select("*")
          .eq("resident_id", resident.id)
          .eq("form_type", formType)
          .eq("status", "draft")
          .contains("content", { csv_import: { source_reference: sourceRef } })
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();
        bySourceRef = data;
      }
      if (bySourceRef) {
        existing = bySourceRef;
      } else if (assessmentDate) {
        // Fallback match: same form_type + prepared_date draft for this resident -- but only
        // drafts that already carry the csv_import marker. Matching ANY draft here let an
        // update-strategy import overwrite a nurse's hand-authored in-progress form with the
        // import stub, and rollback cannot restore an overwrite (it reverts creates only).
        const { data: byDate } = await callerClient.from("resident_assessment_forms").select("*")
          .eq("resident_id", resident.id)
          .eq("form_type", formType)
          .eq("status", "draft")
          .eq("prepared_date", assessmentDate)
          .contains("content", { csv_import: {} })
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();
        existing = byDate;
      }
    }

    let action: "create" | "update" | "skip" = "create";
    if (existing) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") rowErrors.push("Matching draft assessment exists; choose skip or update.");
      else if (duplicateStrategy === "skip") warnings.push("Existing draft assessment matched and will be skipped.");
      else warnings.push("Existing draft assessment will be updated.");
    }

    const payload = {
      organization_id: effectiveOrgId,
      facility_id: resident?.facility_id,
      resident_id: resident?.id,
      form_type: formType,
      reason: reasonRaw,
      status: "draft",
      prepared_date: assessmentDate,
      content: {
        csv_import: {
          source_reference: sourceRef,
          job_id: jobId,
          imported_at: new Date().toISOString(),
          requested_status: requestedStatus || "draft",
        },
      },
      version_number: 1,
      schema_version: 1,
    };

    if (rowErrors.length) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({
        rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "invalid",
        targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: rowErrors, warnings,
      });
      continue;
    }
    if (action === "skip") {
      results.push({ row: rowNumber, success: true, record_id: existing.id, action, preview: mode === "validate" });
      ledgerRows.push({
        rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "skipped",
        targetTable: TARGET, targetId: existing.id, beforeSnapshot: existing, errors: [], warnings,
      });
      continue;
    }
    if (mode === "validate") {
      results.push({ row: rowNumber, success: true, record_id: existing?.id, action, preview: true });
      ledgerRows.push({
        rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "valid",
        targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: [], warnings,
      });
      continue;
    }

    let data: any = null;
    let error: any = null;
    if (action === "update") {
      const res = await callerClient.from("resident_assessment_forms").update({
        reason: reasonRaw,
        prepared_date: assessmentDate,
        content: payload.content,
      }).eq("id", existing.id).select("id").single();
      data = res.data; error = res.error;
    } else {
      const res = await callerClient.from("resident_assessment_forms").insert(payload).select("id").single();
      data = res.data; error = res.error;
    }
    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({
        rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "failed",
        targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: [error.message], warnings,
      });
    } else {
      results.push({ row: rowNumber, success: true, record_id: data.id, action });
      // Receipt each applied row before touching the next one -- batching receipts at chunk
      // end meant a died tab left rows written but still "valid" in the ledger, and the
      // durable worker's rescue then re-applied them as duplicates (the fix bulk-import-
      // employees already carries; see its per-row receipt comment).
      const { error: receiptError } = await callerClient.rpc("record_data_import_row_receipt", {
        p_job_id: jobId,
        p_row: { rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "applied", targetTable: TARGET, targetId: data.id, beforeSnapshot: existing, errors: [], warnings },
      });
      if (receiptError) {
        return json(req, { error: `Row ${rowNumber} was applied but its import receipt failed: ${receiptError.message}`, job_id: jobId }, 500);
      }
    }
  }

  const nextOffset = endIndex < rows.length ? endIndex : null;
  const jobStatus = mode === "validate"
    ? (nextOffset === null ? "ready" : "validated")
    : (nextOffset === null ? "applied" : "applying");
  const { error: ledgerError } = await callerClient.rpc("record_data_import_chunk", {
    p_job_id: jobId, p_rows: ledgerRows, p_job_status: jobStatus, p_last_error: null,
  });
  if (ledgerError) return json(req, { error: `Import receipt failed: ${ledgerError.message}`, job_id: jobId }, 500);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return json(req, {
    success: true, mode, job_id: jobId, total: results.length, succeeded, failed, results,
    totalRows: rows.length, offset, nextOffset,
    can_finalize: nextOffset === null && failed === 0,
    can_rollback: mode === "apply" && nextOffset === null && succeeded > 0,
  });
});
