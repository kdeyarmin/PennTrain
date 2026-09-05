import { FunctionsHttpError } from "@supabase/supabase-js";

/**
 * An Edge Function failure that still says what went wrong, and how (BACKLOG.md I8).
 *
 * `supabase.functions.invoke` reports a non-2xx as a FunctionsHttpError whose message is the
 * unusable "Edge Function returned a non-2xx status code" -- the response body, which is where
 * every one of these functions puts its actual explanation, is left unread on the Response inside
 * `context`. So an operator who hit a real, well-worded refusal saw a sentence about HTTP.
 *
 * The status matters as much as the text: the caller has to distinguish a refusal it should show
 * verbatim from the one refusal that has an action attached -- see privilegedSessionExpired.
 */
export class EdgeFunctionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EdgeFunctionError";
    this.status = status;
  }
}

/**
 * The exact string requireFreshAal2 answers with, matched rather than re-derived because it is a
 * wire contract between _shared/privilegedIdentity.ts and this file, and a paraphrase on either
 * side silently turns the prompt below back into a bare 403.
 */
const ASSURANCE_REFUSAL = "Recent multi-factor authentication is required";

export async function edgeFunctionError(error: unknown): Promise<EdgeFunctionError | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const status = error.context?.status ?? 500;
  try {
    const body = (await error.context.json()) as { error?: unknown; message?: unknown } | null;
    const text = typeof body?.error === "string" && body.error.trim()
      ? body.error
      : typeof body?.message === "string" && body.message.trim()
        ? body.message
        : null;
    if (text) return new EdgeFunctionError(text, status);
  } catch {
    // Body was not JSON. The status is still worth carrying.
  }
  return new EdgeFunctionError(error.message, status);
}

/**
 * "Your privileged window has closed", which is NOT the same thing as "you need a second factor".
 *
 * identity_assurance_is_current measures the privileged window from `auth.sessions.created_at`,
 * and step-up verification does not reset it -- a session that has been open past
 * max_privileged_session_minutes (8 hours by default) holds a genuine aal2 JWT and still fails the
 * check. MfaPolicyGate never fires, because the assurance level really is aal2. So privileged
 * actions started answering 403 with nothing on screen explaining it and no way forward, and
 * re-verifying the factor -- the obvious thing to try -- changes nothing at all.
 *
 * Only a NEW Auth session clears it, which means signing out and back in. Anything that offers to
 * "re-verify" here would be advice that cannot work.
 */
export function privilegedSessionExpired(error: unknown): boolean {
  return error instanceof EdgeFunctionError
    && error.status === 403
    && error.message.includes(ASSURANCE_REFUSAL);
}

/** What to put on screen for it. Kept here so both surfaces say the same thing. */
export const PRIVILEGED_SESSION_EXPIRED_MESSAGE =
  "Your administrator session has been open too long for this action. Sign out and sign back in to continue -- re-verifying your authenticator will not reset it.";
