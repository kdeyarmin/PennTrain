import type { createClient as SupabaseCreateClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireSmsMfaFloor } from "../_shared/smsMfaFloor.ts";
import {
  buildDisabledPushSubscriptionPatch,
  buildPushSubscriptionRow,
  isAllowedWebPushEndpoint,
  validatedWebPushKeys,
} from "../_shared/webPush.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { channelProviderConfigured } from "../_shared/notificationDelivery.ts";

const CORS_OPTIONS = {
  headers: "authorization, x-client-info, apikey, content-type",
  methods: "GET, POST, DELETE, OPTIONS",
};

interface SubscriptionBody {
  subscription?: {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
  endpoint?: string;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req, CORS_OPTIONS) },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

// Removal remains possible for a previously stored endpoint that is no longer supported.
function validRemovalEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 40 || value.length > 4096) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function createPushSubscriptionsHandler({
  createClient,
  getEnv = (name: string) => Deno.env.get(name),
}: {
  createClient: typeof SupabaseCreateClient;
  getEnv?: (name: string) => string | undefined;
}) {
  return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req, CORS_OPTIONS);
  if (!["GET", "POST", "DELETE"].includes(req.method)) return json(req, { error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);
  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: "Push service is not configured" }, 500);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json(req, { error: "Invalid or expired session" }, 401);
  const assurance = await requireSmsMfaFloor(caller);
  if (!assurance.ok) return json(req, { error: assurance.error, code: assurance.code }, assurance.status);
  const { data: profile, error: profileError } = await caller.from("profiles")
    .select("id,organization_id,is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active || !profile.organization_id) return json(req, { error: "Active organization profile required" }, 403);

  if (req.method === "GET") {
    const publicKey = getEnv("WEB_PUSH_VAPID_PUBLIC_KEY");
    return channelProviderConfigured("web_push", getEnv)
      ? json(req, { publicKey }) : json(req, { error: "Web push is not configured" }, 503);
  }
  let body: SubscriptionBody;
  try {
    body = await readJsonBody<SubscriptionBody>(req);
    if (Array.isArray(body)) return json(req, { error: "Invalid JSON body" }, 400);
  } catch (error) {
    return json(req, { error: error instanceof RequestBodyError ? error.message : "Invalid JSON body" },
      error instanceof RequestBodyError ? error.status : 400);
  }
  const admin = createClient(supabaseUrl, serviceKey);
  if (req.method === "DELETE") {
    if (!validRemovalEndpoint(body.endpoint)) return json(req, { error: "A valid HTTPS endpoint is required" }, 400);
    const { error } = await admin.from("push_subscriptions")
      .update(buildDisabledPushSubscriptionPatch("user_unsubscribed"))
      .eq("profile_id", user.id).eq("endpoint_hash", await sha256(body.endpoint));
    return error ? json(req, { error: "Failed to disable push subscription" }, 500) : json(req, { disabled: true });
  }

  if (!channelProviderConfigured("web_push", getEnv)) return json(req, { error: "Web push is not configured" }, 503);

  const subscription = body.subscription;
  if (!isAllowedWebPushEndpoint(subscription?.endpoint)) {
    return json(req, { error: "This browser's push service is not supported. Try Chrome, Firefox, Safari, or Microsoft Edge." }, 400);
  }
  const keys = await validatedWebPushKeys(subscription?.keys?.p256dh, subscription?.keys?.auth);
  if (!keys) {
    return json(req, { error: "A valid browser PushSubscription is required" }, 400);
  }
  let expiration: string | null = null;
  if (subscription.expirationTime !== undefined && subscription.expirationTime !== null) {
    const value = subscription.expirationTime;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= Date.now()
      || !Number.isFinite(new Date(value).getTime())) {
      return json(req, { error: "A valid future subscription expiration is required" }, 400);
    }
    expiration = new Date(value).toISOString();
  }
  const userAgent = req.headers.get("user-agent") || "unknown";
  const { error } = await admin.from("push_subscriptions").upsert(
    buildPushSubscriptionRow({
      organizationId: profile.organization_id,
      profileId: user.id,
      endpoint: subscription.endpoint,
      endpointHash: await sha256(subscription.endpoint),
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
      expirationTime: expiration,
      userAgentHash: await sha256(userAgent),
      now: new Date().toISOString(),
    }),
    { onConflict: "endpoint_hash" },
  );
  return error ? json(req, { error: "Failed to save push subscription" }, 500) : json(req, { active: true }, 201);
  };
}
