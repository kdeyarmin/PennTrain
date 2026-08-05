import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_COMMAND_ACTIONS, APP_PAGES } from "./appDomains";
import { MARKETING_NAV, MARKETING_PRODUCT_NAV, MARKETING_RESOURCES_NAV } from "./publicPaths";
import { PUBLIC_ACCESS_FLOWS } from "./publicAccessToken";
import {
  BILLING_PATHS,
  COMPLIANCE_PATHS,
  CORE_PATHS,
  TRAIN_PATHS,
  WORKFORCE_PATHS,
} from "./productModules";
import { LEGACY_ROUTE_REDIRECTS } from "./routeContracts";
import { routeRegistrationIssues, type RouteRegistrationSource } from "./routeManifest";

const appSource = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");

// Sidebar.tsx builds its own per-role nav data (getNavSections) instead of rendering APP_PAGES
// directly, so its hrefs could drift silently from both APP_PAGES and App.tsx. It's read as text
// here -- the same way appSource itself is -- rather than imported, since the component module
// pulls in hooks/providers (auth, react-query, etc.) this suite has no reason to boot.
const sidebarSource = readFileSync(resolve(__dirname, "../components/layout/Sidebar.tsx"), "utf8");

function stripQueryString(path: string): string {
  return path.split("?")[0] || "/";
}

const legacyRedirectSources = Object.keys(LEGACY_ROUTE_REDIRECTS);
const legacyRedirectDestinations = Object.values(LEGACY_ROUTE_REDIRECTS);

const storageBackedCleanPaths = PUBLIC_ACCESS_FLOWS
  .filter((flow) => flow.storageKey)
  .map((flow) => flow.cleanPath);

// Every `href: "..."` literal assigned inside getNavSections's NavItem entries, across every
// role's sections. Some are guided-action links with a query suffix (e.g.
// "/app/employees?action=add"); the registered route is the pathname portion, same treatment as
// the marketing nav's hash links below.
const sidebarPaths = [...new Set(
  [...sidebarSource.matchAll(/href:\s*"([^"]+)"/g)].map((match) => stripQueryString(match[1])),
)];

// CORE_PATHS' one intentional non-page entry: "/account" is a route-tree prefix for the shared
// /account/* pages (every /account/* route already appears in APP_PAGES and is checked below),
// not a page App.tsx registers on its own. Every other module-classification path is a concrete,
// registered leaf route, so this is the sole documented exception.
const corePathsWithOwnRoute = CORE_PATHS.filter((path) => path !== "/account");

const registrationSources: RouteRegistrationSource[] = [
  { source: "APP_PAGES role/navigation metadata", paths: APP_PAGES.map((page) => page.path) },
  {
    source: "APP_COMMAND_ACTIONS command palette actions",
    paths: APP_COMMAND_ACTIONS.map((action) => stripQueryString(action.path)),
  },
  { source: "Sidebar navigation items (Sidebar.tsx)", paths: sidebarPaths },
  {
    source: "MARKETING_NAV public navigation metadata",
    // Nav entries may be landing-page hash links (e.g. "/#pricing"); the
    // registered route is the pathname portion.
    paths: MARKETING_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  {
    source: "MARKETING_PRODUCT_NAV public navigation metadata",
    paths: MARKETING_PRODUCT_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  {
    source: "MARKETING_RESOURCES_NAV public navigation metadata",
    paths: MARKETING_RESOURCES_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  { source: "LEGACY_ROUTE_REDIRECTS source routes", paths: legacyRedirectSources },
  { source: "LEGACY_ROUTE_REDIRECTS canonical destinations", paths: legacyRedirectDestinations },
  { source: "PUBLIC_ACCESS_FLOWS token routes", paths: PUBLIC_ACCESS_FLOWS.map((flow) => flow.tokenPath) },
  { source: "PUBLIC_ACCESS_FLOWS storage-backed clean routes", paths: storageBackedCleanPaths },
  { source: "productModules.ts core module paths", paths: corePathsWithOwnRoute },
  { source: "productModules.ts train module paths", paths: TRAIN_PATHS },
  { source: "productModules.ts workforce module paths", paths: WORKFORCE_PATHS },
  { source: "productModules.ts compliance module paths", paths: COMPLIANCE_PATHS },
  { source: "productModules.ts billing module paths", paths: BILLING_PATHS },
];

describe("route registration coverage", () => {
  it("registers every route referenced by route metadata sources", () => {
    expect(routeRegistrationIssues(appSource, registrationSources)).toEqual([]);
  });

  it("keeps every sidebar navigation target in the APP_PAGES role/navigation registry", () => {
    // Sidebar.tsx filters its own nav items through canViewPath(item.href, ...), which is keyed
    // off APP_PAGES -- so a sidebar href with no APP_PAGES entry doesn't 404, it just silently
    // disappears from every role's nav with nothing in the UI to say why (e.g. a page that's
    // routed, protected, and coded into three role sections, but never actually rendered).
    const appPagePaths = new Set(APP_PAGES.map((page) => page.path));
    const sidebarPathsMissingAppPagesEntry = sidebarPaths.filter((path) => !appPagePaths.has(path));
    expect(sidebarPathsMissingAppPagesEntry).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// APP_PAGES promises what the route grants
// ---------------------------------------------------------------------------------------------
//
// The tests above check that every navigation target IS a registered route. They do not check who
// the route lets in. APP_PAGES.roles drives the sidebar, the command palette and canViewPath();
// ProtectedRoute's allowedRoles decides what actually happens. Widening one without the other
// produces a page the app offers and then refuses -- a dead end that looks like a permissions bug
// to the person who followed it, and, in the other direction, a page hidden from someone entitled
// to it.
//
// Reported as a list rather than one failing pair so a drift affecting several pages is visible in
// one run. Routes whose roles are an inline array and routes whose roles are a named constant are
// both resolved; the split on route boundaries matters, because a window-based regex pairs a path
// with a LATER route's allowedRoles whenever the route between them uses the other form.
function roleConstants(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const match of text.matchAll(/const ([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g)) {
    const values = [...match[2].matchAll(/"([a-z_]+)"/g)].map((value) => value[1]);
    if (values.length) out[match[1]] = values;
  }
  return out;
}

function routeAllowedRoles(): Map<string, string[] | null> {
  const constants = roleConstants(appSource);
  const routes = new Map<string, string[] | null>();
  for (const chunk of appSource.split("<Route ").slice(1)) {
    const path = chunk.match(/^path="([^"]+)"/)?.[1];
    if (!path || routes.has(path)) continue;
    const rolesRaw = chunk.match(/allowedRoles=\{(\[[^\]]*\]|[A-Z][A-Z0-9_]*)\}/)?.[1];
    if (!rolesRaw) continue;
    routes.set(path, rolesRaw.startsWith("[")
      ? [...rolesRaw.matchAll(/"([a-z_]+)"/g)].map((value) => value[1])
      : constants[rolesRaw] ?? null);
  }
  return routes;
}

describe("APP_PAGES role metadata agrees with the route guards", () => {
  const routes = routeAllowedRoles();

  it("offers no page to a role its route refuses", () => {
    const offeredButRefused = APP_PAGES.flatMap((page) => {
      const allowed = routes.get(stripQueryString(page.path));
      if (!allowed) return [];
      const extra = page.roles.filter((role) => !allowed.includes(role));
      return extra.length
        ? [`${page.path}: APP_PAGES offers [${extra.join(", ")}]; route allows [${allowed.join(", ")}]`]
        : [];
    });
    expect(offeredButRefused).toEqual([]);
  });

  // The reverse direction is deliberately NOT asserted. A route admitting a role the page does not
  // advertise is how two intentional postures are expressed here: trainers reach /app, /app/employees
  // and /app/facilities but are navigated to the /trainer/* equivalents, and platform_admin can open
  // several /app/* operator surfaces without them appearing in an admin menu built from /admin/*.
  // Asserting that empty would encode "every route grant must be advertised", which is not the rule
  // this app follows. The direction that always indicates a defect is the one above: a page the app
  // offers and the route then refuses is a dead end the user cannot distinguish from a broken
  // permission.

  it("resolves a route for every registered page, so neither assertion can pass vacuously", () => {
    const unresolved = APP_PAGES.filter((page) => !routes.has(stripQueryString(page.path)));
    expect(unresolved.map((page) => page.path)).toEqual([]);
  });
});
