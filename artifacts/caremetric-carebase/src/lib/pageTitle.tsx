import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { APP_PAGES } from "@/lib/appDomains";
import { routePatternMatches } from "@/lib/productRoutes";

// Detail pages belong to their searchable index pages for access checks, but need their own
// labels while records load, in browser tabs, and in navigation history.
const DETAIL_PAGE_TITLES = [
  { path: "/admin/organizations/:id", label: "Organization details" },
  { path: "/admin/facilities/:id", label: "Facility details" },
  { path: "/admin/employees/:id", label: "Employee details" },
  { path: "/admin/courses/:id", label: "Training content details" },
  { path: "/admin/support-tickets/:id", label: "Support ticket" },
  { path: "/app/facilities/:id", label: "Facility details" },
  { path: "/app/employees/:id", label: "Employee details" },
  { path: "/app/courses/:id", label: "Training content details" },
  { path: "/app/policy-documents/:id", label: "Policy details" },
  { path: "/app/template-documents/:code", label: "Document template" },
  { path: "/app/incidents/:id", label: "Incident details" },
  { path: "/app/complaints/:id", label: "Complaint details" },
  { path: "/app/confidential-incidents/:id", label: "Confidential report" },
  { path: "/app/work/:id", label: "Work item" },
  { path: "/app/evidence/:id", label: "Documentation collection" },
  { path: "/app/violations/:id", label: "Violation details" },
  { path: "/app/residents/:id", label: "Resident details" },
  { path: "/app/residents/:id/chart", label: "Clinical chart" },
  { path: "/app/admissions/move-ins/:id", label: "Move-in workspace" },
  { path: "/app/change-of-condition/:id", label: "Change follow-up" },
  { path: "/app/qapi/projects/:id", label: "Quality improvement project" },
  { path: "/app/emergency/:id", label: "Emergency details" },
  { path: "/app/residents/:residentId/assessment-forms/:formId", label: "Resident assessment form" },
  { path: "/app/inspections/:id", label: "Inspection details" },
  { path: "/app/maintenance/scan/:kind/:token", label: "Maintenance QR scan" },
  { path: "/app/maintenance/:id", label: "Work order" },
  { path: "/app/help/tickets/:id", label: "Support ticket" },
  { path: "/app/schedule/setup", label: "Schedule setup" },
  { path: "/app/schedule/:id", label: "Shift details" },
  { path: "/trainer/classes/:id/kiosk", label: "Class check-in" },
  { path: "/trainer/classes/:id", label: "Class details" },
  { path: "/trainer/facilities/:id", label: "Facility details" },
  { path: "/trainer/employees/:id", label: "Employee details" },
  { path: "/me/work/:id", label: "My work item" },
  { path: "/me/residents/:id", label: "Resident chart" },
  { path: "/me/change-of-condition/:id", label: "Change follow-up" },
  { path: "/me/courses/:assignmentId/offline", label: "Offline training" },
  { path: "/me/courses/:assignmentId", label: "My training" },
  { path: "/me/courses/:assignmentId/quiz/:quizId", label: "Training quiz" },
  { path: "/me/help/tickets/:id", label: "Support ticket" },
] as const;

const PAGE_TITLES = [...APP_PAGES, ...DETAIL_PAGE_TITLES];

function pageTitleDefinition(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return PAGE_TITLES.find((page) => page.path === pathname)
    ?? PAGE_TITLES.find((page) => page.path.includes(":") && routePatternMatches(page.path, pathname));
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
  return pageTitleDefinition(location)?.label ?? null;
}

export interface PageBreadcrumb {
  label: string;
  path?: string;
}

/** Build only real, accessible ancestors; never turn intermediate URL segments into dead links. */
export function pageBreadcrumbs(
  location: string,
  currentTitle: string,
  homePath: string | null,
  resolveAccessiblePath: (path: string) => string | null,
): PageBreadcrumb[] {
  const pathname = location.split(/[?#]/, 1)[0];
  const crumbs: PageBreadcrumb[] = [];
  const seen = new Set<string>([pathname]);
  const add = (path: string, label: string) => {
    const accessible = resolveAccessiblePath(path);
    if (!accessible || seen.has(accessible)) return;
    seen.add(accessible);
    crumbs.push({ path: accessible, label });
  };
  if (homePath) add(homePath, "Home");

  const definition = pageTitleDefinition(pathname);
  if (definition) {
    const currentPattern = definition.path.split("/").filter(Boolean);
    const concreteSegments = pathname.split("/").filter(Boolean);
    const ancestors = PAGE_TITLES.filter((page) => {
      const candidate = page.path.split("/").filter(Boolean);
      return candidate.length > 1 && candidate.length < currentPattern.length
        && candidate.every((segment, index) => segment === currentPattern[index]
          || (segment.startsWith(":") && currentPattern[index].startsWith(":")));
    }).sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    for (const ancestor of ancestors) {
      const length = ancestor.path.split("/").filter(Boolean).length;
      add(`/${concreteSegments.slice(0, length).join("/")}`, ancestor.label);
    }
  }
  return [...crumbs, { label: currentTitle }];
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
