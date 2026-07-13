import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

export function stripRouterBase(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base && (path === base || path.startsWith(`${base}/`))) {
    return path.slice(base.length) || "/";
  }
  return path;
}

// Keeps a set of string filter/sort/page values synced into the URL query string, so navigating
// away (opening a row) and back preserves what the user had selected instead of resetting to
// defaults on every remount. Values are read from the current URL on every render (not just
// mount) so Back/Forward navigation that changes the URL restores the same filter state, and
// written back via `replace: true` so adjusting a filter doesn't pile up back-stack entries.
//
// A value equal to its default is omitted from the URL entirely, keeping links to the "default"
// view of a page clean rather than always carrying every param.
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const search = useSearch();
  const [location, setLocation] = useLocation();

  const state = useMemo(() => {
    const params = new URLSearchParams(search);
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const v = params.get(key as string);
      if (v !== null) result[key] = v as T[keyof T];
    }
    return result;
  }, [search, defaults]);

  const setState = useCallback(
    (updates: Partial<T>) => {
      const currentSearch = typeof window !== "undefined" ? window.location.search : search;
      const currentPath =
        typeof window !== "undefined"
          ? stripRouterBase(window.location.pathname)
          : location.split("?")[0];
      const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
      for (const key of Object.keys(updates) as (keyof T)[]) {
        const value = updates[key];
        if (value === undefined || value === defaults[key]) params.delete(key as string);
        else params.set(key as string, value);
      }
      const qs = params.toString();
      setLocation(`${currentPath}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [search, location, setLocation, defaults]
  );

  return [state, setState] as const;
}
