import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import {
  phase2MeasuredBillingQuantity,
} from "../_shared/phase2Billing.ts";
import {
  billingQuantitySyncIdempotencyKey,
  billingQuantitySyncOperationKey,
  billingQuantitySyncPeriodBucket,
  resolveBillingOperationConflict,
  resolveSyncTargetQuantity,
} from "../_shared/billingQuantitySync.ts";

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-correlation-id, x-request-id",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export type SyncBillingQuantitiesDeps = {
  createClient: (url: string, key: string, options?: Record<string, unknown>) => unknown;
  stripePost: (path: string, body: Record<string, string>, secretKey: string) => Promise<{
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
  }>;
  stripeGet: (path: string, secretKey: string) => Promise<{
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
  }>;
  getEnv?: (name: string) => string | undefined;
  randomUUID?: () => string;
  nowMs?: () => number;
  requireCron?: (req: Request, headers: HeadersInit) => Response | null;
};

const defaultGetEnv = (name: string) => Deno.env.get(name);
const defaultRandomUUID = () => crypto.randomUUID();
const defaultNowMs = () => Date.now();

export function createSyncBillingQuantitiesHandler({
  createClient,
  stripePost,
  stripeGet,
  getEnv = defaultGetEnv,
  randomUUID = defaultRandomUUID,
  nowMs = defaultNowMs,
  requireCron = requireCronRequest,
}: SyncBillingQuantitiesDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
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
        console.error("Billing sync misconfiguration could not be recorded", { correlationId });
      }
    }
    return json({ error: "billing_sync_not_configured" }, 503);
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const batchSize = typeof body.batchSize === "number"
    ? Math.min(Math.max(Math.trunc(body.batchSize), 1), 100)
    : 25;
  const parsedMaxRuntimeMs = typeof body.maxRuntimeMs === "number" ? body.maxRuntimeMs : undefined;
  const maxRuntimeMs = typeof parsedMaxRuntimeMs === "number"
    ? Math.min(Math.max(Math.trunc(parsedMaxRuntimeMs), 1_000), 150_000)
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
    return json({ error: "claim_failed", details: claimError.message }, 500);
  }
  const claimed = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claimed?.should_execute) {
    return json({
      success: true,
      skipped: true,
      reason: claimed?.skip_reason ?? "already_running",
      runId: claimed?.run_id ?? null,
    });
  }
  const job = { run_id: claimed.run_id as string };

  const result = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    unchanged: 0,
    incomplete: false,
    items: [] as Array<Record<string, unknown>>,
  };

  const { data: subscriptions, error: listError } = await admin
    .from("billing_subscriptions")
    .select("id, organization_id, stripe_subscription_id, status, package_id")
    .in("status", ["active", "trialing", "past_due"])
    .order("updated_at", { ascending: true })
    .limit(batchSize);

  if (listError) {
    await admin.rpc("finish_system_job", {
      p_run_id: job.run_id,
      p_status: "failed",
      p_attempted_count: 0,
      p_succeeded_count: 0,
      p_failed_count: 1,
      p_result: { correlationId },
      p_error_code: "list_subscriptions_failed",
      p_error_message: listError.message,
    });
    return json({ error: "list_subscriptions_failed", details: listError.message }, 500);
  }

  for (const sub of subscriptions ?? []) {
    if (nowMs() >= deadlineAt) {
      result.incomplete = true;
      break;
    }
    result.attempted += 1;
    const organizationId = sub.organization_id as string;
    const stripeSubscriptionId = sub.stripe_subscription_id as string;

    try {
      const measured = await phase2MeasuredBillingQuantity(admin, organizationId, sub.package_id as string | null);
      const targetQuantity = resolveSyncTargetQuantity(measured);

      const stripeSub = await stripeGet(`/v1/subscriptions/${stripeSubscriptionId}`, stripeSecretKey);
      if (!stripeSub.ok) {
        result.failed += 1;
        result.items.push({
          organizationId,
          stripeSubscriptionId,
          status: "failed",
          error: "stripe_subscription_fetch_failed",
          httpStatus: stripeSub.status,
        });
        continue;
      }

      const items = Array.isArray(stripeSub.data.items)
        ? (stripeSub.data.items as Array<Record<string, unknown>>)
        : Array.isArray((stripeSub.data.items as { data?: unknown })?.data)
        ? ((stripeSub.data.items as { data: Array<Record<string, unknown>> }).data)
        : [];

      if (items.length === 0) {
        result.failed += 1;
        result.items.push({
          organizationId,
          stripeSubscriptionId,
          status: "failed",
          error: "no_subscription_items",
        });
        continue;
      }

      let anyChanged = false;
      let anyFailed = false;
      for (const item of items) {
        const itemId = String(item.id ?? "");
        const currentQty = typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 0);
        if (!itemId) continue;

        if (currentQty === targetQuantity) {
          result.unchanged += 1;
          continue;
        }

        const periodBucket = billingQuantitySyncPeriodBucket(nowMs());
        const operationKey = billingQuantitySyncOperationKey({
          organizationId,
          stripeSubscriptionId,
          stripeItemId: itemId,
          periodBucket,
        });
        const idempotencyKey = billingQuantitySyncIdempotencyKey({
          organizationId,
          stripeSubscriptionId,
          stripeItemId: itemId,
          targetQuantity,
          periodBucket,
        });

        const conflict = resolveBillingOperationConflict({
          existingOperationKey: null,
          existingIdempotencyKey: null,
          proposedOperationKey: operationKey,
          proposedIdempotencyKey: idempotencyKey,
        });
        if (conflict === "conflict") {
          anyFailed = true;
          result.items.push({
            organizationId,
            stripeSubscriptionId,
            itemId,
            status: "conflict",
          });
          continue;
        }

        const update = await stripePost(
          `/v1/subscription_items/${itemId}`,
          {
            quantity: String(targetQuantity),
            "proration_behavior": "none",
          },
          stripeSecretKey,
        );
        if (!update.ok) {
          anyFailed = true;
          result.items.push({
            organizationId,
            stripeSubscriptionId,
            itemId,
            status: "failed",
            error: "stripe_item_update_failed",
            httpStatus: update.status,
          });
          continue;
        }
        anyChanged = true;
        result.items.push({
          organizationId,
          stripeSubscriptionId,
          itemId,
          status: "updated",
          from: currentQty,
          to: targetQuantity,
        });
      }

      if (anyFailed) {
        result.failed += 1;
      } else if (anyChanged) {
        result.succeeded += 1;
      } else {
        result.unchanged += 1;
      }
    } catch (err) {
      result.failed += 1;
      result.items.push({
        organizationId,
        stripeSubscriptionId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const terminalStatus = result.failed > 0
    ? "failed"
    : result.incomplete
    ? "partial"
    : "succeeded";

  await admin.rpc("finish_system_job", {
    p_run_id: job.run_id,
    p_status: terminalStatus === "partial" ? "succeeded" : terminalStatus,
    p_attempted_count: result.attempted,
    p_succeeded_count: result.succeeded,
    p_failed_count: result.failed,
    p_result: { correlationId, ...result },
    p_error_code: terminalStatus === "succeeded"
      ? null
      : terminalStatus === "partial"
      ? "sync_incomplete"
      : "sync_failed",
    p_error_message: terminalStatus === "succeeded"
      ? null
      : "One or more subscription quantities require operator attention",
  });

  return json({ success: terminalStatus !== "failed", runId: job.run_id, ...result }, terminalStatus === "failed" ? 502 : 200);
  };
}
