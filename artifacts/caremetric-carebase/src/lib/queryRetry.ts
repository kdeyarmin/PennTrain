import { isRlsViolation } from "./rlsErrors";

/**
 * Whether a failed read can possibly succeed if it is simply sent again.
 *
 * WHY THIS EXISTS. react-query's default is `retry: 3` with exponential backoff, and it applies
 * that to every rejection without asking what the rejection was. For a dropped connection or a 502
 * that is right. For a refusal the database will repeat verbatim it is not: the same request goes
 * out four times, and the user watches a spinner for about seven seconds before the page finally
 * says the thing it already knew at the first response.
 *
 * The repository had already worked this out three times, in three places, one query at a time:
 *
 *   - `auth.tsx` passes `retry: (n, e) => !isDefinitiveProfileAbsence(e) && n < 2`, and
 *     `authProfileErrors.ts` exists to draw exactly this line -- "PGRST116 ... is a definitive
 *     'this account has no readable profile' signal ... Everything else (Failed to fetch,
 *     timeouts, 5xx) is retryable".
 *   - `useGetEmployeeByProfileId` switched to `maybeSingle()` partly because "react-query's
 *     default retry: 3 would retry that 'error' with backoff for several seconds before finally
 *     giving up and settling `data` to undefined anyway".
 *   - Ten other queries carry a bare `retry: false` or `retry: 1`.
 *
 * That is the rule being rediscovered per call site rather than stated once, and every query that
 * has not yet been visited still waits out the backoff. Stating it in the client's defaults means a
 * permission refusal, a missing row or a malformed filter surfaces at the first response, and a
 * genuinely transient failure still gets the three attempts it always got.
 *
 * WHAT COUNTS AS PERMANENT, and why each one cannot succeed on a retry of the identical request:
 *
 *   - `PGRST116`: `.single()` matched no row (or more than one). The row count will not change
 *     because the same select ran again. This is the code `MaintenanceScan` renders as "QR code
 *     not found" and `auth.tsx` signs out on.
 *   - `42501` and any message naming a row-level-security policy: the caller's grants and org
 *     context are fixed for the request. A refusal now is a refusal in a second.
 *   - `PGRST100`/`PGRST102`/`PGRST103`/`PGRST106`: the request itself did not parse -- a bad
 *     filter, body, range or schema. The client would send the identical malformed request again.
 *   - `PGRST202`/`PGRST203`/`PGRST204`: the function or column is not in the schema cache under
 *     the name and argument list this build asked for. A deploy fixes that; a retry does not.
 *   - `42883`/`42P01`/`22P02`: undefined function, undefined table, and a value that is not valid
 *     for its column type (a malformed uuid in an `.eq()`), all decided by the request text.
 *   - `22023`/`23514`/`23503`/`23505`/`P0002`: an RPC's own `raise exception`, a check, a foreign
 *     key, a unique index, a `no_data_found`. These are the server stating a rule about the
 *     arguments it was given.
 *
 * Deliberately NOT on the list, and the omission is the point: `PGRST301` and a bare 401. A JWT
 * that has just expired is the one authorization failure a retry can fix, because supabase-js
 * refreshes the token underneath it -- so those keep all three attempts.
 */
const PERMANENT_ERROR_CODES = new Set([
  "PGRST116",
  "PGRST100",
  "PGRST102",
  "PGRST103",
  "PGRST106",
  "PGRST202",
  "PGRST203",
  "PGRST204",
  "42501",
  "42883",
  "42P01",
  "22P02",
  "22023",
  "23514",
  "23503",
  "23505",
  "P0002",
]);

export function isPermanentQueryFailure(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && PERMANENT_ERROR_CODES.has(code)) return true;
  }
  // A `WITH CHECK` refusal can arrive carrying only the sentence, which is why `isRlsViolation`
  // matches on the message as well as on 42501. Same reasoning applies here.
  return isRlsViolation(error);
}

/**
 * The client-wide read retry: three attempts for anything that might change, none for anything
 * that will not. `failureCount` is the number of failures so far, so `< 3` preserves react-query's
 * own default of three retries after the first attempt.
 */
export function defaultQueryRetry(failureCount: number, error: unknown): boolean {
  return !isPermanentQueryFailure(error) && failureCount < 3;
}
