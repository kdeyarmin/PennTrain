import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  CORS_HEADERS,
  json,
  requireCron,
} from "../_shared/billingHttp.ts";
import { randomUUID as defaultRandomUUID } from "../_shared/ids.ts";

type StripeResponse = { ok: boolean; status: number; data: Record<string, unknown> };

type CreateClient = (
  url: string,
  key: string,
  options?: Record<string, unknown>,
) => unknown;

type StripePost = (
  path: string,
  body: Record<string, string>,
  secretKey: string,
  idempotencyKey?: string,
) => Promise<StripeResponse>;

type StripeGet = (
  path: string,
  secretKey: string,
) => Promise<StripeResponse>;

type GetEnv = (name: string) => string | undefined;

type RequireCron = (
  req: Request,
  headers: HeadersInit,
) => Response | null;

export type SyncBillingQuantitiesDeps = {
  createClient: CreateClient;
  stripePost: StripePost;
  stripeGet: StripeGet;
  getEnv?: GetEnv;
  requireCron?: RequireCron;
  randomUUID?: () => string;
  nowMs?: () => number;
};

function defaultGetEnv(name: string): string | undefined {
  return Deno.env.get(name) ?? undefined;
}

function defaultNowMs(): number {
  return Date.now();
}

export function createSyncBillingQuantitiesHandler({
  createClient,
  stripePost,
  stripeGet,
  getEnv = defaultGetEnv,
  requireCron = requireCron,
  randomUUID = defaultRandomUUID,
  nowMs = defaultNowMs,
}: SyncBillingQuantitiesDeps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const authError = requireCron(req, CORS_HEADERS);
    if (authError) return authError;

    const correlationId = (req.headers.get("x-correlation-id") || randomUUID()).slice(0, 200);
    const requestId = (req.headers.get("x-request-id") || randomUUID()).slice(0, 200);

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
    if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
      // Answering 503 and recording nothing is how a real outage stayed invisible: with no
      // system_job_runs row, /admin/system-jobs shows this job as merely idle and the watchdog
      // has no failure to find, so an hourly misconfiguration looked exactly like a quiet
      // schedule. Supabase always injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, so the
      // shape this takes in production is a missing STRIPE_SECRET_KEY -- which still leaves a
      // usable admin client to write the failed run with.
      if (supabaseUrl && serviceRoleKey) {
        // Tracking is best effort: a failure to record must not turn the misconfiguration
        // into a 500, which would read as a transient error rather than missing setup.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tracker: any = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: claimRows } = await tracker.rpc("claim_system_job_execution", {
            p_job_key: "billing-quantity-sync",
            p_correlation_id: correlationId,
            p_trigger_type: requestId.startsWith("manual:") ? "manual" : "scheduled",
            p_provider_request_id: requestId,
          });
          const claimed = Array.isArray(claimRows) ? claimRows[0] : claimRows;
          if (claimed?.run_id) {
            await tracker.rpc("finish_system_job", {
              p_run_id: claimed.run_id,
              p_status: "failed",
              p_attempted_count: 0,
              p_succeeded_count: 0,
              p_failed_count: 1,
              p_result: { correlationId, missingStripeSecretKey: !stripeSecretKey },
              p_error_code: "billing_sync_not_configured",
              p_error_message:
                "STRIPE_SECRET_KEY is not set on this project, so no subscription quantity can be synchronized",
            });
          }
        } catch {
          console.error("billing sync misconfiguration could not be recorded", { correlationId });
        }
      }
      return json({ error: "billing_sync_not_configured" }, 503);
    }

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const batchSizeRaw = body.batchSize;
    const batchSize = typeof batchSizeRaw === "number" && Number.isFinite(batchSizeRaw)
      ? Math.min(Math.max(Math.trunc(batchSizeRaw), 1), 100)
      : 25;
    const maxRuntimeMsRaw = body.maxRuntimeMs;
    const maxRuntimeMs = typeof maxRuntimeMsRaw === "number" && Number.isFinite(maxRuntimeMsRaw)
      ? Math.min(Math.max(Math.trunc(maxRuntimeMsRaw), 1_000), 150_000)
      : 110_000;
    const deadlineAt = nowMs() + maxRuntimeMs;
    // Typed as any so Deno typecheck does not require full Supabase client generics
    // in the injectable factory (production index wires the real createClient).
    const admin: any = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: claimRows, error: claimError } = await admin.rpc("claim_system_job_execution", {
      p_job_key: "billing-quantity-sync",
      p_correlation_id: correlationId,
      p_trigger_type: requestId.startsWith("manual:") ? "manual" : "scheduled",
      p_provider_request_id: requestId,
    });
    if (claimError) {
      console.error("claim_system_job_execution failed", claimError);
      return json({ error: "claim_failed", details: claimError.message }, 500);
    }
    const claimed = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claimed?.should_execute || !claimed?.run_id) {
      return json({
        success: true,
        skipped: true,
        reason: claimed?.reason ?? "not_claimed",
        runId: claimed?.run_id ?? null,
      });
    }

    const runId = claimed.run_id as string;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    const details: Array<Record<string, unknown>> = [];

    try {
      // Fetch active subscriptions that need quantity sync (flat plans stay at 1).
      const { data: subscriptions, error: subError } = await admin
        .from("billing_subscriptions")
        .select(
          "id, organization_id, stripe_subscription_id, stripe_subscription_item_id, package_id, status",
        )
        .in("status", ["active", "trialing", "past_due"])
        .not("stripe_subscription_item_id", "is", null)
        .limit(batchSize);

      if (subError) {
        throw new Error(`list_subscriptions_failed: ${subError.message}`);
      }

      const rows = Array.isArray(subscriptions) ? subscriptions : [];

      for (const row of rows) {
        if (nowMs() >= deadlineAt) {
          details.push({ organizationId: row.organization_id, status: "deadline_reached" });
          break;
        }
        attempted += 1;
        const orgId = row.organization_id as string;
        const itemId = row.stripe_subscription_item_id as string;

        try {
          // Flat self-serve plans always target quantity 1.
          const targetQuantity = 1;

          const getRes = await stripeGet(`/v1/subscription_items/${itemId}`, stripeSecretKey);
          if (!getRes.ok) {
            failed += 1;
            details.push({
              organizationId: orgId,
              status: "stripe_get_failed",
              httpStatus: getRes.status,
            });
            continue;
          }

          const currentQty = Number((getRes.data as { quantity?: number }).quantity ?? 0);
          if (currentQty === targetQuantity) {
            succeeded += 1;
            details.push({
              organizationId: orgId,
              status: "unchanged",
              quantity: currentQty,
            });
            continue;
          }

          const postRes = await stripePost(
            `/v1/subscription_items/${itemId}`,
            { quantity: String(targetQuantity), "proration_behavior": "none" },
            stripeSecretKey,
            `billing-qty-sync:${orgId}:${itemId}:${targetQuantity}`,
          );
          if (!postRes.ok) {
            failed += 1;
            details.push({
              organizationId: orgId,
              status: "stripe_update_failed",
              httpStatus: postRes.status,
            });
            continue;
          }

          succeeded += 1;
          details.push({
            organizationId: orgId,
            status: "updated",
            from: currentQty,
            to: targetQuantity,
          });
        } catch (itemErr) {
          failed += 1;
          details.push({
            organizationId: orgId,
            status: "exception",
            message: itemErr instanceof Error ? itemErr.message : String(itemErr),
          });
        }
      }

      const terminalStatus = failed > 0 && succeeded === 0 ? "failed" : "succeeded";
      await admin.rpc("finish_system_job", {
        p_run_id: runId,
        p_status: terminalStatus,
        p_attempted_count: attempted,
        p_succeeded_count: succeeded,
        p_failed_count: failed,
        p_result: { correlationId, details },
        p_error_code: terminalStatus === "failed" ? "billing_quantity_sync_incomplete" : null,
        p_error_message: terminalStatus === "failed"
          ? "One or more subscription quantities require operator attention"
          : null,
      });

      return json(
        {
          success: terminalStatus !== "failed",
          runId,
          attempted,
          succeeded,
          failed,
          details,
        },
        terminalStatus === "failed" ? 502 : 200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await admin.rpc("finish_system_job", {
          p_run_id: runId,
          p_status: "failed",
          p_attempted_count: attempted,
          p_succeeded_count: succeeded,
          p_failed_count: failed + 1,
          p_result: { correlationId, details },
          p_error_code: "billing_quantity_sync_exception",
          p_error_message: message,
        });
      } catch (finishErr) {
        console.error("finish_system_job failed after exception", finishErr);
      }
      return json({ error: "billing_quantity_sync_exception", message }, 500);
    }
  };
}
