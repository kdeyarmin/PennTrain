import { useMutation } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface RequestDemoPayload {
  name: string;
  email: string;
  /** Facility or organization name, recorded as demo_requests.organization. */
  organization?: string;
  message?: string;
  sourcePath?: string;
  turnstileToken: string;
}

interface RequestDemoResponse {
  ok?: boolean;
  error?: string;
}

/**
 * The Edge Function returns its user-facing reason ("Too many demo requests...", "Demo request
 * verification failed...") in the JSON body of a non-2xx response, which supabase-js surfaces as a
 * generic FunctionsHttpError. Same unwrapping as useSignup's signupErrorMessage, so the visitor
 * sees why the request was refused instead of "Edge Function returned a non-2xx status code".
 */
async function requestDemoErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = (await error.context.json()) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Response body wasn't JSON -- keep the generic FunctionsHttpError message.
  }
  return null;
}

/**
 * Public, unauthenticated "have the CareMetric team set up a demo workspace" request. Posts to the
 * request-demo Edge Function, which owns Turnstile verification, the hashed-IP submission cap, the
 * service-role insert into demo_requests (no anon write policy), and the platform-admin
 * notification. Rendered on /demo when no public demo accounts are configured for the deployment.
 */
export function useRequestDemo() {
  return useMutation({
    mutationFn: async (payload: RequestDemoPayload) => {
      const { data, error } = await supabase.functions.invoke<RequestDemoResponse>("request-demo", {
        body: {
          name: payload.name,
          email: payload.email,
          organization: payload.organization || undefined,
          message: payload.message || undefined,
          source_path: payload.sourcePath,
          turnstile_token: payload.turnstileToken,
        },
      });
      if (error) {
        const parsed = await requestDemoErrorMessage(error);
        throw parsed ? new Error(parsed) : error;
      }
      // The function returns { ok: true } on success; treat anything else -- including a missing
      // or malformed body -- as a failure so the page can never show a false "received" state.
      if (!data || data.ok !== true) {
        throw new Error(data?.error ?? "We could not submit your demo request. Please try again later.");
      }
      return data;
    },
  });
}
