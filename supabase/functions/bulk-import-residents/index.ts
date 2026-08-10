// @ts-nocheck -- retained: jsr:@std/csv typed output causes inference errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv/parse";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { acquireImportJobLease } from "../_shared/importJobLease.ts";
import { listImportFacilitiesForCaller } from "../_shared/importFacilityScope.ts";
import { paToday } from "../_shared/paDay.ts";

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

const REQUIRED_COLUMNS = ["first_name", "last_name", "facility"];
const DOMAIN = "residents";
const TARGET = "residents";

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
    return json(req, { error: "not authorized to import residents" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }
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
      p_domain: DOMAIN, p_file_name: (body.file_name ?? "residents.csv").slice(0, 255),
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
  // The FACILITY day: this becomes admission_date for a row that does not carry one, and after
  // 20:00 ET the UTC day is already tomorrow -- a resident admitted this evening would be
  // recorded as admitted tomorrow, on a date the regulatory timeline is computed from.
  const today = paToday();

  for (let index = offset; index < endIndex; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const existingLedger = ledgerMap.get(rowNumber);
    if (existingLedger && ["applied", "skipped", "reverted"].includes(existingLedger.status)) {
      results.push({ row: rowNumber, success: existingLedger.status !== "reverted", record_id: existingLedger.target_id ?? undefined, action: existingLedger.proposed_action, preview: mode === "validate" });
      continue;
    }
    const first = row.first_name?.trim();
    const last = row.last_name?.trim();
    const facilityName = row.facility?.trim();
    const dob = row.date_of_birth?.trim() || null;
    const externalId = row.external_id?.trim() || null;
    const room = row.room?.trim() || null;
    const rowErrors: string[] = [];
    const warnings: string[] = [];
    if (!first) rowErrors.push("first_name is required");
    if (!last) rowErrors.push("last_name is required");
    if (!facilityName) rowErrors.push("facility is required");
    if (dob && !DATE_PATTERN.test(dob)) rowErrors.push("date_of_birth must be YYYY-MM-DD");
    const facilityId = facilityName ? facilityByName.get(facilityName.toLowerCase()) : undefined;
    if (facilityName && !facilityId) rowErrors.push(`Unknown facility: ${facilityName}`);

    let existing: any = null;
    if (!rowErrors.length && facilityId) {
      if (externalId) {
        const { data } = await callerClient.from("residents").select("*")
          .eq("organization_id", effectiveOrgId).eq("facility_id", facilityId)
          .eq("preferred_name", `import:${externalId}`).limit(1).maybeSingle();
        existing = data;
      }
      if (!existing) {
        let q = callerClient.from("residents").select("*")
          .eq("organization_id", effectiveOrgId).eq("facility_id", facilityId)
          .ilike("first_name", escapedIlike(first!)).ilike("last_name", escapedIlike(last!));
        if (dob) q = q.eq("date_of_birth", dob);
        const { data } = await q.limit(1).maybeSingle();
        existing = data;
      }
    }

    let action: "create" | "update" | "skip" = "create";
    if (existing) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") rowErrors.push("Resident already exists; choose skip or update.");
      else if (duplicateStrategy === "skip") warnings.push("Existing resident matched and will be skipped.");
      else warnings.push("Existing resident will be updated.");
    }

    // preferred_name stores import external key for contact linking: import:{external_id}
    const payload: any = {
      organization_id: effectiveOrgId,
      facility_id: facilityId,
      first_name: first,
      last_name: last,
      date_of_birth: dob,
      room: room,
      admission_date: today,
      preferred_name: externalId ? `import:${externalId}` : null,
      status: "active",
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

    let data: any = null;
    let error: any = null;
    if (action === "update") {
      const res = await callerClient.from("residents").update({
        first_name: first, last_name: last, date_of_birth: dob, room,
        preferred_name: externalId ? `import:${externalId}` : existing.preferred_name,
      }).eq("id", existing.id).select("id").single();
      data = res.data; error = res.error;
    } else {
      const res = await callerClient.from("residents").insert(payload).select("id").single();
      data = res.data; error = res.error;
    }
    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "failed", targetTable: TARGET, targetId: existing?.id ?? null, beforeSnapshot: existing, errors: [error.message], warnings });
    } else {
      results.push({ row: rowNumber, success: true, record_id: data.id, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "applied", targetTable: TARGET, targetId: data.id, beforeSnapshot: existing, errors: [], warnings });
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
