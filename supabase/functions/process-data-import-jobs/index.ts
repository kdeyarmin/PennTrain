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
  const { error } = await supabase
    .from("data_import_rows")
    .update({
      status: "failed",
      target_table: "employees",
      errors: [errorMessage],
      applied_at: null,
    })
    .eq("id", row.id);
  if (error) throw error;
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
      if (job.domain !== "employees") {
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
          error: releaseErr?.message ?? null,
        });
        continue;
      }

      try {
        const employeeResult = await processEmployeeJob(supabase, job);
        results.push({
          jobId: job.id,
          domain: job.domain,
          ok: true,
          releasedTo: employeeResult.releasedTo,
          appliedRows: employeeResult.appliedRows,
          skippedRows: employeeResult.skippedRows,
          errorRows: employeeResult.errorRows,
          remainingValidRows: employeeResult.remainingValidRows,
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
