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

    // The cron entry mints a correlation id and sends it as X-Correlation-Id
    // (20260730200300), and run-system-job forwards the id of the queued row an operator's
    // "Run now" created. Honouring it is what makes the claim below adopt THAT row instead of
    // opening an unrelated one -- otherwise a manual rerun stays queued for ever, and this
    // repository's own abandoned-run reconciler (20260904080000) later rewrites it as a crash
    // that never happened. Same contract as dispatch-integration-webhooks, generate-certificate-pdf
    // and send-regulatory-digest.
    const correlationId = (request.headers.get("x-correlation-id") || newCorrelationId()).slice(0, 200);

    // Claim before any work, so a run that dies mid-sweep leaves a claimed row the watchdog's
    // abandoned-run reconciler can close rather than no trace at all.
    const { data: claimRows, error: claimError } = await admin.rpc("claim_system_job_execution", {
      p_job_key: DATA_LIFECYCLE_JOB_KEY,
      p_correlation_id: correlationId,
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

    // Default to the failure shape. Only an outcome the sweep actually reached overwrites this,
    // so a throw anywhere below closes the run as failed instead of inheriting a success default
    // -- the false green this instrumentation exists to remove.
    let outcome = {
      status: "failed",
      attempted: 0,
      succeeded: 0,
      failed: 0,
      errorCode: "unhandled_error" as string | null,
      errorMessage: "The lifecycle sweep threw before recording an outcome." as string | null,
    };

    try {
      const { data: policies, error: policyError } = await admin
      .from("data_lifecycle_policies")
      .select("policy_key")
      .eq("is_active", true)
      .order("policy_key");
      if (policyError) {
        outcome = {
          status: "failed",
          attempted: 0,
          succeeded: 0,
          failed: 0,
          errorCode: "policies_unavailable",
          errorMessage: policyError.message ?? "Lifecycle policies could not be loaded",
        };
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

      // Every step is one unit of work -- each retention policy, the export-archive sweep, and
      // the benchmark refresh. Counting the benchmark as a unit rather than as a run-level error
      // is what keeps a night where every policy purged correctly from being recorded as a failed
      // retention sweep: it reports `partial`, which is what actually happened.
      const failedSteps = lifecycle.filter((result) => "error" in result).length
        + (benchmarkError ? 1 : 0);
      const attemptedSteps = lifecycle.length + 1;
      const firstFailure = lifecycle.find((result) => "error" in result);
      outcome = {
        status: failedSteps === 0
          ? "succeeded"
          : failedSteps < attemptedSteps ? "partial" : "failed",
        attempted: attemptedSteps,
        succeeded: attemptedSteps - failedSteps,
        failed: failedSteps,
        errorCode: failedSteps === 0
          ? null
          : firstFailure ? "lifecycle_step_failed" : "benchmark_refresh_failed",
        errorMessage: failedSteps === 0
          ? null
          : String(firstFailure?.error ?? benchmarkError?.message ?? "Lifecycle step failed"),
      };

      return json({
        lifecycle,
        benchmarks: benchmarkError
          ? { error: benchmarkError.message }
          : { cohortsRefreshed: benchmarks },
      }, hasLifecycleError ? 207 : 200);
    } finally {
      // `return` inside try still runs this, so every exit path -- including the early 500 when
      // policies cannot be loaded, and any throw -- closes the run it opened. A finalize that
      // itself fails is logged rather than swallowed: silence there leaves the run 'running'
      // until the reconciler mislabels it.
      const { error: finishError } = await admin.rpc("finish_system_job", {
        p_run_id: runId,
        p_status: outcome.status,
        p_attempted_count: outcome.attempted,
        p_succeeded_count: outcome.succeeded,
        p_failed_count: outcome.failed,
        p_result: {},
        p_error_code: outcome.errorCode,
        p_error_message: outcome.errorMessage,
      });
      if (finishError) {
        console.error(
          JSON.stringify({
            event: "data_lifecycle.finish_system_job_failed",
            runId,
            correlationId,
            error: finishError.message,
          }),
        );
      }
    }
  };
}
