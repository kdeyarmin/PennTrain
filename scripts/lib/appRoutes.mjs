// Shared reading of App.tsx's route table, and the rule for whether a route can serve a link.
//
// Two checks enforce the same invariant against the same route table from opposite sides:
// check-server-route-links.mjs reads link literals out of migrations and edge functions, and
// check-frontend-route-links.mjs reads them out of the CareBase client. Both answer "does a
// declared route serve this path?", and that question has exactly one correct answer, so it lives
// in one place rather than being reimplemented per caller.

/**
 * Fallback prefix list, used only if the route table cannot be read.
 *
 * This was the whole governed set, hand-maintained, and it covered the authenticated app and
 * nothing else. App.tsx also declares the entire public and guest surface -- `/login`, `/signup`,
 * `/evidence-access/:token`, `/move-in-access/:token`, `/passport/:slug`, `/verify/:slug`, the
 * marketing pages -- and a typo or a renamed route in any of those links passed both checks
 * untouched, because the literal did not start with one of these seven strings. Those are the links
 * an unauthenticated surveyor or a family member follows, so they are the ones with the least
 * margin for a 404. `governedPrefixes()` derives the set from the routes themselves instead.
 */
export const APP_PREFIXES = ["/app", "/admin", "/account", "/employee", "/trainer", "/me", "/portal"];

/** Route paths declared in App.tsx. */
export function declaredRoutes(appSource) {
  return [...appSource.matchAll(/<Route\s+path=\{?["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

/**
 * The first path segment of every declared route -- the set of prefixes these checks govern.
 *
 * Derived rather than listed so the governed surface cannot drift from the routing surface: a new
 * top-level route family is covered the day it is declared, with nobody remembering to widen a
 * constant. The bare `/` root is excluded deliberately -- it would govern every absolute string in
 * the codebase, including API paths and storage keys, which is a different check with a much larger
 * allowlist.
 */
export function governedPrefixes(routes) {
  const prefixes = new Set();
  for (const route of routes) {
    const segment = route.split("/")[1];
    if (segment && !segment.startsWith(":")) prefixes.add(`/${segment}`);
  }
  return [...prefixes].sort();
}

/**
 * Whether a declared route can serve this link.
 *
 * `:param` matches one segment. A link ending in `/` is a concatenation prefix, so it is tested as
 * though an id follows it -- that is what the server actually produces. A query string is not part
 * of the route: `/app/alerts?status=open` is `/app/alerts`, and several notification links carry
 * deep-link filters that way. A hash is dropped for the same reason -- `#section` is an anchor
 * within a page, not a route segment.
 */
export function routeMatches(route, link) {
  const pathname = link.split("?")[0].split("#")[0];
  const candidates = pathname.endsWith("/") ? [pathname.slice(0, -1), `${pathname}id`] : [pathname];
  const pattern = new RegExp(
    `^${route.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`,
  );
  return candidates.some((candidate) => pattern.test(candidate));
}

/**
 * True when `value` is an in-app path this family of checks is responsible for.
 *
 * `prefixes` defaults to the hand-maintained list only so a caller that has not read App.tsx still
 * works; every real caller passes `governedPrefixes(declaredRoutes(...))`.
 */
export function isInAppPath(value, prefixes = APP_PREFIXES) {
  return prefixes.some((p) => value === p || value.startsWith(`${p}/`));
}
