import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { requireFreshAal2 } from "../_shared/privilegedIdentity.ts";
import { STRIPE_API_VERSION } from "../_shared/phase2Billing.ts";
import { BillingSessionPlanError, planBillingSession } from "../_shared/billingSessionPlan.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = "authorization, x-client-info, apikey, content-type, idempotency-key, x-correlation-id, x-request-id";

export type StripePostFn = (
  path: string,
  secretKey: string,
  values: Record<string, unknown>,
  idempotencyKey?: string,
) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => any;

export interface CreateBillingSessionDependencies {
  createClient: ClientFactory;
  stripePost: StripePostFn;
  getEnv?: (name: string) => string | undefined;
  randomUUID?: () => string;
  nowIso?: () => string;
}

export function createCreateBillingSessionHandler({
  createClient,
  stripePost,
  getEnv = (name) => Deno.env.get(name),
  randomUUID = () => crypto.randomUUID(),
  nowIso = () => new Date().toISOString(),
}: CreateBillingSessionDependencies) {
  function json(req: Request, body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeadersForRequest(req, { headers: CORS_HEADERS, getEnv }),
      },
    });
  }

  return async (req: Request): Promise<Response> => {

  if (req.method === "OPTIONS") return corsPreflightResponse(req, { headers: CORS_HEADERS, getEnv });
  if (req.method !== "POST") return json(req, { error: { code: "method_not_allowed" } }, 405);

  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
    return json(req, { error: { code: "billing_not_configured" } }, 503);
  }
  const authorization = req.headers.get("authorization");
  if (!authorization) return json(req, { error: { code: "unauthorized" } }, 401);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json(req, { error: { code: "unauthorized" } }, 401);
  const assurance = await requireFreshAal2(callerClient, "billing_admin");
  if (!assurance.ok) {
    return json(
      req,
      { error: { code: assurance.status === 503 ? "billing_state_unavailable" : "fresh_aal2_required" } },
      assurance.status,
    );
  }
  const { data: profile, error: profileError } = await callerClient.from("profiles")
    .select("id, email, role, organization_id, is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active) {
    return json(req, { error: { code: "forbidden" } }, 403);
  }

  let body: {
    organizationId?: string;
    action?: "checkout" | "portal";
    packageId?: string;
    billingInterval?: "month" | "year";
    quantity?: number;
    seatQuantity?: number;
    successUrl?: string;
    cancelUrl?: string;
    returnUrl?: string;
    idempotencyKey?: string;
  };
  try {
    body = await readJsonBody(req, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json(
        req,
        { error: { code: error.status === 413 ? "payload_too_large" : "invalid_json" } },
        error.status,
      );
    }
    return json(req, { error: { code: "invalid_json" } }, 400);
  }
  const organizationId = profile.role === "platform_admin"
    ? body.organizationId
    : profile.organization_id;
  if (!organizationId || !UUID.test(organizationId) ||
    (profile.role !== "platform_admin" && body.organizationId && body.organizationId !== organizationId)) {
    return json(req, { error: { code: "invalid_organization" } }, 403);
  }
  if (profile.role !== "platform_admin") {
    const { data: hasPermission, error: permissionError } = await callerClient.rpc(
      "has_effective_permission",
      {
        p_permission_key: "billing.account.manage",
        p_scope_type: "organization",
        p_scope_id: organizationId,
        p_at: nowIso(),
      },
    );
    if (permissionError || (!hasPermission && profile.role !== "org_admin")) {
      return json(req, { error: { code: "forbidden" } }, 403);
    }
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let plan;
  try { plan = await planBillingSession({admin,profile,organizationId,body,getEnv,nowIso}); }
  catch (error) {
    if (error instanceof BillingSessionPlanError) return json(req,{error:{code:error.code}},error.status);
    throw error;
  }
  const {kind,checkoutConfiguration} = plan;
  const correlationId = (req.headers.get("x-correlation-id") || randomUUID()).slice(0, 200);
  const requestId = (req.headers.get("x-request-id") || randomUUID()).slice(0, 200);
  const suppliedIdempotency = req.headers.get("idempotency-key") || body.idempotencyKey;
  // Preserve the native default until the shared organization reservation owns
  // concurrency for both the interactive and delegated session entry points.
  const idempotencyKey = suppliedIdempotency?.slice(0,200) ?? (kind === "checkout"
    ? `checkout:${organizationId}:${body.packageId}:${checkoutConfiguration!.billingInterval}:${checkoutConfiguration!.quantity}:${new Date().toISOString().slice(0,13)}`
    : `billing-session:${organizationId}:${randomUUID()}`);
  const stripeResult = await stripePost(plan.path,stripeSecretKey,plan.values,idempotencyKey);

  if (!stripeResult.ok) {
    console.error("Stripe billing session creation failed", {
      status: stripeResult.status,
      organizationId,
      correlationId,
    });
    return json(req, { error: { code: "stripe_request_failed" }, meta: { correlationId } }, 502);
  }
  const sessionId = typeof stripeResult.data.id === "string" ? stripeResult.data.id : null;
  const url = typeof stripeResult.data.url === "string" ? stripeResult.data.url : null;
  if (!sessionId || !url) return json(req, { error: { code: "invalid_stripe_response" } }, 502);

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
    new_values: { kind, stripe_session_id: sessionId, checkout_configuration: checkoutConfiguration },
  });
  if (auditError) console.error("Billing session audit persistence failed", { correlationId });
  const expiresAt = typeof stripeResult.data.expires_at === "number"
    ? new Date(stripeResult.data.expires_at * 1000).toISOString()
    : undefined;
  return json(req, {
    data: { kind, sessionId, url, checkoutConfiguration, ...(expiresAt ? { expiresAt } : {}) },
    meta: { requestId, correlationId, stripeApiVersion: STRIPE_API_VERSION },
  });
  };
}
