import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type ProviderFunctionName = "sms-mfa" | "create-billing-session";
type ProviderFunctionResult = { data: unknown; error: Error | null };

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep the existing UI's application codes, never an upstream body, message, or headers. */
function errorDetails(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  const validCode = (code: unknown): code is string =>
    typeof code === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(code);
  if (validCode(value.code)) result.code = value.code;
  if (isRecord(value.error) && validCode(value.error.code)) result.error = { code: value.error.code };
  return result;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body
    || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Invalid response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Invalid response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/**
 * Railway serves these two provider handlers on the app's own origin. The rollout flag is
 * compiled into the browser; a failed call never changes runtimes or repeats a mutation.
 * Supabase remains the default for local development and releases before the server cutover.
 */
export async function invokeProviderFunction<TBody extends object>(
  name: ProviderFunctionName,
  options: { body: TBody },
): Promise<ProviderFunctionResult> {
  if (name !== "sms-mfa" && name !== "create-billing-session") {
    return { data: null, error: new Error("This service request is not supported.") };
  }
  const runtime = import.meta.env.VITE_PROVIDER_RUNTIME;
  if (runtime === undefined || runtime === "supabase") {
    return supabase.functions.invoke(name, options);
  }
  if (runtime !== "railway") {
    return { data: null, error: new Error("This service is not configured correctly.") };
  }
  const base = import.meta.env.BASE_URL;
  // Vite can also accept full URLs or relative bases. Neither is allowed to choose where an
  // authenticated provider request goes. Only an absolute path on this app's origin is valid.
  if (typeof base !== "string" || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) {
    return { data: null, error: new Error("This service is not configured correctly.") };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Request deadline exceeded"));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      deadline,
      (async (): Promise<ProviderFunctionResult> => {
        const { data: auth, error: authError } = await supabase.auth.getSession();
        // getSession may refresh an expired session. If it outlives the deadline, it must not
        // start a payment or send a code after the caller has already received a failure.
        controller.signal.throwIfAborted();
        const token = auth.session?.access_token;
        if (authError || typeof token !== "string" || !token.trim()) {
          return { data: null, error: new Error("Sign in again to continue.") };
        }
        const response = await fetch(`${base}api/providers/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(options.body),
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        let data: unknown;
        try {
          data = await readJson(response);
        } catch {
          if (response.ok) throw new Error("Invalid response");
        }
        controller.signal.throwIfAborted();
        if (!response.ok) {
          return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(errorDetails(data)), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          })) };
        }
        if (!isRecord(data)) throw new Error("Invalid response");
        return { data, error: null };
      })(),
    ]);
  } catch {
    // Do not expose network messages, auth errors, provider bodies, or a request's token/URL.
    return { data: null, error: new Error("The service request could not be confirmed. Check the current status before trying again.") };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
