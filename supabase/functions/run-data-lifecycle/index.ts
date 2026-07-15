import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const HEADERS = withCronCorsHeader({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
Deno.serve(async (req: Request) => {
  const authError = requireCronRequest(req, HEADERS); if (authError) return authError;
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ error: "Supabase service credentials are missing" }), { status: 500, headers: HEADERS });
  const admin = createClient(url, key);
  const { data: policies, error } = await admin.from("data_lifecycle_policies").select("policy_key").eq("is_active", true).order("policy_key");
  if (error) return new Response(JSON.stringify({ error: "Lifecycle policies could not be loaded" }), { status: 500, headers: HEADERS });
  const results: Array<Record<string, unknown>> = [];
  for (const policy of policies ?? []) {
    const { data, error: runError } = await admin.rpc("run_data_lifecycle_policy", { p_policy_key: policy.policy_key, p_limit: 5000, p_request_id: `${new Date().toISOString().slice(0,10)}:${policy.policy_key}` });
    results.push(runError ? { policyKey: policy.policy_key, error: runError.message } : data);
  }
  const { data: benchmarks, error: benchmarkError } = await admin.rpc("refresh_benchmark_snapshots", { p_period_end: new Date().toISOString().slice(0,10), p_k_threshold: 10 });
  return new Response(JSON.stringify({ lifecycle: results, benchmarks: benchmarkError ? { error: benchmarkError.message } : { cohortsRefreshed: benchmarks } }), { status: results.some((result) => "error" in result) ? 207 : 200, headers: HEADERS });
});
