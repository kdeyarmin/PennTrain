/** Durable import claim loop (BACKLOG D3). Auth: the shared cron secret, like the other workers. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
});

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

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

    const jobs = (claimed ?? []) as Array<{ id: string; domain: string }>;
    const results: Array<{ jobId: string; domain: string; ok: boolean; error: string | null }> = [];

    // The row-application pass still runs in the browser; this worker only takes the claim and
    // hands it straight back, so a tab that closes mid-apply leaves the job re-claimable at
    // 'ready' instead of stranded in 'applying' until the lease lapses.
    for (const job of jobs) {
      const { error: releaseErr } = await supabase.rpc("release_data_import_job_claim", {
        p_job_id: job.id,
        p_status: "ready",
        p_last_error: null,
      });
      results.push({
        jobId: job.id,
        domain: job.domain,
        ok: !releaseErr,
        error: releaseErr?.message ?? null,
      });
    }

    return response({ success: true, claimed: jobs.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return response({ success: false, error: message }, 500);
  }
});
