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

// Inclusive [from, to] row range for a 1-indexed page, as `.range()` expects.
export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (Math.max(1, page) - 1) * pageSize
  return [from, from + pageSize - 1]
}
