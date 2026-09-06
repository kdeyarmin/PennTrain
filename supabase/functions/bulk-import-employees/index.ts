// @ts-nocheck -- retained: jsr:@std/csv typed output causes inference errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv/parse";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { acquireImportJobLease } from "../_shared/importJobLease.ts";
import { listImportFacilitiesForCaller } from "../_shared/importFacilityScope.ts";
import { MAX_IMPORT_BODY_BYTES, readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

// job_title has no default in the employees table -- required. hire_date/email/etc are nullable
// with defaults, so left optional. A facility column is also required, but it may arrive as either
// facility_name (the documented, primary path -- resolved case-insensitively against this org's
// facilities below, since a raw facility_id UUID is never shown anywhere else in the UI) or
// facility_id (a raw UUID, still accepted for already-integrated callers) -- checked separately
// below rather than listed here, since exactly one of the two is required, not both.
const REQUIRED_COLUMNS = ["first_name", "last_name", "job_title"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// The employees status CHECK vocabulary (20260704045925_group_a_tenancy_identity.sql).
const EMPLOYEE_STATUSES = new Set(["active", "inactive", "terminated", "on_leave"]);

interface ImportRowResult {
  row: number;
  success: boolean;
  error?: string;
  employee_id?: string;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // This function operates entirely AS THE CALLING USER -- no service-role elevation. Employee RLS
  // remains the write boundary; the import RPCs add a durable job/row receipt but do not bypass the
  // caller's organization or assigned-facility access.
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
    return json(req, { error: "not authorized to import employees" }, 403);
  }

  // offset/limit let the client validate or apply in small, resumable chunks. Older callers that
  // omit mode/job_id still apply rows exactly as before; the server derives a stable file checksum
  // and reuses the same unfinished job across chunk calls.
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
    body = await readJsonBody(req, MAX_IMPORT_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) return json(req, { error: error.message }, error.status);
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
  if (!("facility_name" in rows[0]) && !("facility_id" in rows[0])) {
    return json(req, { error: "CSV is missing required columns: facility_name (or facility_id)" }, 400);
  }

  const fileSha256 = await sha256Hex(csv);
  let jobId = body.job_id ?? null;
  if (!jobId) {
    const { data, error } = await callerClient.rpc("start_data_import_job", {
      p_domain: "employees",
      p_file_name: (body.file_name ?? "employees.csv").slice(0, 255),
      p_file_sha256: fileSha256,
      p_total_rows: rows.length,
      p_duplicate_strategy: duplicateStrategy,
      p_facility_id: null,
      p_organization_id: callerProfile.role === "platform_admin" ? effectiveOrgId : null,
    });
    if (error) return json(req, { error: `Unable to start import job: ${error.message}` }, 400);
    jobId = data as string;
  } else {
    // A job receipt is also the authorization and idempotency boundary. Never allow a caller to
    // reuse a valid in-scope job id with different bytes or duplicate semantics: row numbers and
    // before-snapshots would otherwise describe a different source than the immutable checksum.
    const { data: existingJob, error: jobError } = await callerClient
      .from("data_import_jobs")
      .select("domain,status,original_file_sha256,duplicate_strategy")
      .eq("id", jobId)
      .single();
    if (jobError || !existingJob) return json(req, { error: "Import job was not found in your scope" }, 404);
    if (existingJob.domain !== "employees") return json(req, { error: "Import job domain does not match this processor" }, 409);
    if (existingJob.original_file_sha256 !== fileSha256) return json(req, { error: "CSV checksum does not match the original import receipt" }, 409);
    if (existingJob.duplicate_strategy !== duplicateStrategy) return json(req, { error: "Duplicate strategy cannot change after the import job is created" }, 409);
    const allowedStatuses = mode === "validate"
      ? ["uploaded", "mapping", "validated", "ready", "failed"]
      : ["ready", "applying", "failed"];
    if (!allowedStatuses.includes(existingJob.status)) {
      return json(req, { error: `Import job in ${existingJob.status} state cannot be ${mode === "validate" ? "previewed" : "applied"}` }, 409);
    }
  }

  // Nothing reaches a customer's tables until this job's claim is ours. The durable worker
  // (process-data-import-jobs) cannot tell an in-progress browser apply from a stranded one, so
  // without a claim it applies the same ledger rows this run is walking -- see G34.
  const leaseError = await acquireImportJobLease(callerClient, jobId);
  if (leaseError) return json(req, { error: leaseError, job_id: jobId }, 409);

  // facilities_select is org-wide; assignment-scope the map so validate cannot green-light
  // other-facility rows that the durable service-role worker would then apply.
  let orgFacilities;
  try {
    orgFacilities = await listImportFacilitiesForCaller(
      callerClient, effectiveOrgId, callerProfile.role as string, callerUser.id,
    );
  } catch (facilitiesError) {
    return json(req, { error: `Failed to load facilities: ${facilitiesError instanceof Error ? facilitiesError.message : String(facilitiesError)}` }, 500);
  }
  const allowedFacilityIds = new Set(orgFacilities.map((facility) => facility.id));
  const facilityIdByName = new Map(orgFacilities.map((facility) => [facility.name.trim().toLowerCase(), facility.id]));

  // An omitted limit is capped to the ledger RPC's own 200-row chunk contract rather than the
  // whole file: applying every row and then having the single chunk receipt refused (the RPC
  // hard-rejects >200 rows) left writes unreceipted, the job stuck pre-applied, and a retry
  // reporting the landed rows as duplicates. Callers see nextOffset and keep paging.
  const endIndex = Math.min(offset + (limit ?? 200), rows.length);
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
  const endRowNumber = endIndex + 1; // inclusive row_number for the last row in this chunk
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

  // A lookup that failed leaves this run unable to finish honestly, and returning on the spot
  // would strand the rows the chunk has already processed: they live in `ledgerRows` until the
  // receipt at the end, so a bare return would let a resume apply them a second time. Receipt what
  // is there, THEN refuse. `failed` is a status apply mode is allowed to resume from, it carries
  // the reason into the job's `last_error` where the imports page shows it, and it releases this
  // run's claim so the resume is not blocked by the lease of the run that gave up.
  async function abortRun(message: string) {
    const { error: receiptError } = await callerClient.rpc("record_data_import_chunk", {
      p_job_id: jobId,
      p_rows: ledgerRows,
      p_job_status: "failed",
      p_last_error: message.slice(0, 2000),
    });
    const alsoFailed = receiptError ? ` The receipt for this chunk also failed: ${receiptError.message}` : "";
    return json(req, { error: `${message}${alsoFailed}`, job_id: jobId }, 500);
  }

  for (let index = offset; index < endIndex; index++) {
    const row = rows[index];
    const rowNumber = index + 2; // +1 for 0-index, +1 for the header row already stripped

    const existingLedger = existingLedgerByRowNumber.get(rowNumber);
    if (existingLedger && ["applied", "skipped", "reverted"].includes(existingLedger.status)) {
      results.push({
        row: rowNumber,
        success: existingLedger.status !== "reverted",
        employee_id: existingLedger.target_id ?? undefined,
        action: existingLedger.proposed_action,
        preview: mode === "validate",
        error: existingLedger.status === "reverted" ? "This row was rolled back." : undefined,
      });
      continue;
    }

    const first_name = row.first_name?.trim();
    const last_name = row.last_name?.trim();
    const job_title = row.job_title?.trim();
    const rawFacilityId = row.facility_id?.trim();
    const rawFacilityName = row.facility_name?.trim();
    const hire_date = row.hire_date?.trim() || null;
    // The status CHECK is case-sensitive and HR exports capitalise and use spaces
    // ("Active", "On Leave"); normalise before validating so the dry run never passes a
    // value the table constraint then refuses at apply.
    const status = (row.status?.trim() || "active").toLowerCase().replace(/\s+/g, "_");
    const rowErrors: string[] = [];
    const warnings: string[] = [];

    if (!first_name) rowErrors.push("first_name is required");
    if (!last_name) rowErrors.push("last_name is required");
    if (!job_title) rowErrors.push("job_title is required");
    if (!rawFacilityId && !rawFacilityName) rowErrors.push("facility_name or facility_id is required");
    if (hire_date && !DATE_PATTERN.test(hire_date)) rowErrors.push("hire_date must be YYYY-MM-DD");
    if (!EMPLOYEE_STATUSES.has(status)) rowErrors.push("status must be active|inactive|terminated|on_leave");

    let facility_id = rawFacilityId ?? "";
    if (!rowErrors.length && !facility_id) {
      const resolved = facilityIdByName.get(rawFacilityName!.toLowerCase());
      if (!resolved) rowErrors.push(`Unknown facility: ${rawFacilityName}`);
      else facility_id = resolved;
    }
    if (facility_id && !UUID_PATTERN.test(facility_id)) rowErrors.push("facility_id is not a valid UUID");
    else if (facility_id && !allowedFacilityIds.has(facility_id)) rowErrors.push("facility is outside your assigned scope");

    const normalized = {
      organization_id: effectiveOrgId,
      facility_id,
      first_name: first_name ?? "",
      last_name: last_name ?? "",
      job_title: job_title ?? "",
      email: row.email?.trim().toLowerCase() || null,
      employee_number: row.employee_number?.trim() || null,
      department: row.department?.trim() || null,
      phone: row.phone?.trim() || null,
      hire_date,
      status,
      trainer_status: row.trainer_status?.trim().toLowerCase() === "true",
      administers_medications: row.administers_medications?.trim().toLowerCase() === "true",
    };
    // An update writes only the columns this CSV actually carries. `normalized` fills absent
    // columns with defaults, which is right for a create but was whole-record replacement on
    // update: re-importing a job-title-fix roster nulled email/phone/hire_date and flipped
    // on_leave/inactive employees back to "active" via the status default.
    const presentColumns = new Set(Object.keys(rows[0]));
    const updatePayload = Object.fromEntries(
      Object.entries(normalized).filter(([key]) =>
        key === "organization_id" || key === "facility_id" || presentColumns.has(key)
      ),
    );

    let existingEmployee: Record<string, unknown> | null = null;
    if (!rowErrors.length && normalized.employee_number) {
      // A lookup that FAILED is not an employee who is absent, and both branches here decide
      // create-vs-update: reading only `data` turned an RLS denial or a dropped connection into a
      // second personnel record for someone already on the roster. Stop the run instead --
      // abortRun receipts what this chunk has already done before refusing, so re-posting this
      // job_id resumes rather than repeats.
      const { data, error: byNumberError } = await callerClient
        .from("employees")
        .select("*")
        .eq("organization_id", effectiveOrgId)
        .eq("employee_number", normalized.employee_number)
        .limit(1)
        .maybeSingle();
      if (byNumberError) return await abortRun(`Row ${rowNumber}: employee lookup failed: ${byNumberError.message}`);
      existingEmployee = data;
    }
    if (!rowErrors.length && !existingEmployee && normalized.email) {
      const { data, error: byEmailError } = await callerClient
        .from("employees")
        .select("*")
        .eq("organization_id", effectiveOrgId)
        .ilike("email", escapedIlike(normalized.email))
        .limit(1)
        .maybeSingle();
      if (byEmailError) return await abortRun(`Row ${rowNumber}: employee lookup failed: ${byEmailError.message}`);
      existingEmployee = data;
    }

    let action: "create" | "update" | "skip" = "create";
    if (existingEmployee) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") {
        rowErrors.push("An employee with this employee number or email already exists; choose skip or update.");
      } else if (duplicateStrategy === "skip") {
        warnings.push("Existing employee matched and will be skipped.");
      } else {
        warnings.push("Existing employee matched and will be updated.");
      }
    }
    // The ledger must hold what the apply path writes: the durable worker replays
    // normalizedRow verbatim when it rescues a stranded job, so an update row records the
    // header-filtered payload, not the default-padded create shape.
    const ledgerNormalized = action === "update" ? updatePayload : normalized;

    if (rowErrors.length > 0) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: ledgerNormalized,
        proposedAction: action,
        status: "invalid",
        targetTable: "employees",
        targetId: existingEmployee?.id ?? null,
        beforeSnapshot: existingEmployee,
        errors: rowErrors,
        warnings,
      });
      continue;
    }

    if (action === "skip") {
      results.push({ row: rowNumber, success: true, employee_id: existingEmployee!.id as string, action, preview: mode === "validate" });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: ledgerNormalized,
        proposedAction: action,
        status: "skipped",
        targetTable: "employees",
        targetId: existingEmployee!.id,
        beforeSnapshot: existingEmployee,
        errors: [],
        warnings,
      });
      continue;
    }

    if (mode === "validate") {
      results.push({ row: rowNumber, success: true, employee_id: existingEmployee?.id as string | undefined, action, preview: true });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: ledgerNormalized,
        proposedAction: action,
        status: "valid",
        targetTable: "employees",
        targetId: existingEmployee?.id ?? null,
        beforeSnapshot: existingEmployee,
        errors: [],
        warnings,
      });
      continue;
    }

    const mutation = action === "update"
      ? callerClient.from("employees").update(updatePayload).eq("id", existingEmployee!.id).select("id").single()
      : callerClient.from("employees").insert(normalized).select("id").single();
    const { data, error } = await mutation;

    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({
        rowNumber,
        sourceRow: row,
        normalizedRow: ledgerNormalized,
        proposedAction: action,
        status: "failed",
        targetTable: "employees",
        targetId: existingEmployee?.id ?? null,
        beforeSnapshot: existingEmployee,
        errors: [error.message],
        warnings,
      });
      continue;
    }

    results.push({ row: rowNumber, success: true, employee_id: data.id, action });
    // Receipt each applied row before touching the next one. Batching the receipts at the
    // end of the chunk meant a failed receipt left every row of the chunk written but
    // unreceipted, and a retry then re-inserted them all -- silently, for rows with neither
    // employee_number nor email, since duplicate matching has nothing to match on. One RPC
    // per applied row bounds the exposure to the single row whose receipt fails below; the
    // row-receipt RPC skips the job-wide recount and event insert, which stay with the
    // chunk-level receipt at the end.
    const { error: receiptError } = await callerClient.rpc("record_data_import_row_receipt", {
      p_job_id: jobId,
      p_row: {
        rowNumber,
        sourceRow: row,
        normalizedRow: ledgerNormalized,
        proposedAction: action,
        status: "applied",
        targetTable: "employees",
        targetId: data.id,
        beforeSnapshot: existingEmployee,
        errors: [],
        warnings,
      },
    });
    if (receiptError) {
      return json(req, { error: `Row ${rowNumber} was applied but its import receipt failed: ${receiptError.message}`, job_id: jobId }, 500);
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
    return json(req, { error: `Rows were processed but the import receipt failed: ${ledgerError.message}`, job_id: jobId }, 500);
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
