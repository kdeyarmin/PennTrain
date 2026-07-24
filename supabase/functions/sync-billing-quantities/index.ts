import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import {
  phase2MeasuredBillingQuantity,
  phase2StripePost,
  resolvePhase2BillingQuantity,
} from "../_shared/phase2Billing.ts";

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-correlation-id, x-request-id",
});

type SubscriptionRow = {
  id: string;
  organization_id: string;
  current_period_end: string | null;
  quantity_sync_checked_at: string | null;
};

type ItemRow = {
  id: string;
  organization_id: string;
  quantity: number;
  stripe_price_id: string;
  stripe_subscription_item_id: string;
  subscription_id: string;
};

type PriceRow = {
  billing_metric: string;
  maximum_quantity: number | null;
  minimum_quantity: number;
  stripe_price_id: string;
};

type UsageRow = {
  active_learners: number;
  active_users: number;
  active_residents: number;
  facilities: number;
};

type ProviderOperationRow = {
  id: string;
  status: "pending" | "provider_succeeded" | "local_succeeded" | "failed";
  provider_response_id: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authError = requireCronRequest(req, CORS_HEADERS);
  if (authError) return authError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
    return json({ error: "billing_sync_not_configured" }, 503);
  }

  let body: { batchSize?: number; maxRuntimeMs?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsedBatchSize = Number(body.batchSize ?? 50);
  const batchSize = Number.isFinite(parsedBatchSize)
    ? Math.min(Math.max(Math.trunc(parsedBatchSize), 1), 50)
    : 50;
  const parsedMaxRuntimeMs = Number(body.maxRuntimeMs ?? 110_000);
  const maxRuntimeMs = Number.isFinite(parsedMaxRuntimeMs)
    ? Math.min(Math.max(Math.trunc(parsedMaxRuntimeMs), 1_000), 150_000)
    : 110_000;
  const deadlineAt = Date.now() + maxRuntimeMs;
  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const requestId = (req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 200);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: jobRows, error: jobError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: "billing-quantity-sync",
    p_correlation_id: correlationId,
    p_trigger_type: requestId.startsWith("manual:") ? "manual" : "scheduled",
    p_provider_request_id: requestId,
  });
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  if (jobError || !job?.run_id) return json({ error: "job_tracking_failed", correlationId }, 500);
  if (!job.should_execute) {
    return json({ success: true, replayed: true, runId: job.run_id, correlationId });
  }

  const { data: subscriptionData, error: subscriptionError } = await admin
    .from("billing_subscriptions")
    .select("id, organization_id, current_period_end, quantity_sync_checked_at")
    .in("billing_state", ["trial", "active", "grace", "past_due"])
    .order("quantity_sync_checked_at", { ascending: true, nullsFirst: true })
    .order("current_period_end", { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (subscriptionError) {
    await admin.rpc("finish_system_job", {
      p_run_id: job.run_id,
      p_status: "failed",
      p_attempted_count: 0,
      p_succeeded_count: 0,
      p_failed_count: 1,
      p_result: { correlationId },
      p_error_code: "subscription_read_failed",
      p_error_message: "Active billing subscriptions could not be read",
    });
    return json({ error: "subscription_read_failed", correlationId }, 500);
  }

  const subscriptions = (subscriptionData ?? []) as SubscriptionRow[];
  const subscriptionsById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const outcomesBySubscription = new Map(subscriptions.map((subscription) => [
    subscription.id,
    { status: "pending", errorCode: null } as {
      status: "pending" | "synced" | "unmapped" | "out_of_range" | "failed";
      errorCode: string | null;
    },
  ]));
  const setOutcome = (
    subscriptionId: string,
    status: "synced" | "unmapped" | "out_of_range" | "failed",
    errorCode: string | null,
  ) => {
    const current = outcomesBySubscription.get(subscriptionId);
    const precedence = { pending: -1, synced: 0, unmapped: 1, out_of_range: 2, failed: 3 };
    if (!current || precedence[status] >= precedence[current.status]) {
      outcomesBySubscription.set(subscriptionId, { status, errorCode });
    }
  };
  const subscriptionIds = subscriptions.map((subscription) => subscription.id);
  let items: ItemRow[] = [];
  if (subscriptionIds.length > 0) {
    const { data, error } = await admin.from("billing_subscription_items")
      .select("id, organization_id, quantity, stripe_price_id, stripe_subscription_item_id, subscription_id")
      .in("subscription_id", subscriptionIds);
    if (error) {
      await admin.rpc("finish_system_job", {
        p_run_id: job.run_id,
        p_status: "failed",
        p_attempted_count: 0,
        p_succeeded_count: 0,
        p_failed_count: 1,
        p_result: { correlationId },
        p_error_code: "subscription_item_read_failed",
        p_error_message: "Billing subscription items could not be read",
      });
      return json({ error: "subscription_item_read_failed", correlationId }, 500);
    }
    items = (data ?? []) as ItemRow[];
  }

  const stripePriceIds = [...new Set(items.map((item) => item.stripe_price_id))];
  let prices: PriceRow[] = [];
  if (stripePriceIds.length > 0) {
    const { data, error } = await admin.from("package_billing_prices")
      .select("stripe_price_id, billing_metric, minimum_quantity, maximum_quantity")
      .in("stripe_price_id", stripePriceIds);
    if (error) {
      await admin.rpc("finish_system_job", {
        p_run_id: job.run_id,
        p_status: "failed",
        p_attempted_count: 0,
        p_succeeded_count: 0,
        p_failed_count: 1,
        p_result: { correlationId },
        p_error_code: "billing_price_read_failed",
        p_error_message: "Billing price configuration could not be read",
      });
      return json({ error: "billing_price_read_failed", correlationId }, 500);
    }
    prices = (data ?? []).filter((price): price is PriceRow => !!price.stripe_price_id);
  }

  const pricesByStripeId = new Map(prices.map((price) => [price.stripe_price_id, price]));
  const subscriptionIdsWithItems = new Set(items.map((item) => item.subscription_id));
  for (const subscription of subscriptions) {
    if (!subscriptionIdsWithItems.has(subscription.id)) {
      setOutcome(subscription.id, "unmapped", "subscription_item_unmapped");
    }
  }
  const usageByOrganization = new Map<string, Promise<UsageRow | null>>();
  const getUsage = (organizationId: string) => {
    const cached = usageByOrganization.get(organizationId);
    if (cached) return cached;
    const request = Promise.resolve(admin.rpc("get_organization_billing_usage", {
      p_organization_id: organizationId,
    })).then(({ data, error }) => {
      if (error) return null;
      const usage = Array.isArray(data) ? data[0] : null;
      if (!usage) return null;
      return {
        active_learners: Number(usage.active_learners),
        active_users: Number(usage.active_users),
        active_residents: Number(usage.active_residents),
        facilities: Number(usage.facilities),
      };
    });
    usageByOrganization.set(organizationId, request);
    return request;
  };

  let unchanged = 0;
  let updated = 0;
  let skipped = 0;
  let outOfRange = 0;
  let failed = 0;
  let trackingFailures = 0;
  const concurrency = 5;
  for (let offset = 0; offset < items.length; offset += concurrency) {
    if (Date.now() >= deadlineAt) break;
    await Promise.all(items.slice(offset, offset + concurrency).map(async (item) => {
      if (Date.now() >= deadlineAt) return;
      const price = pricesByStripeId.get(item.stripe_price_id);
      const subscription = subscriptionsById.get(item.subscription_id);
      if (!price || !subscription) {
        skipped++;
        setOutcome(item.subscription_id, "unmapped", "stripe_price_unmapped");
        return;
      }
      if (price.billing_metric === "flat") {
        skipped++;
        setOutcome(item.subscription_id, "synced", null);
        return;
      }
      const usage = await getUsage(item.organization_id);
      const measured = usage ? phase2MeasuredBillingQuantity(price.billing_metric, usage) : null;
      const quantity = measured === null ? null : resolvePhase2BillingQuantity(
        price.billing_metric,
        Math.max(measured, price.minimum_quantity),
        price.minimum_quantity,
        price.maximum_quantity,
      );
      if (measured === null) {
        failed++;
        setOutcome(item.subscription_id, "failed", "billing_usage_unavailable");
        return;
      }
      if (quantity === null) {
        outOfRange++;
        setOutcome(item.subscription_id, "out_of_range", "quantity_outside_self_service_range");
        return;
      }
      if (quantity === item.quantity) {
        unchanged++;
        setOutcome(item.subscription_id, "synced", null);
        return;
      }

      const idempotencyKey = [
        "billing-quantity-sync",
        item.id,
        quantity,
      ].join(":");
      const operationKey = idempotencyKey;
      const operationPayload = {
        operation_key: operationKey,
        operation_type: "subscription_item_quantity_sync",
        organization_id: item.organization_id,
        subscription_id: item.subscription_id,
        subscription_item_id: item.id,
        stripe_subscription_item_id: item.stripe_subscription_item_id,
        target_quantity: quantity,
        idempotency_key: idempotencyKey,
        status: "pending",
        error_code: null,
        attempted_at: new Date().toISOString(),
      };
      let operationData: ProviderOperationRow | null = null;
      const insertOperation = await admin
        .from("billing_provider_operations")
        .insert(operationPayload)
        .select("id, status, provider_response_id")
        .single<ProviderOperationRow>();
      if (insertOperation.error) {
        const existingOperation = await admin
          .from("billing_provider_operations")
          .select("id, status, provider_response_id")
          .eq("operation_key", operationKey)
          .maybeSingle<ProviderOperationRow>();
        if (existingOperation.error || !existingOperation.data) {
          failed++;
          setOutcome(item.subscription_id, "failed", "provider_operation_claim_failed");
          return;
        }
        operationData = existingOperation.data;
      } else {
        operationData = insertOperation.data;
      }
      if (!operationData) {
        failed++;
        setOutcome(item.subscription_id, "failed", "provider_operation_claim_failed");
        return;
      }

      if (operationData.status === "failed") {
        failed++;
        setOutcome(item.subscription_id, "failed", "provider_operation_failed");
        return;
      }

      let providerSucceeded = operationData.status === "provider_succeeded" || operationData.status === "local_succeeded";
      if (!providerSucceeded) {
        const stripeResult = await phase2StripePost(
          `/v1/subscription_items/${encodeURIComponent(item.stripe_subscription_item_id)}`,
          stripeSecretKey,
          { quantity, proration_behavior: "none" },
          idempotencyKey,
        );
        if (!stripeResult.ok || stripeResult.data.id !== item.stripe_subscription_item_id
          || Number(stripeResult.data.quantity) !== quantity) {
          failed++;
          await admin.from("billing_provider_operations").update({
            status: "failed",
            error_code: stripeResult.ok ? "stripe_response_invalid" : `stripe_http_${stripeResult.status}`,
            updated_at: new Date().toISOString(),
          }).eq("id", operationData.id);
          setOutcome(
            item.subscription_id,
            "failed",
            stripeResult.ok ? "stripe_response_invalid" : `stripe_http_${stripeResult.status}`,
          );
          return;
        }
        providerSucceeded = true;
        await admin.from("billing_provider_operations").update({
          status: "provider_succeeded",
          error_code: null,
          provider_response_id: String(stripeResult.data.id),
          provider_succeeded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", operationData.id);
      }

      const { error: persistenceError } = await admin.from("billing_subscription_items")
        .update({ quantity })
        .eq("id", item.id);
      if (persistenceError) {
        failed++;
        await admin.from("billing_provider_operations").update({
          status: providerSucceeded ? "provider_succeeded" : "failed",
          error_code: "local_quantity_persistence_failed",
          updated_at: new Date().toISOString(),
        }).eq("operation_key", operationKey);
        setOutcome(item.subscription_id, "failed", "local_quantity_persistence_failed");
        return;
      }
      // billing_subscriptions.seat_quantity means PURCHASED SEATS (people): entitlement
      // seat caps and get_billing_reconciliation's purchasedSeats/seatLimitExceeded
      // compare it against active profile counts. Only seat-denominated items may write
      // it -- syncing a facility- or resident-metered item's quantity here would corrupt
      // seat reconciliation (e.g. flag "seat limit exceeded" for an org with 3 buildings).
      if (price.billing_metric === "active_learner" || price.billing_metric === "active_user") {
        const { error: subscriptionPersistenceError } = await admin.from("billing_subscriptions")
          .update({ seat_quantity: quantity })
          .eq("id", item.subscription_id);
        if (subscriptionPersistenceError) {
          failed++;
          await admin.from("billing_provider_operations").update({
            status: providerSucceeded ? "provider_succeeded" : "failed",
            error_code: "subscription_quantity_persistence_failed",
            updated_at: new Date().toISOString(),
          }).eq("operation_key", operationKey);
          setOutcome(item.subscription_id, "failed", "subscription_quantity_persistence_failed");
          return;
        }
      }
      await admin.from("billing_provider_operations").update({
        status: "local_succeeded",
        error_code: null,
        local_succeeded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("operation_key", operationKey);
      updated++;
      setOutcome(item.subscription_id, "synced", null);
    }));
  }

  const checkedAt = new Date().toISOString();
  for (const [subscriptionId, outcome] of outcomesBySubscription) {
    if (outcome.status === "pending") continue;
    const { error } = await admin.from("billing_subscriptions").update({
      quantity_sync_checked_at: checkedAt,
      quantity_sync_status: outcome.status,
      quantity_sync_error_code: outcome.errorCode,
    }).eq("id", subscriptionId);
    if (error) trackingFailures++;
  }

  const syncedSubscriptions = [...outcomesBySubscription.values()]
    .filter((outcome) => outcome.status === "synced").length;
  const unmappedSubscriptions = [...outcomesBySubscription.values()]
    .filter((outcome) => outcome.status === "unmapped").length;
  const deferredSubscriptions = [...outcomesBySubscription.values()]
    .filter((outcome) => outcome.status === "pending").length;
  const attempted = subscriptions.length - deferredSubscriptions;
  const succeeded = syncedSubscriptions;
  const failedCount = Math.max(0, attempted - succeeded) + trackingFailures;
  const terminalStatus = (failed > 0 || trackingFailures > 0) && succeeded === 0
    ? "failed"
    : failed > 0 || trackingFailures > 0 || outOfRange > 0 || unmappedSubscriptions > 0 || deferredSubscriptions > 0
    ? "partial"
    : "succeeded";
  const result = {
    subscriptions: subscriptions.length,
    items: items.length,
    updated,
    unchanged,
    skipped,
    syncedSubscriptions,
    unmappedSubscriptions,
    outOfRange,
    failed,
    deferredSubscriptions,
    trackingFailures,
    prorationBehavior: "none",
    correlationId,
  };
  await admin.rpc("finish_system_job", {
    p_run_id: job.run_id,
    p_status: terminalStatus,
    p_attempted_count: attempted,
    p_succeeded_count: succeeded,
    p_failed_count: failedCount,
    p_result: result,
    p_error_code: terminalStatus === "succeeded" ? null : "billing_quantity_sync_incomplete",
    p_error_message: terminalStatus === "succeeded"
      ? null
      : "One or more subscription quantities require operator attention",
  });

  return json({ success: terminalStatus !== "failed", runId: job.run_id, ...result }, terminalStatus === "failed" ? 502 : 200);
});
