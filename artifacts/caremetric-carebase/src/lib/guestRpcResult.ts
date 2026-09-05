/**
 * Unwraps the success shape of a guest RPC.
 *
 * These eight used to return a bare `boolean` or `uuid`. They return jsonb now, and the reason is
 * the denial path rather than the success path: a denied guest call has to reach the browser as an
 * error the client will notice. Measured against postgrest-js, a 403 whose body is `false` or
 * `null` arrives as a FALSY `error` with null `data` — a silent nothing, which is worse than the
 * defect it replaced — while an object body shaped like a PostgREST error arrives exactly the way
 * the old `raise` did, message and SQLSTATE intact.
 *
 * The denial had to stop raising so the throttle counters written before it survive the call; see
 * migration 20260905360000. These two helpers keep that entirely inside the data layer, so every
 * caller above still sees the boolean or the id it always saw.
 */
export function guestRpcOk(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;
}

export function guestRpcId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
