/**
 * XML sitemap generation for the public marketing surface.
 *
 * Single source of truth for which routes are advertised to search engines. Two
 * consumers must never drift:
 *  - server/prerender-heads.mjs calls buildSitemapXml at build time and writes the
 *    result to dist/public/sitemap.xml (the copy Railway actually serves), derived
 *    from the same MARKETING_ROUTE_META that drives per-route <head> prerendering.
 *  - src/lib/sitemap.test.ts asserts the committed public/sitemap.xml equals the
 *    generated output, so the checked-in file can't fall behind the route list.
 *
 * Pure data + string helpers only (no imports): prerender-heads.mjs bundles this
 * for Node at build time, outside the Vite browser build.
 */

/**
 * Routes present in MARKETING_ROUTE_META but deliberately excluded from the sitemap:
 * pure authentication utility pages with nothing to rank for, plus every route whose
 * RouteMeta sets `noindex` -- a page reached only by holding a token or emailed link
 * (facility poster code, guest portal, password reset). A sitemap entry for a page
 * whose own head says noindex is a contradiction, so the two lists must stay in step.
 * Conversion landing pages (/signup, /demo) and /legal/facility-signup stay indexable
 * and are intentionally NOT excluded.
 */
export const SITEMAP_EXCLUDED_ROUTES: readonly string[] = [
  "/login",
  "/report-safety",
  "/resident-portal",
  "/forgot-password",
  "/reset-password",
  // The tokenized guest and verification stems, added to MARKETING_ROUTE_META so they get a
  // noindex head instead of the homepage's. BACKLOG J74 (P3, guest). Nothing here is a page a
  // visitor can open without a credential, so none of them belongs in a sitemap.
  "/checkin",
  "/evidence-access",
  "/move-in-access",
  "/resident-agreement-access",
  "/survey-packet-access",
  "/passport",
  "/verify",
];

/**
 * Ordered list of sitemap paths derived from the marketing route metadata keys,
 * minus the excluded utility routes. Order follows MARKETING_ROUTE_META (homepage
 * first), which keeps the generated file stable across builds.
 */
export function sitemapPaths(routeKeys: readonly string[]): string[] {
  const excluded = new Set(SITEMAP_EXCLUDED_ROUTES);
  return routeKeys.filter((path) => !excluded.has(path));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Builds a valid <urlset> sitemap. `priority`, `changefreq`, and `lastmod` are
 * intentionally omitted: Google ignores the first two, and a baked-in lastmod goes
 * stale the moment any page changes without a matching sitemap edit. A bare, correct
 * <loc> list is the standard, drift-proof form.
 *
 * `siteUrl` is normalized to have no trailing slash; the homepage ("/") still emits
 * the canonical "<siteUrl>/".
 */
export function buildSitemapXml(siteUrl: string, paths: readonly string[]): string {
  const base = siteUrl.replace(/\/$/, "");
  const urls = paths
    .map((path) => {
      const loc = escapeXml(path === "/" ? `${base}/` : `${base}${path}`);
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
