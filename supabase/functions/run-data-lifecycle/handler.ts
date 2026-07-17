import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

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
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: RUN_DATA_LIFECYCLE_HEADERS,
  });
}

export function createRunDataLifecycleHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
  now = () => new Date(),
  authorizeRequest = requireCronRequest,
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
    const { data: policies, error: policyError } = await admin
      .from("data_lifecycle_policies")
      .select("policy_key")
      .eq("is_active", true)
      .order("policy_key");
    if (policyError) {
      return json({ error: "Lifecycle policies could not be loaded" }, 500);
    }

    const periodEnd = now().toISOString().slice(0, 10);
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

    const { data: benchmarks, error: benchmarkError } = await admin.rpc(
      "refresh_benchmark_snapshots",
      { p_period_end: periodEnd, p_k_threshold: 10 },
    );
    const hasLifecycleError = lifecycle.some((result) => "error" in result);

    return json({
      lifecycle,
      benchmarks: benchmarkError
        ? { error: benchmarkError.message }
        : { cohortsRefreshed: benchmarks },
    }, hasLifecycleError ? 207 : 200);
  };
}
