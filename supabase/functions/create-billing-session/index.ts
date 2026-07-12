import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  phase2StripePost,
  STRIPE_API_VERSION,
  validatePhase2BillingReturnUrl,
} from "../_shared/phase2Billing.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-correlation-id, x-request-id",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405);
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > 32 * 1024) return json({ error: { code: "payload_too_large" } }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
    return json({ error: { code: "billing_not_configured" } }, 503);
  }
  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: { code: "unauthorized" } }, 401);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: { code: "unauthorized" } }, 401);
  const { data: assurance, error: assuranceError } = await callerClient.auth.mfa
    .getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return json({ error: { code: "aal2_required" } }, 403);
  }
  const { data: assuranceCurrent, error: freshnessError } = await callerClient.rpc(
    "identity_assurance_is_current",
    { p_operation: "billing_admin" },
  );
  if (freshnessError || assuranceCurrent !== true) {
    return json({ error: { code: "fresh_aal2_required" } }, 403);
  }
  const { data: profile, error: profileError } = await callerClient.from("profiles")
    .select("id, email, role, organization_id, is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active) {
    return json({ error: { code: "forbidden" } }, 403);
  }

  let body: {
    organizationId?: string;
    action?: "checkout" | "portal";
    packageId?: string;
    seatQuantity?: number;
    successUrl?: string;
    cancelUrl?: string;
    returnUrl?: string;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: { code: "invalid_json" } }, 400);
  }
  const organizationId = profile.role === "platform_admin"
    ? body.organizationId
    : profile.organization_id;
  if (!organizationId || !UUID.test(organizationId) ||
    (profile.role !== "platform_admin" && body.organizationId && body.organizationId !== organizationId)) {
    return json({ error: { code: "invalid_organization" } }, 403);
  }
  if (profile.role !== "platform_admin") {
    const { data: hasPermission, error: permissionError } = await callerClient.rpc(
      "has_effective_permission",
      {
        p_permission_key: "billing.account.manage",
        p_scope_type: "organization",
        p_scope_id: organizationId,
        p_at: new Date().toISOString(),
      },
    );
    if (permissionError || (!hasPermission && profile.role !== "org_admin")) {
      return json({ error: { code: "forbidden" } }, 403);
    }
  }
  const action = body.action ?? "checkout";
  if (!(["checkout", "portal"] as string[]).includes(action)) {
    return json({ error: { code: "invalid_action" } }, 400);
  }

  const configuredOrigins = (Deno.env.get("BILLING_RETURN_URL_ORIGINS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const requestOrigin = req.headers.get("origin");
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: account } = await admin.from("billing_accounts")
    .select("id, stripe_customer_id, billing_state").eq("organization_id", organizationId).maybeSingle();
  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const requestId = (req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 200);
  const suppliedIdempotency = req.headers.get("idempotency-key") || body.idempotencyKey;
  const idempotencyKey = suppliedIdempotency?.slice(0, 200) ??
    `billing-session:${organizationId}:${crypto.randomUUID()}`;

  let stripeResult: Awaited<ReturnType<typeof phase2StripePost>>;
  let kind: "checkout" | "portal";
  if (action === "portal") {
    if (!account?.stripe_customer_id) return json({ error: { code: "billing_customer_missing" } }, 409);
    const returnUrl = body.returnUrl;
    if (!returnUrl || !validatePhase2BillingReturnUrl(returnUrl, requestOrigin, configuredOrigins)) {
      return json({ error: { code: "invalid_return_url" } }, 400);
    }
    stripeResult = await phase2StripePost(
      "/v1/billing_portal/sessions",
      stripeSecretKey,
      { customer: account.stripe_customer_id, return_url: returnUrl },
      idempotencyKey,
    );
    kind = "portal";
  } else {
    if (!body.packageId || !UUID.test(body.packageId)) {
      return json({ error: { code: "package_required" } }, 400);
    }
    const { data: price, error: priceError } = await admin.from("package_billing_prices")
      .select("stripe_price_id, is_seat_based, minimum_quantity, maximum_quantity, packages!inner(is_active)")
      .eq("package_id", body.packageId).eq("is_active", true)
      .eq("packages.is_active", true)
      .lte("effective_from", new Date().toISOString())
      .or(`effective_to.is.null,effective_to.gt.${new Date().toISOString()}`)
      .order("effective_from", { ascending: false }).limit(1).maybeSingle();
    if (priceError || !price) return json({ error: { code: "active_price_missing" } }, 409);
    const quantity = price.is_seat_based ? Math.trunc(body.seatQuantity ?? price.minimum_quantity) : 1;
    if (!Number.isSafeInteger(quantity) || quantity < price.minimum_quantity ||
      (price.maximum_quantity !== null && quantity > price.maximum_quantity)) {
      return json({ error: { code: "invalid_seat_quantity" } }, 400);
    }
    if (!body.successUrl || !body.cancelUrl ||
      !validatePhase2BillingReturnUrl(body.successUrl, requestOrigin, configuredOrigins) ||
      !validatePhase2BillingReturnUrl(body.cancelUrl, requestOrigin, configuredOrigins)) {
      return json({ error: { code: "invalid_return_url" } }, 400);
    }
    stripeResult = await phase2StripePost(
      "/v1/checkout/sessions",
      stripeSecretKey,
      {
        mode: "subscription",
        client_reference_id: organizationId,
        customer: account?.stripe_customer_id ?? undefined,
        customer_email: account?.stripe_customer_id ? undefined : profile.email,
        success_url: body.successUrl,
        cancel_url: body.cancelUrl,
        line_items: [{ price: price.stripe_price_id, quantity }],
        metadata: { organization_id: organizationId, package_id: body.packageId },
        subscription_data: { metadata: { organization_id: organizationId, package_id: body.packageId } },
      },
      idempotencyKey,
    );
    kind = "checkout";
  }

  if (!stripeResult.ok) {
    console.error("Stripe billing session creation failed", {
      status: stripeResult.status,
      organizationId,
      correlationId,
    });
    return json({ error: { code: "stripe_request_failed" }, meta: { correlationId } }, 502);
  }
  const sessionId = typeof stripeResult.data.id === "string" ? stripeResult.data.id : null;
  const url = typeof stripeResult.data.url === "string" ? stripeResult.data.url : null;
  if (!sessionId || !url) return json({ error: { code: "invalid_stripe_response" } }, 502);

  const { error: auditError } = await admin.from("audit_logs").insert({
    organization_id: organizationId,
    actor_profile_id: user.id,
    actor_subject_id: user.id,
    entity_type: "billing_session",
    entity_id: sessionId,
    action: kind === "checkout" ? "billing_checkout_created" : "billing_portal_created",
    source: "edge_function",
    request_id: requestId,
    correlation_id: correlationId,
    new_values: { kind, stripe_session_id: sessionId },
  });
  if (auditError) console.error("Billing session audit persistence failed", { correlationId });
  const expiresAt = typeof stripeResult.data.expires_at === "number"
    ? new Date(stripeResult.data.expires_at * 1000).toISOString()
    : undefined;
  return json({
    data: { kind, sessionId, url, ...(expiresAt ? { expiresAt } : {}) },
    meta: { requestId, correlationId, stripeApiVersion: STRIPE_API_VERSION },
  });
});
