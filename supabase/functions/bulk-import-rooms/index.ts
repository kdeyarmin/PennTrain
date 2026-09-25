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

const REQUIRED_COLUMNS = ["facility", "room_number"];
const DOMAIN = "rooms";
const TARGET = "facility_rooms";

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
    return json(req, { error: "not authorized to import rooms" }, 403);
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
      p_domain: DOMAIN, p_file_name: (body.file_name ?? "rooms.csv").slice(0, 255),
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

  // An omitted limit is capped to the ledger RPC's 200-row chunk contract rather than the whole
  // file -- see bulk-import-employees for the failure this prevents. Callers page via nextOffset.
  const endIndex = Math.min(offset + (limit ?? 200), rows.length);
  if (offset >= rows.length) {
    return json(req, { success: true, mode, job_id: jobId, total: 0, succeeded: 0, failed: 0, results: [], totalRows: rows.length, offset, nextOffset: null });
  }

  const results: ImportRowResult[] = [];
  const ledgerRows: any[] = [];
  // A failed receipt load is not an empty ledger. Reading only `data` left ledgerMap empty, and
  // the loop below skips rows by that map -- so a resume after a transient failure re-walked every
  // row it had already applied. This importer receipts only at chunk end, so that map is the whole
  // of its resume safety. bulk-import-credentials, -employees and -training-records refuse here.
  const { data: existingLedgers, error: ledgerLoadError } = await callerClient.from("data_import_rows")
    .select("row_number, status, target_id, proposed_action").eq("job_id", jobId)
    .gte("row_number", offset + 2).lte("row_number", endIndex + 1);
  if (ledgerLoadError) return json(req, { error: `Failed to load existing import receipts: ${ledgerLoadError.message}`, job_id: jobId }, 500);
  const ledgerMap = new Map((existingLedgers ?? []).map((r: any) => [r.row_number, r]));

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

  // The header set: an update writes only the columns this CSV actually carries (the rule
  // bulk-import-employees already follows).
  const presentColumns = new Set(Object.keys(rows[0] ?? {}));

  for (let index = offset; index < endIndex; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const existingLedger = ledgerMap.get(rowNumber);
    if (existingLedger && ["applied", "skipped", "reverted"].includes(existingLedger.status)) {
      results.push({ row: rowNumber, success: existingLedger.status !== "reverted", record_id: existingLedger.target_id ?? undefined, action: existingLedger.proposed_action, preview: mode === "validate" });
      continue;
    }
    const facilityName = row.facility?.trim();
    const roomNumber = row.room_number?.trim();
    const unit = row.unit?.trim() || "";
    const capacityRaw = row.capacity?.trim();
    const capacity = capacityRaw ? Math.max(1, Math.min(8, parseInt(capacityRaw, 10) || 1)) : 1;
    const statusRaw = (row.status?.trim() || "active").toLowerCase();
    const rowErrors: string[] = [];
    const warnings: string[] = [];
    if (!facilityName) rowErrors.push("facility is required");
    if (!roomNumber) rowErrors.push("room_number is required");
    const facilityId = facilityName ? facilityByName.get(facilityName.toLowerCase()) : undefined;
    if (facilityName && !facilityId) rowErrors.push(`Unknown facility: ${facilityName}`);

    let existingRoom: any = null;
    if (!rowErrors.length && facilityId) {
      // A failed duplicate check reads as "no match", and the row then applies as a create -- a
      // second facility_rooms row for a room number that already exists. Stop the run instead:
      // abortRun receipts what this chunk has already done before refusing, so re-posting this
      // job_id resumes rather than repeats.
      const { data, error: existingRoomError } = await callerClient.from("facility_rooms").select("id, room_number, room_type, is_active, residential_unit_id, building_id")
        .eq("facility_id", facilityId).eq("room_number", roomNumber!).limit(1).maybeSingle();
      if (existingRoomError) return await abortRun(`Row ${rowNumber}: existing room lookup failed: ${existingRoomError.message}`);
      existingRoom = data;
    }
    let action: "create" | "update" | "skip" = "create";
    if (existingRoom) {
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "skip" ? "skip" : "create";
      if (duplicateStrategy === "create") rowErrors.push("Room already exists; choose skip or update.");
      else if (duplicateStrategy === "skip") warnings.push("Existing room matched and will be skipped.");
      else warnings.push("Existing room will be upserted via create_room_with_beds.");
    }
    // create_room_with_beds is an upsert that overwrites room_type and the unit and then
    // reconciles the bed count, so the defaults for absent columns (1 bed, private, unit "Main",
    // active) collapsed a two-bed "East Wing" room to one private bed in a new "Main" unit and
    // deleted its spare bed -- which the ledger snapshot cannot restore. For an update, absent
    // columns carry the stored inventory instead; the ledger records those effective values so
    // the durable worker replays the same room.
    let bedCount = capacity;
    let roomType = capacity === 1 ? "private" : capacity === 2 ? "semi_private" : "shared";
    let unitName = unit || "Main";
    let buildingName = "Main";
    let isActive = statusRaw !== "inactive";
    if (action === "update" && existingRoom) {
      if (!presentColumns.has("capacity")) {
        const { count: bedTotal, error: bedCountError } = await callerClient.from("facility_beds")
          .select("id", { count: "exact", head: true }).eq("room_id", existingRoom.id);
        if (bedCountError) return await abortRun(`Row ${rowNumber}: existing bed lookup failed: ${bedCountError.message}`);
        bedCount = Math.max(1, Math.min(8, bedTotal ?? 1));
        roomType = existingRoom.room_type ?? roomType;
      }
      if (!presentColumns.has("unit")) {
        if (existingRoom.residential_unit_id) {
          const { data: existingUnit, error: unitError } = await callerClient.from("residential_units")
            .select("name").eq("id", existingRoom.residential_unit_id).maybeSingle();
          if (unitError) return await abortRun(`Row ${rowNumber}: existing unit lookup failed: ${unitError.message}`);
          unitName = existingUnit?.name ?? "";
        } else {
          // A blank unit name keeps residential_unit_id null: the RPC creates a unit only for a
          // non-blank name.
          unitName = "";
        }
      }
      if (existingRoom.building_id) {
        // The unit upsert keys on (building_id, name), so the existing building keeps an
        // existing unit from being re-created under a "Main" building.
        const { data: existingBuilding, error: buildingError } = await callerClient.from("facility_buildings")
          .select("name").eq("id", existingRoom.building_id).maybeSingle();
        if (buildingError) return await abortRun(`Row ${rowNumber}: existing building lookup failed: ${buildingError.message}`);
        buildingName = existingBuilding?.name || "Main";
      }
      if (!presentColumns.has("status")) isActive = existingRoom.is_active ?? isActive;
    }
    const payload = {
      facility_id: facilityId, room_number: roomNumber, unit_name: unitName,
      bed_count: bedCount, room_type: roomType, building_name: buildingName, is_active: isActive,
    };
    if (rowErrors.length) {
      results.push({ row: rowNumber, success: false, error: rowErrors.join("; "), action, preview: mode === "validate" });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "invalid", targetTable: TARGET, targetId: existingRoom?.id ?? null, beforeSnapshot: existingRoom, errors: rowErrors, warnings });
      continue;
    }
    if (action === "skip") {
      results.push({ row: rowNumber, success: true, record_id: existingRoom.id, action, preview: mode === "validate" });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "skipped", targetTable: TARGET, targetId: existingRoom.id, beforeSnapshot: existingRoom, errors: [], warnings });
      continue;
    }
    if (mode === "validate") {
      results.push({ row: rowNumber, success: true, record_id: existingRoom?.id, action, preview: true });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "valid", targetTable: TARGET, targetId: existingRoom?.id ?? null, beforeSnapshot: existingRoom, errors: [], warnings });
      continue;
    }
    const { data, error } = await callerClient.rpc("create_room_with_beds", {
      p_facility_id: facilityId,
      p_building_name: buildingName,
      p_unit_name: unitName,
      p_room_number: roomNumber,
      p_room_type: roomType,
      p_bed_count: bedCount,
      p_gender_restriction: "none",
      // The table's UPDATE grant is deliberately revoked from authenticated, so the CSV
      // status must land through the SECURITY DEFINER upsert, not a follow-up update.
      p_is_active: isActive,
    });
    if (error) {
      results.push({ row: rowNumber, success: false, error: error.message, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "failed", targetTable: TARGET, targetId: existingRoom?.id ?? null, beforeSnapshot: existingRoom, errors: [error.message], warnings });
    } else {
      results.push({ row: rowNumber, success: true, record_id: data as string, action });
      ledgerRows.push({ rowNumber, sourceRow: row, normalizedRow: payload, proposedAction: action, status: "applied", targetTable: TARGET, targetId: data, beforeSnapshot: existingRoom, errors: [], warnings });
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
