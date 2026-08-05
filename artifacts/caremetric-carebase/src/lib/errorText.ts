/**
 * The text to show a user when a mutation rejects.
 *
 * Most of this codebase narrows inline with `e instanceof Error ? e.message : String(e)`, which is
 * correct about the common case and unhelpful about the uncommon one: `String({})` is
 * `"[object Object]"`, which tells somebody standing at a workstation nothing at all.
 *
 * The uncommon case is reachable. `supabase.rpc(...)` is a POST, and POST is not in postgrest-js's
 * `RETRYABLE_METHODS` (`GET`/`HEAD`/`OPTIONS`), so a fetch failure is rethrown as the raw rejected
 * value rather than surfacing as the `{ data, error }` pair. The library's own source says why that
 * value is not necessarily an `Error`:
 *
 *   > JS allows throwing any value, and serverless or realm-crossing fetch implementations can
 *   > reject with non-Error objects. `instanceof Error` is too narrow here; narrow at the use site
 *   > with optional chaining.
 *
 * That path skips a hook's `if (error) throw new Error(error.message)` entirely -- the `await`
 * itself rejects, so the wrap never runs. Such a value still carries its text on `.message`, so
 * read that before giving up.
 *
 * Note this is about presentation, not diagnosis: the fallback is deliberately a sentence a user
 * can act on rather than a stringified object, because a toast is not a log.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;

  // PostgREST-shaped plain objects, and anything else that rejected with a text `message`.
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  if (typeof error === "string" && error.trim()) return error;

  return "Something went wrong. Please try again.";
}
