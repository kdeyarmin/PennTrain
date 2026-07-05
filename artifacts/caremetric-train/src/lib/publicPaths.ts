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

/** True for any path a signed-out visitor may view without being sent to /login. */
export function isPublicPath(path: string): boolean {
  return (
    path === "/" ||
    path === "/login" ||
    path === "/forgot-password" ||
    path.startsWith("/verify/") ||
    MARKETING_PATHS.includes(path)
  );
}
