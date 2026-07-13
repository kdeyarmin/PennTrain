/**
 * Single source of truth for the public (signed-out) surface of the site.
 *
 * Two consumers must agree on this list, so it lives in one place:
 *  - MarketingLayout renders these in the header nav and footer.
 *  - AuthProvider allows these paths for signed-out visitors; anything else
 *    bounces to /login. If a marketing page isn't listed here, loading it
 *    directly (refresh, bookmark, new tab) would redirect to login.
 */
export const MARKETING_NAV = [
  { href: "/features", label: "Features" },
  { href: "/who-its-for", label: "Who It's For" },
  { href: "/security", label: "Security" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/faq", label: "FAQ" },
] as const;

const MARKETING_PATHS: readonly string[] = MARKETING_NAV.map((item) => item.href);

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
    p.startsWith("/evidence-access/") ||
    p.startsWith("/verify/") ||
    p.startsWith("/evidence-access/") ||
    MARKETING_PATHS.includes(p)
  );
}

export function loginRedirectTarget(search: string): string {
  const candidate = new URLSearchParams(search).get("redirect") ?? "/";
  return /^\/(?!\/)(?!login(?:[?#]|$))[^\\]*$/.test(candidate) ? candidate : "/";
}
