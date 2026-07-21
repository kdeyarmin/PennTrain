import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { APP_PAGES } from "@/lib/appDomains";

// True when a concrete `location` matches an APP_PAGES `pattern` that may contain :param segments,
// e.g. "/app/incidents/:id" matches "/app/incidents/abc-123" but not "/app/incidents".
function pathMatches(pattern: string, location: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const l = location.split("/").filter(Boolean);
  if (p.length !== l.length) return false;
  return p.every((segment, i) => segment.startsWith(":") || segment === l[i]);
}

/**
 * Human label for a route, drawn from the shared APP_PAGES registry that already powers global
 * search and the sidebar. Prefers an exact path match, then a :param detail-route pattern
 * ("/app/incidents/:id"). Returns null for anything not in the registry so the caller can fall
 * back (the Header keeps its old last-segment title-casing as a final resort). This replaces the
 * Header deriving titles by title-casing the last URL segment, which mislabeled every detail route
 * (a UUID segment) with its parent list's name.
 */
export function registryLabelForPath(location: string): string | null {
  const pathname = location.split(/[?#]/, 1)[0];
  const exact = APP_PAGES.find((page) => page.path === pathname);
  if (exact) return exact.label;
  const pattern = APP_PAGES.find((page) => page.path.includes(":") && pathMatches(page.path, pathname));
  return pattern ? pattern.label : null;
}

interface PageTitleValue {
  entityTitle: string | null;
  setEntityTitle: (title: string | null) => void;
}

const PageTitleContext = createContext<PageTitleValue | null>(null);

/**
 * Holds the entity-aware title a detail page publishes (via usePageTitle) so the Header can show
 * the record itself -- an incident number, a resident's name -- instead of the section label.
 * Wraps the authenticated app shell (Header + routed pages) in MainLayout.
 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [entityTitle, setEntityTitle] = useState<string | null>(null);
  return (
    <PageTitleContext.Provider value={{ entityTitle, setEntityTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

// Returns the current entity title and its setter. Degrades to an inert value when no provider is
// present (e.g. a page rendered outside MainLayout in a test), so callers never need to null-check.
export function usePageTitleContext(): PageTitleValue {
  return useContext(PageTitleContext) ?? { entityTitle: null, setEntityTitle: () => {} };
}

/**
 * Called by a detail page to publish its resolved entity name so the header/breadcrumb and browser
 * tab show the record, not the section. Pass undefined or null while the entity is still loading --
 * the header falls back to the registry label until then. The title clears on unmount and whenever
 * it changes, so navigating between records never leaves a stale name behind.
 */
export function usePageTitle(title: string | null | undefined): void {
  const { setEntityTitle } = usePageTitleContext();
  useEffect(() => {
    setEntityTitle(title ?? null);
    return () => setEntityTitle(null);
  }, [title, setEntityTitle]);
}
