// Generic tool executor: POST into the owning app with the END USER's JWT,
// so the app's own RLS + role checks gate every read — the gateway holds no
// service-role keys for any app. The bridge already zod-validated the args;
// the app endpoint re-validates at its own boundary too.

import type { ToolDispatcher } from "../core/bridge.js";

export interface HttpToolDispatcherOptions {
  url: string;
  /** End-user JWT — held in memory for the session, never logged. */
  jwt: string;
  /** Supabase functions gateway also expects the anon key as `apikey`. */
  anonKey?: string;
  context: { facilityId: string | null; sessionId: string };
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class HttpToolDispatcher implements ToolDispatcher {
  constructor(private readonly opts: HttpToolDispatcherOptions) {}

  async dispatch(name: string, args: unknown): Promise<unknown> {
    const { url, jwt, anonKey, context, timeoutMs } = this.opts;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({ tool: name, args, context }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Model-voiceable failure; the status code stays out of the spoken
        // reply but lands in the gateway log via the tool.status event.
        return {
          ok: false,
          error: `tool_http_${res.status}`,
          message:
            "The lookup failed on our side. Apologize briefly and offer to try again.",
        };
      }
      return (await res.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}
