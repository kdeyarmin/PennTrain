import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "@/hooks/useUrlState";

export type SortDirection = "asc" | "desc";

export interface PaginatedResult<T> {
  rows: T[];
  count: number;
}

export interface ServerListState<TFilters extends Record<string, string> = Record<string, string>> {
  search: string;
  debouncedSearch: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: SortDirection;
  filters: TFilters;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (field: string) => void;
  setFilter: (key: keyof TFilters, value: string) => void;
  resetFilters: () => void;
  activeFilters: { key: string; value: string }[];
  urlState: Record<string, string>;
}

export function useServerListState<TDefaults extends Record<string, string>>(
  defaults: TDefaults,
  options: { debounceMs?: number; filterKeys?: (keyof TDefaults)[] } = {},
): ServerListState<TDefaults> {
  const [urlState, setUrlState] = useUrlState(defaults);
  const [searchInput, setSearchInput] = useState(urlState.search ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(urlState.search ?? "");
  const debounceMs = options.debounceMs ?? 300;

  const commitSearchRef = useRef(() => {});
  commitSearchRef.current = () => {
    if (searchInput !== (urlState.search ?? "")) setUrlState(({ search: searchInput, page: "1" } as unknown) as Partial<TDefaults>);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput);
      commitSearchRef.current();
    }, debounceMs);
    return () => clearTimeout(t);
  }, [searchInput, debounceMs]);

  useEffect(() => {
    setSearchInput(urlState.search ?? "");
    setDebouncedSearch(urlState.search ?? "");
  }, [urlState.search]);

  const filterKeys = useMemo(() => options.filterKeys ?? (Object.keys(defaults).filter((key) => !["search", "page", "pageSize", "sortField", "sortDir"].includes(key)) as (keyof TDefaults)[]), [defaults, options.filterKeys]);

  const activeFilters = useMemo(() => filterKeys
    .filter((key) => urlState[key] !== defaults[key] && urlState[key] !== "")
    .map((key) => ({ key: key as string, value: urlState[key] })), [defaults, filterKeys, urlState]);

  return {
    search: searchInput,
    debouncedSearch,
    page: Math.max(1, Number(urlState.page) || 1),
    pageSize: Math.max(1, Number(urlState.pageSize) || 25),
    sortField: urlState.sortField ?? defaults.sortField ?? "created_at",
    sortDir: (urlState.sortDir === "asc" || urlState.sortDir === "desc" ? urlState.sortDir : defaults.sortDir ?? "desc") as SortDirection,
    filters: urlState,
    setSearch: setSearchInput,
    setPage: (page) => setUrlState(({ page: String(Math.max(1, page)) } as unknown) as Partial<TDefaults>),
    setPageSize: (pageSize) => setUrlState(({ pageSize: String(pageSize), page: "1" } as unknown) as Partial<TDefaults>),
    setSort: (field) => setUrlState(({ sortField: field, sortDir: urlState.sortField === field && urlState.sortDir === "asc" ? "desc" : "asc", page: "1" } as unknown) as Partial<TDefaults>),
    setFilter: (key, value) => setUrlState(({ [key]: value, page: "1" } as unknown) as Partial<TDefaults>),
    resetFilters: () => {
      const reset = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, value])) as Partial<TDefaults>;
      setUrlState(reset);
      setSearchInput(defaults.search ?? "");
    },
    activeFilters,
    urlState,
  };
}

// csvEscape/downloadCsv live in @/lib/csv (a pure module without React imports) so
// non-UI libs and tests can use them without pulling in hook dependencies.
export { csvEscape, downloadCsv } from "./csv";
