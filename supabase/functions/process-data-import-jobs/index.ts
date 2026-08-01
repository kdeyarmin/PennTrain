// @ts-nocheck -- Deno typecheck: esm/jsr supabase client + ledger apply helpers
/** Durable import claim loop (BACKLOG D3). Auth: the shared cron secret, like the other workers. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const IMPORT_BATCH_SIZE = 100;
const EMPLOYEE_WRITABLE_FIELDS = [
  "facility_id",
  "first_name",
  "last_name",
  "job_title",
  "email",
  "employee_number",
  "department",
  "phone",
  "hire_date",
  "status",
  "trainer_status",
  "administers_medications",
] as const;

const DOMAIN_TARGET_TABLE: Record<string, string> = {
  employees: "employees",
  training_records: "employee_training_records",
  credentials: "employee_credentials",
  residents: "residents",
  resident_contacts: "resident_contacts",
  rooms: "facility_rooms",
  assessments: "resident_assessment_forms",
  incidents: "incidents",
};

type ClaimedJob = {
  id: string;
  domain: string;
  organization_id: string;
};

type ImportLedgerRow = {
  id: string;
  row_number: number;
  normalized_row: unknown;
  proposed_action: string;
  target_id: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function normalizeAction(value: string): "create" | "update" | "skip" {
  if (value === "update" || value === "skip") return value;
  return "create";
}

function buildEmployeePayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  const payload: Record<string, unknown> = { organization_id: organizationId };
  for (const field of EMPLOYEE_WRITABLE_FIELDS) {
    payload[field] = row[field];
  }
  payload.facility_id = asStringOrNull(payload.facility_id);
  payload.first_name = asStringOrNull(payload.first_name) ?? "";
  payload.last_name = asStringOrNull(payload.last_name) ?? "";
  payload.job_title = asStringOrNull(payload.job_title) ?? "";
  payload.email = asStringOrNull(payload.email)?.toLowerCase() ?? null;
  payload.employee_number = asStringOrNull(payload.employee_number);
  payload.department = asStringOrNull(payload.department);
  payload.phone = asStringOrNull(payload.phone);
  payload.hire_date = asStringOrNull(payload.hire_date);
  payload.status = asStringOrNull(payload.status) ?? "active";
  payload.trainer_status = asBoolean(payload.trainer_status, false);
  payload.administers_medications = asBoolean(
    payload.administers_medications,
    false,
  );
  return payload;
}

async function markLedgerRowStatus(
  supabase: ReturnType<typeof createClient>,
  row: ImportLedgerRow,
  status: "applied" | "skipped",
  targetTable: string,
  targetId: string | null,
) {
  const { error } = await supabase
    .from("data_import_rows")
    .update({
      status,
      target_table: targetTable,
      target_id: targetId,
      errors: [],
      applied_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw error;
}

async function recountAndPersistJobCounters(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  finalizedStatus?: "applied" | "failed",
) {
  const { data: ledgerStatuses, error: countsErr } = await supabase
    .from("data_import_rows")
    .select("status")
    .eq("job_id", jobId);
  if (countsErr) throw countsErr;

  const statuses = (ledgerStatuses ?? []) as Array<{ status: string }>;
  const appliedRows = statuses.filter((row) => row.status === "applied").length;
  const skippedRows = statuses.filter((row) => row.status === "skipped").length;
  const validRows = statuses.filter((row) => row.status === "valid").length;
  const errorRows =
    statuses.filter((row) =>
      row.status === "failed" || row.status === "invalid"
    ).length;

  const updatePayload: Record<string, unknown> = {
    applied_rows: appliedRows,
    skipped_rows: skippedRows,
    error_rows: errorRows,
    valid_rows: validRows,
  };
  if (finalizedStatus === "applied") {
    updatePayload.applied_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabase.from("data_import_jobs").update(
    updatePayload,
  ).eq("id", jobId);
  if (updateErr) throw updateErr;

  return { appliedRows, skippedRows, errorRows, validRows };
}

async function markLedgerRowFailure(
  supabase: ReturnType<typeof createClient>,
  row: ImportLedgerRow,
  targetTable: string,
  errorMessage: string,
) {
  const { error } = await supabase
    .from("data_import_rows")
    .update({
      status: "failed",
      target_table: targetTable,
      errors: [errorMessage],
      applied_at: null,
    })
    .eq("id", row.id);
  if (error) throw error;
}

async function processEmployeeJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const payload = buildEmployeePayload(
      row.normalized_row,
      job.organization_id,
    );
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        "employees",
        `Row ${row.row_number}: facility_id is missing or invalid`,
      );
      continue;
    }

    if (!facilityCache.has(facilityId)) {
      const { data: facility, error: facilityErr } = await supabase
        .from("facilities")
        .select("id")
        .eq("id", facilityId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (facilityErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          "employees",
          `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`,
        );
        continue;
      }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        "employees",
        `Row ${row.row_number}: facility_id is not in the job organization`,
      );
      continue;
    }

    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        "employees",
        row.target_id,
      );
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          "employees",
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedEmployee, error: updateErr } = await supabase
        .from("employees")
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedEmployee) {
        await markLedgerRowFailure(
          supabase,
          row,
          "employees",
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "employee target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        "employees",
        updatedEmployee.id,
      );
      continue;
    }

    const { data: createdEmployee, error: createErr } = await supabase
      .from("employees")
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        "employees",
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      "employees",
      createdEmployee.id,
    );
  }

  const counts = await recountAndPersistJobCounters(supabase, job.id);
  const hasRemainingValidRows = counts.validRows > 0;
  const finalizedStatus = hasRemainingValidRows
    ? "applying"
    : (counts.appliedRows === 0 && counts.errorRows > 0 ? "failed" : "applied");

  if (!hasRemainingValidRows && finalizedStatus === "applied") {
    await recountAndPersistJobCounters(supabase, job.id, "applied");
  }

  const { error: releaseErr } = await supabase.rpc(
    "release_data_import_job_claim",
    {
      p_job_id: job.id,
      p_status: finalizedStatus,
      p_last_error: null,
    },
  );
  if (releaseErr) throw releaseErr;

  return {
    remainingValidRows: counts.validRows,
    appliedRows: counts.appliedRows,
    skippedRows: counts.skippedRows,
    errorRows: counts.errorRows,
    releasedTo: finalizedStatus,
  };
}

async function releaseJobWithRecount(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
) {
  const counts = await recountAndPersistJobCounters(supabase, jobId);
  const hasRemainingValidRows = counts.validRows > 0;
  const finalizedStatus = hasRemainingValidRows
    ? "applying"
    : (counts.appliedRows === 0 && counts.errorRows > 0 ? "failed" : "applied");

  if (!hasRemainingValidRows && finalizedStatus === "applied") {
    await recountAndPersistJobCounters(supabase, jobId, "applied");
  }

  const { error: releaseErr } = await supabase.rpc(
    "release_data_import_job_claim",
    {
      p_job_id: jobId,
      p_status: finalizedStatus,
      p_last_error: null,
    },
  );
  if (releaseErr) throw releaseErr;

  return {
    remainingValidRows: counts.validRows,
    appliedRows: counts.appliedRows,
    skippedRows: counts.skippedRows,
    errorRows: counts.errorRows,
    releasedTo: finalizedStatus,
  };
}

async function processTrainingRecordsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.training_records;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const employeeCache = new Map<
    string,
    { id: string; facility_id: string | null; status: string } | null
  >();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);

    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const employeeId = asStringOrNull(normalized.employee_id);
    const trainingTypeId = asStringOrNull(normalized.training_type_id);
    if (!employeeId || !UUID_PATTERN.test(employeeId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee_id is missing or invalid`,
      );
      continue;
    }
    if (!trainingTypeId || !UUID_PATTERN.test(trainingTypeId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: training_type_id is missing or invalid`,
      );
      continue;
    }

    if (!employeeCache.has(employeeId)) {
      const { data: employee, error: employeeErr } = await supabase
        .from("employees")
        .select("id,facility_id,status")
        .eq("id", employeeId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (employeeErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify employee scope (${employeeErr.message})`,
        );
        continue;
      }
      employeeCache.set(employeeId, employee ?? null);
    }

    const employee = employeeCache.get(employeeId);
    if (!employee) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee is not in the job organization`,
      );
      continue;
    }
    if (employee.status === "terminated") {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee is terminated`,
      );
      continue;
    }

    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: employee.facility_id,
      employee_id: employee.id,
      training_type_id: trainingTypeId,
      completion_date: asStringOrNull(normalized.completion_date),
      due_date: asStringOrNull(normalized.due_date),
      status: asStringOrNull(normalized.status) ?? "missing",
      completion_method: asStringOrNull(normalized.completion_method),
      training_provider: asStringOrNull(normalized.training_provider),
      notes: asStringOrNull(normalized.notes),
      document_required: asBoolean(normalized.document_required, false),
      approval_status: asStringOrNull(normalized.approval_status),
    };

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedRecord, error: updateErr } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedRecord) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "training record target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        targetTable,
        updatedRecord.id,
      );
      continue;
    }

    const { data: createdRecord, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdRecord.id,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

async function processCredentialsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.credentials;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const employeeCache = new Map<
    string,
    { id: string; facility_id: string | null; status: string } | null
  >();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const employeeId = asStringOrNull(normalized.employee_id);
    if (!employeeId || !UUID_PATTERN.test(employeeId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee_id is missing or invalid`,
      );
      continue;
    }

    if (!employeeCache.has(employeeId)) {
      const { data: employee, error: employeeErr } = await supabase
        .from("employees")
        .select("id,facility_id,status")
        .eq("id", employeeId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (employeeErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify employee scope (${employeeErr.message})`,
        );
        continue;
      }
      employeeCache.set(employeeId, employee ?? null);
    }
    const employee = employeeCache.get(employeeId);
    if (!employee) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee is not in the job organization`,
      );
      continue;
    }
    if (employee.status === "terminated") {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: employee is terminated`,
      );
      continue;
    }

    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: employee.facility_id,
      employee_id: employee.id,
      credential_type: asStringOrNull(normalized.credential_type),
      credential_number: asStringOrNull(normalized.credential_number),
      issue_date: asStringOrNull(normalized.issue_date),
      expiration_date: asStringOrNull(normalized.expiration_date),
      status: asStringOrNull(normalized.status) ?? "missing",
      verification_method: asStringOrNull(normalized.verification_method),
      notes: asStringOrNull(normalized.notes),
    };

    if (!payload.credential_type) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: credential_type is missing`,
      );
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedRecord, error: updateErr } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedRecord) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "credential target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        targetTable,
        updatedRecord.id,
      );
      continue;
    }

    const { data: createdRecord, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdRecord.id,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

async function processResidentsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.residents;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const facilityId = asStringOrNull(normalized.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is missing or invalid`,
      );
      continue;
    }
    if (!facilityCache.has(facilityId)) {
      const { data: facility, error: facilityErr } = await supabase
        .from("facilities")
        .select("id")
        .eq("id", facilityId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (facilityErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`,
        );
        continue;
      }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is not in the job organization`,
      );
      continue;
    }

    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: facilityId,
      first_name: asStringOrNull(normalized.first_name),
      last_name: asStringOrNull(normalized.last_name),
      date_of_birth: asStringOrNull(normalized.date_of_birth),
      room: asStringOrNull(normalized.room),
      admission_date: asStringOrNull(normalized.admission_date),
      preferred_name: asStringOrNull(normalized.preferred_name),
      status: asStringOrNull(normalized.status) ?? "active",
    };
    if (!payload.first_name || !payload.last_name) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: first_name and last_name are required`,
      );
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedRecord, error: updateErr } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedRecord) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "resident target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        targetTable,
        updatedRecord.id,
      );
      continue;
    }

    const { data: createdRecord, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdRecord.id,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

async function processResidentContactsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.resident_contacts;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const residentCache = new Map<
    string,
    { id: string; facility_id: string | null } | null
  >();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const residentId = asStringOrNull(normalized.resident_id);
    if (!residentId || !UUID_PATTERN.test(residentId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident_id is missing or invalid`,
      );
      continue;
    }

    if (!residentCache.has(residentId)) {
      const { data: resident, error: residentErr } = await supabase
        .from("residents")
        .select("id,facility_id")
        .eq("id", residentId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (residentErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify resident scope (${residentErr.message})`,
        );
        continue;
      }
      residentCache.set(residentId, resident ?? null);
    }
    const resident = residentCache.get(residentId);
    if (!resident) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident is not in the job organization`,
      );
      continue;
    }

    const isPrimary = asBoolean(normalized.is_primary, false);
    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: resident.facility_id,
      resident_id: resident.id,
      name: asStringOrNull(normalized.name),
      relationship: asStringOrNull(normalized.relationship),
      email: asStringOrNull(normalized.email)?.toLowerCase() ?? null,
      phone: asStringOrNull(normalized.phone),
      is_primary: isPrimary,
      contact_type: asStringOrNull(normalized.contact_type) ??
        (isPrimary ? "primary" : "family"),
      active: asBoolean(normalized.active, true),
    };
    if (!payload.name) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: contact name is required`,
      );
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedRecord, error: updateErr } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedRecord) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "resident contact target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        targetTable,
        updatedRecord.id,
      );
      continue;
    }

    const { data: createdRecord, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdRecord.id,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

function normalizeIncidentSeverity(value: string | null): string | null {
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === "low") return "minor";
  if (lowered === "medium") return "moderate";
  if (lowered === "high") return "major";
  if (lowered === "critical") return "critical";
  return lowered;
}

async function processRoomsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.rooms;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const facilityId = asStringOrNull(normalized.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is missing or invalid`,
      );
      continue;
    }
    if (!facilityCache.has(facilityId)) {
      const { data: facility, error: facilityErr } = await supabase
        .from("facilities")
        .select("id")
        .eq("id", facilityId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (facilityErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`,
        );
        continue;
      }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is not in the job organization`,
      );
      continue;
    }

    if (
      action === "update" &&
      (!row.target_id || !UUID_PATTERN.test(row.target_id))
    ) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: update action is missing target_id`,
      );
      continue;
    }

    const bedCountRaw = Number(
      asStringOrNull(normalized.bed_count) ?? normalized.bed_count,
    );
    const bedCount = Number.isFinite(bedCountRaw)
      ? Math.max(1, Math.min(8, Math.trunc(bedCountRaw)))
      : 1;
    const roomType = asStringOrNull(normalized.room_type) ??
      (bedCount === 1 ? "private" : bedCount === 2 ? "semi_private" : "shared");
    const unitName = asStringOrNull(normalized.unit_name) ?? "Main";
    const buildingName = asStringOrNull(normalized.building_name) ?? "Main";
    const roomNumber = asStringOrNull(normalized.room_number);
    if (!roomNumber) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: room_number is required`,
      );
      continue;
    }

    const { data: roomId, error: createErr } = await supabase.rpc(
      "create_room_with_beds",
      {
        p_facility_id: facilityId,
        p_building_name: buildingName,
        p_unit_name: unitName,
        p_room_number: roomNumber,
        p_room_type: roomType,
        p_bed_count: bedCount,
        p_gender_restriction: "none",
      },
    );
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }

    const roomIdValue = asStringOrNull(roomId) ?? row.target_id;
    const isActive = asBoolean(normalized.is_active, true);
    if (roomIdValue && UUID_PATTERN.test(roomIdValue)) {
      const { error: activeErr } = await supabase
        .from("facility_rooms")
        .update({ is_active: isActive })
        .eq("id", roomIdValue)
        .eq("organization_id", job.organization_id);
      if (activeErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${activeErr.message}`,
        );
        continue;
      }
    }

    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      roomIdValue,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

async function processAssessmentsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.assessments;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const residentCache = new Map<
    string,
    { id: string; facility_id: string | null } | null
  >();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }

    const residentId = asStringOrNull(normalized.resident_id);
    if (!residentId || !UUID_PATTERN.test(residentId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident_id is missing or invalid`,
      );
      continue;
    }
    if (!residentCache.has(residentId)) {
      const { data: resident, error: residentErr } = await supabase
        .from("residents")
        .select("id,facility_id")
        .eq("id", residentId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (residentErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify resident scope (${residentErr.message})`,
        );
        continue;
      }
      residentCache.set(residentId, resident ?? null);
    }
    const resident = residentCache.get(residentId);
    if (!resident) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident is not in the job organization`,
      );
      continue;
    }

    const formType = asStringOrNull(normalized.form_type);
    const reason = asStringOrNull(normalized.reason);
    if (!formType || !reason) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: form_type and reason are required`,
      );
      continue;
    }

    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: resident.facility_id,
      resident_id: resident.id,
      form_type: formType,
      reason,
      status: "draft",
      prepared_date: asStringOrNull(normalized.prepared_date),
      content: normalized.content ?? {},
      version_number: Number(
        asStringOrNull(normalized.version_number) ??
          normalized.version_number ?? 1,
      ) || 1,
      schema_version: Number(
        asStringOrNull(normalized.schema_version) ??
          normalized.schema_version ?? 1,
      ) || 1,
    };

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: update action is missing target_id`,
        );
        continue;
      }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedRecord, error: updateErr } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .select("id")
        .maybeSingle();
      if (updateErr || !updatedRecord) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: ${
            updateErr?.message ??
              "assessment target was not found in the job organization"
          }`,
        );
        continue;
      }
      await markLedgerRowStatus(
        supabase,
        row,
        "applied",
        targetTable,
        updatedRecord.id,
      );
      continue;
    }

    const { data: createdRecord, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdRecord.id,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

async function processIncidentsJob(
  supabase: ReturnType<typeof createClient>,
  job: ClaimedJob,
) {
  const targetTable = DOMAIN_TARGET_TABLE.incidents;
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(IMPORT_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  const residentCache = new Map<
    string,
    {
      id: string;
      facility_id: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null
  >();

  for (const row of ledgerRows) {
    const normalized = asRecord(row.normalized_row);
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(
        supabase,
        row,
        "skipped",
        targetTable,
        row.target_id,
      );
      continue;
    }
    if (action === "update") {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: update action is not supported for incidents`,
      );
      continue;
    }

    const facilityId = asStringOrNull(normalized.facility_id);
    const residentId = asStringOrNull(normalized.resident_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is missing or invalid`,
      );
      continue;
    }
    if (!residentId || !UUID_PATTERN.test(residentId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident_id is missing or invalid`,
      );
      continue;
    }

    if (!facilityCache.has(facilityId)) {
      const { data: facility, error: facilityErr } = await supabase
        .from("facilities")
        .select("id")
        .eq("id", facilityId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (facilityErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`,
        );
        continue;
      }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: facility_id is not in the job organization`,
      );
      continue;
    }

    if (!residentCache.has(residentId)) {
      const { data: resident, error: residentErr } = await supabase
        .from("residents")
        .select("id,facility_id,first_name,last_name")
        .eq("id", residentId)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (residentErr) {
        await markLedgerRowFailure(
          supabase,
          row,
          targetTable,
          `Row ${row.row_number}: failed to verify resident scope (${residentErr.message})`,
        );
        continue;
      }
      residentCache.set(residentId, resident ?? null);
    }
    const resident = residentCache.get(residentId);
    if (!resident) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident is not in the job organization`,
      );
      continue;
    }
    if (resident.facility_id !== facilityId) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: resident is outside the incident facility`,
      );
      continue;
    }

    const occurredAt = asStringOrNull(normalized.occurred_at);
    const incidentType = asStringOrNull(normalized.incident_type);
    const severity = normalizeIncidentSeverity(
      asStringOrNull(normalized.severity),
    );
    const narrative = asStringOrNull(normalized.narrative);
    if (!occurredAt || !incidentType || !severity || !narrative) {
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: occurred_at, incident_type, severity, and narrative are required`,
      );
      continue;
    }

    const residentSnapshot =
      asStringOrNull(normalized.resident_identifier_snapshot) ??
        [resident.last_name, resident.first_name].filter(Boolean).join(", ");
    const locationDetail = asStringOrNull(normalized.location_detail);
    const idempotencyKey = `import:${job.id}:${row.row_number}`;

    const payload: Record<string, unknown> = {
      organization_id: job.organization_id,
      facility_id: facilityId,
      resident_id: resident.id,
      occurred_at: occurredAt,
      incident_type: incidentType,
      severity,
      narrative,
      resident_identifier: resident.id,
      resident_identifier_snapshot: residentSnapshot || null,
      location_detail: locationDetail,
      status: "reported",
      idempotency_key: idempotencyKey,
    };

    const { data: createdIncident, error: createErr } = await supabase
      .from(targetTable)
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (createErr) {
      if (createErr.code === "23505") {
        const { data: existingIncident, error: existingErr } = await supabase
          .from(targetTable)
          .select("id")
          .eq("organization_id", job.organization_id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existingErr || !existingIncident) {
          await markLedgerRowFailure(
            supabase,
            row,
            targetTable,
            `Row ${row.row_number}: duplicate insert detected but existing incident could not be loaded`,
          );
          continue;
        }
        await markLedgerRowStatus(
          supabase,
          row,
          "applied",
          targetTable,
          existingIncident.id,
        );
        continue;
      }
      await markLedgerRowFailure(
        supabase,
        row,
        targetTable,
        `Row ${row.row_number}: ${createErr.message}`,
      );
      continue;
    }
    await markLedgerRowStatus(
      supabase,
      row,
      "applied",
      targetTable,
      createdIncident?.id ?? null,
    );
  }

  return releaseJobWithRecount(supabase, job.id);
}

Deno.serve(async (req) => {
  const authError = requireCronRequest(req, HEADERS);
  if (authError) return authError;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return response({ error: "Service credentials are missing" }, 503);
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = await req.json().catch(() => ({}));
    const requested = Number((payload as { limit?: number }).limit ?? 3);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 10)
      : 3;

    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_data_import_jobs",
      {
        p_limit: limit,
        p_claim_seconds: 600,
      },
    );
    if (claimErr) throw claimErr;

    const jobs = (claimed ?? []) as ClaimedJob[];
    const results: Array<{
      jobId: string;
      domain: string;
      ok: boolean;
      releasedTo?: string;
      appliedRows?: number;
      skippedRows?: number;
      errorRows?: number;
      remainingValidRows?: number;
      error: string | null;
    }> = [];

    for (const job of jobs) {
      try {
        let jobResult:
          | Awaited<ReturnType<typeof processEmployeeJob>>
          | Awaited<ReturnType<typeof processTrainingRecordsJob>>
          | Awaited<ReturnType<typeof processCredentialsJob>>
          | Awaited<ReturnType<typeof processResidentsJob>>
          | Awaited<ReturnType<typeof processResidentContactsJob>>
          | Awaited<ReturnType<typeof processRoomsJob>>
          | Awaited<ReturnType<typeof processAssessmentsJob>>
          | Awaited<ReturnType<typeof processIncidentsJob>>;
        switch (job.domain) {
          case "employees":
            jobResult = await processEmployeeJob(supabase, job);
            break;
          case "training_records":
            jobResult = await processTrainingRecordsJob(supabase, job);
            break;
          case "credentials":
            jobResult = await processCredentialsJob(supabase, job);
            break;
          case "residents":
            jobResult = await processResidentsJob(supabase, job);
            break;
          case "resident_contacts":
            jobResult = await processResidentContactsJob(supabase, job);
            break;
          case "rooms":
            jobResult = await processRoomsJob(supabase, job);
            break;
          case "assessments":
            jobResult = await processAssessmentsJob(supabase, job);
            break;
          case "incidents":
            jobResult = await processIncidentsJob(supabase, job);
            break;
          default: {
            const { error: releaseErr } = await supabase.rpc(
              "release_data_import_job_claim",
              {
                p_job_id: job.id,
                p_status: "ready",
                p_last_error: null,
              },
            );
            results.push({
              jobId: job.id,
              domain: job.domain,
              ok: !releaseErr,
              releasedTo: "ready",
              error: releaseErr?.message ?? null,
            });
            continue;
          }
        }
        results.push({
          jobId: job.id,
          domain: job.domain,
          ok: true,
          releasedTo: jobResult.releasedTo,
          appliedRows: jobResult.appliedRows,
          skippedRows: jobResult.skippedRows,
          errorRows: jobResult.errorRows,
          remainingValidRows: jobResult.remainingValidRows,
          error: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase.rpc("release_data_import_job_claim", {
          p_job_id: job.id,
          p_status: "failed",
          p_last_error: message.slice(0, 2000),
        });
        results.push({
          jobId: job.id,
          domain: job.domain,
          ok: false,
          releasedTo: "failed",
          error: message,
        });
      }
    }

    return response({ success: true, claimed: jobs.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return response({ success: false, error: message }, 500);
  }
});
