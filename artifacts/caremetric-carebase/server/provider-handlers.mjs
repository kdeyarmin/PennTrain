import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireCronRequest } from "../../../supabase/functions/_shared/cronAuth.ts";
import {
  phase2StripeGet,
  phase2StripePost,
} from "../../../supabase/functions/_shared/phase2Billing.ts";
import { createCreateBillingSessionHandler } from "../../../supabase/functions/create-billing-session/handler.ts";
import { createSmsMfaHandler } from "../../../supabase/functions/sms-mfa/handler.ts";
import { createStripeBillingWebhookHandler } from "../../../supabase/functions/stripe-billing-webhook/handler.ts";
import { createSyncBillingQuantitiesHandler } from "../../../supabase/functions/sync-billing-quantities/handler.ts";

/**
 * Run the existing provider handlers in the Railway server's environment.
 * Node 24 strips the shared handlers' erasable TypeScript at import time.
 * Database access, session assurance, signatures, and idempotency stay in those
 * handlers so the Railway and Supabase entry points enforce the same rules.
 */
export function createProviderHandlers({
  getEnv = (name) => process.env[name],
  createClient = createSupabaseClient,
  fetcher = fetch,
  stripePost = phase2StripePost,
  stripeGet = phase2StripeGet,
  verifySignature,
  sha256,
  randomUUID,
  nowIso,
  nowMs,
} = {}) {
  const runtimeEnv = (name) => {
    const configured = getEnv(name);
    if (configured !== undefined) return configured;
    if (name === "SUPABASE_URL") return getEnv("VITE_SUPABASE_URL");
    if (name === "SUPABASE_ANON_KEY") return getEnv("VITE_SUPABASE_ANON_KEY");
    return undefined;
  };
  const factories = new Map([
    ["sms-mfa", createSmsMfaHandler],
    ["create-billing-session", createCreateBillingSessionHandler],
    ["stripe-billing-webhook", createStripeBillingWebhookHandler],
    ["sync-billing-quantities", createSyncBillingQuantitiesHandler],
  ]);

  return new Map([...factories].map(([name, factory]) => [name, async (req) => {
    req.signal.throwIfAborted();
    const requestFetch = (input, init = {}) => {
      const signals = [req.signal, AbortSignal.timeout(20_000)];
      if (input instanceof Request) signals.push(input.signal);
      if (init.signal) signals.push(init.signal);
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      return fetcher(input, { ...init, signal });
    };
    const serverClient = (url, key, options = {}) => createClient(url, key, {
      ...options,
      global: { ...options.global, fetch: requestFetch },
      auth: {
        ...options.auth,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    // Each request owns its clients and cancellation scope. Never share a
    // mutable auth client or a disconnected caller's abort signal with another.
    const handler = factory({
      createClient: serverClient,
      getEnv: runtimeEnv,
      fetcher: requestFetch,
      stripePost: (path, key, values, idempotencyKey) =>
        stripePost(path, key, values, idempotencyKey, requestFetch),
      stripeGet: (path, key) => stripeGet(path, key, requestFetch),
      verifySignature,
      sha256,
      randomUUID,
      nowIso,
      nowMs,
      // Passing even an empty string prevents cronAuth's Deno env fallback.
      requireCron: (request, headers) => requireCronRequest(
        request, headers, runtimeEnv("CRON_SHARED_SECRET") ?? "",
      ),
    });
    return handler(req);
  }]));
}
