/**
 * The message of a thrown value, whatever shape it arrived in.
 *
 * `error instanceof Error ? error.message : String(error)` is the idiom most of these functions
 * use, and it has one hole that reached production: a PostgREST failure returned by the
 * supabase-js query builder is a plain `{ message, details, hint, code }` object, not an `Error`
 * (postgrest-js only wraps it in `PostgrestError` when `throwOnError` is set), so code that does
 * `if (error) throw error` and later stringifies it records the literal "[object Object]". The
 * certificate PDF worker did exactly that five times over a `permission denied for table
 * course_assignments`, and the stored error said nothing (BACKLOG Tier I).
 */
export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string") {
    return error || fallback;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === "string" && record.message) {
      const code = typeof record.code === "string" && record.code ? ` (${record.code})` : "";
      return `${record.message}${code}`;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Circular or otherwise unserializable. Nothing in it is worth more than the fallback,
      // and `String(object)` would be the "[object Object]" this helper exists to remove.
    }
    return fallback;
  }
  if (error === null || error === undefined) return fallback;
  return String(error);
}
