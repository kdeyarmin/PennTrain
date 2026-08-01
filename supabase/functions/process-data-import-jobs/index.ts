/** Durable import claim loop (BACKLOG D3). Auth: service role Bearer or x-cron-secret. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("IMPORT_WORKER_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isCron = Boolean(cronSecret && headerSecret && headerSecret === cronSecret);
    const isService = Boolean(serviceKey && authHeader === `Bearer ${serviceKey}`);

    if (!isCron && !isService) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number((payload as { limit?: number }).limit ?? 3), 10);

    const { data: claimed, error: claimErr } = await supabase.rpc("claim_data_import_jobs", {
      p_limit: limit,
      p_claim_seconds: 600,
    });
    if (claimErr) throw claimErr;

    const jobs = (claimed ?? []) as Array<{ id: string; domain: string }>;
    const results: Array<{ jobId: string; domain: string; ok: boolean; error: string | null }> = [];

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

    return new Response(JSON.stringify({ success: true, claimed: jobs.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
