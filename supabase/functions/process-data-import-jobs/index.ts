// @ts-nocheck -- Deno typecheck: esm/jsr supabase client + ledger apply helpers
/** Durable import claim loop (BACKLOG D3). Auth: the shared cron secret, like the other workers. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const EMPLOYEE_BATCH_SIZE = 100;
const DOMAIN_BATCH_SIZE = 100;
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
const ROOM_TARGET_TABLE = "facility_rooms";
const CREDENTIAL_TARGET_TABLE = "employee_credentials";
const RESIDENT_TARGET_TABLE = "residents";
const PENDING_DURABLE_DOMAINS = new Set(["resident_contacts", "training_records", "assessments", "incidents"]);

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
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
  payload.administers_medications = asBoolean(payload.administers_medications, false);
  return payload;
}

function asInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildRoomPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  const bedCount = Math.max(1, Math.min(8, asInteger(row.bed_count, 1)));
  const normalizedType = asStringOrNull(row.room_type);
  const roomType = normalizedType === "private" || normalizedType === "semi_private" || normalizedType === "shared"
    ? normalizedType
    : (bedCount === 1 ? "private" : bedCount === 2 ? "semi_private" : "shared");
  return {
    facility_id: asStringOrNull(row.facility_id),
    room_number: asStringOrNull(row.room_number),
    unit_name: asStringOrNull(row.unit_name) ?? "Main",
    building_name: asStringOrNull(row.building_name) ?? "Main",
    bed_count: bedCount,
    room_type: roomType,
    is_active: asBoolean(row.is_active, true),
  };
}

function buildCredentialPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    employee_id: asStringOrNull(row.employee_id),
    facility_id: asStringOrNull(row.facility_id),
    organization_id: organizationId,
    credential_type: asStringOrNull(row.credential_type),
    credential_number: asStringOrNull(row.credential_number),
    issue_date: asStringOrNull(row.issue_date),
    expiration_date: asStringOrNull(row.expiration_date),
    status: asStringOrNull(row.status) ?? "missing",
    verification_method: asStringOrNull(row.verification_method) ?? "csv_import",
    notes: asStringOrNull(row.notes) ?? "Imported via data migration center",
  };
}

function buildResidentPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: organizationId,
    facility_id: asStringOrNull(row.facility_id),
    first_name: asStringOrNull(row.first_name) ?? "",
    last_name: asStringOrNull(row.last_name) ?? "",
    date_of_birth: asStringOrNull(row.date_of_birth),
    room: asStringOrNull(row.room),
    admission_date: asStringOrNull(row.admission_date) ?? new Date().toISOString().slice(0, 10),
    preferred_name: asStringOrNull(row.preferred_name),
    status: asStringOrNull(row.status) ?? "active",
  };
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
  const errorRows = statuses.filter((row) => row.status === "failed" || row.status === "invalid").length;

  const updatePayload: Record<string, unknown> = {
    applied_rows: appliedRows,
    skipped_rows: skippedRows,
    error_rows: errorRows,
    valid_rows: validRows,
  };
  if (finalizedStatus === "applied") {
    updatePayload.applied_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabase.from("data_import_jobs").update(updatePayload).eq("id", jobId);
  if (updateErr) throw updateErr;

  return { appliedRows, skippedRows, errorRows, validRows };
}

async function markLedgerRowFailure(
  supabase: ReturnType<typeof createClient>,
  row: ImportLedgerRow,
  errorMessage: string,
) {
  return markLedgerRowFailureForTable(supabase, row, "employees", errorMessage);
}

async function markLedgerRowFailureForTable(
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

async function markLedgerRowStatus(
  supabase: ReturnType<typeof createClient>,
  row: ImportLedgerRow,
  options: {
    status: "applied" | "skipped";
    targetTable: string;
    targetId: string | null;
  },
) {
  const { error } = await supabase
    .from("data_import_rows")
    .update({
      status: options.status,
      target_table: options.targetTable,
      target_id: options.targetId,
      errors: [],
      applied_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw error;
}

async function ensureFacilityInOrganization(
  supabase: ReturnType<typeof createClient>,
  facilityCache: Map<string, boolean>,
  facilityId: string,
  organizationId: string,
) {
  if (!facilityCache.has(facilityId)) {
    const { data: facility, error: facilityErr } = await supabase
      .from("facilities")
      .select("id")
      .eq("id", facilityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (facilityErr) {
      throw facilityErr;
    }
    facilityCache.set(facilityId, Boolean(facility));
  }
  return facilityCache.get(facilityId) === true;
}

async function finalizeAndReleaseJob(
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

  const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", {
    p_job_id: jobId,
    p_status: finalizedStatus,
    p_last_error: null,
  });
  if (releaseErr) throw releaseErr;

  return {
    remainingValidRows: counts.validRows,
    appliedRows: counts.appliedRows,
    skippedRows: counts.skippedRows,
    errorRows: counts.errorRows,
    releasedTo: finalizedStatus,
  };
}

async function processEmployeeJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(EMPLOYEE_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const payload = buildEmployeePayload(row.normalized_row, job.organization_id);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: facility_id is missing or invalid`);
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
          `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`,
        );
        continue;
      }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) {
      await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: facility_id is not in the job organization`);
      continue;
    }

    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      const { error: skipErr } = await supabase
        .from("data_import_rows")
        .update({
          status: "skipped",
          target_table: "employees",
          target_id: row.target_id,
          errors: [],
          applied_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (skipErr) throw skipErr;
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: update action is missing target_id`);
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
          `Row ${row.row_number}: ${updateErr?.message ?? "employee target was not found in the job organization"}`,
        );
        continue;
      }
      const { error: ledgerUpdateErr } = await supabase
        .from("data_import_rows")
        .update({
          status: "applied",
          target_table: "employees",
          target_id: updatedEmployee.id,
          errors: [],
          applied_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (ledgerUpdateErr) throw ledgerUpdateErr;
      continue;
    }

    const { data: createdEmployee, error: createErr } = await supabase
      .from("employees")
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: ${createErr.message}`);
      continue;
    }
    const { error: ledgerCreateErr } = await supabase
      .from("data_import_rows")
      .update({
        status: "applied",
        target_table: "employees",
        target_id: createdEmployee.id,
        errors: [],
        applied_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (ledgerCreateErr) throw ledgerCreateErr;
  }

  const counts = await recountAndPersistJobCounters(supabase, job.id);
  const hasRemainingValidRows = counts.validRows > 0;
  const finalizedStatus = hasRemainingValidRows
    ? "applying"
    : (counts.appliedRows === 0 && counts.errorRows > 0 ? "failed" : "applied");

  if (!hasRemainingValidRows && finalizedStatus === "applied") {
    await recountAndPersistJobCounters(supabase, job.id, "applied");
  }

  const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", {
    p_job_id: job.id,
    p_status: finalizedStatus,
    p_last_error: null,
  });
  if (releaseErr) throw releaseErr;

  return {
    remainingValidRows: counts.validRows,
    appliedRows: counts.appliedRows,
    skippedRows: counts.skippedRows,
    errorRows: counts.errorRows,
    releasedTo: finalizedStatus,
  };
}

async function processRoomJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const payload = buildRoomPayload(row.normalized_row);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: facility_id is missing or invalid`);
      continue;
    }
    if (!asStringOrNull(payload.room_number)) {
      await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: room_number is required`);
      continue;
    }

    try {
      const isInScope = await ensureFacilityInOrganization(supabase, facilityCache, facilityId, job.organization_id);
      if (!isInScope) {
        await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: facility_id is not in the job organization`);
        continue;
      }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`);
      continue;
    }

    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(supabase, row, {
        status: "skipped",
        targetTable: ROOM_TARGET_TABLE,
        targetId: row.target_id,
      });
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`);
        continue;
      }
      const { data: existingRoom, error: existingRoomErr } = await supabase
        .from("facility_rooms")
        .select("id,facility_id")
        .eq("id", row.target_id)
        .maybeSingle();
      if (existingRoomErr || !existingRoom) {
        await markLedgerRowFailureForTable(
          supabase,
          row,
          ROOM_TARGET_TABLE,
          `Row ${row.row_number}: ${existingRoomErr?.message ?? "room target was not found"}`,
        );
        continue;
      }
      try {
        const roomInScope = await ensureFacilityInOrganization(supabase, facilityCache, String(existingRoom.facility_id), job.organization_id);
        if (!roomInScope) {
          await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: room target is not in the job organization`);
          continue;
        }
      } catch (facilityErr) {
        const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
        await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: failed to verify room target scope (${message})`);
        continue;
      }
    }

    const { data, error } = await supabase.rpc("create_room_with_beds", {
      p_facility_id: facilityId,
      p_building_name: payload.building_name,
      p_unit_name: payload.unit_name,
      p_room_number: payload.room_number,
      p_room_type: payload.room_type,
      p_bed_count: payload.bed_count,
      p_gender_restriction: "none",
    });
    if (error) {
      await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: ${error.message}`);
      continue;
    }

    const recordId = asStringOrNull(data) ?? row.target_id;
    if (!payload.is_active && recordId) {
      const { error: inactiveErr } = await supabase
        .from("facility_rooms")
        .update({ is_active: false })
        .eq("id", recordId);
      if (inactiveErr) {
        await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: ${inactiveErr.message}`);
        continue;
      }
    }

    await markLedgerRowStatus(supabase, row, {
      status: "applied",
      targetTable: ROOM_TARGET_TABLE,
      targetId: recordId,
    });
  }

  return finalizeAndReleaseJob(supabase, job.id);
}

async function processCredentialJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  const employeeCache = new Map<string, { id: string; organization_id: string; facility_id: string | null } | null>();

  for (const row of ledgerRows) {
    const payload = buildCredentialPayload(row.normalized_row, job.organization_id);
    const employeeId = asStringOrNull(payload.employee_id);
    if (!employeeId || !UUID_PATTERN.test(employeeId)) {
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee_id is missing or invalid`);
      continue;
    }
    if (!payload.credential_type) {
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: credential_type is required`);
      continue;
    }

    if (!employeeCache.has(employeeId)) {
      const { data: employee, error: employeeErr } = await supabase
        .from("employees")
        .select("id,organization_id,facility_id")
        .eq("id", employeeId)
        .maybeSingle();
      if (employeeErr) {
        await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: failed to verify employee scope (${employeeErr.message})`);
        continue;
      }
      employeeCache.set(employeeId, employee ? {
        id: String(employee.id),
        organization_id: String(employee.organization_id),
        facility_id: asStringOrNull(employee.facility_id),
      } : null);
    }

    const employee = employeeCache.get(employeeId);
    if (!employee || employee.organization_id !== job.organization_id) {
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee is not in the job organization`);
      continue;
    }
    if (!employee.facility_id || !UUID_PATTERN.test(employee.facility_id)) {
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee facility is missing or invalid`);
      continue;
    }

    try {
      const facilityInScope = await ensureFacilityInOrganization(supabase, facilityCache, employee.facility_id, job.organization_id);
      if (!facilityInScope) {
        await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee facility is not in the job organization`);
        continue;
      }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`);
      continue;
    }

    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(supabase, row, {
        status: "skipped",
        targetTable: CREDENTIAL_TARGET_TABLE,
        targetId: row.target_id,
      });
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`);
        continue;
      }
      const { data: existingCredential, error: existingCredentialErr } = await supabase
        .from("employee_credentials")
        .select("id,organization_id")
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (existingCredentialErr || !existingCredential) {
        await markLedgerRowFailureForTable(
          supabase,
          row,
          CREDENTIAL_TARGET_TABLE,
          `Row ${row.row_number}: ${existingCredentialErr?.message ?? "credential target was not found in the job organization"}`,
        );
        continue;
      }
    }

    const rpcPayload = { ...payload, facility_id: employee.facility_id, employee_id: employee.id, organization_id: job.organization_id };
    const { data, error } = await supabase.rpc("save_employee_credential", {
      p_credential_id: action === "update" ? row.target_id : undefined,
      p_payload: rpcPayload,
    });
    if (error) {
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: ${error.message}`);
      continue;
    }

    const createdData = asRecord(data);
    const recordId = asStringOrNull(createdData.id) ?? asStringOrNull(data) ?? row.target_id;
    await markLedgerRowStatus(supabase, row, {
      status: "applied",
      targetTable: CREDENTIAL_TARGET_TABLE,
      targetId: recordId,
    });
  }

  return finalizeAndReleaseJob(supabase, job.id);
}

async function processResidentJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase
    .from("data_import_rows")
    .select("id,row_number,normalized_row,proposed_action,target_id")
    .eq("job_id", job.id)
    .eq("status", "valid")
    .order("row_number", { ascending: true })
    .limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;

  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();

  for (const row of ledgerRows) {
    const payload = buildResidentPayload(row.normalized_row, job.organization_id);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) {
      await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: facility_id is missing or invalid`);
      continue;
    }
    if (!payload.first_name.trim() || !payload.last_name.trim()) {
      await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: first_name and last_name are required`);
      continue;
    }

    try {
      const inScope = await ensureFacilityInOrganization(supabase, facilityCache, facilityId, job.organization_id);
      if (!inScope) {
        await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: facility_id is not in the job organization`);
        continue;
      }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`);
      continue;
    }

    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      await markLedgerRowStatus(supabase, row, {
        status: "skipped",
        targetTable: RESIDENT_TARGET_TABLE,
        targetId: row.target_id,
      });
      continue;
    }

    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) {
        await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`);
        continue;
      }
      const { data: existingResident, error: existingResidentErr } = await supabase
        .from("residents")
        .select("id,organization_id")
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (existingResidentErr || !existingResident) {
        await markLedgerRowFailureForTable(
          supabase,
          row,
          RESIDENT_TARGET_TABLE,
          `Row ${row.row_number}: ${existingResidentErr?.message ?? "resident target was not found in the job organization"}`,
        );
        continue;
      }
      const { error: updateErr } = await supabase
        .from("residents")
        .update({
          first_name: payload.first_name,
          last_name: payload.last_name,
          date_of_birth: payload.date_of_birth,
          room: payload.room,
          preferred_name: payload.preferred_name,
        })
        .eq("id", row.target_id)
        .eq("organization_id", job.organization_id);
      if (updateErr) {
        await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: ${updateErr.message}`);
        continue;
      }
      await markLedgerRowStatus(supabase, row, {
        status: "applied",
        targetTable: RESIDENT_TARGET_TABLE,
        targetId: row.target_id,
      });
      continue;
    }

    const { data: createdResident, error: createErr } = await supabase
      .from("residents")
      .insert(payload)
      .select("id")
      .single();
    if (createErr) {
      await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: ${createErr.message}`);
      continue;
    }

    await markLedgerRowStatus(supabase, row, {
      status: "applied",
      targetTable: RESIDENT_TARGET_TABLE,
      targetId: asStringOrNull(createdResident?.id),
    });
  }

  return finalizeAndReleaseJob(supabase, job.id);
}

Deno.serve(async (req) => {
  const authError = requireCronRequest(req, HEADERS);
  if (authError) return authError;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ error: "Service credentials are missing" }, 503);

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = await req.json().catch(() => ({}));
    const requested = Number((payload as { limit?: number }).limit ?? 3);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 10) : 3;

    const { data: claimed, error: claimErr } = await supabase.rpc("claim_data_import_jobs", {
      p_limit: limit,
      p_claim_seconds: 600,
    });
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
      if (!["employees", "rooms", "credentials", "residents"].includes(job.domain)) {
        // Follow-up domains will retain ready-release behavior until their domain applicators
        // are migrated into this durable worker (resident_contacts, training_records,
        // assessments, incidents).
        const pendingMessage = PENDING_DURABLE_DOMAINS.has(job.domain)
          ? "Durable apply pending for this domain; claim released back to ready."
          : null;
        const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", {
          p_job_id: job.id,
          p_status: "ready",
          p_last_error: null,
        });
        results.push({
          jobId: job.id,
          domain: job.domain,
          ok: !releaseErr,
          releasedTo: "ready",
          error: releaseErr?.message ?? pendingMessage,
        });
        continue;
      }

      try {
        const workerResult = job.domain === "employees"
          ? await processEmployeeJob(supabase, job)
          : job.domain === "rooms"
          ? await processRoomJob(supabase, job)
          : job.domain === "credentials"
          ? await processCredentialJob(supabase, job)
          : await processResidentJob(supabase, job);
        results.push({
          jobId: job.id,
          domain: job.domain,
          ok: true,
          releasedTo: workerResult.releasedTo,
          appliedRows: workerResult.appliedRows,
          skippedRows: workerResult.skippedRows,
          errorRows: workerResult.errorRows,
          remainingValidRows: workerResult.remainingValidRows,
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
