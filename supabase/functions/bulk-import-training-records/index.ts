// @ts-nocheck -- retained: jsr:@std/csv typed output causes inference errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv/parse";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const REQUIRED_COLUMNS = ["employee_number", "course_code", "completion_date"];
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

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
  }
  if (!["platform_admin", "org_admin", "facility_manager"].includes(callerProfile.role as string)) {
    return json(req, { error: "not authorized to import training records" }, 403);
  }

  let body: {
    csv?: string;
    organization_id?: string;
    offset?: number;
    limit?: number;
    mode?: "validate" | "apply";
    job_id?: string;
    file_name?: string;
    duplicate_strategy?: "create" | "skip" | "update";
  };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const { csv, organization_id } = body;
  if (!csv || typeof csv !== "string") return json(req, { error: "csv (string) is required" }, 400);
  const offset = Number.isFinite(body.offset) ? Math.max(0, Math.floor(body.offset as number)) : 0;
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(200, Math.floor(body.limit as number))) : null;
  const mode = body.mode === "validate" ? "validate" : "apply";
  const duplicateStrategy = ["create", "skip", "update"].includes(body.duplicate_strategy ?? "")
    ? body.duplicate_strategy!
    : "create";
  if (body.job_id && !UUID_PATTERN.test(body.job_id)) return json(req, { error: "job_id must be a UUID" }, 400);

  const effectiveOrgId = callerProfile.role === "platform_admin" ? organization_id : callerProfile.organization_id;
  if (!effectiveOrgId) return json(req, { error: "organization_id is required" }, 400);

  let rows: Record<string, string | undefined>[];
  try {
    rows = (await parse(csv, { skipFirstRow: true, strip: true })) as Record<string, string | undefined>[];
  } catch (e) {
    return json(req, { error: `Failed to parse CSV: ${(e as Error).message}` }, 400);
  }

  if (rows.length === 0) return json(req, { error: "CSV contains no data rows" }, 400);
  if (rows.length > 1000) return json(req, { error: "CSV exceeds the 1000-row import limit; split into smaller files" }, 400);

  const missingCols = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingCols.length > 0) {
    return json(req, { error: `CSV is missing required columns: ${missingCols.join(", ")}` }, 400);
  }

  const fileSha256 = await sha256Hex(csv);
  let jobId = body.job_id ?? null;
  if (!jobId) {
    const { data, error } = await callerClient.rpc("start_data_import_job", {
      p_domain: "training_records",
      p_file_name: (body.file_name ?? "training_records.csv").slice(0, 255),
      p_file_sha256: fileSha256,
      p_total_rows: rows.length,
      p_duplicate_strategy: duplicateStrategy,
      p_facility_id: null,
      p_organization_id: callerProfile.role === "platform_admin" ? effectiveOrgId : null,
    });
    if (error) return json(req, { error: `Unable to start import job: ${error.message}` }, 400);
    jobId = data as string;
  } else {
    const { data: existingJob, error: jobError } = await callerClient
      .from("data_import_jobs")
      .select("domain,status,original_file_sha256,duplicate_strategy")
      .eq("id", jobId)
      .single();
    if (jobError || !existingJob) return json(req, { error: "Import job was not found in your scope" }, 404);
    if (existingJob.domain !== "training_records") {
      return json(req, { error: "Import job domain does not match this processor" }, 409);
    }
    if (existingJob.original_file_sha256 !== fileSha256) {
      return json(req, { error: "CSV checksum does not match the original import receipt" }, 409);
    }
    if (existingJob.duplicate_strategy !== duplicateStrategy) {
      return json(req, { error: "Duplicate strategy cannot change after the import job is created" }, 409);
    }
    const allowedStatuses = mode === "validate"
      ? ["uploaded", "mapping", "validated", "ready", "failed"]
      : ["ready", "applying", "failed"];
    if (!allowedStatuses.includes(existingJob.status)) {
      return json(req, {
        error: `Import job in ${existingJob.status} state cannot be ${mode === "validate" ? "previewed" : "applied"}`,
      }, 409);
    }
  }

  const { data: employees, error: employeesError } = await callerClient
    .from("employees")
    .select("id, employee_number, facility_id, organization_id, status")
    .eq("organization_id", effectiveOrgId)
    .not("employee_number", "is", null);
  if (employeesError) return json(req, { error: `Failed to load employees: ${employeesError.message}` }, 500);
  const employeeByNumber = new Map(
    (employees ?? [])
      .filter((e) => e.employee_number)
      .map((e) => [String(e.employee_number).trim().toLowerCase(), e]),
  );

  const { data: trainingTypes, error: typesError } = await callerClient
    .from("training_types")
    .select("id, code, name, organization_id, document_required")
    .or(`organization_id.is.null,organization_id.eq.${effectiveOrgId}`);
  if (typesError) return json(req, { error: `Failed to load training types: ${typesError.message}` }, 500);
  const typeByCode = new Map(
    (trainingTypes ?? [])
      .filter((t) => t.code)
      .map((t) => [String(t.code).trim().toLowerCase(), t]),
  );

  // Fallback: courses.catalog_code → training_type_id when the CSV uses a course catalog code.
  const { data: courses, error: coursesError } = await callerClient
    .from("courses")
    .select("catalog_code, training_type_id, organization_id")
    .not("catalog_code", "is", null)
    .or(`organization_id.is.null,organization_id.eq.${effectiveOrgId}`);
  if (coursesError) return json(req, { error: `Failed to load courses: ${coursesError.message}` }, 500);
  const typeIdByCatalogCode = new Map(
    (courses ?? [])
      .filter((c) => c.catalog_code && c.training_type_id)
      .map((c) => [String(c.catalog_code).trim().toLowerCase(), c.training_type_id as string]),
  );

  const endIndex = limit === null ? rows.length : Math.min(offset + limit, rows.length);
  if (offset >= rows.length) {
    return json(req, {
      success: true,
      mode,
      job_id: jobId,
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      totalRows: rows.length,
      offset,
      nextOffset: null,
    });
  }

  const results: ImportRowResult[] = [];
  const ledgerRows: Record<string, unknown>[] = [];

  const startRowNumber = offset + 2;
  const endRowNumber = endIndex + 1;
  const { data: existingLedgers, error: ledgerLoadError } = await callerClient
    .from("data_import_rows")
    .select("row_number, status, target_id, proposed_action")
    .eq("job_id", jobId)
    .gte("row_number", startRowNumber)
    .lte("row_number", endRowNumber);
  if (ledgerLoadError) {
    return json(req, { error: `Failed to load existing import receipts: ${ledgerLoadError.message}`, job_id: jobId }, 500);
  }
  const existingLedgerByRowNumber = new Map((existingLedgers ?? []).map((r) => [r.row_number, r]));

  for (let index = offset; index < endIndex; index++) {
    const row = rows[index];
    const rowNumber = index + 2;

    const existingLedger = existingLedgerByRowNumber.get(rowNumber);
    if (existingLedger && ["applied", "skipped", "reverted"].includes(existingLedger.status)) {
      results.push({
        row: rowNumber,
        success: existingLedger.status !== "reverted",
        record_id: existingLedger.target_id ?? undefined,
        action: existingLedger.proposed_action,
        preview: mode === "validate",
        error: existingLedger.status === "reverted" ? "This row was rolled back." : undefined,
      });
      continue;
    }

    const employeeNumber = row.employee_number?.trim() ?? "";
    const courseCode = row.course_code?.trim() ?? "";
    const completionDate = row.completion_date?.trim() ?? "";
    const expirationDate = row.expiration_date?.trim() || null;
    const source = row.source?.trim() || null;
    const rowErrors: string[] = [];
    const warnings: string[] = [];

    if (!employeeNumber) rowErrors.push("employee_number is required");
    if (!courseCode) rowErrors.push("course_code is required");
    if (!completionDate) rowErrors.push("completion_date is required");
    if (completionDate && !DATE_PATTERN.test(completionDate)) {
      rowErrors.push("completion_date must be YYYY-MM-DD");
    }
    if (expirationDate && !DATE_PATTERN.test(expirationDate)) {
      rowErrors.push("expiration_date must be YYYY-MM-DD");
    }

    const employee = employeeNumber
      ? employeeByNumber.get(employeeNumber.toLowerCase())
      : null;
    if (!rowErrors.length && !employee) {
      rowErrors.push(`Unknown employee_number: ${employeeNumber}`);
    } else if (employee && employee.status === "terminated") {
      rowErrors.push(`Employee ${employeeNumber} is terminated`);
    }

    let trainingType = courseCode ? typeByCode.get(courseCode.toLowerCase()) : null;
    if (!trainingType && courseCode) {
      const typeId = typeIdByCatalogCode.get(courseCode.toLowerCase());
      if (typeId) trainingType = (trainingTypes ?? []).find((t) => t.id === typeId) ?? null;
    }
    if (!rowErrors.length && !trainingType) {
      rowErrors.push(`Unknown course_code / training type code: ${courseCode}`);
    }

    const normalized = {
      employee_id: employee?.id ?? null,
      training_type_id: trainingType?.id ?? null,
      organization_id: effectiveOrgId,
      facility_id: employee?.facility_id ?? null,
      completion_date: completionDate || null,
      due_date: expirationDate,
      status: completionDate ? "compliant" : "missing",
      completion_method: "csv_import",
      training_provider: source,
      notes: source ? `Imported from ${source}` : "Imported via training records CSV",
      document_required: trainingType?.document_required ?? false,
      approval_status: "approved",
    };

    let existingRecord: { id: string; status: string; completion_date: string | null } | null = null;
    if (!rowErrors.length && employee && trainingType) {
      const { data } = await callerClient
        .from("employee_training_records")
        .select("id, status, completion_date")
        .eq("employee_id", employee.id)
        .eq("training_type_id", trainingType.id)
        .eq("completion_date", completionDate)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existingRecord = data;
    }

    let action: "create" | "update" | "skip" = "create";
    if (existingRecord) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") {
        rowErrors.push(
          "A training record already exists for this employee, course, and completion date; choose skip or update.",
        );
      } else if (duplicateStrategy === "skip") {
        warnings.push("Existing training record matched and will be skipped.");
      } else {
        warnings.push("Existing training record matched and will be updated.");
      }
    }

    if (rowErrors.length > 0) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: normalized,
        proposedAction: action,
        status: "invalid",
        targetTable: "employee_training_records",
        targetId: existingRecord?.id ?? null,
        beforeSnapshot: existingRecord,
        errors: rowErrors,
        warnings,
      });
      continue;
    }

    if (action === "skip") {
      results.push({
        row: rowNumber,
        success: true,
        record_id: existingRecord!.id,
        action,
        preview: mode === "validate",
      });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: normalized,
        proposedAction: action,
        status: "skipped",
        targetTable: "employee_training_records",
        targetId: existingRecord!.id,
        beforeSnapshot: existingRecord,
        errors: [],
        warnings,
      });
      continue;
    }

    if (mode === "validate") {
      results.push({
        row: rowNumber,
        success: true,
        record_id: existingRecord?.id,
        action,
        preview: true,
      });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: normalized,
        proposedAction: action,
        status: "valid",
        targetTable: "employee_training_records",
        targetId: existingRecord?.id ?? null,
        beforeSnapshot: existingRecord,
        errors: [],
        warnings,
      });
      continue;
    }

    const payload = {
      employee_id: normalized.employee_id,
      training_type_id: normalized.training_type_id,
      completion_date: normalized.completion_date,
      due_date: normalized.due_date,
      status: normalized.status,
      completion_method: normalized.completion_method,
      training_provider: normalized.training_provider,
      notes: normalized.notes,
      document_required: normalized.document_required,
      approval_status: normalized.approval_status,
    };

    const { data, error } = await callerClient.rpc("save_training_record", {
      p_record_id: action === "update" ? existingRecord!.id : null,
      p_payload: payload,
    });

    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: normalized,
        proposedAction: action,
        status: "failed",
        targetTable: "employee_training_records",
        targetId: existingRecord?.id ?? null,
        beforeSnapshot: existingRecord,
        errors: [error.message],
        warnings,
      });
    } else {
      const recordId = (data as { id?: string } | null)?.id ?? existingRecord?.id ?? null;
      results.push({ row: rowNumber, success: true, record_id: recordId ?? undefined, action });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: normalized,
        proposedAction: action,
        status: "applied",
        targetTable: "employee_training_records",
        targetId: recordId,
        beforeSnapshot: existingRecord,
        errors: [],
        warnings,
      });
    }
  }

  const nextOffset = endIndex < rows.length ? endIndex : null;
  const jobStatus = mode === "validate"
    ? (nextOffset === null ? "ready" : "validated")
    : (nextOffset === null ? "applied" : "applying");
  const { error: ledgerError } = await callerClient.rpc("record_data_import_chunk", {
    p_job_id: jobId,
    p_rows: ledgerRows,
    p_job_status: jobStatus,
    p_last_error: null,
  });
  if (ledgerError) {
    return json(req, {
      error: `Rows were processed but the import receipt failed: ${ledgerError.message}`,
      job_id: jobId,
    }, 500);
  }

  const succeeded = results.filter((result) => result.success).length;
  const failed = results.length - succeeded;

  return json(req, {
    success: true,
    mode,
    job_id: jobId,
    file_sha256: fileSha256,
    duplicate_strategy: duplicateStrategy,
    total: results.length,
    succeeded,
    failed,
    results,
    totalRows: rows.length,
    offset,
    nextOffset,
    can_finalize: nextOffset === null && failed === 0,
    can_rollback: mode === "apply" && nextOffset === null && succeeded > 0,
  });
});
