// Shared shapes for server-paginated list pages.
//
// A `useServerListState` hook used to live here, wrapping `useUrlState` with search debouncing and
// filter bookkeeping. No page ever adopted it -- every list page (Employees, Incidents, Violations,
// Complaints, ...) calls `useUrlState` directly with its own defaults -- so it was removed rather
// than kept as an abstraction with no users. The types below are the part that is actually shared.

export type SortDirection = "asc" | "desc";

export interface PaginatedResult<T> {
  rows: T[];
  count: number;
}

// csvEscape/downloadCsv live in @/lib/csv (a pure module without React imports) so
// non-UI libs and tests can use them without pulling in hook dependencies.
export { csvEscape, downloadCsv } from "./csv";
