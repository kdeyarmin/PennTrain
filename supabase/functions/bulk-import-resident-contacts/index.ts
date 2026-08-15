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

function escapedIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const REQUIRED_COLUMNS = ["resident_external_id", "name"];
const DOMAIN = "resident_contacts";
const TARGET = "resident_contacts";
// The resident_contacts CHECK vocabulary (20260713183435_resident_administrative_master.sql).
const RESIDENT_CONTACT_TYPES = new Set([
  "emergency_contact",
  "designated_person",
  "guardian",
  "power_of_attorney",
  "primary_care_provider",
  "dentist",
  "pharmacy",
  "case_manager",
  "hospice_agency",
  "home_health_agency",
  "insurer",
  "other",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json(req, { error: "Invalid or expired session" }, 401);
  const { data: profile } = await callerClient.from("profiles").select("role, organization_id, is_active").eq("id", user.id).single();
  if (!profile?.is_active) return json(req, { error: "Caller profile not found or inactive" }, 403);
  if (!["platform_admin", "org_admin", "facility_manager"].includes(profile.role as string)) {
    return json(req, { error: "not authorized to import resident contacts" }, 403);
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
  const duplicateStrategy = ["create", "skip", "update"].includes(body.duplicate_strategy ?? "") ? body.duplicate_strategy : "create";
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
      p_domain: DOMAIN, p_file_name: (body.file_name ?? "resident_contacts.csv").slice(0, 255),
      p_file_sha256: fileSha256, p_total_rows: rows.length, p_duplicate_strategy: duplicateStrategy,
      p_facility_id: null, p_organization_id: profile.role === "platform_admin" ? effectiveOrgId : null,
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
    if (!allowed.includes(existingJob.status)) return json(req, { error: `Import job in ${existingJob.status} cannot continue` }, 409);
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
    return json(req, { success: true, mode, job_id: jobId, total: 0, succeeded: 0, failed: 0, results: [], totalRows: rows.length, offset, nextOffset: null });
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
      results.push({ row: rowNumber, success: existingLedger.status !== "reverted", record_id: existingLedger.target_id ?? undefined, action: existingLedger.proposed_action, preview: mode === "validate" });
      continue;
    }
    const externalId = row.resident_external_id?.trim();
    const name = row.name?.trim();
    const relationship = row.relationship?.trim() || null;
    const email = row.email?.trim()?.toLowerCase() || null;
    const phone = row.phone?.trim() || null;
    const isPrimary = (row.is_primary?.trim() || "").toLowerCase() === "true";
    // Same coercion as the durable worker (process-data-import-jobs/helpers.ts): an explicit
    // legal contact_type wins, anything else maps onto the table's CHECK vocabulary --
    // 'primary'/'family' are not legal values there.
    const contactTypeRaw = row.contact_type?.trim().toLowerCase() || null;
    const contactType = contactTypeRaw && RESIDENT_CONTACT_TYPES.has(contactTypeRaw)
      ? contactTypeRaw
      : (isPrimary ? "emergency_contact" : "other");
    const rowErrors: string[] = [];
    const warnings: string[] = [];
    if (!externalId) rowErrors.push("resident_external_id is required");
    if (!name) rowErrors.push("name is required");

    let resident: any = null;
    if (!rowErrors.length) {
      const { data } = await callerClient.from("residents").select("id, facility_id, organization_id")
        .eq("organization_id", effectiveOrgId).eq("preferred_name", `import:${externalId}`).limit(1).maybeSingle();
      if (!data) rowErrors.push(`Unknown resident_external_id: ${externalId} (import residents first with matching external_id)`);
      else resident = data;
    }

    let existing: any = null;
    if (!rowErrors.length && resident) {
      const { data } = await callerClient.from("resident_contacts").select("*")
        .eq("resident_id", resident.id).ilike("name", escapedIlike(name!)).limit(1).maybeSingle();
      existing = data;
    }

    let action: "create" | "update" | "skip" = "create";
    if (existing) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") rowErrors.push("Contact already exists; choose skip or update.");
      else if (duplicateStrategy === "skip") warnings.push("Existing contact matched and will be skipped.");
      else warnings.push("Existing contact will be updated.");
    }

    const payload = {
      organization_id: effectiveOrgId,
      facility_id: resident?.facility_id,
      resident_id: resident?.id,
      name, relationship, email, phone,
      is_primary: isPrimary,
      contact_type: contactType,
      active: true,
    };

    if (rowErrors.length) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "invalid", targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: rowErrors, warnings });
      continue;
    }
    if (action === "skip") {
      results.push({ row: rowNumber, success: true, record_id: existing.id, action, preview: mode === "validate" });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "skipped", targetTable: TARGET, targetId: existing.id, beforeSnapshot: existing, errors: [], warnings });
      continue;
    }
    if (mode === "validate") {
      results.push({ row: rowNumber, success: true, record_id: existing?.id, action, preview: true });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "valid", targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: [], warnings });
      continue;
    }

    // resident_contacts is SELECT-only for authenticated (writes are RPC-only per
    // 20260713183435), so the apply goes through the import RPC rather than the table.
    const { data, error } = await callerClient.rpc("import_apply_resident_contact", {
      p_job_id: jobId,
      p_resident_id: resident.id,
      p_contact_id: action === "update" ? existing.id : null,
      p_payload: {
        name, relationship, email, phone,
        is_primary: isPrimary,
        contact_type: contactType,
      },
    });
    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "failed", targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: [error.message], warnings });
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
  const jobStatus = mode === "validate" ? (nextOffset === null ? "ready" : "validated") : (nextOffset === null ? "applied" : "applying");
  const { error: ledgerError } = await callerClient.rpc("record_data_import_chunk", { p_job_id: jobId, p_rows: ledgerRows, p_job_status: jobStatus, p_last_error: null });
  if (ledgerError) return json(req, { error: `Import receipt failed: ${ledgerError.message}`, job_id: jobId }, 500);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return json(req, { success: true, mode, job_id: jobId, total: results.length, succeeded, failed, results, totalRows: rows.length, offset, nextOffset, can_finalize: nextOffset === null && failed === 0, can_rollback: mode === "apply" && nextOffset === null && succeeded > 0 });
});
