// @ts-nocheck -- retained: jsr:@std/csv typed output causes inference errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv/parse";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { acquireImportJobLease } from "../_shared/importJobLease.ts";
import { listImportFacilitiesForCaller } from "../_shared/importFacilityScope.ts";

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


const REQUIRED_COLUMNS = ["facility", "occurred_at", "incident_type", "severity", "summary"];
const DOMAIN = "incidents";
const TARGET = "incidents";
const VALID_SEVERITY = new Set(["low", "medium", "high", "critical"]);

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
    return json(req, { error: "not authorized to import incidents" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }
  const csv = body.csv;
  if (!csv || typeof csv !== "string") return json(req, { error: "csv (string) is required" }, 400);
  const offset = Number.isFinite(body.offset) ? Math.max(0, Math.floor(body.offset)) : 0;
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(100, Math.floor(body.limit))) : null;
  const mode = body.mode === "validate" ? "validate" : "apply";
  // Incidents are create-only for safety (no silent overwrite of clinical events)
  const duplicateStrategy = "create";
  if (body.job_id && !UUID_PATTERN.test(body.job_id)) return json(req, { error: "job_id must be a UUID" }, 400);
  const effectiveOrgId = profile.role === "platform_admin" ? body.organization_id : profile.organization_id;
  if (!effectiveOrgId) return json(req, { error: "organization_id is required" }, 400);

  let rows: Record<string, string | undefined>[];
  try { rows = (await parse(csv, { skipFirstRow: true, strip: true })) as any; }
  catch (e) { return json(req, { error: `Failed to parse CSV: ${(e as Error).message}` }, 400); }
  if (rows.length === 0) return json(req, { error: "CSV contains no data rows" }, 400);
  if (rows.length > 500) return json(req, { error: "Incident CSV limited to 500 rows" }, 400);
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) return json(req, { error: `CSV is missing required columns: ${missing.join(", ")}` }, 400);

  const fileSha256 = await sha256Hex(csv);
  let jobId = body.job_id ?? null;
  if (!jobId) {
    const { data, error } = await callerClient.rpc("start_data_import_job", {
      p_domain: DOMAIN, p_file_name: (body.file_name ?? "incidents.csv").slice(0, 255),
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
    const allowed = mode === "validate" ? ["uploaded", "mapping", "validated", "ready", "failed"] : ["ready", "applying", "failed"];
    if (!allowed.includes(existingJob.status)) return json(req, { error: `Import job in ${existingJob.status} cannot continue` }, 409);
  }

  // Nothing reaches a customer's tables until this job's claim is ours. The durable worker
  // (process-data-import-jobs) cannot tell an in-progress browser apply from a stranded one, so
  // without a claim it applies the same ledger rows this run is walking -- see G34.
  const leaseError = await acquireImportJobLease(callerClient, jobId);
  if (leaseError) return json(req, { error: leaseError, job_id: jobId }, 409);

  let facilities;
  try {
    facilities = await listImportFacilitiesForCaller(callerClient, effectiveOrgId, profile.role as string, user.id);
  } catch (facilitiesError) {
    return json(req, { error: `Failed to load facilities: ${facilitiesError instanceof Error ? facilitiesError.message : String(facilitiesError)}` }, 500);
  }
  const facilityByName = new Map(facilities.map((f: any) => [String(f.name).trim().toLowerCase(), f.id as string]));

  const endIndex = limit === null ? rows.length : Math.min(offset + limit, rows.length);
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
    const facilityName = row.facility?.trim();
    const occurredAt = row.occurred_at?.trim();
    const incidentType = row.incident_type?.trim();
    const severity = (row.severity?.trim() || "").toLowerCase();
    const summary = row.summary?.trim();
    const externalId = row.resident_external_id?.trim() || null;
    const rowErrors: string[] = [];
    const warnings: string[] = [];
    if (!facilityName) rowErrors.push("facility is required");
    if (!occurredAt) rowErrors.push("occurred_at is required");
    if (!incidentType) rowErrors.push("incident_type is required");
    if (!severity || !VALID_SEVERITY.has(severity)) rowErrors.push("severity must be low|medium|high|critical");
    // 10, matching BOTH apply paths: record_incident_from_import
    // (20260714202515_carebase_integrity_foundation.sql) and the durable worker's
    // apply_incident_import_row (20260801220000_durable_import_apply_rpcs.sql) each reject
    // `length(btrim(narrative)) < 10`. At 8 the dry run called an 8- or 9-character summary valid
    // and the apply then refused it -- the one thing a preview exists to rule out.
    if (!summary || summary.length < 10) rowErrors.push("summary must be at least 10 characters");
    const facilityId = facilityName ? facilityByName.get(facilityName.toLowerCase()) : undefined;
    if (facilityName && !facilityId) rowErrors.push(`Unknown facility: ${facilityName}`);

    let resident: any = null;
    if (!rowErrors.length && externalId) {
      const { data } = await callerClient.from("residents").select("id, first_name, last_name")
        .eq("organization_id", effectiveOrgId).eq("preferred_name", `import:${externalId}`).limit(1).maybeSingle();
      if (!data) rowErrors.push(`Unknown resident_external_id: ${externalId}`);
      else resident = data;
    }
    if (!rowErrors.length && !resident) {
      // create_incident_atomic requires a resident — pick first active resident at facility as last resort is unsafe.
      rowErrors.push("resident_external_id is required for incident import (import residents first)");
    }

    const action: "create" | "update" | "skip" = "create";
    const payload = {
      organization_id: effectiveOrgId, facility_id: facilityId, occurred_at: occurredAt,
      incident_type: incidentType, severity, narrative: summary,
      resident_id: resident?.id,
      resident_identifier_snapshot: resident ? `${resident.last_name}, ${resident.first_name}` : null,
      location_detail: "Imported via data migration center",
    };

    if (rowErrors.length) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "invalid", targetTable: TARGET, targetId: null, beforeSnapshot: null, errors: rowErrors, warnings });
      continue;
    }
    if (mode === "validate") {
      results.push({ row: rowNumber, success: true, action, preview: true });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "valid", targetTable: TARGET, targetId: null, beforeSnapshot: null, errors: [], warnings });
      continue;
    }

    const { data, error } = await callerClient.rpc("create_incident_atomic", {
      p_organization_id: effectiveOrgId,
      p_facility_id: facilityId,
      p_resident_id: resident.id,
      p_resident_identifier_snapshot: `${resident.last_name}, ${resident.first_name}`,
      p_incident_type: incidentType,
      p_severity: severity,
      p_occurred_at: occurredAt,
      p_location_detail: "Imported via data migration center",
      p_narrative: summary,
      p_idempotency_key: `import:${jobId}:${rowNumber}`,
    });
    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "failed", targetTable: TARGET, targetId: null, beforeSnapshot: null, errors: [error.message], warnings });
    } else {
      const recordId = (data as any)?.id ?? data;
      results.push({ row: rowNumber, success: true, record_id: recordId, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "applied", targetTable: TARGET, targetId: recordId, beforeSnapshot: null, errors: [], warnings });
    }
  }

  const nextOffset = endIndex < rows.length ? endIndex : null;
  const jobStatus = mode === "validate" ? (nextOffset === null ? "ready" : "validated") : (nextOffset === null ? "applied" : "applying");
  const { error: ledgerError } = await callerClient.rpc("record_data_import_chunk", { p_job_id: jobId, p_rows: ledgerRows, p_job_status: jobStatus, p_last_error: null });
  if (ledgerError) return json(req, { error: `Import receipt failed: ${ledgerError.message}`, job_id: jobId }, 500);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  return json(req, { success: true, mode, job_id: jobId, total: results.length, succeeded, failed, results, totalRows: rows.length, offset, nextOffset, can_finalize: nextOffset === null && failed === 0, can_rollback: false });
});
