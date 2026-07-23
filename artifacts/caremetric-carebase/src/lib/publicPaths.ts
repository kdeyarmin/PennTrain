/**
 * Single source of truth for the public (signed-out) surface of the site.
 *
 * Several consumers must agree on this list, so it lives in one place:
 *  - MarketingLayout renders these in the header nav and footer.
 *  - AuthProvider allows these paths for signed-out visitors; anything else
 *    bounces to /login. If a marketing page isn't listed here, loading it
 *    directly (refresh, bookmark, new tab) would redirect to login.
 *
 * The header is deliberately split into a short row of primary links plus a
 * grouped "Resources" menu: ten top-level links overflowed the bar and
 * collided with the logo. MARKETING_NAV holds the primary links;
 * MARKETING_RESOURCES_NAV holds the secondary (mostly PA regulatory) pages
 * that fold into the dropdown. Both are still public pages, so both feed the
 * auth allow-list below.
 */
export const MARKETING_NAV = [
  { href: "/#platform", label: "Platform" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/savings", label: "Savings" },
  { href: "/#pricing", label: "Pricing" },
] as const;

/**
 * Secondary links grouped under the header's "Resources" dropdown (and listed
 * flat, under a heading, in the mobile menu). Each is a standalone public page.
 */
export const MARKETING_RESOURCES_NAV = [
  { href: "/pa-training-requirements", label: "PA requirements guide" },
  { href: "/pa-dhs-citations", label: "Top DHS citations" },
  { href: "/regulatory-updates", label: "Regulatory updates" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "About" },
] as const;

/**
 * Marketing routes that live outside the header nav (footer / legal links)
 * but must still be reachable while signed out.
 */
export const MARKETING_EXTRA_PATHS = [
  "/security",
  "/privacy",
  "/terms",
  // Retired page from the previous marketing site; kept public so old
  // bookmarks still resolve (App.tsx redirects it to /features).
  "/who-its-for",
  // Retired lead-capture form; kept public so old bookmarks still resolve
  // (App.tsx redirects it to /demo).
  "/request-demo",
] as const;

const MARKETING_PATHS: readonly string[] = [
  // Nav entries may be landing-page hash links (e.g. "/#pricing"); only real
  // pathnames belong in the auth guard's allow list.
  ...MARKETING_NAV.map((item) => item.href).filter((href) => !href.includes("#")),
  ...MARKETING_RESOURCES_NAV.map((item) => item.href).filter((href) => !href.includes("#")),
  ...MARKETING_EXTRA_PATHS,
];

// Deployments may serve the app under a base path (vite `base` / BASE_PATH,
// e.g. "/train/"). Wouter strips this before matching routes, but the auth
// guard checks the raw window.location.pathname -- so strip it here too, or a
// signed-out visitor loading "/train/features" directly would be bounced to
// /login. Empty ("") when the app is served from the root.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function stripBase(path: string): string {
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) {
    return path.slice(BASE.length) || "/";
  }
  return path;
}

/** True for any path a signed-out visitor may view without being sent to /login. */
export function isPublicPath(path: string): boolean {
  const stripped = stripBase(path);
  // Normalize a trailing slash (e.g. "/demo/") so copied/shared links and CDN
  // rewrites still match the exact-string comparisons below.
  const p = stripped.length > 1 && stripped.endsWith("/") ? stripped.slice(0, -1) : stripped;
  return (
    p === "/" ||
    p === "/login" ||
    p === "/demo" ||
    p === "/signup" ||
    p === "/forgot-password" ||
    p === "/reset-password" ||
    p === "/report-safety" ||
    p === "/resident-portal" ||
    p.startsWith("/evidence-access/") ||
    p.startsWith("/move-in-access/") ||
    p.startsWith("/resident-agreement-access/") ||
    p.startsWith("/verify/") ||
    p.startsWith("/passport/") ||
    MARKETING_PATHS.includes(p)
  );
}

export function loginRedirectTarget(search: string): string {
  const candidate = new URLSearchParams(search).get("redirect") ?? "/";
  return /^\/(?!\/)(?!login(?:[?#]|$))[^\\]*$/.test(candidate) ? candidate : "/";
}
