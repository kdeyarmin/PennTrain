import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import { paToday } from "../_shared/paDay.ts";

export const RUN_DATA_LIFECYCLE_HEADERS = withCronCorsHeader({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
});

type ClientFactory = (url: string, key: string) => any;
type AuthorizeRequest = (request: Request, headers: Record<string, string>) => Response | null;

interface RunDataLifecycleDependencies {
  createClient: ClientFactory;
  getEnv?: (name: string) => string | undefined;
  now?: () => Date;
  authorizeRequest?: AuthorizeRequest;
  // Injectable so the suite can assert an exact rpc call list. Production always takes the
  // default: the correlation id must be unique per invocation or claim_system_job_execution
  // treats a second run as a retry of the first.
  newCorrelationId?: () => string;
}

// The definition this worker reports against. Until 20260904090000 nothing here claimed a run at
// all, so `data-lifecycle` had an empty ledger and the watchdog fell back to pg_cron's exit
// status -- which, for a cron entry whose command is a net.http_post, records that the request
// was enqueued and nothing about whether the sweep ran. See BACKLOG G270.
const DATA_LIFECYCLE_JOB_KEY = "data-lifecycle";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: RUN_DATA_LIFECYCLE_HEADERS,
  });
}

async function sweepExpiredOrganizationExports(admin: any): Promise<Record<string, unknown>> {
  const step: Record<string, unknown> = {
    policyKey: "lifecycle.organization_export_archives",
    expired: 0,
    purged: 0,
  };
  try {
    const { data: expired, error: listError } = await admin.rpc(
      "list_expired_organization_exports",
      { p_limit: 200 },
    );
    if (listError) throw new Error(listError.message);
    const rows = (expired ?? []) as Array<{ job_id: string; storage_bucket: string; storage_path: string }>;
    step.expired = rows.length;
    if (rows.length === 0) return step;

    const byBucket = new Map<string, { jobIds: string[]; paths: string[] }>();
    for (const row of rows) {
      const group = byBucket.get(row.storage_bucket) ?? { jobIds: [], paths: [] };
      group.jobIds.push(row.job_id);
      group.paths.push(row.storage_path);
      byBucket.set(row.storage_bucket, group);
    }
    const purgeable: string[] = [];
    const removalErrors: string[] = [];
    for (const [bucket, group] of byBucket) {
      const { error: removeError } = await admin.storage.from(bucket).remove(group.paths);
      if (removeError) removalErrors.push(`${bucket}: ${removeError.message}`);
      else purgeable.push(...group.jobIds);
    }
    if (purgeable.length > 0) {
      const { data: purged, error: purgeError } = await admin.rpc(
        "purge_expired_organization_exports",
        { p_job_ids: purgeable },
      );
      if (purgeError) throw new Error(purgeError.message);
      step.purged = typeof purged === "number" ? purged : 0;
    }
    if (removalErrors.length > 0) {
      step.error = `archive removal failed: ${removalErrors.join("; ")}`;
    }
  } catch (error) {
    step.error = error instanceof Error ? error.message : String(error);
  }
  return step;
}

export function createRunDataLifecycleHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
  now = () => new Date(),
  authorizeRequest = requireCronRequest,
  newCorrelationId = () => crypto.randomUUID(),
}: RunDataLifecycleDependencies) {
  return async (request: Request): Promise<Response> => {
    const authError = authorizeRequest(request, RUN_DATA_LIFECYCLE_HEADERS);
    if (authError) return authError;

    const url = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) {
      return json({ error: "Supabase service credentials are missing" }, 500);
    }

    const admin = createClient(url, serviceRoleKey);

    // Claim before any work, so a run that dies mid-sweep leaves a claimed row the watchdog's
    // abandoned-run reconciler can close (20260904080000) rather than no trace at all.
    const { data: claimRows, error: claimError } = await admin.rpc("claim_system_job_execution", {
      p_job_key: DATA_LIFECYCLE_JOB_KEY,
      p_correlation_id: newCorrelationId(),
      p_trigger_type: "scheduled",
      p_provider_request_id: null,
    });
    if (claimError) {
      return json({ error: claimError.message }, 500);
    }
    const claimedRun = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claimedRun?.should_execute) {
      return json({ skipped: true, status: claimedRun?.existing_status ?? "skipped" }, 200);
    }
    const runId = claimedRun.run_id;

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    try {
      return await runLifecycle();
    } finally {
      // `return` inside try still runs this, so every exit path -- including the early 500 when
      // policies cannot be loaded -- closes the run it opened.
      await admin.rpc("finish_system_job", {
        p_run_id: runId,
        p_status: errorCode
          ? "failed"
          : failed > 0
            ? (succeeded > 0 ? "partial" : "failed")
            : "succeeded",
        p_attempted_count: attempted,
        p_succeeded_count: succeeded,
        p_failed_count: failed,
        p_result: {},
        p_error_code: errorCode,
        p_error_message: errorMessage,
      });
    }

    async function runLifecycle(): Promise<Response> {
    const { data: policies, error: policyError } = await admin
      .from("data_lifecycle_policies")
      .select("policy_key")
      .eq("is_active", true)
      .order("policy_key");
    if (policyError) {
      errorCode = "policies_unavailable";
      errorMessage = policyError.message ?? "Lifecycle policies could not be loaded";
      return json({ error: "Lifecycle policies could not be loaded" }, 500);
    }

    const periodEnd = paToday(now());
    const lifecycle: Array<Record<string, unknown>> = [];
    for (const policy of policies ?? []) {
      const { data, error } = await admin.rpc("run_data_lifecycle_policy", {
        p_policy_key: policy.policy_key,
        p_limit: 5000,
        p_request_id: `${periodEnd}:${policy.policy_key}`,
      });
      lifecycle.push(
        error
          ? { policyKey: policy.policy_key, error: error.message }
          : data && typeof data === "object" && !Array.isArray(data)
            ? data as Record<string, unknown>
            : { policyKey: policy.policy_key, result: data },
      );
    }

    // Expired organization export archives (PT-006B). These are transient
    // download artifacts, not retention-managed records, and their storage
    // objects can only be removed through the Storage API -- which is why this
    // sweep is a dedicated step here instead of a run_data_lifecycle_policy row.
    // list_expired_organization_exports honors active data_lifecycle_holds
    // (source_table 'organization_export_jobs' or all-table holds); objects are
    // removed first and only then are their job rows purged, so a removal
    // failure leaves the row (and the audit trail of what still exists) intact.
    lifecycle.push(await sweepExpiredOrganizationExports(admin));

    const { data: benchmarks, error: benchmarkError } = await admin.rpc(
      "refresh_benchmark_snapshots",
      { p_period_end: periodEnd, p_k_threshold: 10 },
    );
    const hasLifecycleError = lifecycle.some((result) => "error" in result);

    // Each lifecycle step is one unit of work, so a single failing policy reports as `partial`
    // rather than taking the whole sweep down. A failed benchmark refresh is recorded as the
    // run's error without changing the per-step tally, because it is not one of the steps.
    attempted = lifecycle.length;
    failed = lifecycle.filter((result) => "error" in result).length;
    succeeded = attempted - failed;
    if (benchmarkError) {
      errorCode = "benchmark_refresh_failed";
      errorMessage = benchmarkError.message ?? "Benchmark refresh failed";
    }

    return json({
      lifecycle,
      benchmarks: benchmarkError
        ? { error: benchmarkError.message }
        : { cohortsRefreshed: benchmarks },
    }, hasLifecycleError ? 207 : 200);
    }
  };
}
