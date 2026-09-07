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
  /**
   * The session's own token stopped being accepted (401/403 from the app's
   * tool endpoint). Nothing here can refresh it — the browser holds the
   * refresh token, not the gateway — so the session must end and SAY SO,
   * rather than answering every remaining question with an apology.
   */
  onAuthRejected?: () => void;
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
        // An expired sign-in is not "the lookup failed". The browser hands its
        // access token over once at session creation and nothing refreshes it,
        // so a session that outlives the token's hour turns every remaining
        // tool call into a 401 — and the model, told only that something went
        // wrong, apologizes and offers to try again, forever. Name it, end the
        // session, and let the person hear why.
        // 401 and 403 both end the session -- neither will start working again inside it -- but
        // they are not the same fact and must not be told to the person as if they were.
        // `voice-tools` answers 401 for an invalid or expired session and 403 for a profile that
        // is inactive, a role no longer permitted, or a profile lookup that failed. Sending
        // somebody to sign in again fixes the first and does nothing for the second, so the model
        // was telling a deactivated user to do the one thing that could not help them.
        if (res.status === 401 || res.status === 403) {
          this.opts.onAuthRejected?.();
          return {
            ok: false,
            error: `tool_http_${res.status}`,
            message: res.status === 401
              ? "The user's sign-in has expired, so this cannot be looked up. Tell them their "
                + "sign-in expired and that this session is ending; they can start voice again "
                + "after signing back in. Do not offer to retry."
              : "The user's account is no longer permitted to use the voice assistant, so this "
                + "cannot be looked up. Tell them their access has changed and that this session "
                + "is ending, and that an administrator can tell them why. Do not tell them to "
                + "sign in again, and do not offer to retry.",
          };
        }
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
