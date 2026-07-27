import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// PostgREST's or()/and() mini-language treats ',', '.', ':', '(', ')' as structural delimiters --
// left unescaped, a search term containing any of them (e.g. "Smith, Jane" or "Acme (East)") can
// split into extra conditions or otherwise change the filter's logical structure instead of
// erroring. Wrapping the value in double quotes and escaping embedded backslashes/quotes is
// PostgREST's own documented escape hatch for values inside or()/and().
export function escapeOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

// escapeOrValue above only protects PostgREST's *filter syntax*; the value it quotes is still
// handed to ILIKE as a pattern, where '%', '_' and '\' are LIKE metacharacters. Interpolating a
// raw search term into `%...%` therefore turned every roster search box into a wildcard query --
// a bare '%' matched every row and 'P_ain' matched 'Plain' -- instead of literal-text search.
// This is the client-side half of the same defect migration
// 20260724190003_escape_work_item_search_wildcards.sql fixed for the work-queue RPCs; keep the two
// escape orders identical (backslash first, or the escapes we add would themselves be escaped).
// Postgres LIKE treats '\' as the default escape character, so no explicit ESCAPE clause is needed,
// and escapeOrValue's own backslash doubling round-trips these back to a single '\' at the server.
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

// The full "user typed this into a search box" -> PostgREST or()/ilike value pipeline: match the
// term literally anywhere in the column, with both the LIKE pattern and the or() syntax escaped.
export function containsFilterValue(search: string): string {
  return escapeOrValue(`%${escapeLikePattern(search)}%`)
}

// Inclusive [from, to] row range for a 1-indexed page, as `.range()` expects.
export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (Math.max(1, page) - 1) * pageSize
  return [from, from + pageSize - 1]
}

// "some_status" -> "Some Status" -- shared formatter for the many snake_case enum/status values
// (incident types, corrective-action statuses, etc.) rendered as plain-language labels throughout
// the app. Canonical copy of what used to be duplicated verbatim across several page components.
export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}
