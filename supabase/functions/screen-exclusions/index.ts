// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parse } from "jsr:@std/csv@1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

// Internal cron-only endpoint: invoked monthly by pg_cron. Deliberately verify_jwt:false because
// pg_net has no user JWT; authenticity is enforced here with CRON_SHARED_SECRET. Each request may
// also carry x-correlation-id (or correlationId in JSON) so an infrastructure retry resumes the
// same append-only snapshots rather than creating duplicate refresh attempts.

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const LEIE_CSV_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";
const INSERT_BATCH_SIZE = 1000;
const SAM_GOV_BASE_URL = "https://api.sam.gov/entity-information/v4/exclusions";
const NOT_CONFIGURED_SAM =
  "SAM_GOV_API_KEY is not set -- SAM.gov exclusion screening is skipped for this deployment (OIG LEIE screening still runs).";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExclusionSource = "oig_leie" | "sam_exclusions";

interface ExclusionListEntryRow {
  source: ExclusionSource;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  business_name: string | null;
  dob: string | null;
  exclusion_type: string | null;
  exclusion_date: string | null;
  reinstate_date: string | null;
  waiver_date: string | null;
  npi: string | null;
  upin: string | null;
  raw: Record<string, unknown>;
}

interface RefreshHandle {
  runId: string;
  snapshotId: string;
  status: "staging" | "succeeded" | "superseded";
  replayed: boolean;
  recordCount?: number;
  checksum?: string;
  activatedSnapshotId: string | null;
}

interface RefreshResult extends RefreshHandle {
  recordCount?: number;
  checksum?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jobResult(correlationId: string, sources: Record<string, unknown>) {
  const sourceCounts = Object.fromEntries(
    Object.entries(sources).map(([source, outcome]) => {
      const count =
        outcome && typeof outcome === "object" && "recordCount" in outcome
          ? (outcome as { recordCount?: unknown }).recordCount
          : null;
      return [source, typeof count === "number" ? count : null];
    }),
  );
  return { correlationId, sources, sourceCounts, expectedSources: 2 };
}

function canonicalEntryIdentity(entry: ExclusionListEntryRow): string {
  return [
    entry.source,
    entry.last_name,
    entry.first_name,
    entry.middle_name,
    entry.business_name,
    entry.dob,
    entry.exclusion_type,
    entry.exclusion_date,
    entry.reinstate_date,
    entry.waiver_date,
    entry.npi,
    entry.upin,
  ].map((value) => String(value ?? "").trim()).join("\u001f");
}

function deduplicateEntries(
  entries: ExclusionListEntryRow[],
): ExclusionListEntryRow[] {
  const byIdentity = new Map<string, ExclusionListEntryRow>();
  for (const entry of entries) {
    byIdentity.set(canonicalEntryIdentity(entry), entry);
  }
  return Array.from(byIdentity.values());
}

// LEIE date fields are YYYYMMDD, zero-filled ("00000000") when not applicable.
function parseLeieDate(value: string | undefined): string | null {
  if (!value || value === "00000000" || value.length !== 8) return null;
  const y = value.slice(0, 4);
  const m = value.slice(4, 6);
  const d = value.slice(6, 8);
  return `${y}-${m}-${d}`;
}

async function loadOigLeie(): Promise<ExclusionListEntryRow[]> {
  const resp = await fetch(LEIE_CSV_URL, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    throw new Error(`Failed to download LEIE CSV: HTTP ${resp.status}`);
  }
  const text = await resp.text();
  const rows = parse(text, {
    skipFirstRow: true,
    columns: [
      "LASTNAME",
      "FIRSTNAME",
      "MIDNAME",
      "BUSNAME",
      "GENERAL",
      "SPECIALTY",
      "UPIN",
      "NPI",
      "DOB",
      "ADDRESS",
      "CITY",
      "STATE",
      "ZIP",
      "EXCLTYPE",
      "EXCLDATE",
      "REINDATE",
      "WAIVERDATE",
      "WVRSTATE",
    ],
  }) as Record<string, string>[];

  // Business-only exclusions (blank LASTNAME) cannot match an individual employee's name.
  return deduplicateEntries(
    rows
      .filter((row) => row.LASTNAME?.trim())
      .map((row) => ({
        source: "oig_leie" as const,
        last_name: row.LASTNAME.trim(),
        first_name: row.FIRSTNAME?.trim() || null,
        middle_name: row.MIDNAME?.trim() || null,
        business_name: row.BUSNAME?.trim() || null,
        dob: parseLeieDate(row.DOB),
        exclusion_type: row.EXCLTYPE?.trim() || null,
        exclusion_date: parseLeieDate(row.EXCLDATE),
        reinstate_date: parseLeieDate(row.REINDATE),
        waiver_date: parseLeieDate(row.WAIVERDATE),
        npi: row.NPI?.trim() || null,
        upin: row.UPIN?.trim() || null,
        raw: row,
      })),
  );
}

interface SamExclusionRecord {
  classification?: string;
  exclusionType?: { term?: string };
  activeDate?: string;
  terminationDate?: string;
  samNumber?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}

async function loadSamGovForEmployee(
  apiKey: string,
  firstName: string,
  lastName: string,
): Promise<ExclusionListEntryRow[]> {
  const url = `${SAM_GOV_BASE_URL}?api_key=${
    encodeURIComponent(apiKey)
  }&firstName=${encodeURIComponent(firstName)}&lastName=${
    encodeURIComponent(lastName)
  }`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    // Silently treating throttling/server errors as "no matches" would activate a partial source.
    throw new Error(`SAM.gov exclusion query failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json().catch(() => null)) as {
    excludedEntity?: SamExclusionRecord[];
  } | null;
  if (
    !data ||
    (data.excludedEntity !== undefined && !Array.isArray(data.excludedEntity))
  ) {
    throw new Error("SAM.gov exclusion query returned an invalid response");
  }

  return deduplicateEntries((data.excludedEntity ?? []).map((record) => ({
    source: "sam_exclusions" as const,
    last_name: record.lastName?.trim() || lastName,
    first_name: record.firstName?.trim() || firstName,
    middle_name: null,
    business_name: null,
    dob: null,
    exclusion_type: record.exclusionType?.term ?? record.classification ?? null,
    exclusion_date: record.activeDate ?? null,
    reinstate_date: record.terminationDate ?? null,
    waiver_date: null,
    npi: null,
    upin: record.samNumber ?? null,
    raw: record as Record<string, unknown>,
  })));
}

async function loadSamGov(
  adminClient: ReturnType<typeof createClient>,
  apiKey: string,
): Promise<ExclusionListEntryRow[]> {
  // Page the roster: PostgREST caps unpaged selects at 1000 rows, so a single
  // .select() would silently stop screening staff hired after the platform's
  // first ~1000 active employees while the refresh still reported success.
  const pageSize = 1000;
  const employees: Array<{ first_name: string; last_name: string }> = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .from("employees")
      .select("first_name, last_name")
      .eq("status", "active")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(
        `Failed to load roster for SAM.gov screening: ${error.message}`,
      );
    }
    employees.push(...((data ?? []) as Array<{ first_name: string; last_name: string }>));
    if (!data || data.length < pageSize) break;
  }

  // Screen each distinct name pair once -- staff sharing a name would otherwise
  // trigger duplicate SAM.gov queries for identical results.
  const seenNames = new Set<string>();
  const entries: ExclusionListEntryRow[] = [];
  for (const employee of employees) {
    const nameKey = `${employee.first_name}\u0000${employee.last_name}`.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    entries.push(
      ...(await loadSamGovForEmployee(
        apiKey,
        employee.first_name,
        employee.last_name,
      )),
    );
  }
  return deduplicateEntries(entries);
}

async function beginRefresh(
  adminClient: ReturnType<typeof createClient>,
  correlationId: string,
  source: ExclusionSource,
): Promise<RefreshHandle> {
  const { data, error } = await adminClient.rpc(
    "begin_exclusion_source_refresh",
    {
      p_correlation_id: correlationId,
      p_source: source,
    },
  );
  if (error) {
    throw new Error(`Failed to begin ${source} refresh: ${error.message}`);
  }
  return data as RefreshHandle;
}

async function stageEntries(
  adminClient: ReturnType<typeof createClient>,
  snapshotId: string,
  entries: ExclusionListEntryRow[],
): Promise<void> {
  for (let offset = 0; offset < entries.length; offset += INSERT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + INSERT_BATCH_SIZE).map((
      entry,
    ) => ({
      ...entry,
      snapshot_id: snapshotId,
    }));
    const { error } = await adminClient.from("exclusion_list_entries").upsert(
      batch,
      {
        onConflict: "snapshot_id,source_record_key",
        ignoreDuplicates: true,
      },
    );
    if (error) {
      throw new Error(
        `Failed to stage exclusion batch at offset ${offset}: ${error.message}`,
      );
    }
  }
}

async function completeRefresh(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  expectedRecordCount: number,
): Promise<RefreshResult> {
  const { data, error } = await adminClient.rpc(
    "complete_exclusion_source_refresh",
    {
      p_run_id: runId,
      p_expected_record_count: expectedRecordCount,
    },
  );
  if (error) {
    throw new Error(
      `Failed to validate and activate exclusion snapshot: ${error.message}`,
    );
  }
  return data as RefreshResult;
}

async function recordFailure(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  message: string,
): Promise<void> {
  const { error } = await adminClient.rpc("fail_exclusion_source_refresh", {
    p_run_id: runId,
    p_error: message,
  });
  if (error) {
    console.error(
      `Could not record exclusion refresh failure for ${runId}:`,
      error.message,
    );
  }
}

async function beginSystemJob(
  adminClient: ReturnType<typeof createClient>,
  correlationId: string,
  providerRequestId: string | null,
): Promise<{ runId: string; shouldExecute: boolean }> {
  const { data, error } = await adminClient.rpc("claim_system_job_execution", {
    p_job_key: "exclusion-screening",
    p_correlation_id: correlationId,
    p_trigger_type: "scheduled",
    p_provider_request_id: providerRequestId,
  });
  if (error) {
    throw new Error(
      `Failed to begin exclusion-screening system job: ${error.message}`,
    );
  }
  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim?.run_id) {
    throw new Error("Exclusion-screening job claim returned no run");
  }
  return {
    runId: claim.run_id as string,
    shouldExecute: Boolean(claim.should_execute),
  };
}

async function cancellationRequested(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
): Promise<boolean> {
  const { data, error } = await adminClient.rpc(
    "is_system_job_cancellation_requested",
    {
      p_run_id: runId,
    },
  );
  if (error) {
    throw new Error(
      `Could not check exclusion job cancellation: ${error.message}`,
    );
  }
  return Boolean(data);
}

async function heartbeatSystemJob(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  attemptedCount: number,
  succeededCount: number,
  cursor: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminClient.rpc("heartbeat_system_job", {
    p_run_id: runId,
    p_attempted_count: attemptedCount,
    p_succeeded_count: succeededCount,
    p_failed_count: 0,
    p_cursor: cursor,
  });
  // A replay of an already-terminal job legitimately has nothing to heartbeat. Source-level
  // begin/complete calls still make the actual refresh replay safe, so do not turn that into a
  // false source failure.
  if (error) {
    console.warn(
      `Could not heartbeat exclusion-screening job ${runId}:`,
      error.message,
    );
  }
}

async function finishSystemJob(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  status: "succeeded" | "partial" | "failed" | "cancelled",
  attemptedCount: number,
  succeededCount: number,
  failedCount: number,
  result: Record<string, unknown>,
  error: string | null,
): Promise<void> {
  const { error: finishError } = await adminClient.rpc("finish_system_job", {
    p_run_id: runId,
    p_status: status,
    p_attempted_count: attemptedCount,
    p_succeeded_count: succeededCount,
    p_failed_count: failedCount,
    p_result: result,
    p_error_code: error ? "exclusion_refresh_failed" : null,
    p_error_message: error,
  });
  if (finishError) {
    throw new Error(
      `Failed to finish exclusion-screening system job: ${finishError.message}`,
    );
  }
}

async function refreshSource(
  adminClient: ReturnType<typeof createClient>,
  correlationId: string,
  source: ExclusionSource,
  loadEntries: () => Promise<ExclusionListEntryRow[]>,
): Promise<RefreshResult> {
  const handle = await beginRefresh(adminClient, correlationId, source);
  if (handle.status === "succeeded" || handle.status === "superseded") {
    return handle;
  }

  try {
    const entries = await loadEntries();
    await stageEntries(adminClient, handle.snapshotId, entries);
    return await completeRefresh(adminClient, handle.runId, entries.length);
  } catch (error) {
    const message = errorMessage(error);
    await recordFailure(adminClient, handle.runId, message);
    throw error;
  }
}

async function readCorrelationId(req: Request): Promise<string> {
  let bodyCorrelationId: unknown;
  try {
    const body = (await req.json()) as { correlationId?: unknown };
    bodyCorrelationId = body?.correlationId;
  } catch {
    // An empty body is valid for the cron endpoint.
  }

  const supplied = req.headers.get("x-correlation-id") ?? bodyCorrelationId;
  if (
    supplied !== undefined &&
    (typeof supplied !== "string" || !UUID_PATTERN.test(supplied))
  ) {
    throw new Error("correlationId must be a valid UUID");
  }
  return supplied || crypto.randomUUID();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  const cronAuthError = requireCronRequest(req, CORS_HEADERS);
  if (cronAuthError) return cronAuthError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  let correlationId: string;
  try {
    correlationId = await readCorrelationId(req);
  } catch (error) {
    return json({ success: false, error: errorMessage(error) }, 400);
  }

  let systemJobRunId: string;
  try {
    const jobClaim = await beginSystemJob(
      adminClient,
      correlationId,
      req.headers.get("x-request-id"),
    );
    systemJobRunId = jobClaim.runId;
    if (!jobClaim.shouldExecute) {
      return json({
        success: true,
        replayed: true,
        correlationId,
        runId: systemJobRunId,
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    console.error(
      `screen-exclusions job-control begin failed [${correlationId}]:`,
      message,
    );
    return json({ success: false, correlationId, error: message }, 500);
  }

  const sources: Record<string, unknown> = {};
  let currentSource: ExclusionSource = "oig_leie";
  let attemptedSources = 0;
  let succeededSources = 0;

  try {
    if (await cancellationRequested(adminClient, systemJobRunId)) {
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "cancelled",
        0,
        0,
        0,
        jobResult(correlationId, sources),
        null,
      );
      return json({ success: true, cancelled: true, correlationId, sources });
    }
    attemptedSources = 1;
    await heartbeatSystemJob(adminClient, systemJobRunId, 1, 0, {
      phase: "refreshing",
      source: currentSource,
      correlationId,
    });
    const oigLeie = await refreshSource(
      adminClient,
      correlationId,
      currentSource,
      loadOigLeie,
    );
    sources.oig_leie = oigLeie;
    succeededSources = 1;

    if (await cancellationRequested(adminClient, systemJobRunId)) {
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "cancelled",
        attemptedSources,
        succeededSources,
        0,
        jobResult(correlationId, sources),
        null,
      );
      return json({ success: true, cancelled: true, correlationId, sources });
    }

    const samApiKey = Deno.env.get("SAM_GOV_API_KEY");
    if (!samApiKey) {
      console.log(NOT_CONFIGURED_SAM);
      sources.sam_exclusions = { skipped: true, reason: NOT_CONFIGURED_SAM };
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "partial",
        attemptedSources,
        succeededSources,
        0,
        jobResult(correlationId, sources),
        null,
      );
      return json({ success: true, partial: true, correlationId, sources });
    }

    currentSource = "sam_exclusions";
    attemptedSources = 2;
    await heartbeatSystemJob(adminClient, systemJobRunId, 2, 1, {
      phase: "refreshing",
      source: currentSource,
      correlationId,
    });
    const samGov = await refreshSource(
      adminClient,
      correlationId,
      currentSource,
      () => loadSamGov(adminClient, samApiKey),
    );
    sources.sam_exclusions = samGov;
    succeededSources = 2;
  } catch (error) {
    const message = errorMessage(error);
    sources[currentSource] = { status: "failed", error: message };
    const status = succeededSources > 0 ? "partial" : "failed";
    let jobControlError: string | null = null;
    try {
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        status,
        attemptedSources,
        succeededSources,
        1,
        jobResult(correlationId, sources),
        message,
      );
    } catch (finishError) {
      jobControlError = errorMessage(finishError);
      console.error(
        `screen-exclusions job-control finish failed [${correlationId}]:`,
        jobControlError,
      );
    }
    console.error(`screen-exclusions failed [${correlationId}]:`, message);
    return json({
      success: false,
      correlationId,
      sources,
      error: message,
      ...(jobControlError ? { jobControlError } : {}),
    }, 500);
  }

  try {
    await finishSystemJob(
      adminClient,
      systemJobRunId,
      "succeeded",
      attemptedSources,
      succeededSources,
      0,
      jobResult(correlationId, sources),
      null,
    );
  } catch (error) {
    const message = errorMessage(error);
    console.error(
      `screen-exclusions job-control finish failed [${correlationId}]:`,
      message,
    );
    return json(
      { success: false, correlationId, sources, error: message },
      500,
    );
  }

  return json({ success: true, correlationId, sources });
});
