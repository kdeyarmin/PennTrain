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

// SAM.gov throttling (api.data.gov hourly quota) is a pacing signal, not a source failure:
// the resumable sweep parks at its cursor and the hourly continuation run picks it back up.
class SamThrottleError extends Error {
  constructor(status: number) {
    super(`SAM.gov exclusion query throttled: HTTP ${status}`);
    this.name = "SamThrottleError";
  }
}

// Durable resume state for the roster-wide SAM sweep, carried in the exclusion-screening
// system job's terminal result (the regulatory digest's pattern) and read back through
// get_exclusion_sam_sweep_state(). refreshCorrelationId keys begin_exclusion_source_refresh,
// which replays into the SAME staging run/snapshot for the same (correlation, source) --
// that replay branch is what makes the sweep resumable without new lifecycle SQL.
interface SamSweepResume {
  refreshCorrelationId: string;
  cursor: string | null;
  screenedNames: number;
  totalNames: number;
  // When the sweep began. The completion pass re-screens names from employees created or
  // renamed after this instant whose keys sort into the already-swept prefix -- without it,
  // a new hire whose name sorts before the cursor would be skipped by every resumed run and
  // the snapshot would activate "complete" without ever querying them.
  startedAt: string;
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

// Always attached to the terminal job result -- `resume: null` is the affirmative "nothing
// to continue" that lets get_exclusion_sam_sweep_state() clear a stale cursor, exactly how
// the digest sender's digestState works.
function withSamSweepState(
  result: Record<string, unknown>,
  resume: SamSweepResume | null,
) {
  return { ...result, samSweepState: { resume } };
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
  // Page until totalRecords is reached: SAM.gov paginates (small default page), and reading
  // only the first page silently dropped later records -- for a common name, the actual
  // excluded individual could sit on page 2 and screen clear while listed. The page cap is a
  // runaway guard; hitting it fails the refresh loudly rather than activating a partial list.
  const pageSize = 100;
  const maxPages = 25;
  const records: SamExclusionRecord[] = [];
  let totalRecords: number | null = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error(`SAM.gov exclusion query exceeded ${maxPages} pages for one name`);
    }
    // The key travels in the X-Api-Key header, never the URL: a transport-level failure
    // embeds the full URL in the error message, and that message is persisted into
    // exclusion_refresh_runs.error / exclusion_source_state.last_error -- columns every
    // tenant's admins can read. api.data.gov-fronted SAM.gov accepts the header form.
    const url = `${SAM_GOV_BASE_URL}?firstName=${encodeURIComponent(firstName)}&lastName=${
      encodeURIComponent(lastName)
    }&page=${page}&size=${pageSize}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      // Deno network errors quote the full request URL (query names included); rethrow
      // without it so nothing employee-identifying or secret-adjacent lands in the shared
      // error columns.
      const name = error instanceof Error ? error.name : "Error";
      throw new Error(`SAM.gov exclusion query failed: network error (${name})`);
    }
    if (resp.status === 429) {
      throw new SamThrottleError(resp.status);
    }
    if (!resp.ok) {
      // Silently treating server errors as "no matches" would activate a partial source.
      throw new Error(`SAM.gov exclusion query failed: HTTP ${resp.status}`);
    }
    const data = (await resp.json().catch(() => null)) as {
      totalRecords?: number;
      excludedEntity?: SamExclusionRecord[];
    } | null;
    if (
      !data ||
      (data.excludedEntity !== undefined && !Array.isArray(data.excludedEntity))
    ) {
      throw new Error("SAM.gov exclusion query returned an invalid response");
    }
    const pageRecords = data.excludedEntity ?? [];
    records.push(...pageRecords);
    if (typeof data.totalRecords === "number" && Number.isFinite(data.totalRecords)) {
      totalRecords = data.totalRecords;
    }
    // Stop on an empty page (nothing more to read) or once the reported total is in hand.
    if (pageRecords.length === 0) break;
    if (totalRecords !== null && records.length >= totalRecords) break;
  }

  return deduplicateEntries(records.map((record) => ({
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

async function loadSamRosterNameKeys(
  adminClient: ReturnType<typeof createClient>,
): Promise<Array<{ first: string; last: string; key: string }>> {
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

  // Distinct names, sorted: the sort is what makes the resume cursor meaningful across
  // invocations -- every run walks the same order and continues strictly after the last
  // name the previous run finished staging.
  const byKey = new Map<string, { first: string; last: string; key: string }>();
  for (const employee of employees) {
    const key = `${employee.first_name}\u0000${employee.last_name}`.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { first: employee.first_name, last: employee.last_name, key });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

interface SamSweepOutcome {
  completed: boolean;
  cursor: string | null;
  screenedNames: number;
  totalNames: number;
  throttled: boolean;
}

async function sweepSamGov(
  adminClient: ReturnType<typeof createClient>,
  apiKey: string,
  snapshotId: string,
  resumeCursor: string | null,
  sweepStartedAt: string,
  deadlineAt: number,
): Promise<SamSweepOutcome> {
  const names = await loadSamRosterNameKeys(adminClient);
  let screened = 0;
  let cursor = resumeCursor;
  let throttled = false;

  for (const name of names) {
    if (cursor !== null && name.key <= cursor) {
      screened += 1;
      continue;
    }
    // The deadline turns "the isolate dies at the platform wall clock mid-sweep, silently"
    // into "the run finishes as partial at a durable cursor" -- the hourly continuation run
    // (and the monthly full run) picks up strictly after the last completed name.
    if (Date.now() >= deadlineAt) {
      return { completed: false, cursor, screenedNames: screened, totalNames: names.length, throttled };
    }
    let entries: ExclusionListEntryRow[];
    try {
      entries = await loadSamGovForEmployee(apiKey, name.first, name.last);
    } catch (error) {
      if (error instanceof SamThrottleError) {
        // Quota pacing, not failure: park at the cursor and let the next tick continue.
        throttled = true;
        return { completed: false, cursor, screenedNames: screened, totalNames: names.length, throttled };
      }
      throw error;
    }
    // Stage per name, before the cursor advances past it: the (snapshot_id,
    // source_record_key) upsert makes a replayed name idempotent, so a crash between the
    // stage and the next heartbeat re-stages harmlessly.
    if (entries.length > 0) {
      await stageEntries(adminClient, snapshotId, deduplicateEntries(entries));
    }
    cursor = name.key;
    screened += 1;
  }

  // Completion catch-up: the roster is reloaded per invocation, so an employee hired or
  // renamed while the sweep was parked -- whose key sorts INTO the already-swept prefix --
  // was skipped by the cursor on every resumed pass. Screen exactly those late arrivals
  // before the snapshot may activate as complete. Idempotent across partial catch-ups: the
  // updated_at filter re-selects them until this pass finishes inside one budget.
  const { data: lateRows, error: lateErr } = await adminClient
    .from("employees")
    .select("first_name, last_name")
    .eq("status", "active")
    .gte("updated_at", sweepStartedAt);
  if (lateErr) {
    throw new Error(`Failed to load late roster changes for SAM.gov screening: ${lateErr.message}`);
  }
  const lateNames = new Map<string, { first: string; last: string; key: string }>();
  for (const row of (lateRows ?? []) as Array<{ first_name: string; last_name: string }>) {
    const key = `${row.first_name}\u0000${row.last_name}`.toLowerCase();
    if (cursor !== null && key <= cursor && !lateNames.has(key)) {
      lateNames.set(key, { first: row.first_name, last: row.last_name, key });
    }
  }
  for (const name of lateNames.values()) {
    if (Date.now() >= deadlineAt) {
      return { completed: false, cursor, screenedNames: screened, totalNames: names.length, throttled };
    }
    let entries: ExclusionListEntryRow[];
    try {
      entries = await loadSamGovForEmployee(apiKey, name.first, name.last);
    } catch (error) {
      if (error instanceof SamThrottleError) {
        throttled = true;
        return { completed: false, cursor, screenedNames: screened, totalNames: names.length, throttled };
      }
      throw error;
    }
    if (entries.length > 0) {
      await stageEntries(adminClient, snapshotId, deduplicateEntries(entries));
    }
  }

  return { completed: true, cursor, screenedNames: screened, totalNames: names.length, throttled };
}

async function countStagedEntries(
  adminClient: ReturnType<typeof createClient>,
  snapshotId: string,
): Promise<number> {
  // The DB is the authority on the staged count: in-memory totals cannot survive resume
  // boundaries, and cross-name duplicates collapse in the upsert -- so the completion
  // handshake counts what actually landed.
  const { count, error } = await adminClient
    .from("exclusion_list_entries")
    .select("id", { count: "exact", head: true })
    .eq("snapshot_id", snapshotId);
  if (error) {
    throw new Error(`Failed to count staged SAM entries: ${error.message}`);
  }
  return count ?? 0;
}

async function getSamSweepResume(
  adminClient: ReturnType<typeof createClient>,
): Promise<SamSweepResume | null> {
  const { data, error } = await adminClient.rpc("get_exclusion_sam_sweep_state");
  if (error) {
    // Fail toward a fresh sweep, never a crash: a fresh sweep is always safe, it is just
    // slower than a resumed one.
    console.warn("Could not read SAM sweep state:", error.message);
    return null;
  }
  const record = (data ?? null) as { resume?: unknown } | null;
  const candidate = record?.resume as SamSweepResume | null | undefined;
  if (
    candidate && typeof candidate === "object" &&
    typeof candidate.refreshCorrelationId === "string" &&
    UUID_PATTERN.test(candidate.refreshCorrelationId) &&
    (candidate.cursor === null || typeof candidate.cursor === "string") &&
    typeof candidate.startedAt === "string" &&
    Number.isFinite(Date.parse(candidate.startedAt))
  ) {
    return {
      refreshCorrelationId: candidate.refreshCorrelationId,
      cursor: candidate.cursor,
      screenedNames: Number(candidate.screenedNames) || 0,
      totalNames: Number(candidate.totalNames) || 0,
      startedAt: candidate.startedAt,
    };
  }
  return null;
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
  jobKey: "exclusion-screening" | "sam-sweep-continuation",
): Promise<{ runId: string; shouldExecute: boolean }> {
  const { data, error } = await adminClient.rpc("claim_system_job_execution", {
    p_job_key: jobKey,
    p_correlation_id: correlationId,
    p_trigger_type: "scheduled",
    p_provider_request_id: providerRequestId,
  });
  if (error) {
    throw new Error(
      `Failed to begin ${jobKey} system job: ${error.message}`,
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

interface SamRefreshOutcome {
  result: Record<string, unknown>;
  resume: SamSweepResume | null;
  partial: boolean;
}

async function refreshSamResumable(
  adminClient: ReturnType<typeof createClient>,
  apiKey: string,
  priorResume: SamSweepResume | null,
  deadlineAt: number,
): Promise<SamRefreshOutcome> {
  // Reusing the stored correlation id is the whole resume mechanism:
  // begin_exclusion_source_refresh replays the same (correlation, source) into the same
  // staging run and snapshot, and resets a failed run back to staging. A fresh sweep mints
  // a fresh id and therefore a fresh snapshot.
  const refreshCorrelationId = priorResume?.refreshCorrelationId ?? crypto.randomUUID();
  const sweepStartedAt = priorResume?.startedAt ?? new Date().toISOString();
  const handle = await beginRefresh(adminClient, refreshCorrelationId, "sam_exclusions");
  if (handle.status === "succeeded" || handle.status === "superseded") {
    // A stale cursor pointing at an already-terminal run: nothing to continue.
    return { result: handle as unknown as Record<string, unknown>, resume: null, partial: false };
  }

  try {
    const sweep = await sweepSamGov(
      adminClient,
      apiKey,
      handle.snapshotId,
      priorResume?.cursor ?? null,
      sweepStartedAt,
      deadlineAt,
    );
    if (!sweep.completed) {
      // Deadline or quota: the staging run stays open at a durable cursor. Deliberately no
      // recordFailure -- this is pacing, and failing it would reset the staged progress.
      return {
        result: {
          status: "staging",
          partial: true,
          throttled: sweep.throttled,
          screenedNames: sweep.screenedNames,
          totalNames: sweep.totalNames,
        },
        resume: {
          refreshCorrelationId,
          cursor: sweep.cursor,
          screenedNames: sweep.screenedNames,
          totalNames: sweep.totalNames,
          startedAt: sweepStartedAt,
        },
        partial: true,
      };
    }
    const stagedCount = await countStagedEntries(adminClient, handle.snapshotId);
    const completed = await completeRefresh(adminClient, handle.runId, stagedCount);
    return { result: completed as unknown as Record<string, unknown>, resume: null, partial: false };
  } catch (error) {
    // A hard failure keeps today's semantics: the refresh run is marked failed and the
    // resume clears, so a broken vendor is retried on the monthly cadence rather than
    // hammered hourly. begin's failed->staging replay branch means a later manual rerun
    // with the same correlation id could still salvage the staged snapshot.
    const message = errorMessage(error);
    await recordFailure(adminClient, handle.runId, message);
    throw error;
  }
}

interface RequestOptions {
  correlationId: string;
  resumeOnly: boolean;
  maxRuntimeMs: number;
}

async function readRequestOptions(req: Request): Promise<RequestOptions> {
  let bodyCorrelationId: unknown;
  let resumeOnly = false;
  let maxRuntimeMs = 100_000;
  try {
    const body = (await req.json()) as {
      correlationId?: unknown;
      resumeOnly?: unknown;
      maxRuntimeMs?: unknown;
    };
    bodyCorrelationId = body?.correlationId;
    resumeOnly = body?.resumeOnly === true;
    if (typeof body?.maxRuntimeMs === "number" && Number.isFinite(body.maxRuntimeMs)) {
      // Bounded under the platform wall clock so the deadline fires while this code can
      // still write a cursor.
      maxRuntimeMs = Math.min(Math.max(Math.trunc(body.maxRuntimeMs), 10_000), 140_000);
    }
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
  return { correlationId: supplied || crypto.randomUUID(), resumeOnly, maxRuntimeMs };
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

  const startedAtMs = Date.now();
  let options: RequestOptions;
  try {
    options = await readRequestOptions(req);
  } catch (error) {
    return json({ success: false, error: errorMessage(error) }, 400);
  }
  const correlationId = options.correlationId;

  // The continuation tick runs under its own watched job key (every cron entry carries a
  // definition row -- every_scheduled_job_is_watched pins it), so even an idle hour is a
  // recorded succeeded run: the watchdog sees a live hourly heartbeat, the same shape
  // billing-quantity-sync already has. Idle runs attach no samSweepState, so they never
  // clobber the latest cursor.
  const jobKey = options.resumeOnly ? "sam-sweep-continuation" as const : "exclusion-screening" as const;

  let systemJobRunId: string;
  try {
    const jobClaim = await beginSystemJob(
      adminClient,
      correlationId,
      req.headers.get("x-request-id"),
      jobKey,
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

  const priorSamResume = await getSamSweepResume(adminClient);
  if (options.resumeOnly && !priorSamResume) {
    // Nothing parked mid-roster: finish the tick as a cheap idle success. No samSweepState
    // on the result -- an idle run must not overwrite the state the reader returns.
    try {
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "succeeded",
        0,
        0,
        0,
        { correlationId, idle: true },
        null,
      );
    } catch (error) {
      console.error(
        `sam-sweep-continuation idle finish failed [${correlationId}]:`,
        errorMessage(error),
      );
    }
    return json({ success: true, idle: true, correlationId, runId: systemJobRunId });
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
        withSamSweepState(jobResult(correlationId, sources), priorSamResume),
        null,
      );
      return json({ success: true, cancelled: true, correlationId, sources });
    }
    if (options.resumeOnly) {
      // A continuation run exists to finish the SAM sweep; the monthly full run owns LEIE.
      sources.oig_leie = { skipped: true, reason: "SAM sweep continuation run" };
    } else {
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
    }

    if (await cancellationRequested(adminClient, systemJobRunId)) {
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "cancelled",
        attemptedSources,
        succeededSources,
        0,
        withSamSweepState(jobResult(correlationId, sources), priorSamResume),
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
        withSamSweepState(jobResult(correlationId, sources), null),
        null,
      );
      return json({ success: true, partial: true, correlationId, sources });
    }

    currentSource = "sam_exclusions";
    attemptedSources += 1;
    await heartbeatSystemJob(adminClient, systemJobRunId, attemptedSources, succeededSources, {
      phase: "refreshing",
      source: currentSource,
      correlationId,
      ...(priorSamResume ? { resumedFromCursor: priorSamResume.cursor } : {}),
    });
    const samOutcome = await refreshSamResumable(
      adminClient,
      samApiKey,
      priorSamResume,
      startedAtMs + options.maxRuntimeMs,
    );
    sources.sam_exclusions = samOutcome.result;
    if (samOutcome.partial) {
      // Parked at a durable cursor (deadline or quota). Finish as partial carrying the
      // resume state; the hourly continuation run -- or next month's full run -- picks the
      // sweep up strictly after the last completed name.
      await finishSystemJob(
        adminClient,
        systemJobRunId,
        "partial",
        attemptedSources,
        succeededSources,
        0,
        withSamSweepState(jobResult(correlationId, sources), samOutcome.resume),
        null,
      );
      return json({
        success: true,
        partial: true,
        samResume: true,
        correlationId,
        sources,
      });
    }
    succeededSources += 1;
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
        withSamSweepState(jobResult(correlationId, sources), null),
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
      withSamSweepState(jobResult(correlationId, sources), null),
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
