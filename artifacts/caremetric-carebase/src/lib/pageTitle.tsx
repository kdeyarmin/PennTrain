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

const OPAQUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Last-resort human label for a route the APP_PAGES registry does not carry, derived from the URL.
 *
 * Title-cases the last path segment -- except when that segment is an opaque record id (a UUID or a
 * bare number), in which case it uses the segment above it, so `/app/residents/<uuid>` reads
 * "Residents" rather than "Ab2C6Aba 1C36 4Fe4 ...".
 *
 * That exception is the whole point of this function, and it is shared because it was previously
 * written twice and only one copy had it. The Header had it; MainLayout's "Recents" recorder did
 * not, under a comment claiming it did ("so Recents reads 'Incident detail', not a raw UUID"). The
 * registry carries :param patterns for the /admin detail routes only, so every detail route under
 * /app, /me and /trainer -- around thirty of them -- fell to the unguarded copy and wrote a
 * title-cased UUID into the user's own navigation history, where it persists in
 * navigation_preferences until it ages out. A browser journey caught it on screen:
 * "Ab2c6aba 1c36 4fe4 B03b 6b8879f138a8" sitting in the sidebar under RECENT.
 *
 * Query strings and fragments are stripped first, matching registryLabelForPath, so a caller that
 * has not pre-trimmed the location does not title-case `?tab=x` into the label.
 */
export function pathFallbackLabel(location: string): string {
  const pathname = location.split(/[?#]/, 1)[0];
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Dashboard";
  const last = segments[segments.length - 1];
  const isOpaque = OPAQUE_ID_RE.test(last) || (last.trim() !== "" && !Number.isNaN(Number(last)));
  const chosen = isOpaque && segments.length > 1 ? segments[segments.length - 2] : last;
  return chosen.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

// Stable inert fallback for renders outside a provider (e.g. a page mounted alone in a test). Kept
// module-scoped so `setEntityTitle` has a constant identity -- returning a fresh object/closure each
// render would retrigger usePageTitle's effect (which depends on setEntityTitle) on every render.
const INERT_PAGE_TITLE: PageTitleValue = { entityTitle: null, setEntityTitle: () => {} };

// Returns the current entity title and its setter. Degrades to the inert value when no provider is
// present, so callers never need to null-check.
export function usePageTitleContext(): PageTitleValue {
  return useContext(PageTitleContext) ?? INERT_PAGE_TITLE;
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
