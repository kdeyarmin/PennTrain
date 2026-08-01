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
  "facility_id", "first_name", "last_name", "job_title", "email", "employee_number",
  "department", "phone", "hire_date", "status", "trainer_status", "administers_medications",
] as const;
const ROOM_TARGET_TABLE = "facility_rooms";
const CREDENTIAL_TARGET_TABLE = "employee_credentials";
const RESIDENT_TARGET_TABLE = "residents";
const CONTACT_TARGET_TABLE = "resident_contacts";
const TRAINING_TARGET_TABLE = "employee_training_records";
const ASSESSMENT_TARGET_TABLE = "resident_assessment_forms";
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
// incidents remains pending: create_incident_atomic is security invoker and requires auth.uid()
const PENDING_DURABLE_DOMAINS = new Set(["incidents"]);

type ClaimedJob = { id: string; domain: string; organization_id: string };
type ImportLedgerRow = { id: string; row_number: number; normalized_row: unknown; proposed_action: string; target_id: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string") { const t = value.trim(); return t.length > 0 ? t : null; }
  return null;
}
function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const l = value.trim().toLowerCase();
    if (l === "true") return true;
    if (l === "false") return false;
  }
  return fallback;
}
function normalizeAction(value: string): "create" | "update" | "skip" {
  if (value === "update" || value === "skip") return value;
  return "create";
}
function asInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const p = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(p)) return p;
  }
  return fallback;
}

function buildEmployeePayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  const payload: Record<string, unknown> = { organization_id: organizationId };
  for (const field of EMPLOYEE_WRITABLE_FIELDS) payload[field] = row[field];
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
function buildRoomPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  const bedCount = Math.max(1, Math.min(8, asInteger(row.bed_count, 1)));
  const nt = asStringOrNull(row.room_type);
  const roomType = nt === "private" || nt === "semi_private" || nt === "shared" ? nt
    : (bedCount === 1 ? "private" : bedCount === 2 ? "semi_private" : "shared");
  return {
    facility_id: asStringOrNull(row.facility_id), room_number: asStringOrNull(row.room_number),
    unit_name: asStringOrNull(row.unit_name) ?? "Main", building_name: asStringOrNull(row.building_name) ?? "Main",
    bed_count: bedCount, room_type: roomType, is_active: asBoolean(row.is_active, true),
  };
}
function buildCredentialPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    employee_id: asStringOrNull(row.employee_id), facility_id: asStringOrNull(row.facility_id),
    organization_id: organizationId, credential_type: asStringOrNull(row.credential_type),
    credential_number: asStringOrNull(row.credential_number), issue_date: asStringOrNull(row.issue_date),
    expiration_date: asStringOrNull(row.expiration_date), status: asStringOrNull(row.status) ?? "missing",
    verification_method: asStringOrNull(row.verification_method) ?? "csv_import",
    notes: asStringOrNull(row.notes) ?? "Imported via data migration center",
  };
}
function buildResidentPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: organizationId, facility_id: asStringOrNull(row.facility_id),
    first_name: asStringOrNull(row.first_name) ?? "", last_name: asStringOrNull(row.last_name) ?? "",
    date_of_birth: asStringOrNull(row.date_of_birth), room: asStringOrNull(row.room),
    admission_date: asStringOrNull(row.admission_date) ?? new Date().toISOString().slice(0, 10),
    preferred_name: asStringOrNull(row.preferred_name), status: asStringOrNull(row.status) ?? "active",
  };
}
function buildContactPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  const isPrimary = asBoolean(row.is_primary, false);
  const contactType = asStringOrNull(row.contact_type)?.toLowerCase();
  return {
    organization_id: organizationId,
    facility_id: asStringOrNull(row.facility_id),
    resident_id: asStringOrNull(row.resident_id),
    name: asStringOrNull(row.name) ?? "",
    relationship: asStringOrNull(row.relationship),
    email: asStringOrNull(row.email)?.toLowerCase() ?? null,
    phone: asStringOrNull(row.phone),
    is_primary: isPrimary,
    contact_type: contactType && RESIDENT_CONTACT_TYPES.has(contactType) ? contactType : (isPrimary ? "emergency_contact" : "other"),
    active: asBoolean(row.active, true),
  };
}
function buildTrainingPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: organizationId,
    facility_id: asStringOrNull(row.facility_id),
    employee_id: asStringOrNull(row.employee_id),
    training_type_id: asStringOrNull(row.training_type_id),
    completion_date: asStringOrNull(row.completion_date),
    due_date: asStringOrNull(row.due_date),
    status: asStringOrNull(row.status) ?? "compliant",
    completion_method: asStringOrNull(row.completion_method) ?? "csv_import",
    training_provider: asStringOrNull(row.training_provider),
    notes: asStringOrNull(row.notes) ?? "Imported via data migration center",
    document_required: asBoolean(row.document_required, false),
    approval_status: asStringOrNull(row.approval_status) ?? "approved",
  };
}
function buildAssessmentPayload(normalizedRow: unknown, organizationId: string) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: organizationId,
    facility_id: asStringOrNull(row.facility_id),
    resident_id: asStringOrNull(row.resident_id),
    form_type: asStringOrNull(row.form_type),
    reason: asStringOrNull(row.reason) ?? "initial",
    status: "draft",
    prepared_date: asStringOrNull(row.prepared_date),
    content: (row.content && typeof row.content === "object") ? row.content : { csv_import: true },
    version_number: asInteger(row.version_number, 1),
    schema_version: asInteger(row.schema_version, 1),
  };
}

async function recountAndPersistJobCounters(supabase: ReturnType<typeof createClient>, jobId: string, finalizedStatus?: "applied" | "failed") {
  const { data: ledgerStatuses, error: countsErr } = await supabase.from("data_import_rows").select("status").eq("job_id", jobId);
  if (countsErr) throw countsErr;
  const statuses = (ledgerStatuses ?? []) as Array<{ status: string }>;
  const appliedRows = statuses.filter((r) => r.status === "applied").length;
  const skippedRows = statuses.filter((r) => r.status === "skipped").length;
  const validRows = statuses.filter((r) => r.status === "valid").length;
  const errorRows = statuses.filter((r) => r.status === "failed" || r.status === "invalid").length;
  const updatePayload: Record<string, unknown> = { applied_rows: appliedRows, skipped_rows: skippedRows, error_rows: errorRows, valid_rows: validRows };
  if (finalizedStatus === "applied") updatePayload.applied_at = new Date().toISOString();
  const { error: updateErr } = await supabase.from("data_import_jobs").update(updatePayload).eq("id", jobId);
  if (updateErr) throw updateErr;
  return { appliedRows, skippedRows, errorRows, validRows };
}
async function markLedgerRowFailure(supabase: ReturnType<typeof createClient>, row: ImportLedgerRow, errorMessage: string) {
  return markLedgerRowFailureForTable(supabase, row, "employees", errorMessage);
}
async function markLedgerRowFailureForTable(supabase: ReturnType<typeof createClient>, row: ImportLedgerRow, targetTable: string, errorMessage: string) {
  const { error } = await supabase.from("data_import_rows").update({ status: "failed", target_table: targetTable, errors: [errorMessage], applied_at: null }).eq("id", row.id);
  if (error) throw error;
}
async function markLedgerRowStatus(supabase: ReturnType<typeof createClient>, row: ImportLedgerRow, options: { status: "applied" | "skipped"; targetTable: string; targetId: string | null }) {
  const { error } = await supabase.from("data_import_rows").update({ status: options.status, target_table: options.targetTable, target_id: options.targetId, errors: [], applied_at: new Date().toISOString() }).eq("id", row.id);
  if (error) throw error;
}
async function ensureFacilityInOrganization(supabase: ReturnType<typeof createClient>, facilityCache: Map<string, boolean>, facilityId: string, organizationId: string) {
  if (!facilityCache.has(facilityId)) {
    const { data: facility, error: facilityErr } = await supabase.from("facilities").select("id").eq("id", facilityId).eq("organization_id", organizationId).maybeSingle();
    if (facilityErr) throw facilityErr;
    facilityCache.set(facilityId, Boolean(facility));
  }
  return facilityCache.get(facilityId) === true;
}
async function finalizeAndReleaseJob(supabase: ReturnType<typeof createClient>, jobId: string) {
  const counts = await recountAndPersistJobCounters(supabase, jobId);
  const hasRemainingValidRows = counts.validRows > 0;
  const finalizedStatus = hasRemainingValidRows ? "applying" : (counts.appliedRows === 0 && counts.errorRows > 0 ? "failed" : "applied");
  if (!hasRemainingValidRows && finalizedStatus === "applied") await recountAndPersistJobCounters(supabase, jobId, "applied");
  const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", { p_job_id: jobId, p_status: finalizedStatus, p_last_error: null });
  if (releaseErr) throw releaseErr;
  return { remainingValidRows: counts.validRows, appliedRows: counts.appliedRows, skippedRows: counts.skippedRows, errorRows: counts.errorRows, releasedTo: finalizedStatus };
}

async function processEmployeeJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(EMPLOYEE_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  for (const row of ledgerRows) {
    const payload = buildEmployeePayload(row.normalized_row, job.organization_id);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: facility_id is missing or invalid`); continue; }
    if (!facilityCache.has(facilityId)) {
      const { data: facility, error: facilityErr } = await supabase.from("facilities").select("id").eq("id", facilityId).eq("organization_id", job.organization_id).maybeSingle();
      if (facilityErr) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: failed to verify facility scope (${facilityErr.message})`); continue; }
      facilityCache.set(facilityId, Boolean(facility));
    }
    if (!facilityCache.get(facilityId)) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: facility_id is not in the job organization`); continue; }
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") {
      const { error: skipErr } = await supabase.from("data_import_rows").update({ status: "skipped", target_table: "employees", target_id: row.target_id, errors: [], applied_at: new Date().toISOString() }).eq("id", row.id);
      if (skipErr) throw skipErr; continue;
    }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: update action is missing target_id`); continue; }
      const { organization_id: _org, ...updatePayload } = payload;
      const { data: updatedEmployee, error: updateErr } = await supabase.from("employees").update(updatePayload).eq("id", row.target_id).eq("organization_id", job.organization_id).select("id").maybeSingle();
      if (updateErr || !updatedEmployee) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: ${updateErr?.message ?? "employee target was not found in the job organization"}`); continue; }
      const { error: ledgerUpdateErr } = await supabase.from("data_import_rows").update({ status: "applied", target_table: "employees", target_id: updatedEmployee.id, errors: [], applied_at: new Date().toISOString() }).eq("id", row.id);
      if (ledgerUpdateErr) throw ledgerUpdateErr; continue;
    }
    const { data: createdEmployee, error: createErr } = await supabase.from("employees").insert(payload).select("id").single();
    if (createErr) { await markLedgerRowFailure(supabase, row, `Row ${row.row_number}: ${createErr.message}`); continue; }
    const { error: ledgerCreateErr } = await supabase.from("data_import_rows").update({ status: "applied", target_table: "employees", target_id: createdEmployee.id, errors: [], applied_at: new Date().toISOString() }).eq("id", row.id);
    if (ledgerCreateErr) throw ledgerCreateErr;
  }
  const counts = await recountAndPersistJobCounters(supabase, job.id);
  const hasRemainingValidRows = counts.validRows > 0;
  const finalizedStatus = hasRemainingValidRows ? "applying" : (counts.appliedRows === 0 && counts.errorRows > 0 ? "failed" : "applied");
  if (!hasRemainingValidRows && finalizedStatus === "applied") await recountAndPersistJobCounters(supabase, job.id, "applied");
  const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", { p_job_id: job.id, p_status: finalizedStatus, p_last_error: null });
  if (releaseErr) throw releaseErr;
  return { remainingValidRows: counts.validRows, appliedRows: counts.appliedRows, skippedRows: counts.skippedRows, errorRows: counts.errorRows, releasedTo: finalizedStatus };
}

async function processRoomJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  for (const row of ledgerRows) {
    const payload = buildRoomPayload(row.normalized_row);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: facility_id is missing or invalid`); continue; }
    if (!asStringOrNull(payload.room_number)) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: room_number is required`); continue; }
    try {
      const isInScope = await ensureFacilityInOrganization(supabase, facilityCache, facilityId, job.organization_id);
      if (!isInScope) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: facility_id is not in the job organization`); continue; }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`); continue;
    }
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: ROOM_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`); continue; }
      const { data: existingRoom, error: existingRoomErr } = await supabase.from("facility_rooms").select("id,facility_id").eq("id", row.target_id).maybeSingle();
      if (existingRoomErr || !existingRoom) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: ${existingRoomErr?.message ?? "room target was not found"}`); continue; }
      try {
        const roomInScope = await ensureFacilityInOrganization(supabase, facilityCache, String(existingRoom.facility_id), job.organization_id);
        if (!roomInScope) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: room target is not in the job organization`); continue; }
      } catch (facilityErr) {
        const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
        await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: failed to verify room target scope (${message})`); continue;
      }
    }
    const { data, error } = await supabase.rpc("create_room_with_beds", { p_facility_id: facilityId, p_building_name: payload.building_name, p_unit_name: payload.unit_name, p_room_number: payload.room_number, p_room_type: payload.room_type, p_bed_count: payload.bed_count, p_gender_restriction: "none" });
    if (error) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: ${error.message}`); continue; }
    const recordId = asStringOrNull(data) ?? row.target_id;
    if (!payload.is_active && recordId) {
      const { error: inactiveErr } = await supabase.from("facility_rooms").update({ is_active: false }).eq("id", recordId);
      if (inactiveErr) { await markLedgerRowFailureForTable(supabase, row, ROOM_TARGET_TABLE, `Row ${row.row_number}: ${inactiveErr.message}`); continue; }
    }
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: ROOM_TARGET_TABLE, targetId: recordId });
  }
  return finalizeAndReleaseJob(supabase, job.id);
}

async function processCredentialJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  const employeeCache = new Map<string, { id: string; organization_id: string; facility_id: string | null } | null>();
  for (const row of ledgerRows) {
    const payload = buildCredentialPayload(row.normalized_row, job.organization_id);
    const employeeId = asStringOrNull(payload.employee_id);
    if (!employeeId || !UUID_PATTERN.test(employeeId)) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee_id is missing or invalid`); continue; }
    if (!payload.credential_type) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: credential_type is required`); continue; }
    if (!employeeCache.has(employeeId)) {
      const { data: employee, error: employeeErr } = await supabase.from("employees").select("id,organization_id,facility_id").eq("id", employeeId).maybeSingle();
      if (employeeErr) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: failed to verify employee scope (${employeeErr.message})`); continue; }
      employeeCache.set(employeeId, employee ? { id: String(employee.id), organization_id: String(employee.organization_id), facility_id: asStringOrNull(employee.facility_id) } : null);
    }
    const employee = employeeCache.get(employeeId);
    if (!employee || employee.organization_id !== job.organization_id) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee is not in the job organization`); continue; }
    if (!employee.facility_id || !UUID_PATTERN.test(employee.facility_id)) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee facility is missing or invalid`); continue; }
    try {
      const facilityInScope = await ensureFacilityInOrganization(supabase, facilityCache, employee.facility_id, job.organization_id);
      if (!facilityInScope) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: employee facility is not in the job organization`); continue; }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`); continue;
    }
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: CREDENTIAL_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`); continue; }
      const { data: existingCredential, error: existingCredentialErr } = await supabase.from("employee_credentials").select("id,organization_id").eq("id", row.target_id).eq("organization_id", job.organization_id).maybeSingle();
      if (existingCredentialErr || !existingCredential) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: ${existingCredentialErr?.message ?? "credential target was not found in the job organization"}`); continue; }
    }
    const rpcPayload = { ...payload, facility_id: employee.facility_id, employee_id: employee.id, organization_id: job.organization_id };
    const { data, error } = await supabase.rpc("save_employee_credential", { p_credential_id: action === "update" ? row.target_id : undefined, p_payload: rpcPayload });
    if (error) { await markLedgerRowFailureForTable(supabase, row, CREDENTIAL_TARGET_TABLE, `Row ${row.row_number}: ${error.message}`); continue; }
    const createdData = asRecord(data);
    const recordId = asStringOrNull(createdData.id) ?? asStringOrNull(data) ?? row.target_id;
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: CREDENTIAL_TARGET_TABLE, targetId: recordId });
  }
  return finalizeAndReleaseJob(supabase, job.id);
}

async function processResidentJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  const facilityCache = new Map<string, boolean>();
  for (const row of ledgerRows) {
    const payload = buildResidentPayload(row.normalized_row, job.organization_id);
    const facilityId = asStringOrNull(payload.facility_id);
    if (!facilityId || !UUID_PATTERN.test(facilityId)) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: facility_id is missing or invalid`); continue; }
    if (!payload.first_name.trim() || !payload.last_name.trim()) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: first_name and last_name are required`); continue; }
    try {
      const inScope = await ensureFacilityInOrganization(supabase, facilityCache, facilityId, job.organization_id);
      if (!inScope) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: facility_id is not in the job organization`); continue; }
    } catch (facilityErr) {
      const message = facilityErr instanceof Error ? facilityErr.message : String(facilityErr);
      await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: failed to verify facility scope (${message})`); continue;
    }
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: RESIDENT_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: update action is missing target_id`); continue; }
      const { data: existingResident, error: existingResidentErr } = await supabase.from("residents").select("id,organization_id").eq("id", row.target_id).eq("organization_id", job.organization_id).maybeSingle();
      if (existingResidentErr || !existingResident) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: ${existingResidentErr?.message ?? "resident target was not found in the job organization"}`); continue; }
      const { error: updateErr } = await supabase.from("residents").update({ first_name: payload.first_name, last_name: payload.last_name, date_of_birth: payload.date_of_birth, room: payload.room, preferred_name: payload.preferred_name }).eq("id", row.target_id).eq("organization_id", job.organization_id);
      if (updateErr) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: ${updateErr.message}`); continue; }
      await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: RESIDENT_TARGET_TABLE, targetId: row.target_id }); continue;
    }
    const { data: createdResident, error: createErr } = await supabase.from("residents").insert(payload).select("id").single();
    if (createErr) { await markLedgerRowFailureForTable(supabase, row, RESIDENT_TARGET_TABLE, `Row ${row.row_number}: ${createErr.message}`); continue; }
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: RESIDENT_TARGET_TABLE, targetId: asStringOrNull(createdResident?.id) });
  }
  return finalizeAndReleaseJob(supabase, job.id);
}

async function processResidentContactsJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  for (const row of ledgerRows) {
    const payload = buildContactPayload(row.normalized_row, job.organization_id);
    const residentId = asStringOrNull(payload.resident_id);
    if (!residentId || !UUID_PATTERN.test(residentId)) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: resident_id is missing or invalid`); continue; }
    if (!payload.name.trim()) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: name is required`); continue; }
    const { data: resident, error: resErr } = await supabase.from("residents").select("id,organization_id,facility_id").eq("id", residentId).eq("organization_id", job.organization_id).maybeSingle();
    if (resErr || !resident) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: resident not found in job organization`); continue; }
    payload.facility_id = asStringOrNull(resident.facility_id) ?? payload.facility_id;
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: CONTACT_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: update missing target_id`); continue; }
      const { data: updated, error: updErr } = await supabase.from("resident_contacts").update({ name: payload.name, relationship: payload.relationship, email: payload.email, phone: payload.phone, is_primary: payload.is_primary, contact_type: payload.contact_type, active: payload.active }).eq("id", row.target_id).eq("organization_id", job.organization_id).eq("resident_id", residentId).select("id").maybeSingle();
      if (updErr || !updated) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: ${updErr?.message ?? "contact target was not found in resident scope"}`); continue; }
      await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: CONTACT_TARGET_TABLE, targetId: asStringOrNull(updated.id) ?? row.target_id }); continue;
    }
    const { data: created, error: createErr } = await supabase.from("resident_contacts").insert(payload).select("id").single();
    if (createErr) { await markLedgerRowFailureForTable(supabase, row, CONTACT_TARGET_TABLE, `Row ${row.row_number}: ${createErr.message}`); continue; }
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: CONTACT_TARGET_TABLE, targetId: asStringOrNull(created?.id) });
  }
  return finalizeAndReleaseJob(supabase, job.id);
}

async function processTrainingRecordsJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  for (const row of ledgerRows) {
    const payload = buildTrainingPayload(row.normalized_row, job.organization_id);
    const employeeId = asStringOrNull(payload.employee_id);
    const trainingTypeId = asStringOrNull(payload.training_type_id);
    if (!employeeId || !UUID_PATTERN.test(employeeId)) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: employee_id is missing or invalid`); continue; }
    if (!trainingTypeId || !UUID_PATTERN.test(trainingTypeId)) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: training_type_id is missing or invalid`); continue; }
    const { data: employee, error: empErr } = await supabase.from("employees").select("id,organization_id,facility_id,status").eq("id", employeeId).eq("organization_id", job.organization_id).maybeSingle();
    if (empErr || !employee) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: employee not found in job organization`); continue; }
    if (employee.status === "terminated") { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: employee is terminated`); continue; }
    payload.facility_id = asStringOrNull(employee.facility_id) ?? payload.facility_id;
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: TRAINING_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: update missing target_id`); continue; }
      const { data: updated, error: updErr } = await supabase.from("employee_training_records").update({ completion_date: payload.completion_date, due_date: payload.due_date, status: payload.status, completion_method: payload.completion_method, training_provider: payload.training_provider, notes: payload.notes, document_required: payload.document_required, approval_status: payload.approval_status }).eq("id", row.target_id).eq("organization_id", job.organization_id).eq("employee_id", employeeId).select("id").maybeSingle();
      if (updErr || !updated) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: ${updErr?.message ?? "training target was not found in employee scope"}`); continue; }
      await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: TRAINING_TARGET_TABLE, targetId: asStringOrNull(updated.id) ?? row.target_id }); continue;
    }
    const { data: created, error: createErr } = await supabase.from("employee_training_records").insert(payload).select("id").single();
    if (createErr) { await markLedgerRowFailureForTable(supabase, row, TRAINING_TARGET_TABLE, `Row ${row.row_number}: ${createErr.message}`); continue; }
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: TRAINING_TARGET_TABLE, targetId: asStringOrNull(created?.id) });
  }
  return finalizeAndReleaseJob(supabase, job.id);
}

async function processAssessmentsJob(supabase: ReturnType<typeof createClient>, job: ClaimedJob) {
  const { data: rows, error: rowsErr } = await supabase.from("data_import_rows").select("id,row_number,normalized_row,proposed_action,target_id").eq("job_id", job.id).eq("status", "valid").order("row_number", { ascending: true }).limit(DOMAIN_BATCH_SIZE);
  if (rowsErr) throw rowsErr;
  const ledgerRows = (rows ?? []) as ImportLedgerRow[];
  for (const row of ledgerRows) {
    const payload = buildAssessmentPayload(row.normalized_row, job.organization_id);
    const residentId = asStringOrNull(payload.resident_id);
    if (!residentId || !UUID_PATTERN.test(residentId)) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: resident_id is missing or invalid`); continue; }
    if (!payload.form_type || (payload.form_type !== "RASP" && payload.form_type !== "ASP")) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: form_type must be RASP or ASP`); continue; }
    const { data: resident, error: resErr } = await supabase.from("residents").select("id,organization_id,facility_id").eq("id", residentId).eq("organization_id", job.organization_id).maybeSingle();
    if (resErr || !resident) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: resident not found in job organization`); continue; }
    payload.facility_id = asStringOrNull(resident.facility_id) ?? payload.facility_id;
    const action = normalizeAction(row.proposed_action);
    if (action === "skip") { await markLedgerRowStatus(supabase, row, { status: "skipped", targetTable: ASSESSMENT_TARGET_TABLE, targetId: row.target_id }); continue; }
    if (action === "update") {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: update missing target_id`); continue; }
      const { data: updated, error: updErr } = await supabase.from("resident_assessment_forms").update({ reason: payload.reason, prepared_date: payload.prepared_date, content: payload.content }).eq("id", row.target_id).eq("organization_id", job.organization_id).eq("resident_id", residentId).select("id").maybeSingle();
      if (updErr || !updated) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: ${updErr?.message ?? "assessment target was not found in resident scope"}`); continue; }
      await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: ASSESSMENT_TARGET_TABLE, targetId: asStringOrNull(updated.id) ?? row.target_id }); continue;
    }
    const { data: created, error: createErr } = await supabase.from("resident_assessment_forms").insert(payload).select("id").single();
    if (createErr) { await markLedgerRowFailureForTable(supabase, row, ASSESSMENT_TARGET_TABLE, `Row ${row.row_number}: ${createErr.message}`); continue; }
    await markLedgerRowStatus(supabase, row, { status: "applied", targetTable: ASSESSMENT_TARGET_TABLE, targetId: asStringOrNull(created?.id) });
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
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const payload = await req.json().catch(() => ({}));
    const requested = Number((payload as { limit?: number }).limit ?? 3);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 10) : 3;
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_data_import_jobs", { p_limit: limit, p_claim_seconds: 600 });
    if (claimErr) throw claimErr;
    const jobs = (claimed ?? []) as ClaimedJob[];
    const results: Array<{ jobId: string; domain: string; ok: boolean; releasedTo?: string; appliedRows?: number; skippedRows?: number; errorRows?: number; remainingValidRows?: number; error: string | null }> = [];
    const DURABLE = new Set(["employees", "rooms", "credentials", "residents", "resident_contacts", "training_records", "assessments"]);
    for (const job of jobs) {
      if (!DURABLE.has(job.domain)) {
        const pendingMessage = PENDING_DURABLE_DOMAINS.has(job.domain)
          ? "Durable apply pending for this domain (incidents requires auth.uid() via create_incident_atomic); claim released to ready."
          : null;
        const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", { p_job_id: job.id, p_status: "ready", p_last_error: null });
        results.push({ jobId: job.id, domain: job.domain, ok: !releaseErr, releasedTo: "ready", error: releaseErr?.message ?? pendingMessage });
        continue;
      }
      try {
        let workerResult;
        if (job.domain === "employees") workerResult = await processEmployeeJob(supabase, job);
        else if (job.domain === "rooms") workerResult = await processRoomJob(supabase, job);
        else if (job.domain === "credentials") workerResult = await processCredentialJob(supabase, job);
        else if (job.domain === "residents") workerResult = await processResidentJob(supabase, job);
        else if (job.domain === "resident_contacts") workerResult = await processResidentContactsJob(supabase, job);
        else if (job.domain === "training_records") workerResult = await processTrainingRecordsJob(supabase, job);
        else workerResult = await processAssessmentsJob(supabase, job);
        results.push({ jobId: job.id, domain: job.domain, ok: true, releasedTo: workerResult.releasedTo, appliedRows: workerResult.appliedRows, skippedRows: workerResult.skippedRows, errorRows: workerResult.errorRows, remainingValidRows: workerResult.remainingValidRows, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase.rpc("release_data_import_job_claim", { p_job_id: job.id, p_status: "failed", p_last_error: message.slice(0, 2000) });
        results.push({ jobId: job.id, domain: job.domain, ok: false, releasedTo: "failed", error: message });
      }
    }
    return response({ success: true, claimed: jobs.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return response({ success: false, error: message }, 500);
  }
});
