import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const HUB_APP_READ_AUTHORIZE = "https://support-hub-web-production.up.railway.app/api/internal/admin/authorize";
const HUB_APP_COMMAND_AUTHORIZE = "https://support-hub-web-production.up.railway.app/api/internal/command/carebase/authorize";
const HUB_APP_LEARNING_AUTHORIZE = "https://support-hub-web-production.up.railway.app/api/internal/learning/carebase/authorize";

export class AdminError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function httpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must be an HTTPS origin.`);
  }
  return url.origin;
}

/** No inferred accounts. Mapping is an explicit server-side deployment grant. */
export function readPlatformAdminConfig(getEnv = (name) => process.env[name]) {
  const enabled = getEnv("CAREMETRIC_ADMIN_ENABLED");
  if (enabled === undefined || enabled === "false") return { enabled: false };
  if (enabled !== "true") throw new Error("CAREMETRIC_ADMIN_ENABLED must be true or false.");
  const hubUrl = httpsOrigin(getEnv("HUB_SUPABASE_URL"), "HUB_SUPABASE_URL");
  const hubKey = getEnv("HUB_SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!hubKey.startsWith("sb_publishable_")) throw new Error("HUB_SUPABASE_PUBLISHABLE_KEY must be a publishable key.");
  const supabaseUrl = httpsOrigin(getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL"), "SUPABASE_URL");
  const builtUrl = getEnv("VITE_SUPABASE_URL");
  if (builtUrl && httpsOrigin(builtUrl, "VITE_SUPABASE_URL") !== supabaseUrl) {
    throw new Error("Central administration must use the frontend's CareBase project.");
  }
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceKey || serviceKey.startsWith("sb_publishable_")) throw new Error("A server-only SUPABASE_SERVICE_ROLE_KEY is required.");
  let rawMap;
  try { rawMap = JSON.parse(getEnv("CAREMETRIC_ADMIN_IDENTITY_MAP_JSON") ?? ""); }
  catch { throw new Error("CAREMETRIC_ADMIN_IDENTITY_MAP_JSON must contain explicit UUID mappings."); }
  if (!rawMap || Array.isArray(rawMap) || typeof rawMap !== "object") throw new Error("Invalid central administrator identity map.");
  const entries = Object.entries(rawMap);
  if (!entries.length || entries.length > 100 || entries.some(([hubId, nativeId]) => !UUID.test(hubId) || typeof nativeId !== "string" || !UUID.test(nativeId))) {
    throw new Error("Central administrator mappings must contain 1–100 UUID pairs.");
  }
  const identities = new Map(entries.map(([hubId, nativeId]) => [hubId.toLowerCase(), nativeId.toLowerCase()]));
  if (identities.size !== entries.length || new Set(identities.values()).size !== entries.length) {
    throw new Error("Each central administrator must map to one distinct CareBase identity.");
  }
  const revision = getEnv("RAILWAY_GIT_COMMIT_SHA");
  const sourceRevision = typeof revision === "string" && /^[0-9a-f]{40}$/i.test(revision) ? revision.toLowerCase() : null;
  const commandFlag = getEnv("CAREMETRIC_ADMIN_COMMANDS_ENABLED");
  if (commandFlag !== undefined && commandFlag !== "true" && commandFlag !== "false") throw new Error("CAREMETRIC_ADMIN_COMMANDS_ENABLED must be true or false.");
  const billingFlag = getEnv("CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED");
  const checkoutFlag = getEnv("CAREMETRIC_ADMIN_CHECKOUT_COMMANDS_ENABLED");
  const packageFlag = getEnv("CAREMETRIC_ADMIN_PACKAGE_INGESTION_ENABLED");
  if (packageFlag !== undefined && packageFlag !== "true" && packageFlag !== "false") throw new Error("CAREMETRIC_ADMIN_PACKAGE_INGESTION_ENABLED must be true or false.");
  if (checkoutFlag !== undefined && checkoutFlag !== "true" && checkoutFlag !== "false") throw new Error("CAREMETRIC_ADMIN_CHECKOUT_COMMANDS_ENABLED must be true or false.");
  if (billingFlag !== undefined && billingFlag !== "true" && billingFlag !== "false") throw new Error("CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED must be true or false.");
  return { enabled: true, hubUrl, hubKey, supabaseUrl, serviceKey, identities, sourceRevision, commandsEnabled: commandFlag === "true",
    billingCommandsEnabled: billingFlag === "true", checkoutCommandsEnabled: checkoutFlag === "true", packageIngestionEnabled: packageFlag === "true", stripeKey: getEnv("STRIPE_SECRET_KEY")?.trim() || null };
}

export async function boundedFetch(fetcher, requestSignal, input, init = {}, maximumBytes = MAX_UPSTREAM_BYTES) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4100000) throw new Error('Invalid response limit');
  const signals = [requestSignal, AbortSignal.timeout(8000)];
  if (input instanceof Request) signals.push(input.signal);
  if (init.signal) signals.push(init.signal);
  const signal = AbortSignal.any(signals);
  const response = await fetcher(input, { ...init, signal, redirect: "error" });
  if (!response.body) return response;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new Error("Source response exceeds limit"); }
      chunks.push(Buffer.from(value));
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  return new Response(Buffer.concat(chunks, bytes), { status: response.status, statusText: response.statusText, headers: response.headers });
}


export async function authorizePlatformAdmin(request, { config, command = false, learning = false, sessionRequired = false, operation, parseOperation, createClient = createSupabaseClient, fetcher = fetch, now = () => new Date() }) {
  if (learning && !command) throw new AdminError(403, "forbidden");
  if (!config.enabled) throw new AdminError(503, "unconfigured");
  if (request.method !== "POST") throw new AdminError(405, "method_not_allowed");
  // The Hub backend calls this endpoint. It is never a browser cross-origin API.
  if (request.headers.has("origin")) throw new AdminError(403, "forbidden");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new AdminError(415, "unsupported_content_type");
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) throw new AdminError(401, "unauthenticated");
  const makeClient = (url, key, headers = {}) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers, fetch: (input, init) => boundedFetch(fetcher, request.signal, input, init,
      learning && command && operation?.operation === 'source'
      && String(input instanceof Request ? input.url : input) === `${config.supabaseUrl}/rest/v1/rpc/get_learning_authoring_source`
        ? 4100000 : MAX_UPSTREAM_BYTES) },
  });
  let actor, authenticationMethod;
  if (authorization.startsWith("Bearer cmh_")) {
    if (!/^Bearer cmh_[A-Za-z0-9_-]{43}$/.test(authorization)) throw new AdminError(401, "unauthenticated");
    // Distinct endpoints consume distinct audiences. A read ticket cannot authorize a command.
    const result = await boundedFetch(fetcher, request.signal, learning ? HUB_APP_LEARNING_AUTHORIZE : command ? HUB_APP_COMMAND_AUTHORIZE : HUB_APP_READ_AUTHORIZE, {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: "{}",
    });
    if (!result.ok) throw new AdminError(result.status === 401 || result.status === 403 ? result.status : 503,
      result.status === 401 ? "unauthenticated" : result.status === 403 ? "forbidden" : "upstream");
    actor = await result.json();
    if (actor?.method !== "sms" || typeof parseOperation !== "function" || !operation) throw new AdminError(403, "forbidden");
    let approved;
    try { approved = parseOperation(actor.operation); } catch { throw new AdminError(403, "forbidden"); }
    if (!isDeepStrictEqual(approved, operation)) throw new AdminError(403, "forbidden");
    authenticationMethod = "app_sms";
  } else {
    const hub = makeClient(config.hubUrl, config.hubKey, { Authorization: authorization });
    const { data, error: actorError, status: actorStatus } = await hub.schema("hub").rpc(command || sessionRequired ? "authorize_platform_command" : "authorize_platform_admin");
    if (actorError) {
      if (actorStatus === 401 || actorError.code === "28000") throw new AdminError(401, "unauthenticated");
      if (actorError.code === "42501") throw new AdminError(403, "forbidden");
      throw new AdminError(503, "upstream");
    }
    actor = data;
    if (actor?.aal !== "aal2") throw new AdminError(403, "forbidden");
    authenticationMethod = "jwt_aal2";
  }
  if (!actor || actor.role !== "platform_admin" || typeof actor.user_id !== "string" || !UUID.test(actor.user_id)) {
    throw new AdminError(403, "forbidden");
  }
  const nativeId = config.identities.get(actor.user_id.toLowerCase());
  if (!nativeId) throw new AdminError(403, "forbidden");
  const native = makeClient(config.supabaseUrl, config.serviceKey);
  const [profileResult, userResult] = await Promise.all([
    native.from("profiles").select("id,role,is_active").eq("id", nativeId).maybeSingle(),
    native.auth.admin.getUserById(nativeId),
  ]);
  if (profileResult.error) throw new AdminError(503, "upstream");
  if (userResult.error) throw new AdminError(userResult.error.status === 404 ? 403 : 503, userResult.error.status === 404 ? "forbidden" : "upstream");
  const profile = profileResult.data;
  const user = userResult.data?.user;
  const timestamp = now();
  if (!profile || profile.id !== nativeId || profile.role !== "platform_admin" || profile.is_active !== true
    || !user || user.id !== nativeId || user.is_anonymous === true || user.deleted_at
    || (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > timestamp.getTime()))) {
    throw new AdminError(403, "forbidden");
  }

  if (command || sessionRequired) {
    const started = Date.parse(actor.session_started_at);
    const expires = Date.parse(actor.assurance_expires_at);
    if (typeof actor.session_id !== "string" || !UUID.test(actor.session_id)
      || typeof actor.session_started_at !== "string" || typeof actor.assurance_expires_at !== "string"
      || !Number.isFinite(started) || !Number.isFinite(expires)
      || started < timestamp.getTime() - 480 * 60_000 || started > timestamp.getTime() + 5 * 60_000
      || expires <= timestamp.getTime() || expires > started + 480 * 60_000) throw new AdminError(403, "forbidden");
  }
  return { native, nativeId, actor, authenticationMethod, timestamp };
}
